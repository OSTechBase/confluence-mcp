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
