import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig } from "./config.js";

// 指向不存在的路径，强制走旧模式（跳过项目根目录的 sites.json）
const NO_SITES = { CONFLUENCE_SITES_FILE: "/nonexistent/sites.json" };

const FULL = {
  ...NO_SITES,
  CONFLUENCE_BASE_URL: "https://rd.dtsphere.com",
  CONFLUENCE_USERNAME: "u",
  CONFLUENCE_PASSWORD: "p",
};

describe("loadConfig — 旧模式（无 sites 文件）", () => {
  it("三个变量齐全时返回配置，并去掉 baseUrl 末尾斜杠", () => {
    const cfg = loadConfig({ ...FULL, CONFLUENCE_BASE_URL: "https://rd.dtsphere.com/" });
    expect(cfg).toEqual({ baseUrl: "https://rd.dtsphere.com", username: "u", password: "p" });
  });

  it("缺少变量时抛错并指出缺哪个", () => {
    const { CONFLUENCE_PASSWORD, ...rest } = FULL;
    expect(() => loadConfig(rest)).toThrow(/CONFLUENCE_PASSWORD/);
  });
});

describe("loadConfig — 多站点模式（sites.json）", () => {
  let sitesDir: string;
  let sitesFile: string;

  beforeEach(() => {
    sitesDir = join(tmpdir(), `confluence-mcp-test-${Date.now()}`);
    mkdirSync(sitesDir, { recursive: true });
    sitesFile = join(sitesDir, "sites.json");
  });

  afterEach(() => {
    rmSync(sitesDir, { recursive: true, force: true });
  });

  it("从 sites.json 取第一个站点，去掉末尾斜杠", () => {
    writeFileSync(sitesFile, JSON.stringify([
      { name: "rd", baseUrl: "https://rd.dtsphere.com/", username: "alice", password: "secret" },
    ]));
    const cfg = loadConfig({ CONFLUENCE_SITES_FILE: sitesFile });
    expect(cfg).toEqual({ baseUrl: "https://rd.dtsphere.com", username: "alice", password: "secret" });
  });

  it("通过 CONFLUENCE_SITE 按 name 选站点", () => {
    writeFileSync(sitesFile, JSON.stringify([
      { name: "rd", baseUrl: "https://rd.dtsphere.com", username: "alice", password: "p1" },
      { name: "wiki", baseUrl: "https://wiki.example.com", username: "bob", password: "p2" },
    ]));
    const cfg = loadConfig({ CONFLUENCE_SITES_FILE: sitesFile, CONFLUENCE_SITE: "wiki" });
    expect(cfg.baseUrl).toBe("https://wiki.example.com");
    expect(cfg.username).toBe("bob");
  });

  it("CONFLUENCE_SITE 指定的名字不存在时抛错", () => {
    writeFileSync(sitesFile, JSON.stringify([
      { name: "rd", baseUrl: "https://rd.dtsphere.com", username: "alice", password: "p1" },
    ]));
    expect(() => loadConfig({ CONFLUENCE_SITES_FILE: sitesFile, CONFLUENCE_SITE: "no-such" }))
      .toThrow(/no-such/);
  });
});
