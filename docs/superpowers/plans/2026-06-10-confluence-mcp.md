# Confluence MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 stdio MCP server，让 Claude Code 能按 pageId/URL 取回内部 Confluence 页面正文（Markdown）并按关键词搜索。

**Architecture:** 分层单进程：`config` 读环境变量，`url`/`html` 是纯函数（解析引用、HTML→Markdown），`confluence` 封装 REST 调用，`tools` 把它们组合成两个 MCP 工具，`index` 装配并连 stdio。

**Tech Stack:** Node.js v20 + TypeScript、`@modelcontextprotocol/sdk`、`turndown`、`zod`、原生 `fetch`、`vitest`。

**项目根目录：** `/Users/huangrui/confluence-mcp`（已 init git，已含 spec 与 .gitignore）。

---

### Task 1: 项目脚手架与依赖

**Files:**
- Create: `/Users/huangrui/confluence-mcp/package.json`
- Create: `/Users/huangrui/confluence-mcp/tsconfig.json`
- Create: `/Users/huangrui/confluence-mcp/vitest.config.ts`

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "confluence-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "confluence-mcp": "dist/index.js" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "turndown": "^7.2.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/turndown": "^5.0.5",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: 写 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

- [ ] **Step 3: 写 vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 4: 安装依赖**

Run: `cd /Users/huangrui/confluence-mcp && npm install`
Expected: 生成 `node_modules` 与 `package-lock.json`，无报错。

- [ ] **Step 5: 提交**

```bash
cd /Users/huangrui/confluence-mcp
git add package.json package-lock.json tsconfig.json vitest.config.ts
git commit -m "chore: 初始化 TS 项目脚手架与依赖"
```

---

### Task 2: URL / pageId 解析（纯函数，TDD）

**Files:**
- Create: `/Users/huangrui/confluence-mcp/src/url.ts`
- Test: `/Users/huangrui/confluence-mcp/src/url.test.ts`

- [ ] **Step 1: 写失败测试**

`src/url.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parsePageRef } from "./url.js";

describe("parsePageRef", () => {
  it("纯数字按 pageId 处理", () => {
    expect(parsePageRef("90394821")).toEqual({ kind: "id", pageId: "90394821" });
  });

  it("viewpage.action?pageId= 形式 URL 解析出 pageId", () => {
    const u = "https://rd.dtsphere.com/pages/viewpage.action?pageId=90394821";
    expect(parsePageRef(u)).toEqual({ kind: "id", pageId: "90394821" });
  });

  it("带额外 query 参数也能取出 pageId", () => {
    const u = "https://rd.dtsphere.com/pages/viewpage.action?spaceKey=DEV&pageId=123&foo=bar";
    expect(parsePageRef(u)).toEqual({ kind: "id", pageId: "123" });
  });

  it("/display/SPACE/Title 形式解析出空间与标题", () => {
    const u = "https://rd.dtsphere.com/display/DEV/My+Page+Title";
    expect(parsePageRef(u)).toEqual({ kind: "title", spaceKey: "DEV", title: "My Page Title" });
  });

  it("非法输入抛错", () => {
    expect(() => parsePageRef("https://rd.dtsphere.com/")).toThrow(/无法解析/);
    expect(() => parsePageRef("")).toThrow(/无法解析/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/huangrui/confluence-mcp && npx vitest run src/url.test.ts`
Expected: FAIL，提示找不到模块 `./url.js` 或 `parsePageRef` 未定义。

- [ ] **Step 3: 写实现**

`src/url.ts`:

```ts
// 页面引用：要么是已知 pageId，要么是空间+标题（需再查一次）
export type PageRef =
  | { kind: "id"; pageId: string }
  | { kind: "title"; spaceKey: string; title: string };

// 把用户输入（纯 pageId / 完整 URL）解析为 PageRef。
// 兼容 viewpage.action?pageId= 与 /display/SPACE/Title 两种 URL 形式。
export function parsePageRef(input: string): PageRef {
  const raw = input.trim();
  if (raw === "") throw new Error(`无法解析页面引用：输入为空`);

  // 纯数字 → 直接当 pageId
  if (/^\d+$/.test(raw)) return { kind: "id", pageId: raw };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`无法解析页面引用：${raw}`);
  }

  // 形式一：?pageId=xxx（无论路径后缀是什么，只看 query）
  const pageId = url.searchParams.get("pageId");
  if (pageId && /^\d+$/.test(pageId)) return { kind: "id", pageId };

  // 形式二：/display/SPACE/Title
  const m = url.pathname.match(/\/display\/([^/]+)\/([^/]+)\/?$/);
  if (m) {
    const spaceKey = decodeURIComponent(m[1]);
    // Confluence 标题里空格常编码为 +，先转空格再 decode
    const title = decodeURIComponent(m[2].replace(/\+/g, " "));
    return { kind: "title", spaceKey, title };
  }

  throw new Error(`无法解析页面引用：${raw}`);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/huangrui/confluence-mcp && npx vitest run src/url.test.ts`
Expected: PASS，5 个用例全绿。

- [ ] **Step 5: 提交**

```bash
cd /Users/huangrui/confluence-mcp
git add src/url.ts src/url.test.ts
git commit -m "feat: 实现 URL/pageId 解析 parsePageRef"
```

---

### Task 3: HTML → Markdown 转换（纯函数，TDD）

**Files:**
- Create: `/Users/huangrui/confluence-mcp/src/html.ts`
- Test: `/Users/huangrui/confluence-mcp/src/html.test.ts`

- [ ] **Step 1: 写失败测试**

`src/html.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "./html.js";

describe("htmlToMarkdown", () => {
  it("标题转 #", () => {
    expect(htmlToMarkdown("<h1>Title</h1>")).toBe("# Title");
  });

  it("无序列表转 -", () => {
    const md = htmlToMarkdown("<ul><li>a</li><li>b</li></ul>");
    expect(md).toContain("- a");
    expect(md).toContain("- b");
  });

  it("代码块用 fenced 风格", () => {
    const md = htmlToMarkdown("<pre><code>const x = 1;</code></pre>");
    expect(md).toContain("```");
    expect(md).toContain("const x = 1;");
  });

  it("链接转 markdown 链接", () => {
    const md = htmlToMarkdown('<a href="https://x.com">X</a>');
    expect(md).toBe("[X](https://x.com)");
  });

  it("空输入返回空串", () => {
    expect(htmlToMarkdown("")).toBe("");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/html.test.ts`
Expected: FAIL，提示找不到 `./html.js` 或 `htmlToMarkdown` 未定义。

- [ ] **Step 3: 写实现**

`src/html.ts`:

```ts
import TurndownService from "turndown";

// 用 fenced 代码块风格，更贴合 Markdown 阅读习惯
const service = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// 把 Confluence 渲染出的 HTML 正文转成 Markdown 文本。
export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  return service.turndown(html);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/huangrui/confluence-mcp && npx vitest run src/html.test.ts`
Expected: PASS，5 个用例全绿。

- [ ] **Step 5: 提交**

```bash
cd /Users/huangrui/confluence-mcp
git add src/html.ts src/html.test.ts
git commit -m "feat: 实现 HTML 转 Markdown"
```

---

### Task 4: 配置读取与校验

**Files:**
- Create: `/Users/huangrui/confluence-mcp/src/config.ts`
- Test: `/Users/huangrui/confluence-mcp/src/config.test.ts`

- [ ] **Step 1: 写失败测试**

`src/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

const FULL = {
  CONFLUENCE_BASE_URL: "https://rd.dtsphere.com",
  CONFLUENCE_USERNAME: "u",
  CONFLUENCE_PASSWORD: "p",
};

describe("loadConfig", () => {
  it("三个变量齐全时返回配置，并去掉 baseUrl 末尾斜杠", () => {
    const cfg = loadConfig({ ...FULL, CONFLUENCE_BASE_URL: "https://rd.dtsphere.com/" });
    expect(cfg).toEqual({
      baseUrl: "https://rd.dtsphere.com",
      username: "u",
      password: "p",
    });
  });

  it("缺少变量时抛错并指出缺哪个", () => {
    const { CONFLUENCE_PASSWORD, ...rest } = FULL;
    expect(() => loadConfig(rest)).toThrow(/CONFLUENCE_PASSWORD/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/huangrui/confluence-mcp && npx vitest run src/config.test.ts`
Expected: FAIL，`loadConfig` 未定义。

- [ ] **Step 3: 写实现**

`src/config.ts`:

```ts
export interface Config {
  baseUrl: string;
  username: string;
  password: string;
}

// 从环境变量映射读取并校验配置。传入 env 便于测试。
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = env.CONFLUENCE_BASE_URL;
  const username = env.CONFLUENCE_USERNAME;
  const password = env.CONFLUENCE_PASSWORD;

  const missing: string[] = [];
  if (!baseUrl) missing.push("CONFLUENCE_BASE_URL");
  if (!username) missing.push("CONFLUENCE_USERNAME");
  if (!password) missing.push("CONFLUENCE_PASSWORD");
  if (missing.length > 0) {
    throw new Error(`缺少环境变量：${missing.join(", ")}`);
  }

  return {
    // 去掉末尾斜杠，后续拼接 /rest/... 不会出现双斜杠
    baseUrl: baseUrl!.replace(/\/+$/, ""),
    username: username!,
    password: password!,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/huangrui/confluence-mcp && npx vitest run src/config.test.ts`
Expected: PASS，2 个用例全绿。

- [ ] **Step 5: 提交**

```bash
cd /Users/huangrui/confluence-mcp
git add src/config.ts src/config.test.ts
git commit -m "feat: 实现配置读取与校验"
```

---

### Task 5: ConfluenceClient（REST 调用，TDD with mocked fetch）

**Files:**
- Create: `/Users/huangrui/confluence-mcp/src/confluence.ts`
- Test: `/Users/huangrui/confluence-mcp/src/confluence.test.ts`

- [ ] **Step 1: 写失败测试**

`src/confluence.test.ts`:

```ts
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
    expect(hits).toEqual([
      { id: "1", title: "A", url: "https://rd.dtsphere.com/pages/viewpage.action?pageId=1" },
      { id: "2", title: "B", url: "https://rd.dtsphere.com/pages/viewpage.action?pageId=2" },
    ]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/confluence.test.ts`
Expected: FAIL，`ConfluenceClient` 未定义。

- [ ] **Step 3: 写实现**

`src/confluence.ts`:

```ts
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
    const cql = encodeURIComponent(`text~"${query}"`);
    const url = `${this.config.baseUrl}/rest/api/content/search?cql=${cql}&limit=${limit}`;
    const data = await this.get(url);
    return (data.results ?? []).map((r: any) => ({
      id: r.id,
      title: r.title,
      url: this.pageUrl(r.id),
    }));
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/huangrui/confluence-mcp && npx vitest run src/confluence.test.ts`
Expected: PASS，4 个用例全绿。

- [ ] **Step 5: 提交**

```bash
cd /Users/huangrui/confluence-mcp
git add src/confluence.ts src/confluence.test.ts
git commit -m "feat: 实现 ConfluenceClient REST 客户端"
```

---

### Task 6: MCP 工具 + 入口装配

**Files:**
- Create: `/Users/huangrui/confluence-mcp/src/tools.ts`
- Create: `/Users/huangrui/confluence-mcp/src/index.ts`

> 说明：工具 handler 主要是装配逻辑（解析→调用客户端→格式化），核心逻辑已在
> url/html/confluence 三个模块各自单测覆盖，这里不再写单测，靠 Task 7 的真实联调验证。

- [ ] **Step 1: 写 tools.ts（注册两个工具）**

`src/tools.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ConfluenceClient } from "./confluence.js";
import { parsePageRef } from "./url.js";
import { htmlToMarkdown } from "./html.js";

// 把两个工具注册到 server 上。client 注入便于复用与测试。
export function registerTools(server: McpServer, client: ConfluenceClient): void {
  // 工具一：按 pageId 或完整 URL 取页面正文（Markdown）
  server.tool(
    "get_page",
    "按 pageId 或完整 Confluence URL 取回页面标题与正文（Markdown）",
    { ref: z.string().describe("pageId（如 90394821）或完整页面 URL") },
    async ({ ref }) => {
      const pref = parsePageRef(ref);
      const page =
        pref.kind === "id"
          ? await client.getPageById(pref.pageId)
          : await client.getPageByTitle(pref.spaceKey, pref.title);
      const md = htmlToMarkdown(page.bodyHtml);
      const header =
        `# ${page.title}\n\n` +
        `空间：${page.spaceKey} | 版本：${page.version} | 链接：${page.url}\n\n---\n\n`;
      return { content: [{ type: "text", text: header + md }] };
    },
  );

  // 工具二：按关键词搜索页面
  server.tool(
    "search_pages",
    "按关键词搜索 Confluence 页面，返回标题/pageId/链接列表",
    {
      query: z.string().describe("搜索关键词"),
      limit: z.number().int().positive().max(50).optional().describe("结果数量上限，默认 10"),
    },
    async ({ query, limit }) => {
      const hits = await client.search(query, limit ?? 10);
      if (hits.length === 0) {
        return { content: [{ type: "text", text: `未找到与「${query}」匹配的页面` }] };
      }
      const lines = hits.map(
        (h) => `- ${h.title}（pageId=${h.id}）\n  ${h.url}`,
      );
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
```

- [ ] **Step 2: 写 index.ts（入口）**

`src/index.ts`:

```ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { ConfluenceClient } from "./confluence.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  // 配置缺失时直接退出，错误打到 stderr（stdout 留给 MCP 协议）
  const config = loadConfig();
  const client = new ConfluenceClient(config);

  const server = new McpServer({ name: "confluence-mcp", version: "0.1.0" });
  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(`[confluence-mcp] 启动失败：${err.message}`);
  process.exit(1);
});
```

- [ ] **Step 3: 构建确认无类型错误**

Run: `npm run build`
Expected: 生成 `dist/`，`tsc` 无报错。

- [ ] **Step 4: 跑全部单测**

Run: `cd /Users/huangrui/confluence-mcp && npm test`
Expected: url/html/config/confluence 全部 PASS。

- [ ] **Step 5: 提交**

```bash
cd /Users/huangrui/confluence-mcp
git add src/tools.ts src/index.ts
git commit -m "feat: 注册 MCP 工具并装配 stdio 入口"
```

---

### Task 7: README + 真实联调验证

**Files:**
- Create: `/Users/huangrui/confluence-mcp/README.md`

- [ ] **Step 1: 写 README**

`README.md`:

```markdown
# Confluence MCP Server

让 Claude Code 直接读取内部 Confluence 文档（站点 https://rd.dtsphere.com）。
基于 Confluence Server/DC 的 REST API，只读。

## 工具

- `get_page` — 传 pageId 或完整页面 URL，返回标题 + Markdown 正文。URL 后缀变化也能自动解析出 pageId。
- `search_pages` — 传关键词，返回匹配页面的标题 / pageId / 链接列表。

## 安装

    npm install && npm run build

## 配置（接入 Claude Code）

在 ~/.claude.json 的 mcpServers 中加入：

    {
      "mcpServers": {
        "confluence": {
          "command": "node",
          "args": ["/Users/huangrui/confluence-mcp/dist/index.js"],
          "env": {
            "CONFLUENCE_BASE_URL": "https://rd.dtsphere.com",
            "CONFLUENCE_USERNAME": "<用户名>",
            "CONFLUENCE_PASSWORD": "<密码>"
          }
        }
      }
    }

> 认证用 HTTP Basic，密码会明文存于 ~/.claude.json。若 Confluence 支持
> Personal Access Token，建议用 token 替代密码（用法相同，可单独吊销）。
```

- [ ] **Step 2: 提交 README**

```bash
cd /Users/huangrui/confluence-mcp
git add README.md
git commit -m "docs: 添加 README 使用说明"
```

- [ ] **Step 3: 真实联调——取正文**

用真实凭据真连服务器（凭据走环境变量，不写进文件、不提交）：

```bash
cd /Users/huangrui/confluence-mcp
CONFLUENCE_BASE_URL="https://rd.dtsphere.com" \
CONFLUENCE_USERNAME="<用户名>" \
CONFLUENCE_PASSWORD="<密码>" \
node -e '
import("./dist/confluence.js").then(async ({ ConfluenceClient }) => {
  const c = new ConfluenceClient({
    baseUrl: process.env.CONFLUENCE_BASE_URL,
    username: process.env.CONFLUENCE_USERNAME,
    password: process.env.CONFLUENCE_PASSWORD,
  });
  const p = await c.getPageById("90394821");
  console.log("OK:", p.title, "| 正文长度", p.bodyHtml.length);
});
'
```
Expected: 打印 `OK: <页面标题> | 正文长度 <非零数字>`。
若报「认证失败」→ 检查凭据；若报「未找到」→ 检查 pageId 是否仍有效。

- [ ] **Step 4: 真实联调——搜索**

```bash
cd /Users/huangrui/confluence-mcp
CONFLUENCE_BASE_URL="https://rd.dtsphere.com" \
CONFLUENCE_USERNAME="<用户名>" \
CONFLUENCE_PASSWORD="<密码>" \
node -e '
import("./dist/confluence.js").then(async ({ ConfluenceClient }) => {
  const c = new ConfluenceClient({
    baseUrl: process.env.CONFLUENCE_BASE_URL,
    username: process.env.CONFLUENCE_USERNAME,
    password: process.env.CONFLUENCE_PASSWORD,
  });
  const hits = await c.search("test", 5);
  console.log("搜索命中", hits.length, "条:", hits.map(h => h.title));
});
'
```
Expected: 打印命中条数与标题数组（可能为 0，只要不报错即认证与接口通）。

- [ ] **Step 5: 写入 Claude Code 配置并重启验证**

把 Task 7 README 里的 mcpServers 片段填入 `~/.claude.json`（填真实凭据），
重启 Claude Code，确认 `confluence` server 已连接、`get_page` / `search_pages` 两个工具可见。

---

## 验证清单（整体）

- [ ] `npm test` 全绿（url / html / config / confluence 四组单测）。
- [ ] `npm run build` 无类型错误，生成 `dist/`。
- [ ] 真实联调取 pageId 90394821 正文成功（Task 7 Step 3）。
- [ ] 真实联调搜索接口连通（Task 7 Step 4）。
- [ ] Claude Code 重启后能看到并调用两个工具（Task 7 Step 5）。
- [ ] `git status` 干净，且 `node_modules`/`dist` 未被提交、凭据未进 git。
