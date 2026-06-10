import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ConfluenceClient } from "./confluence.js";
import { loadConfigForSite } from "./config.js";
import { parsePageRef } from "./url.js";
import { htmlToMarkdown } from "./html.js";
import { extractImageUrls } from "./images.js";
import { parseRanges, sliceByRanges } from "./sections.js";
import { analyzeImages } from "./vision.js";

// 单次 get_page 默认返回的图片数，防止超大页面塞爆上下文
const DEFAULT_MAX_IMAGES = 10;
// 一次最多允许取的图片数上限
const HARD_MAX_IMAGES = 30;

// 按 site 名返回对应客户端；未指定时使用默认 client
function clientFor(site: string | undefined, defaultClient: ConfluenceClient): ConfluenceClient {
  if (!site) return defaultClient;
  return new ConfluenceClient(loadConfigForSite(site));
}

// 把两个工具注册到 server 上。client 注入便于复用与测试。
export function registerTools(server: McpServer, client: ConfluenceClient): void {
  const siteParam = z.string().optional().describe("站点名称（对应 sites.json 中的 name 字段），不填则用默认站点");

  // 工具一：按 pageId 或完整 URL 取页面正文（Markdown）+ 内嵌图片
  server.tool(
    "get_page",
    "按 pageId 或完整 Confluence URL 取回页面标题与正文（Markdown），并附带页面内的图片供理解",
    {
      ref: z.string().describe("pageId（如 90394821）或完整页面 URL"),
      site: siteParam,
      includeImages: z
        .boolean()
        .optional()
        .describe("是否下载并返回页面内的图片，默认 true。纯文本场景可设 false 提速"),
      maxImages: z
        .number()
        .int()
        .positive()
        .max(HARD_MAX_IMAGES)
        .optional()
        .describe(`本次返回图片数上限，默认 ${DEFAULT_MAX_IMAGES}，最大 ${HARD_MAX_IMAGES}。页面图片超过上限时可调大`),
      sections: z
        .string()
        .optional()
        .describe(
          '按标题编号截取章节，支持多个不连续区间，逗号分隔，每段用 - 表示起止。' +
            '例："2-3.2.1" 取一段；"2-3.2.1, 4-5" 取两段；"2.1" 取单节。' +
            "区间含两端，终点的子节（如 3.2.1.1）也包含。只返回这些章节的正文与图片",
        ),
      analyzeImages: z
        .boolean()
        .optional()
        .describe("是否调用视觉模型分析页面图片，结果以文字形式追加到返回内容。默认 false"),
    },
    async ({ ref, site, includeImages, maxImages, sections, analyzeImages: doAnalyze }) => {
      const c = clientFor(site, client);
      const pref = parsePageRef(ref);
      const page =
        pref.kind === "id"
          ? await c.getPageById(pref.pageId)
          : await c.getPageByTitle(pref.spaceKey, pref.title);

      // 指定了编号区间时，先把正文切到这些区间（正文和图片都只取这些段）
      let bodyHtml = page.bodyHtml;
      let rangeNote = "";
      if (sections) {
        const ranges = parseRanges(sections);
        const sliced = sliceByRanges(bodyHtml, ranges);
        if (sliced) {
          bodyHtml = sliced;
          rangeNote = `（已截取章节：${sections}）\n\n`;
        } else {
          // 没匹配到编号，退回整页并提示，避免返回空内容让人误以为没数据
          rangeNote = `（未找到章节 ${sections}，以下为整页内容）\n\n`;
        }
      }

      const md = htmlToMarkdown(bodyHtml);
      const header =
        `# ${page.title}\n\n` +
        `空间：${page.spaceKey} | 版本：${page.version} | 链接：${page.url}\n\n---\n\n`;

      const content: any[] = [{ type: "text", text: header + rangeNote + md }];

      // 默认下载页面图片，让 Claude 能看懂产品图等视觉内容
      if (includeImages !== false) {
        // 图片相对路径要拼站点根地址（origin），不能用带查询串的页面 URL
        const origin = new URL(page.url).origin;
        const allUrls = extractImageUrls(bodyHtml, origin);
        const limit = maxImages ?? DEFAULT_MAX_IMAGES;
        const urls = allUrls.slice(0, limit);
        // 并行下载，失败的返回 null 后过滤掉。
        // 注意：开视觉分析时图片也必须先下载——模型要的是图片字节，不是链接。
        const images = (await Promise.all(urls.map((u) => c.fetchImage(u)))).filter(
          (img): img is NonNullable<typeof img> => img !== null,
        );

        if (images.length > 0) {
          const truncated = allUrls.length > urls.length;

          if (doAnalyze) {
            // 视觉分析模式：图片只用于喂模型，不把 base64 返回给客户端。
            // 开视觉分析通常是因为客户端（如 CLI）看不了图，返回 base64 纯占上下文。
            const note = truncated
              ? `\n（页面共 ${allUrls.length} 张图片，本次分析前 ${images.length} 张；` +
                `如需分析剩余图片，可调大 maxImages，最大 ${HARD_MAX_IMAGES}）`
              : `\n（已分析页面内嵌的 ${images.length} 张图片）`;
            try {
              const analysis = await analyzeImages(images, md);
              content.push({ type: "text", text: `${note}\n\n## 图片分析\n\n${analysis}` });
            } catch (e) {
              content.push({
                type: "text",
                text: `\n（图片分析失败：${e instanceof Error ? e.message : String(e)}）`,
              });
            }
          } else {
            // 普通模式：把图片 base64 返回，供有视觉能力的客户端（网页/桌面版）直接查看
            for (const img of images) {
              content.push({ type: "image", data: img.base64, mimeType: img.mimeType });
            }
            // 页面图片数超过本次上限时，明确告知 Claude 还有多少张、如何取全
            const note = truncated
              ? `\n（页面共 ${allUrls.length} 张图片，本次返回前 ${images.length} 张；` +
                `如需查看剩余图片，可再次调用并调大 maxImages，最大 ${HARD_MAX_IMAGES}）`
              : `\n（以上为页面内嵌的 ${images.length} 张图片）`;
            content.push({ type: "text", text: note });
          }
        } else if (doAnalyze && allUrls.length > 0) {
          // 想分析图片、页面也确实有图，但全部下载失败，明确告知而非静默
          content.push({
            type: "text",
            text: `\n（页面有 ${allUrls.length} 张图片，但全部下载失败，无法分析）`,
          });
        }
      }

      return { content };
    },
  );

  // 工具二：按关键词搜索页面
  server.tool(
    "search_pages",
    "按关键词搜索 Confluence 页面，返回标题/pageId/链接列表",
    {
      query: z.string().describe("搜索关键词"),
      limit: z.number().int().positive().max(50).optional().describe("结果数量上限，默认 10"),
      site: siteParam,
    },
    async ({ query, limit, site }) => {
      const c = clientFor(site, client);
      const hits = await c.search(query, limit ?? 10);
      if (hits.length === 0) {
        return { content: [{ type: "text", text: `未找到与「${query}」匹配的页面` }] };
      }
      const lines = hits.map((h) => `- ${h.title}（pageId=${h.id}）\n  ${h.url}`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
