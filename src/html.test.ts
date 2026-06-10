import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "./html.js";

describe("htmlToMarkdown", () => {
  it("标题转 #", () => {
    expect(htmlToMarkdown("<h1>Title</h1>")).toBe("# Title");
  });

  it("无序列表转 - 开头", () => {
    // turndown 默认在 marker 后补空格对齐（如 "-   a"），故只断言以 "-" 起始
    const md = htmlToMarkdown("<ul><li>a</li><li>b</li></ul>");
    expect(md).toMatch(/^-\s+a/m);
    expect(md).toMatch(/^-\s+b/m);
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
