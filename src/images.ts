// 从 Confluence 渲染后的 HTML（body.view）中提取嵌入图片的绝对 URL。
// 只取真正的附件图片，过滤掉表情符号、UI 图标等噪音。

// 把页面里可能的相对路径补全为绝对 URL
function toAbsolute(src: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  // 以 / 开头的根相对路径直接拼 baseUrl
  if (src.startsWith("/")) return baseUrl + src;
  return `${baseUrl}/${src}`;
}

// 判断是否为需要的内容图片：只保留附件下载链接，排除图标
function isContentImage(absUrl: string): boolean {
  // 附件 / 缩略图是用户真正插入的图片
  const isAttachment =
    absUrl.includes("/download/attachments/") ||
    absUrl.includes("/download/thumbnails/");
  // 排除 Confluence 自带的表情、图标等装饰性图片
  const isDecoration =
    absUrl.includes("/images/icons/") ||
    absUrl.includes("/images/emoticons/") ||
    absUrl.includes("/s/") && absUrl.includes("/_/"); // 静态资源批处理路径
  return isAttachment && !isDecoration;
}

// 提取 HTML 中所有内容图片的绝对 URL（去重，保持出现顺序）
export function extractImageUrls(html: string, baseUrl: string): string[] {
  const base = baseUrl.replace(/\/+$/, "");
  const urls: string[] = [];
  const seen = new Set<string>();

  // 匹配 <img ... src="..." ...>，src 可能用单引号或双引号
  const imgRe = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    // HTML 实体 &amp; 还原成 &，否则下载链接的查询参数会断
    const raw = m[1].replace(/&amp;/g, "&");
    const abs = toAbsolute(raw, base);
    if (isContentImage(abs) && !seen.has(abs)) {
      seen.add(abs);
      urls.push(abs);
    }
  }
  return urls;
}
