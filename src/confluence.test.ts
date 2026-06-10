import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConfluenceClient } from "./confluence.js";

const config = { baseUrl: "https://rd.dtsphere.com", username: "u", password: "p" };

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

describe("ConfluenceClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("getPageById 拼对 URL 并带 Basic 认证头", async () => {
    const f = mockFetch(200, {
      id: "123", title: "T", space: { key: "DEV" },
      version: { number: 4 }, body: { view: { value: "<p>hi</p>" } },
    });
    const c = new ConfluenceClient(config, f);
    const page = await c.getPageById("123");

    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe("https://rd.dtsphere.com/rest/api/content/123?expand=body.view,space,version");
    expect((init.headers as any).Authorization).toBe("Basic " + Buffer.from("u:p").toString("base64"));
    expect(page).toEqual({
      id: "123", title: "T", spaceKey: "DEV", version: 4,
      bodyHtml: "<p>hi</p>",
      url: "https://rd.dtsphere.com/pages/viewpage.action?pageId=123",
    });
  });

  it("401 抛认证失败", async () => {
    const c = new ConfluenceClient(config, mockFetch(401, {}));
    await expect(c.getPageById("123")).rejects.toThrow(/认证失败/);
  });

  it("404 抛未找到", async () => {
    const c = new ConfluenceClient(config, mockFetch(404, {}));
    await expect(c.getPageById("999")).rejects.toThrow(/未找到/);
  });

  it("search 返回标题/pageId/url 列表", async () => {
    const f = mockFetch(200, { results: [{ id: "1", title: "A" }, { id: "2", title: "B" }] });
    const c = new ConfluenceClient(config, f);
    const hits = await c.search("关键词", 10);

    const [url] = (f as any).mock.calls[0];
    expect(url).toContain("/rest/api/content/search?cql=");
    expect(url).toContain("limit=10");
    // CQL 应限定 type=page（编码后包含 type%3Dpage）
    expect(decodeURIComponent(url)).toContain('type=page AND text~"关键词"');
    expect(hits).toEqual([
      { id: "1", title: "A", url: "https://rd.dtsphere.com/pages/viewpage.action?pageId=1" },
      { id: "2", title: "B", url: "https://rd.dtsphere.com/pages/viewpage.action?pageId=2" },
    ]);
  });

  // 构造下载图片用的 mock：可控 content-type 和字节
  function mockImageFetch(status: number, contentType: string, bytes: Uint8Array) {
    return vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? contentType : null) },
      arrayBuffer: async () => bytes.buffer,
    })) as unknown as typeof fetch;
  }

  it("fetchImage 返回 base64 + mimeType，并带认证头", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const f = mockImageFetch(200, "image/png", bytes);
    const c = new ConfluenceClient(config, f);
    const img = await c.fetchImage("https://rd.dtsphere.com/download/attachments/1/a.png");

    const [, init] = (f as any).mock.calls[0];
    expect((init.headers as any).Authorization).toBe("Basic " + Buffer.from("u:p").toString("base64"));
    expect(img).toEqual({
      url: "https://rd.dtsphere.com/download/attachments/1/a.png",
      base64: Buffer.from(bytes).toString("base64"),
      mimeType: "image/png",
    });
  });

  it("fetchImage 对非图片响应返回 null", async () => {
    const c = new ConfluenceClient(config, mockImageFetch(200, "text/html", new Uint8Array([0])));
    expect(await c.fetchImage("https://x/notimg")).toBeNull();
  });

  it("fetchImage 对 4xx/5xx 返回 null", async () => {
    const c = new ConfluenceClient(config, mockImageFetch(404, "image/png", new Uint8Array([0])));
    expect(await c.fetchImage("https://x/missing.png")).toBeNull();
  });
});
