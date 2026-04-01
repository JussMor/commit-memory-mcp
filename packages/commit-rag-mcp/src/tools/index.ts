import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  agentRetrieveContext,
  buildContextPack,
  getModuleGraph,
  getModuleKnowledge,
  prePlanSyncBrief,
  promoteContextFacts,
} from "../layers/business.js";
import { extractBusinessFacts, ingestPr } from "../layers/ingest.js";
import {
  getOvernightBrief,
  listActiveWorktrees,
  syncPrContext,
  whoChangedThis,
  whyWasThisChanged,
} from "../layers/trazability.js";

export function registerTools(server: McpServer): void {
  server.tool(
    "sync_pr_context",
    { repo: z.string(), limit: z.number().optional() },
    async ({ repo, limit }) => ({
      content: [{ type: "text", text: await syncPrContext(repo, limit) }],
    }),
  );

  server.tool(
    "who_changed_this",
    { file: z.string(), repo: z.string() },
    async ({ file, repo }) => ({
      content: [{ type: "text", text: await whoChangedThis(file, repo) }],
    }),
  );

  server.tool(
    "why_was_this_changed",
    {
      file: z.string().optional(),
      sha: z.string().optional(),
      repo: z.string(),
    },
    async ({ file, sha, repo }) => ({
      content: [
        { type: "text", text: await whyWasThisChanged(file, sha, repo) },
      ],
    }),
  );

  server.tool(
    "get_main_branch_overnight_brief",
    { repo: z.string(), hours: z.number().optional() },
    async ({ repo, hours }) => ({
      content: [{ type: "text", text: await getOvernightBrief(repo, hours) }],
    }),
  );

  server.tool("list_active_worktrees", {}, async () => ({
    content: [{ type: "text", text: await listActiveWorktrees() }],
  }));

  server.tool(
    "ingest_pr",
    { repo: z.string(), pr_number: z.number() },
    async ({ repo, pr_number }) => {
      await ingestPr(repo, pr_number);
      return { content: [{ type: "text", text: `PR #${pr_number} ingested` }] };
    },
  );

  server.tool(
    "extract_business_facts",
    { repo: z.string(), pr_number: z.number(), module: z.string() },
    async ({ repo, pr_number, module }) => {
      await extractBusinessFacts(repo, pr_number, module);
      return {
        content: [
          {
            type: "text",
            text: `Facts extracted from PR #${pr_number} -> ${module}`,
          },
        ],
      };
    },
  );

  server.tool(
    "get_module_knowledge",
    { module: z.string() },
    async ({ module }) => ({
      content: [{ type: "text", text: await getModuleKnowledge(module) }],
    }),
  );

  server.tool(
    "get_module_graph",
    { module: z.string() },
    async ({ module }) => ({
      content: [{ type: "text", text: await getModuleGraph(module) }],
    }),
  );

  server.tool(
    "promote_context_facts",
    { module: z.string(), pr_number: z.number().optional() },
    async ({ module, pr_number }) => ({
      content: [
        { type: "text", text: await promoteContextFacts(module, pr_number) },
      ],
    }),
  );

  server.tool(
    "build_context_pack",
    {
      module: z.string(),
      limit: z.number().optional(),
      query: z.string().optional(),
    },
    async ({ module, limit, query }) => ({
      content: [
        { type: "text", text: await buildContextPack(module, limit, query) },
      ],
    }),
  );

  server.tool(
    "agent_retrieve_context",
    {
      module: z.string(),
      query: z.string(),
      limit: z.number().optional(),
    },
    async ({ module, query, limit }) => ({
      content: [
        {
          type: "text",
          text: await agentRetrieveContext(module, query, limit),
        },
      ],
    }),
  );

  server.tool(
    "pre_plan_sync_brief",
    { repo: z.string(), module: z.string() },
    async ({ repo, module }) => ({
      content: [{ type: "text", text: await prePlanSyncBrief(repo, module) }],
    }),
  );
}
