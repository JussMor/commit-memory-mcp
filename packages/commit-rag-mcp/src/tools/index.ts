import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  compactStaleKnowledge,
  executeResearchStep,
  getChunkHistory,
  getModuleContext,
  getModuleGraph,
  getResearchSessionResult,
  getResearchSessionStatus,
  ingestPrs,
  prePlanSyncBrief,
  promoteContextFacts,
  promoteResearchFindings,
  startResearchSession,
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

  // =========================================================================
  // 6. SMART FORGETTING  ·  Knowledge graph compaction.
  //    Archives stale facts, merges overlapping ones, deletes old versions.
  // =========================================================================

  server.tool(
    "compact_stale_knowledge",
    "Smart forgetting: archives stale business facts, merges overlapping ones into summary nodes, and deletes superseded knowledge_note versions. Pass dry_run=true (default) to preview what would be cleaned up before committing.",
    {
      module: z.string(),
      stale_days: z
        .number()
        .optional()
        .describe(
          "Days of inactivity before a fact is considered stale (default 30)",
        ),
      dry_run: z
        .boolean()
        .optional()
        .describe(
          "Preview mode — show what would be cleaned up without acting (default true)",
        ),
    },
    async ({ module, stale_days, dry_run }) => ({
      content: [
        {
          type: "text",
          text: await compactStaleKnowledge(module, stale_days, dry_run),
        },
      ],
    }),
  );

  // =========================================================================
  // 7. RESEARCH ORCHESTRATION  ·  Multi-step async research sessions.
  //    External agents drive research via SurrealDB-backed state machine.
  // =========================================================================

  server.tool(
    "start_research",
    "Creates a new research session: decomposes a question into investigation steps, pre-fetches module context, and dispatches step 0. Returns a session ID immediately (non-blocking). Use get_research_status to follow progress.",
    {
      question: z.string(),
      repo: z.string(),
      module: z.string().optional().describe("Module to scope the research to"),
      max_steps: z
        .number()
        .optional()
        .describe("Maximum investigation steps (default 5, max 10)"),
    },
    async ({ question, repo, module, max_steps }) => ({
      content: [
        {
          type: "text",
          text: await startResearchSession(question, repo, module, max_steps),
        },
      ],
    }),
  );

  server.tool(
    "get_research_status",
    "Returns a snapshot of a research session: current status, step progress, and findings so far. Use to monitor async research sessions.",
    { session_id: z.string() },
    async ({ session_id }) => ({
      content: [
        { type: "text", text: await getResearchSessionStatus(session_id) },
      ],
    }),
  );

  server.tool(
    "execute_research_step",
    "Executes the current running step in a research session. The research agent calls this to advance the session one step at a time. Each step reads its instruction and context from SurrealDB, processes it, writes findings back, and dispatches the next step.",
    { session_id: z.string() },
    async ({ session_id }) => ({
      content: [{ type: "text", text: await executeResearchStep(session_id) }],
    }),
  );

  server.tool(
    "get_research_result",
    "Returns the final assembled answer from a completed research session. If the session is still running, returns the current status instead.",
    { session_id: z.string() },
    async ({ session_id }) => ({
      content: [
        { type: "text", text: await getResearchSessionResult(session_id) },
      ],
    }),
  );

  server.tool(
    "promote_research_findings",
    "Promotes all unpromoted findings from a research session to permanent knowledge_note records. Call after reviewing findings to persist them as the official knowledge base.",
    { session_id: z.string() },
    async ({ session_id }) => ({
      content: [
        { type: "text", text: await promoteResearchFindings(session_id) },
      ],
    }),
  );
}
