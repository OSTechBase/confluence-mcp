import { describe, it, expect } from "vitest";
import { parseNumber, inRange, sliceByNumber, parseRanges, sliceByRanges } from "./sections.js";

describe("parseNumber", () => {
  it("解析多级编号", () => {
    expect(parseNumber("3.2.1")).toEqual([3, 2, 1]);
    expect(parseNumber("2.")).toEqual([2]);
    expect(parseNumber(" 1.4. ")).toEqual([1, 4]);
  });
});

describe("inRange", () => {
  const from = [2];
  const to = [3, 2, 1];

  it("区间内的编号都命中", () => {
    expect(inRange([2], from, to)).toBe(true);
    expect(inRange([2, 1], from, to)).toBe(true);
    expect(inRange([3], from, to)).toBe(true);
    expect(inRange([3, 2], from, to)).toBe(true);
    expect(inRange([3, 2, 1], from, to)).toBe(true);
  });

  it("终点的子节算在内", () => {
    expect(inRange([3, 2, 1, 1], from, to)).toBe(true);
  });

  it("早于起点的排除", () => {
    expect(inRange([1], from, to)).toBe(false);
    expect(inRange([1, 4], from, to)).toBe(false);
  });

  it("晚于终点且非子节的排除", () => {
    expect(inRange([3, 2, 2], from, to)).toBe(false);
    expect(inRange([3, 3], from, to)).toBe(false);
    expect(inRange([4], from, to)).toBe(false);
  });
});

describe("sliceByNumber", () => {
  // 模拟 Confluence 渲染：标题带 nh-number，标题间夹正文
  const html =
    `<h1><span class="nh-number">1. </span>背景</h1><p>p1</p>` +
    `<h2><span class="nh-number">1.1. </span>子背景</h2><p>p11</p>` +
    `<h1><span class="nh-number">2. </span>描述</h1><p>p2</p>` +
    `<h2><span class="nh-number">2.1. </span>子描述</h2><p>p21</p>` +
    `<h1><span class="nh-number">3. </span>方案</h1><p>p3</p>` +
    `<h2><span class="nh-number">3.2. </span>详设</h2><p>p32</p>` +
    `<h3><span class="nh-number">3.2.1. </span>细节</h3><p>p321</p>` +
    `<h3><span class="nh-number">3.2.2. </span>其他</h3><p>p322</p>` +
    `<h1><span class="nh-number">4. </span>结尾</h1><p>p4</p>`;

  it("截取 2 到 3.2.1 区间", () => {
    const out = sliceByNumber(html, "2", "3.2.1");
    expect(out).toContain("描述");
    expect(out).toContain("p2");
    expect(out).toContain("子描述");
    expect(out).toContain("方案");
    expect(out).toContain("详设");
    expect(out).toContain("细节");
    expect(out).toContain("p321");
    // 不应包含起点之前和终点之后的内容
    expect(out).not.toContain("背景");
    expect(out).not.toContain("其他");
    expect(out).not.toContain("p322");
    expect(out).not.toContain("结尾");
  });

  it("单节：from 与 to 相同", () => {
    const out = sliceByNumber(html, "2.1", "2.1");
    expect(out).toContain("子描述");
    expect(out).toContain("p21");
    expect(out).not.toContain("方案");
  });

  it("无匹配编号返回空串", () => {
    expect(sliceByNumber("<p>没有标题</p>", "2", "3")).toBe("");
  });
});

describe("parseRanges", () => {
  it("解析多个区间", () => {
    expect(parseRanges("2-3.2.1, 4-5")).toEqual([
      { from: "2", to: "3.2.1" },
      { from: "4", to: "5" },
    ]);
  });

  it("单节无 - 时 from===to", () => {
    expect(parseRanges("2.1")).toEqual([{ from: "2.1", to: "2.1" }]);
  });

  it("混合单节与区间", () => {
    expect(parseRanges("1, 3-3.2")).toEqual([
      { from: "1", to: "1" },
      { from: "3", to: "3.2" },
    ]);
  });
});

describe("sliceByRanges 多区间", () => {
  const html =
    `<h1><span class="nh-number">1. </span>背景</h1><p>p1</p>` +
    `<h1><span class="nh-number">2. </span>描述</h1><p>p2</p>` +
    `<h2><span class="nh-number">2.1. </span>子描述</h2><p>p21</p>` +
    `<h1><span class="nh-number">3. </span>方案</h1><p>p3</p>` +
    `<h2><span class="nh-number">3.2. </span>详设</h2><p>p32</p>` +
    `<h2><span class="nh-number">3.3. </span>余下</h2><p>p33</p>` +
    `<h1><span class="nh-number">4. </span>测试</h1><p>p4</p>` +
    `<h1><span class="nh-number">5. </span>上线</h1><p>p5</p>` +
    `<h1><span class="nh-number">6. </span>附录</h1><p>p6</p>`;

  it("不连续区间 2~3.2 和 4~5", () => {
    const out = sliceByRanges(html, [
      { from: "2", to: "3.2" },
      { from: "4", to: "5" },
    ]);
    // 命中段
    expect(out).toContain("描述");
    expect(out).toContain("详设");
    expect(out).toContain("测试");
    expect(out).toContain("上线");
    // 跳过的中间段与首尾
    expect(out).not.toContain("背景"); // 1
    expect(out).not.toContain("余下"); // 3.3
    expect(out).not.toContain("附录"); // 6
  });

  it("结果按文档顺序，区间顺序颠倒也不影响", () => {
    const out = sliceByRanges(html, [
      { from: "4", to: "5" },
      { from: "2", to: "2" },
    ]);
    expect(out.indexOf("描述")).toBeLessThan(out.indexOf("测试"));
  });
});
