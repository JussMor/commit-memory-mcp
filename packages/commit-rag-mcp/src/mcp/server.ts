#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openDatabase } from "../db/client.js";
import { indexRepository } from "../indexer.js";
import { explainCommitMatch, searchRelatedCommits } from "../search/query.js";

function runGitDiff(repoPath: string, sha: string): string {
  return execFileSync(
    "git",
    ["-C", repoPath, "show", "--no-color", "--stat", "--patch", sha],
    {
      encoding: "utf8",
    },
  );
}

function getConfig() {
  const repoPath = path.resolve(process.env.COMMIT_RAG_REPO ?? process.cwd());
  const dbPath = path.resolve(
    process.env.COMMIT_RAG_DB ?? path.join(repoPath, ".commit-rag.db"),
  );
  const limit = Number.parseInt(process.env.COMMIT_RAG_LIMIT ?? "", 10) || 400;
  return { repoPath, dbPath, limit };
}

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    {
      name: "commit-memory-mcp",
      version: "0.3.1",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_related_commits",
        description:
          "Find commit chunks semantically related to current work context.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            activeFile: { type: "string" },
            limit: { type: "number" },
          },
          required: ["query"],
        },
      },
      {
        name: "explain_commit_match",
        description: "Return contextual details for a chunk match.",
        inputSchema: {
          type: "object",
          properties: {
            chunkId: { type: "string" },
          },
          required: ["chunkId"],
        },
      },
      {
        name: "get_commit_diff",
        description: "Get full git show output for a commit SHA.",
        inputSchema: {
          type: "object",
          properties: {
            sha: { type: "string" },
          },
          required: ["sha"],
        },
      },
      {
        name: "reindex_commits",
        description: "Refresh commit index from git history.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number" },
          },
          required: [],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { repoPath, dbPath, limit: defaultLimit } = getConfig();

    if (request.params.name === "reindex_commits") {
      const limit = Number(
        (request.params.arguments?.limit as number | undefined) ?? defaultLimit,
      );
      const summary = await indexRepository({ repoPath, dbPath, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }

    const db = openDatabase(dbPath);

    try {
      if (request.params.name === "search_related_commits") {
        const query = String(request.params.arguments?.query ?? "").trim();
        const activeFile = request.params.arguments?.activeFile
          ? String(request.params.arguments.activeFile)
          : undefined;
        const limit = Number(
          (request.params.arguments?.limit as number | undefined) ?? 8,
        );

        if (!query) {
          return {
            content: [{ type: "text", text: "query is required" }],
            isError: true,
          };
        }

        const results = await searchRelatedCommits(
          db,
          query,
          limit,
          activeFile,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      }

      if (request.params.name === "explain_commit_match") {
        const chunkId = String(request.params.arguments?.chunkId ?? "").trim();
        if (!chunkId) {
          return {
            content: [{ type: "text", text: "chunkId is required" }],
            isError: true,
          };
        }

        const result = explainCommitMatch(db, chunkId);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      if (request.params.name === "get_commit_diff") {
        const sha = String(request.params.arguments?.sha ?? "").trim();
        if (!sha) {
          return {
            content: [{ type: "text", text: "sha is required" }],
            isError: true,
          };
        }

        const output = runGitDiff(repoPath, sha);
        return {
          content: [{ type: "text", text: output }],
        };
      }

      return {
        content: [
          { type: "text", text: `Unknown tool: ${request.params.name}` },
        ],
        isError: true,
      };
    } finally {
      db.close();
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function isDirectExecution(): boolean {
  const argvPath = process.argv[1];
  if (!argvPath) {
    return false;
  }

  const directHref = pathToFileURL(path.resolve(argvPath)).href;
  if (directHref === import.meta.url) {
    return true;
  }

  try {
    const realHref = pathToFileURL(fs.realpathSync(argvPath)).href;
    return realHref === import.meta.url;
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  startMcpServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
