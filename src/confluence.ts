import type { Config } from "./config.js";

export interface Page {
  id: string;
  title: string;
  spaceKey: string;
  version: number;
  bodyHtml: string;
  url: string;
}

export interface SearchHit {
  id: string;
  title: string;
  url: string;
}

// 下载下来的图片：base64 数据 + MIME 类型，供 MCP 以 image 块返回
export interface FetchedImage {
  url: string;
  base64: string;
  mimeType: string;
}

// 封装 Confluence Server/DC 的只读 REST 调用。fetch 可注入便于测试。
export class ConfluenceClient {
  constructor(
    private config: Config,
    private fetchFn: typeof fetch = fetch,
  ) {}

  // Basic 认证头
  private authHeader(): string {
    const token = Buffer.from(
      `${this.config.username}:${this.config.password}`,
    ).toString("base64");
    return `Basic ${token}`;
  }

  // 构造页面的浏览链接（统一用 viewpage.action 形式）
  private pageUrl(id: string): string {
    return `${this.config.baseUrl}/pages/viewpage.action?pageId=${id}`;
  }

  // 统一发起 GET 请求，集中处理 401/404/其他错误
  private async get(url: string): Promise<any> {
    const res = await this.fetchFn(url, {
      headers: { Authorization: this.authHeader(), Accept: "application/json" },
    });
    if (res.status === 401) throw new Error("认证失败，请检查用户名/密码");
    if (res.status === 404) throw new Error("未找到对应的页面");
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Confluence 请求失败（${res.status}）：${body}`);
    }
    return res.json();
  }

  // 把 API 返回的 content 对象映射为 Page
  private toPage(data: any): Page {
    return {
      id: data.id,
      title: data.title,
      spaceKey: data.space?.key ?? "",
      version: data.version?.number ?? 0,
      bodyHtml: data.body?.view?.value ?? "",
      url: this.pageUrl(data.id),
    };
  }

  async getPageById(pageId: string): Promise<Page> {
    const url = `${this.config.baseUrl}/rest/api/content/${pageId}?expand=body.view,space,version`;
    return this.toPage(await this.get(url));
  }

  async getPageByTitle(spaceKey: string, title: string): Promise<Page> {
    const url =
      `${this.config.baseUrl}/rest/api/content` +
      `?spaceKey=${encodeURIComponent(spaceKey)}` +
      `&title=${encodeURIComponent(title)}` +
      `&expand=body.view,space,version`;
    const data = await this.get(url);
    const first = data.results?.[0];
    if (!first) throw new Error(`未找到页面：${spaceKey}/${title}`);
    return this.toPage(first);
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    // 限定 type=page，否则 CQL 会把附件（id 形如 attXXX）也搜进来，
    // 这些 id 不是页面、无法被 getPageById 取回。
    const cql = encodeURIComponent(`type=page AND text~"${query}"`);
    const url = `${this.config.baseUrl}/rest/api/content/search?cql=${cql}&limit=${limit}`;
    const data = await this.get(url);
    return (data.results ?? []).map((r: any) => ({
      id: r.id,
      title: r.title,
      url: this.pageUrl(r.id),
    }));
  }

  // 带认证下载单张图片，返回 base64。失败时返回 null（不让单张图拖垮整页）。
  async fetchImage(url: string): Promise<FetchedImage | null> {
    try {
      const res = await this.fetchFn(url, {
        headers: { Authorization: this.authHeader() },
      });
      if (!res.ok) {
        // 记录失败状态码，便于排查认证问题
        console.error(`[fetchImage] ${res.status} ${res.statusText} — ${url}`);
        return null;
      }
      const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "";
      // 只接受图片类型，避免把登录页 HTML 之类的当图片塞给模型
      if (!mimeType.startsWith("image/")) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return { url, base64: buf.toString("base64"), mimeType };
    } catch {
      return null;
    }
  }
}
