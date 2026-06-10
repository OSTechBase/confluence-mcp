#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { ConfluenceClient } from "./confluence.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  // 配置缺失时直接退出，错误打到 stderr（stdout 留给 MCP 协议）
  const config = loadConfig();
  const client = new ConfluenceClient(config);

  const server = new McpServer({ name: "confluence-mcp", version: "0.1.0" });
  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(`[confluence-mcp] 启动失败：${err.message}`);
  process.exit(1);
});
