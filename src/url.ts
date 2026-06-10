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
