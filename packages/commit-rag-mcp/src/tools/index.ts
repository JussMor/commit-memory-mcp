import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getKnowledgeLineage,
  getLatestKnowledge,
  getModuleGraph,
  getModuleOverview,
  ingestCurrentKnowledgeDemo,
  prePlanSyncBrief,
  promoteContextFacts,
  searchModuleContext,
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
    "Sync PR context from GitHub into the local knowledge store.",
    { repo: z.string(), limit: z.number().optional() },
    async ({ repo, limit }) => ({
      content: [{ type: "text", text: await syncPrContext(repo, limit) }],
    }),
  );

  server.tool(
    "who_changed_this",
    "Show recent authors and commits for a file path.",
    { file: z.string(), repo: z.string() },
    async ({ file, repo }) => ({
      content: [{ type: "text", text: await whoChangedThis(file, repo) }],
    }),
  );

  server.tool(
    "why_was_this_changed",
    "Explain the intent behind a file change or commit using traceability context.",
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
    "Summarize merged main-branch changes over the last N hours.",
    { repo: z.string(), hours: z.number().optional() },
    async ({ repo, hours }) => ({
      content: [{ type: "text", text: await getOvernightBrief(repo, hours) }],
    }),
  );

  server.tool(
    "list_active_worktrees",
    "List active git worktrees for the current repository.",
    {},
    async () => ({
      content: [{ type: "text", text: await listActiveWorktrees() }],
    }),
  );

  server.tool(
    "ingest_pr",
    "Ingest a PR and persist its context into Surreal knowledge records.",
    { repo: z.string(), pr_number: z.number() },
    async ({ repo, pr_number }) => {
      await ingestPr(repo, pr_number);
      return { content: [{ type: "text", text: `PR #${pr_number} ingested` }] };
    },
  );

  server.tool(
    "extract_business_facts",
    "Extract business-facing facts from a PR into a target module.",
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
    "get_module_overview",
    "Return a high-level overview for a module from stored context.",
    { module: z.string() },
    async ({ module }) => ({
      content: [{ type: "text", text: await getModuleOverview(module) }],
    }),
  );

  server.tool(
    "get_latest_module_knowledge",
    "Fetch the latest knowledge entries for a module and optional topic.",
    {
      module: z.string(),
      topic: z.string().optional(),
      limit: z.number().optional(),
    },
    async ({ module, topic, limit }) => ({
      content: [
        {
          type: "text",
          text: await getLatestKnowledge(module, topic, limit),
        },
      ],
    }),
  );

  server.tool(
    "get_knowledge_lineage",
    "Trace lineage and provenance for module knowledge over time.",
    {
      module: z.string(),
      topic: z.string().optional(),
      depth: z.number().optional(),
    },
    async ({ module, topic, depth }) => ({
      content: [
        {
          type: "text",
          text: await getKnowledgeLineage(module, topic, depth),
        },
      ],
    }),
  );

  server.tool(
    "get_module_graph",
    "Return the relationship graph for a module and related knowledge.",
    { module: z.string() },
    async ({ module }) => ({
      content: [{ type: "text", text: await getModuleGraph(module) }],
    }),
  );

  server.tool(
    "promote_context_facts",
    "Promote vetted context facts into durable module knowledge.",
    { module: z.string(), pr_number: z.number().optional() },
    async ({ module, pr_number }) => ({
      content: [
        { type: "text", text: await promoteContextFacts(module, pr_number) },
      ],
    }),
  );

  server.tool(
    "search_module_context",
    "Search stored context for a module using semantic retrieval.",
    {
      module: z.string(),
      query: z.string(),
      limit: z.number().optional(),
    },
    async ({ module, query, limit }) => ({
      content: [
        {
          type: "text",
          text: await searchModuleContext(module, query, limit),
        },
      ],
    }),
  );

  server.tool(
    "ingest_current_knowledge_demo",
    "Insert current-session findings into module knowledge (demo helper).",
    {
      module: z.string(),
      topic: z.string(),
      findings: z.string(),
      route: z.string().optional(),
      feature: z.string().optional(),
      related_modules: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
    },
    async ({
      module,
      topic,
      findings,
      route,
      feature,
      related_modules,
      tags,
    }) => ({
      content: [
        {
          type: "text",
          text: await ingestCurrentKnowledgeDemo(
            module,
            topic,
            findings,
            route,
            feature,
            related_modules,
            tags,
          ),
        },
      ],
    }),
  );

  server.tool(
    "pre_plan_sync_brief",
    "Run pre-plan sync checks and return a planning brief for a module.",
    { repo: z.string(), module: z.string() },
    async ({ repo, module }) => ({
      content: [{ type: "text", text: await prePlanSyncBrief(repo, module) }],
    }),
  );
}
