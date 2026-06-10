# Confluence MCP Server

让 Claude Code 能直接读取 Confluence 内部文档。

## 它能做什么

- **`get_page`** — 给一个页面 ID 或完整 URL，返回页面内容（转成 Markdown），并自动下载页面内的图片，让 Claude 能看懂产品图等视觉内容
- **`search_pages`** — 输入关键词，返回匹配的页面列表

## 安装

```bash
cd ~/confluence-mcp
npm install
npm run build
```

> 如果 npm install 报网络错误，改用公共源：
> `npm install --registry=https://registry.npmjs.org/`

## 配置

### 第一步：填写站点信息

在项目根目录创建 `sites.json`：

```json
[
  {
    "baseUrl": "https://your-confluence.example.com",
    "username": "你的用户名",
    "password": "你的密码"
  }
]
```

> `sites.json` 已加入 `.gitignore`，不会被提交到 git。

### 第二步：接入 Claude Code

编辑 `~/.claude.json`，在 `mcpServers` 里加入：

```json
{
  "mcpServers": {
    "confluence": {
      "command": "node",
      "args": ["/Users/你的用户名/confluence-mcp/dist/index.js"],
      "env": {}
    }
  }
}
```

> `args` 里的路径改成你自己机器上的实际路径。

### 第三步：重启 Claude Code

重启后，Claude Code 会自动加载 `get_page` 和 `search_pages` 两个工具。

## 多站点

如果你有多个 Confluence 站点，在 `sites.json` 里加就行：

```json
[
  {
    "name": "rd",
    "baseUrl": "https://rd.example.com",
    "username": "alice",
    "password": "xxx"
  },
  {
    "name": "wiki",
    "baseUrl": "https://wiki.example.com",
    "username": "bob",
    "password": "yyy"
  }
]
```

然后在 `~/.claude.json` 的 `env` 里指定用哪个：

```json
"env": { "CONFLUENCE_SITE": "wiki" }
```

不设的话默认用第一个。

## 使用

配置好重启 Claude Code 后，直接在对话里说：

**读一个页面：**
> 帮我看看这个页面：`https://rd.dtsphere.com/pages/viewpage.action?pageId=90394821`
> 帮我读页面 90394821

**搜索：**
> 搜一下关于「部署流程」的文档

**多站点时指定站点：**
> 去 wiki 站点搜「接口规范」

Claude 会自动调用工具，不需要手动指定工具名。

### 关于图片

`get_page` 默认会下载页面里的图片（产品图、流程图等）一起返回。

- 单页最多取 10 张图，自动过滤表情、图标等装饰性图片
- 只想看文字、不想下图时，可以让 Claude 跳过：
  > 读页面 90394821，不用下图

**注意：命令行版（CLI）的 Claude 没有视觉能力，看不了图片内容。** 网页版、桌面版能直接看图；CLI 下要分析图片，用下面的视觉分析。

### 让 CLI 也能分析图片（视觉分析）

CLI 看不了图时，可以让工具先调用视觉模型把图片解读成文字，再返回：

> 读页面 90394821 的 2.2 章节，分析里面的图片

工具会把图片喂给视觉模型，把"页面长什么样、有哪些字段和交互"的分析结论作为文字一并返回，CLI 就能基于这段文字继续工作。

- 视觉分析走 `~/.claude.json` 里配置的同一套 API（`ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL`）
- 分析用哪个模型，按优先级取：`CONFLUENCE_VISION_MODEL`（图片分析专用）→ `ANTHROPIC_MODEL`（通用）→ 回退默认
- **`claude --model haiku` 或 `/model` 切换不影响图片分析模型**——主体模型和分析模型是两条独立链路（详见下方实现原理）
- 想单独指定分析模型，在 server 的 `env` 里加 `CONFLUENCE_VISION_MODEL`，重启生效
- 配合 `sections` 只分析某章节的图，又快又省

### 分段读大页面

页面内容很长时（如大型需求文档），可以让 Claude 只读某几章，避免上下文撑爆：

> 读页面 90394821，只看第 2 到第 3 章
> 读页面 90394821，只看 sections 2-3.2.1

`sections` 参数裁的是正文，图片也只取那几章里的，两者同步缩减。

**建议用法：** 先用 `search_pages` 定位页面，再分章节逐段读，每次只给 Claude 当前要分析的那段内容。

## 文件位置一览

| 文件 | 作用 |
|---|---|
| `~/confluence-mcp/sites.json` | 站点配置（你维护，不进 git）|
| `~/confluence-mcp/dist/index.js` | MCP server 实际运行的文件 |
| `~/.claude.json` | Claude Code 配置，指向上面的 dist |

## 实现原理

这个 server 的本质是一个**只读的翻译层**：Claude 连不上你内网的 Confluence，server 替它调 API，把结果转成 Claude 能消化的 Markdown + 图片 / 图片分析。

### 整体架构

一个文件一个职责，各自可独立测试：

```
Claude Code (CLI / 桌面 / 网页)
      │  MCP 协议 (stdio)
      ▼
  index.ts        启动入口，建 server，接 stdio
      │
  tools.ts        注册 2 个工具，编排整个流程
      │
      ├── confluence.ts   调 Confluence REST API（带认证）
      ├── url.ts          解析 pageId / 各种 URL 形式
      ├── sections.ts     按章节编号裁剪正文
      ├── html.ts         HTML → Markdown
      ├── images.ts       从 HTML 抽图片链接
      └── vision.ts       调视觉模型分析图片
  config.ts         读 sites.json，管多站点配置
```

### get_page 的完整数据流

一次 `get_page` 调用，内部依次发生：

1. **解析引用**（`url.ts`）— 用户给的可能是纯数字 `90387185`、完整 URL、或 `/display/空间/标题`，统一解析成 pageId 或「空间+标题」。
2. **调 API 取页面**（`confluence.ts`）— 带 Basic 认证请求 `/rest/api/content/{id}?expand=body.view`，拿到**渲染后的 HTML**。401/404 统一转中文错误。
3. **按章节裁剪**（`sections.ts`，可选）— 指定 `sections` 时，根据标题里的自动编号（`<span class="nh-number">2.2.</span>`）把正文切到指定区间。**这是省上下文的关键。**
4. **HTML 转 Markdown**（`html.ts`）— 用 turndown 转成干净的 Markdown。
5. **处理图片**（`images.ts` + `confluence.ts`）— 从正文 HTML 抽出附件图链接（过滤表情/图标），带认证下载转 base64。图片从**裁剪后**的 HTML 抽取，所以只看某章节时图片也只取那章的，正文和图同步缩减。
6. **视觉分析**（`vision.ts`，可选）— 开启 `analyzeImages` 时，server 自己调一次视觉模型把图片解读成文字，追加到返回里，让没有视觉能力的 CLI 也能用上图片内容。

### 为什么 /model 切换不影响图片分析

MCP server 是 Claude Code 启动时 fork 出的**独立子进程**：

```
终端
  ├─ Claude Code 主进程      ← /model 只切这里（跟你对话的模型）
  └─ confluence MCP 子进程    ← vision.ts 用自己的 env 调模型
```

`/model` 改的是主进程内存里的设置，不会传播到已经跑起来的子进程。`vision.ts` 调模型走的是它自己发起的全新 API 请求，模型名来自**子进程启动时的环境变量**，跟主体当前选什么模型没有通信渠道。所以图片分析模型只能通过 server 的 `env`（`CONFLUENCE_VISION_MODEL` 等）控制。

### 关键设计决策

- **图片下载失败返回 null 而非抛错** — 一页十几张图，一张挂了不该拖垮整页。
- **vision client 懒加载** — 缺 token 时只在真正分析图片时才报错，不影响纯文本的 `get_page` / `search_pages`。
- **只读** — 全程只有 GET，没有任何写/改/删 Confluence 的能力。
- **凭据隔离** — 账密放 `sites.json`，已进 `.gitignore`。

## 开发

```bash
npm test       # 跑单元测试
npm run build  # 重新编译
```
