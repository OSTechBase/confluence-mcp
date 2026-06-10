// 按 Confluence 自动编号（标题里的 <span class="nh-number">2.1. </span>）切片页面 HTML。
// 让调用方能只取某个编号区间的内容，比如「2 到 3.2.1」。

// 把编号字符串解析成数字数组："3.2.1" -> [3,2,1]，"2." -> [2]
export function parseNumber(s: string): number[] {
  return s
    .trim()
    .replace(/\.+$/, "") // 去掉末尾的点
    .split(".")
    .map((p) => parseInt(p, 10))
    .filter((n) => !Number.isNaN(n));
}

// 字典序比较两个编号数组：返回负/零/正。短前缀视为更小（[3] < [3,2,1]）。
function compare(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

// b 是否为 a 的「祖先编号」（a 以 b 开头）：[3,2,1] 是 [3,2,1,1] 的祖先
function isDescendant(a: number[], ancestor: number[]): boolean {
  if (a.length <= ancestor.length) return false;
  return ancestor.every((v, i) => a[i] === v);
}

// 判断编号 n 是否落在 [from, to] 区间内（含端点，且 to 的子节也算）
export function inRange(n: number[], from: number[], to: number[]): boolean {
  if (compare(n, from) < 0) return false; // 早于起点
  if (compare(n, to) <= 0) return true; // 不晚于终点
  return isDescendant(n, to); // 晚于终点但属于终点的子节
}

// 一个编号区间：起止编号字符串（单节时 from===to）
export interface NumRange {
  from: string;
  to: string;
}

// 把区间字符串解析成 NumRange 列表。
// 语法："2-3.2.1, 4-5" 多个区间逗号分隔，每段用 - 分隔起止；
// 单节可写 "2.1"（from===to）。编号本身只含数字和点，不含 -，故可安全分割。
export function parseRanges(spec: string): NumRange[] {
  return spec
    .split(",")
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => {
      const parts = seg.split("-").map((p) => p.trim());
      const from = parts[0];
      const to = parts[1] ?? from; // 没有 - 则单节
      return { from, to };
    });
}

// 一个标题节点：编号 + 在 HTML 中的起始/结束位置
interface HeadingMark {
  num: number[];
  start: number; // 标题标签 <hN 的起始下标
}

// 从 HTML 中找出所有带 nh-number 编号的标题及其位置
function findHeadings(html: string): HeadingMark[] {
  const marks: HeadingMark[] = [];
  // 匹配 <hN ...> ... <span class="nh-number">X.Y. </span> ... </hN>
  const re = /<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const numMatch = m[0].match(/class="nh-number"[^>]*>([\d.]+)/);
    if (numMatch) {
      marks.push({ num: parseNumber(numMatch[1]), start: m.index });
    }
  }
  return marks;
}

// 按多个编号区间截取 HTML 片段。标题只要落在任一区间内即包含，
// 按文档原始顺序输出，天然处理区间重叠与乱序。找不到任何匹配返回空串。
export function sliceByRanges(html: string, ranges: NumRange[]): string {
  const parsed = ranges.map((r) => ({ from: parseNumber(r.from), to: parseNumber(r.to) }));
  const heads = findHeadings(html);
  if (heads.length === 0 || parsed.length === 0) return "";

  const pieces: string[] = [];
  for (let i = 0; i < heads.length; i++) {
    const hit = parsed.some((r) => inRange(heads[i].num, r.from, r.to));
    if (!hit) continue;
    const start = heads[i].start;
    // 该节内容到下一个标题起始处为止（最后一个标题则到文末）
    const end = i + 1 < heads.length ? heads[i + 1].start : html.length;
    pieces.push(html.slice(start, end));
  }
  return pieces.join("");
}

// 截取单个 [from, to] 编号区间（sliceByRanges 的便捷封装）。
export function sliceByNumber(html: string, from: string, to: string): string {
  return sliceByRanges(html, [{ from, to }]);
}

