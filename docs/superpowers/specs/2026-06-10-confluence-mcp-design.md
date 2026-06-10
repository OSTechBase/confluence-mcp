# Confluence MCP Server 设计文档

## Context（背景）

用户需要在 Claude Code 中直接读取公司内部 Confluence 文档（站点 `https://rd.dtsphere.com`）。
典型页面 URL 形如 `https://rd.dtsphere.com/pages/viewpage.action?pageId=90394821`：
路径后缀可能变化，`pageId` 一定会变。

该站点是 **Atlassian Confluence Server / Data Center**，自带 REST API，
因此无需爬取 HTML，给定 `pageId` 即可通过 API 取回页面正文。本项目构建一个
MCP server，让 Claude Code 能按 pageId / URL 取正文、按关键词搜索文档。

预期结果：用户在 Claude Code 里贴一个 Confluence 链接或关键词，模型即可读到对应文档内容。

## 目标与非目标

**目标**
- 给定 `pageId` 或完整页面 URL，返回页面标题 + 正文（Markdown）。
- 给定关键词，搜索 Confluence 并返回标题 / pageId / 链接列表。
- 凭据通过环境变量传入，不写入代码、不提交 git。

**非目标（YAGNI）**
- 不做页面创建 / 编辑 / 删除（只读）。
- 不做附件下载、评论、权限管理。
- 不做缓存层、分页遍历整个空间。
- 不支持 Confluence Cloud 的 API token 差异（本站点是 Server/DC）。

## 认证

HTTP Basic Auth：`Authorization: Basic base64(username:password)`。

凭据来自环境变量：
- `CONFLUENCE_BASE_URL` — 如 `https://rd.dtsphere.com`
- `CONFLUENCE_USERNAME`
- `CONFLUENCE_PASSWORD`

启动时若任一变量缺失，立即报错退出并提示缺哪个变量。

> ⚠️ 安全说明：Claude Code 的 MCP 配置（`~/.claude.json`）为明文存储，
> 密码会明文落在配置文件中，这是 Basic Auth 的固有缺点。若日后 Confluence
> 支持 Personal Access Token，可将 `CONFLUENCE_PASSWORD` 替换为 token（用法相同，
> 可单独吊销）。本期按用户名+密码实现。

## 架构

stdio 传输的单进程 MCP server，分层清晰：

```
src/
  index.ts        # 入口：读环境变量、装配 server、注册工具、连 stdio
  config.ts       # 读取并校验环境变量，导出 Config
  confluence.ts   # ConfluenceClient：封装 REST 调用与认证
  url.ts          # parsePageRef：从 URL/pageId 字符串解析出 pageId
  html.ts         # htmlToMarkdown：HTML 正文转 Markdown
  tools.ts        # 三个工具的 schema 与 handler，调用上面各模块
```

每个文件单一职责：`url.ts` 和 `html.ts` 是纯函数（最易测试），
`confluence.ts` 只管 HTTP，`tools.ts` 把它们组合成 MCP 工具。

## 模块职责与接口

**config.ts**
- `loadConfig(): Config` — 从 `process.env` 读三个变量，缺失则抛错。
- `Config = { baseUrl: string; username: string; password: string }`

**url.ts**
- `parsePageRef(input: string): PageRef` — 输入可能是纯 pageId、
  `viewpage.action?pageId=xxx` 形式 URL、或 `/display/SPACE/Title` 形式 URL。
- 返回 `{ kind: 'id', pageId } | { kind: 'title', spaceKey, title }`。
- 纯函数，无网络，是单测重点。

**confluence.ts**
- `class ConfluenceClient { constructor(config) }`
- `getPageById(pageId): Promise<Page>` —
  `GET /rest/api/content/{id}?expand=body.view,space,version`
- `getPageByTitle(spaceKey, title): Promise<Page>` —
  `GET /rest/api/content?spaceKey=X&title=Y&expand=body.view,space,version`
- `search(query, limit): Promise<SearchHit[]>` —
  `GET /rest/api/content/search?cql=text~"query"&limit=N`
- `Page = { id, title, spaceKey, version, bodyHtml, url }`
- `SearchHit = { id, title, url }`
- 统一处理 401（认证失败）与 404（页面不存在），抛带可读信息的错误。

**html.ts**
- `htmlToMarkdown(html: string): string` — 用 `turndown` 转换。
- 纯函数，单测重点。

**tools.ts** — 注册两个 MCP 工具：

1. `get_page`
   - 入参：`{ ref: string }`（pageId 或完整 URL）
   - 流程：`parsePageRef` → 按 kind 调 `getPageById` / `getPageByTitle`
     → `htmlToMarkdown(bodyHtml)` → 返回标题、空间、版本、Markdown 正文、原始链接。
2. `search_pages`
   - 入参：`{ query: string, limit?: number }`（limit 默认 10）
   - 流程：`client.search` → 返回 `[{ title, pageId, url }]`。

（URL 解析内置在 `get_page` 中，不单独做工具。）

## 数据流

```
get_page:    ref ──parsePageRef──▶ PageRef ──ConfluenceClient──▶ Page
                                                       │
                                          htmlToMarkdown(bodyHtml)
                                                       ▼
                              { title, space, version, url, markdown }

search_pages: query ──ConfluenceClient.search──▶ [{title, pageId, url}]
```

## 错误处理

- 环境变量缺失：启动即退出，stderr 打印缺失项。
- 401：返回「认证失败，请检查用户名/密码」。
- 404：返回「未找到 pageId=X 对应的页面」。
- CQL 搜索语法错误 / 400：原样返回 Confluence 的错误消息。
- 其他网络错误：包装为含状态码和 URL 的可读错误（不泄露凭据）。
- 所有错误以 MCP 工具错误结果返回，不让进程崩溃。

## 测试策略

- **单元测试（vitest）**
  - `url.test.ts`：覆盖 pageId、viewpage.action URL、display URL、非法输入。
  - `html.test.ts`：覆盖标题、列表、表格、代码块、链接转换。
  - `confluence.test.ts`：用 mock 的 fetch 验证 URL 拼装、Basic header、401/404 处理。
- **真实联调（用户提供测试凭据后）**
  - 用 pageId `90394821` 真连 `rd.dtsphere.com`，验证认证通过且能取回正文。
  - 跑一次关键词搜索，确认返回结果结构正确。
  - 若无凭据，则只跑单元测试，联调留给用户自测。

## 技术栈

- Node.js v20 + TypeScript
- `@modelcontextprotocol/sdk`（官方 MCP SDK，stdio 传输）
- `turndown`（HTML → Markdown）
- `zod`（工具入参校验，SDK 推荐）
- 原生 `fetch`（Node 20 内置，不引入 HTTP 库）
- `vitest`（测试）

## 部署 / 接入 Claude Code

构建后在 `~/.claude.json` 的 `mcpServers` 中注册：

```json
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
```

`.gitignore` 排除 `node_modules`、`dist`，确保不提交任何凭据。
