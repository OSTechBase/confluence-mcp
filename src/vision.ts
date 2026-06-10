import Anthropic from "@anthropic-ai/sdk";
import type { FetchedImage } from "./confluence.js";

// 图片分析专用模型。优先级：专用变量 > 通用变量 > 回退默认。
// 用独立的 CONFLUENCE_VISION_MODEL，可单独控制图片分析模型，
// 不被 Claude Code 主体的 ANTHROPIC_MODEL 带偏（且 /model 切换不影响这里）。
const model =
  process.env.CONFLUENCE_VISION_MODEL ?? process.env.ANTHROPIC_MODEL ?? "glm-5.1";

// 懒加载 client：只在真正调用图片分析时才构造。
// 否则缺 token 时 SDK 构造会抛错，连带拖垮只用 get_page/search_pages 的场景。
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client) return client;
  // 兼容 ANTHROPIC_AUTH_TOKEN（Claude Code 内置环境变量）和标准的 ANTHROPIC_API_KEY
  const apiKey =
    process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) {
    throw new Error(
      "未配置 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN，无法调用视觉模型分析图片",
    );
  }
  // 自定义网关场景下需带上 baseURL，否则会打到官方 API
  const baseURL = process.env.ANTHROPIC_BASE_URL;
  client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  return client;
}

// 把图片和文字上下文一起喂给视觉模型，返回分析结果
export async function analyzeImages(
  images: FetchedImage[],
  textContext: string,
): Promise<string> {
  const content: Anthropic.MessageParam["content"] = [
    {
      type: "text",
      text: `以下是页面内容，请分析图片中的 UI 设计和需求细节：\n\n${textContext}`,
    },
    ...images.map((img) => ({
      type: "image" as const,
      // mimeType 来自下载响应的 content-type，运行时是合法图片类型，
      // 这里的断言只为满足 SDK 的字面量联合类型
      source: {
        type: "base64" as const,
        media_type: img.mimeType as Anthropic.Base64ImageSource["media_type"],
        data: img.base64,
      },
    })),
  ];

  const res = await getClient().messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: "user", content }],
  });

  // 网关可能开启 extended thinking，content 里会混入 thinking block，
  // 取所有 text block 拼接，而不是写死 content[0]
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  // 命中 max_tokens 上限说明分析被截断，明确告知避免误判为完整结论
  return res.stop_reason === "max_tokens"
    ? `${text}\n\n（注：分析内容因长度限制被截断）`
    : text;
}
