import { describe, it, expect } from "vitest";
import { extractImageUrls } from "./images.js";

const BASE = "https://rd.dtsphere.com";

describe("extractImageUrls", () => {
  it("提取附件图片并补全相对路径", () => {
    const html = `<p>文案</p><img src="/download/attachments/123/产品图.png?api=v2" />`;
    expect(extractImageUrls(html, BASE)).toEqual([
      "https://rd.dtsphere.com/download/attachments/123/产品图.png?api=v2",
    ]);
  });

  it("还原 &amp; 实体，保住查询参数", () => {
    const html = `<img src="/download/attachments/1/a.png?width=200&amp;height=100" />`;
    expect(extractImageUrls(html, BASE)).toEqual([
      "https://rd.dtsphere.com/download/attachments/1/a.png?width=200&height=100",
    ]);
  });

  it("过滤掉表情和图标", () => {
    const html =
      `<img src="/images/icons/emoticons/smile.png" />` +
      `<img src="/download/attachments/9/real.jpg" />`;
    expect(extractImageUrls(html, BASE)).toEqual([
      "https://rd.dtsphere.com/download/attachments/9/real.jpg",
    ]);
  });

  it("去重，保留出现顺序", () => {
    const html =
      `<img src="/download/attachments/1/a.png" />` +
      `<img src="/download/attachments/2/b.png" />` +
      `<img src="/download/attachments/1/a.png" />`;
    expect(extractImageUrls(html, BASE)).toEqual([
      "https://rd.dtsphere.com/download/attachments/1/a.png",
      "https://rd.dtsphere.com/download/attachments/2/b.png",
    ]);
  });

  it("已是绝对 URL 时不重复拼接", () => {
    const html = `<img src="https://cdn.other.com/download/attachments/1/x.png" />`;
    expect(extractImageUrls(html, BASE)).toEqual([
      "https://cdn.other.com/download/attachments/1/x.png",
    ]);
  });

  it("没有内容图片时返回空数组", () => {
    expect(extractImageUrls(`<p>纯文本</p>`, BASE)).toEqual([]);
  });
});
