import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export interface Config {
  baseUrl: string;
  username: string;
  password: string;
}

// sites.json 中单个站点的结构（账户密码直接写在文件里）
interface SiteEntry {
  name?: string;
  baseUrl: string;
  username: string;
  password: string;
}

// 项目根目录（dist/config.js 的上两级）
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 从 sites.json 加载多站点配置，返回选中站点的 Config
function loadFromSitesFile(sitesFile: string, siteName?: string): Config {
  let entries: SiteEntry[];
  try {
    entries = JSON.parse(readFileSync(sitesFile, "utf-8"));
  } catch (e: any) {
    // ENOENT 保留原始 code，让上层降级到旧模式
    if (e.code === "ENOENT") throw e;
    throw new Error(`读取站点配置文件失败 (${sitesFile})：${e.message}`);
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`站点配置文件为空或格式错误：${sitesFile}`);
  }

  // 通过 CONFLUENCE_SITE 按 name 选站点，否则取第一个
  const site = siteName ? entries.find((s) => s.name === siteName) : entries[0];
  if (!site) {
    throw new Error(`未找到站点 "${siteName}"，可用站点：${entries.map((s) => s.name ?? "(unnamed)").join(", ")}`);
  }

  return {
    baseUrl: site.baseUrl.replace(/\/+$/, ""),
    username: site.username,
    password: site.password,
  };
}

// 按站点名加载指定站点的配置（供工具层按需切换站点）
export function loadConfigForSite(siteName: string, env: NodeJS.ProcessEnv = process.env): Config {
  const sitesFile = env.CONFLUENCE_SITES_FILE ?? join(PROJECT_ROOT, "sites.json");
  return loadFromSitesFile(sitesFile, siteName);
}

// 加载配置：优先读项目目录下的 sites.json，降级到旧的三个环境变量
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const sitesFile = env.CONFLUENCE_SITES_FILE ?? join(PROJECT_ROOT, "sites.json");

  try {
    return loadFromSitesFile(sitesFile, env.CONFLUENCE_SITE);
  } catch (e: any) {
    // 文件不存在时降级到单站点环境变量模式
    if (e.code !== "ENOENT") throw e;
  }

  // 旧模式：CONFLUENCE_BASE_URL / CONFLUENCE_USERNAME / CONFLUENCE_PASSWORD
  const baseUrl = env.CONFLUENCE_BASE_URL;
  const username = env.CONFLUENCE_USERNAME;
  const password = env.CONFLUENCE_PASSWORD;
  const missing: string[] = [];
  if (!baseUrl) missing.push("CONFLUENCE_BASE_URL");
  if (!username) missing.push("CONFLUENCE_USERNAME");
  if (!password) missing.push("CONFLUENCE_PASSWORD");
  if (missing.length > 0) throw new Error(`缺少环境变量：${missing.join(", ")}`);

  return {
    baseUrl: baseUrl!.replace(/\/+$/, ""),
    username: username!,
    password: password!,
  };
}
