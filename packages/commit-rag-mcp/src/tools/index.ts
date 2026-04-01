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
import {
  flagDecision,
  getCrossModuleImpact,
  getDecisionLog,
  getHandoffSummary,
  getStaleKnowledge,
  getTeamActivity,
  linkModules,
} from "../layers/coordination.js";
import { extractBusinessFacts, ingestPr } from "../layers/ingest.js";
import {
  getOvernightBrief,
  listActiveWorktrees,
  syncPrContext,
  whoChangedThis,
  whyWasThisChanged,
} from "../layers/trazability.js";

export function registerTools(server: McpServer): void {
  // =========================================================================
  //  SYNC — Pull external data into the knowledge store
  // =========================================================================

  server.tool(
    "sync_pr_context",
    "Sync PR metadata, descriptions, and review decisions from GitHub into the local knowledge store. Run this at session start to ensure the DB reflects the latest merged PRs.",
    { repo: z.string(), limit: z.number().optional() },
    async ({ repo, limit }) => ({
      content: [{ type: "text", text: await syncPrContext(repo, limit) }],
    }),
  );

  // =========================================================================
  //  INGEST — Process raw data into structured knowledge
  // =========================================================================

  server.tool(
    "ingest_pr",
    "Ingest a single PR and persist its full context (title, body, files, commits, labels) into SurrealDB.",
    { repo: z.string(), pr_number: z.number() },
    async ({ repo, pr_number }) => {
      await ingestPr(repo, pr_number);
      return { content: [{ type: "text", text: `PR #${pr_number} ingested` }] };
    },
  );

  server.tool(
    "ingest_business_facts",
    "Extract business-facing facts, rationale, and memory chunks from a PR into a target module. Creates draft facts that can later be promoted.",
    { repo: z.string(), pr_number: z.number(), module: z.string() },
    async ({ repo, pr_number, module }) => {
      await extractBusinessFacts(repo, pr_number, module);
      return {
        content: [
          {
            type: "text",
            text: `Business facts ingested from PR #${pr_number} -> ${module}`,
          },
        ],
      };
    },
  );

  server.tool(
    "ingest_knowledge",
    "Persist current-session findings, discoveries, or investigation results into versioned module knowledge. Each call creates a new version with lineage tracking via the supersedes relation.",
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

  // =========================================================================
  //  CATCHUP — Session-start awareness tools for async teams
  // =========================================================================

  server.tool(
    "get_overnight_brief",
    "Summarize merged main-branch PRs over the last N hours. Use at session start to catch up on what landed while you were away.",
    { repo: z.string(), hours: z.number().optional() },
    async ({ repo, hours }) => ({
      content: [{ type: "text", text: await getOvernightBrief(repo, hours) }],
    }),
  );

  server.tool(
    "get_handoff_summary",
    "Cross-module async handoff: summarize ALL new PRs, business facts, knowledge updates, and worktree activity since N hours ago. The team standup replacement for async teams.",
    {
      since_hours: z.number().describe("Hours to look back (default 24)"),
      modules: z
        .array(z.string())
        .optional()
        .describe("Filter to specific modules, or omit for all"),
    },
    async ({ since_hours, modules }) => ({
      content: [
        {
          type: "text",
          text: await getHandoffSummary(since_hours, modules),
        },
      ],
    }),
  );

  server.tool(
    "pre_plan_sync_brief",
    "Run sync + overnight + knowledge checks before planning work on a module. Enforces: PR context sync, overnight change awareness, and branch divergence visibility.",
    { repo: z.string(), module: z.string() },
    async ({ repo, module }) => ({
      content: [{ type: "text", text: await prePlanSyncBrief(repo, module) }],
    }),
  );

  // =========================================================================
  //  QUERY — Read-only retrieval of stored knowledge
  // =========================================================================

  server.tool(
    "who_changed_this",
    "Show recent authors, commits, and PR context for a file path. Use to understand ownership and recent activity.",
    { file: z.string(), repo: z.string() },
    async ({ file, repo }) => ({
      content: [{ type: "text", text: await whoChangedThis(file, repo) }],
    }),
  );

  server.tool(
    "why_was_this_changed",
    "Explain the intent behind a file change or commit by tracing it back to PR descriptions and team decisions.",
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
    "get_module_overview",
    "Return a high-level overview for a module: promoted facts, recent PRs, memory chunks, and latest knowledge notes.",
    { module: z.string() },
    async ({ module }) => ({
      content: [{ type: "text", text: await getModuleOverview(module) }],
    }),
  );

  server.tool(
    "get_latest_knowledge",
    "Fetch the most recent versioned knowledge entries for a module, optionally filtered by topic.",
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
    "Trace the version history and provenance chain for a knowledge topic. Shows how understanding evolved over time via the supersedes relation.",
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
    "Return the dependency/relationship graph for a module showing affects, required_by, and affected_by links.",
    { module: z.string() },
    async ({ module }) => ({
      content: [{ type: "text", text: await getModuleGraph(module) }],
    }),
  );

  server.tool(
    "search_context",
    "Semantic search across stored business facts and memory chunks for a module. Combines BM25 full-text, embedding similarity, and keyword scoring.",
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
    "get_decision_log",
    "Return all promoted business facts and high-confidence knowledge notes for a module. This is the source of truth for team-agreed business rules and architectural decisions.",
    {
      module: z.string(),
      include_archived: z
        .boolean()
        .optional()
        .describe("Include archived decisions (default false)"),
    },
    async ({ module, include_archived }) => ({
      content: [
        {
          type: "text",
          text: await getDecisionLog(module, include_archived),
        },
      ],
    }),
  );

  server.tool(
    "get_stale_knowledge",
    "Detect knowledge notes and business facts that haven't been updated recently but whose module has new PR activity. Flags rules that may be outdated and need re-evaluation.",
    {
      module: z.string(),
      stale_days: z
        .number()
        .optional()
        .describe("Consider stale after N days (default 30)"),
    },
    async ({ module, stale_days }) => ({
      content: [
        {
          type: "text",
          text: await getStaleKnowledge(module, stale_days),
        },
      ],
    }),
  );

  server.tool(
    "get_cross_module_impact",
    "Given a PR number or file paths, identify which modules are affected and which business facts/knowledge might need updating. Use before large PRs to assess blast radius.",
    {
      repo: z.string(),
      pr_number: z.number().optional(),
      file_paths: z.array(z.string()).optional(),
    },
    async ({ repo, pr_number, file_paths }) => ({
      content: [
        {
          type: "text",
          text: await getCrossModuleImpact(repo, pr_number, file_paths),
        },
      ],
    }),
  );

  // =========================================================================
  //  TEAM — Worktree & collaboration awareness
  // =========================================================================

  server.tool(
    "list_active_worktrees",
    "List active git worktrees and their branches. Shows who may be working on what in a multi-worktree setup.",
    {},
    async () => ({
      content: [{ type: "text", text: await listActiveWorktrees() }],
    }),
  );

  server.tool(
    "get_team_activity",
    "Async standup: summarize who committed recently, which worktrees are active, which modules had PR merges, and who's working on what. Covers the last N hours.",
    {
      repo: z.string(),
      since_hours: z
        .number()
        .optional()
        .describe("Hours to look back (default 24)"),
    },
    async ({ repo, since_hours }) => ({
      content: [
        {
          type: "text",
          text: await getTeamActivity(repo, since_hours),
        },
      ],
    }),
  );

  // =========================================================================
  //  LIFECYCLE — Knowledge promotion, linking, and decision flagging
  // =========================================================================

  server.tool(
    "promote_facts",
    "Promote vetted draft business facts into durable promoted status. Promoted facts appear in decision logs and are weighted higher in search.",
    { module: z.string(), pr_number: z.number().optional() },
    async ({ module, pr_number }) => ({
      content: [
        { type: "text", text: await promoteContextFacts(module, pr_number) },
      ],
    }),
  );

  server.tool(
    "link_modules",
    "Create an explicit dependency relationship between two modules (affects or required_by). Enables the module graph to show real dependency chains.",
    {
      from: z.string().describe("Source module name"),
      to: z.string().describe("Target module name"),
      relation: z
        .enum(["affects", "required_by"])
        .describe("Type of relationship"),
    },
    async ({ from, to, relation }) => ({
      content: [{ type: "text", text: await linkModules(from, to, relation) }],
    }),
  );

  server.tool(
    "flag_decision",
    "Mark a knowledge note or business fact as a team decision, blocker, or convention. Bumps confidence to 0.95 and adds team-decision tags so it surfaces prominently in decision logs.",
    {
      record_id: z
        .string()
        .describe("SurrealDB record ID (e.g. knowledge_note:abc123)"),
      severity: z.enum(["decision", "blocker", "convention"]),
      reason: z.string().describe("Why this was flagged as a team decision"),
    },
    async ({ record_id, severity, reason }) => ({
      content: [
        {
          type: "text",
          text: await flagDecision(record_id, severity, reason),
        },
      ],
    }),
  );
}
