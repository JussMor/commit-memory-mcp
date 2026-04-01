#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closeDb } from "./db/client.js";
import { runMigrations } from "./db/schema.js";
import { registerTools } from "./tools/index.js";

async function main(): Promise<void> {
  await runMigrations();

  const server = new McpServer({
    name: "commit-memory-mcp",
    version: "2.0.0",
  });

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", async () => {
    await closeDb();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await closeDb();
    process.exit(0);
  });
}

main().catch((error: unknown) => {
  console.error("[commit-memory-mcp] startup failed", error);
  process.exit(1);
});
