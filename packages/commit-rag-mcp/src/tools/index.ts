import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getChunkHistory,
  getModuleContext,
  getModuleGraph,
  ingestPrs,
  prePlanSyncBrief,
  promoteContextFacts,
  whoChangedThis,
  whyWasThisChanged,
} from "../layers/core.js";

export function registerTools(server: McpServer): void {
  // =========================================================================
  // 1. THE DAILY ENTRY POINT  ·  Run this before starting work on any module.
  //    Orchestrates: overnight PR sync + knowledge graph + context brief.
  // =========================================================================

  server.tool(
    "pre_plan_sync_brief",
    "Run this FIRST before starting work on a module. Orchestrates everything: checks for overnight merges, syncs new PRs, and returns the foundational context needed to start coding.",
    { repo: z.string(), module: z.string() },
    async ({ repo, module }) => ({
      content: [{ type: "text", text: await prePlanSyncBrief(repo, module) }],
    }),
  );

  // =========================================================================
  // 2. BACKGROUND INGESTION  ·  Fully automated PR → Graph pipeline.
  //    Fetches merged PRs, extracts ATOM 5-tuples, updates SurrealDB graph.
  // =========================================================================

  server.tool(
    "ingest_prs",
    "Detects new merged PRs, chunks the history, extracts business intent via ATOM 5-tuple extraction, and updates the SurrealDB relationship graph automatically. Usually triggered by a webhook, but can be forced manually.",
    { repo: z.string(), limit: z.number().optional() },
    async ({ repo, limit }) => {
      await ingestPrs(repo, limit);
      return {
        content: [
          {
            type: "text",
            text: `Successfully ingested new PRs for ${repo}. Graph updated.`,
          },
        ],
      };
    },
  );

  // =========================================================================
  // 3. HUMAN-IN-THE-LOOP  ·  Sprint-level fact validation (5 min/sprint).
  //    Dev approves draft facts → confidence 1.0 → source of truth.
  // =========================================================================

  server.tool(
    "promote_context_facts",
    "Surfaces newly extracted draft facts for a module so the developer can validate them. Approved facts get a 1.0 confidence score and become the official business source of truth.",
    { module: z.string() },
    async ({ module }) => ({
      content: [{ type: "text", text: await promoteContextFacts(module) }],
    }),
  );

  // =========================================================================
  // 4. KNOWLEDGE RETRIEVAL  ·  The primary agent-facing search tool.
  //    Hybrid-ranked: overview + latest knowledge + decisions + semantic search.
  // =========================================================================

  server.tool(
    "get_module_context",
    "The primary search tool. Retrieves hybrid-ranked business facts, rules, and memory chunks for a specific module. Pass an optional query for semantic search on top of the structured overview.",
    {
      module: z.string(),
      query: z
        .string()
        .optional()
        .describe("Optional semantic query to filter results"),
    },
    async ({ module, query }) => ({
      content: [{ type: "text", text: await getModuleContext(module, query) }],
    }),
  );

  server.tool(
    "get_module_graph",
    "Returns structural relationships for a module (what it depends on, what it affects). Use this to understand the blast radius of potential changes before writing code.",
    { module: z.string() },
    async ({ module }) => ({
      content: [{ type: "text", text: await getModuleGraph(module) }],
    }),
  );

  server.tool(
    "get_chunk_history",
    "Traces how a module's knowledge evolved over time. Shows the lineage of decisions, replaced facts, and version history so you can understand how rules changed and why.",
    { module: z.string() },
    async ({ module }) => ({
      content: [{ type: "text", text: await getChunkHistory(module) }],
    }),
  );

  // =========================================================================
  // 5. TRACEABILITY  ·  File / commit level attribution.
  // =========================================================================

  server.tool(
    "who_changed_this",
    "Shows recent authors, commits, and ownership context for a specific file path. Use to identify who to talk to before changing a file.",
    {
      file: z.string(),
      repo: z.string().optional(),
    },
    async ({ file, repo }) => ({
      content: [{ type: "text", text: await whoChangedThis(file, repo) }],
    }),
  );

  server.tool(
    "why_was_this_changed",
    "Explains the business intent behind a specific file change or commit SHA by traversing back to the merged PR description and associated business facts.",
    {
      file: z.string().optional(),
      sha: z.string().optional(),
      repo: z.string().optional(),
    },
    async ({ file, sha, repo }) => ({
      content: [
        { type: "text", text: await whyWasThisChanged(file, sha, repo) },
      ],
    }),
  );
}
