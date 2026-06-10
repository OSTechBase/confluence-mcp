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
