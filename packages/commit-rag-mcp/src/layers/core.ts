/**
 * core.ts — The 8-function public surface that backs the 8 MCP tools.
 *
 * Principles:
 *  - Every function is fully self-contained (one import source per concern).
 *  - Developers / AI agents never call into business.ts / coordination.ts /
 *    trazability.ts / ingest.ts directly — they go through here.
 *  - Zero manual wiring: ingestion is fully automated end-to-end.
 */

import {
  getKnowledgeLineage,
  getLatestKnowledge,
  getModuleGraph as getModuleGraphRaw,
  getModuleOverview,
  prePlanSyncBrief as prePlanSyncBriefRaw,
  promoteContextFacts as promoteContextFactsRaw,
  searchModuleContext,
} from "./business.js";
import { getDecisionLog } from "./coordination.js";
import { runGh } from "./gh.js";
import { atomExtract, extractBusinessFacts, ingestPr } from "./ingest.js";
import {
  syncPrContext,
  whoChangedThis as whoChangedThisRaw,
  whyWasThisChanged as whyWasThisChangedRaw,
} from "./trazability.js";

// ---------------------------------------------------------------------------
// 1. pre_plan_sync_brief
// Orchestrates everything needed before starting work on a module:
// overnight PR sync + knowledge-graph awareness all in one call.
// ---------------------------------------------------------------------------
export async function prePlanSyncBrief(
  repo: string,
  module: string,
): Promise<string> {
  return prePlanSyncBriefRaw(repo, module);
}

// ---------------------------------------------------------------------------
// 2. ingest_prs
// Full automated pipeline: fetch merged PRs → ingest raw PR → extract
// business facts → run ATOM 5-tuple extraction.
// One call replaces: sync_pr_context + ingest_pr + ingest_business_facts +
// atom_extract.
// ---------------------------------------------------------------------------

type MergedPrListItem = {
  number: number;
  title: string;
  mergedAt: string | null;
  baseRefName: string;
  labels: Array<{ name: string }>;
};

export async function ingestPrs(repo: string, limit = 20): Promise<void> {
  // Step 1: sync raw PR metadata from GitHub
  await syncPrContext(repo, limit);

  // Step 2: fetch the list of recently merged PRs to process them deeper
  const [owner, name] = repo.split("/");
  if (!owner || !name)
    throw new Error(`Invalid repo format: ${repo}. Expected owner/name.`);

  const raw = runGh([
    "pr",
    "list",
    "--repo",
    `${owner}/${name}`,
    "--state",
    "merged",
    "--limit",
    String(limit),
    "--json",
    "number,title,mergedAt,baseRefName,labels",
  ]);

  const prs: MergedPrListItem[] = JSON.parse(raw) as MergedPrListItem[];

  // Step 3: for each PR, ingest + extract facts + ATOM tuples
  // Derive a module hint from the PR labels or fall back to the repo name
  for (const pr of prs) {
    try {
      // Full detail ingest (body, files, commits)
      await ingestPr(repo, pr.number);

      // Derive a module hint from labels (first label that looks like a module)
      const moduleHint =
        pr.labels.map((l) => l.name).find((l) => /^[a-z]/i.test(l)) ??
        name ??
        "unknown";

      // Business facts (memory chunks, PR body extraction)
      await extractBusinessFacts(repo, pr.number, moduleHint);

      // ATOM 5-tuple extraction (temporal business rules)
      await atomExtract(repo, pr.number, moduleHint);
    } catch (err) {
      // Log but don't fail the whole batch if one PR errors
      console.warn(
        `[ingest_prs] PR #${pr.number} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 3. promote_context_facts
// Surfaces draft facts for a module so the developer can validate them.
// ---------------------------------------------------------------------------
export async function promoteContextFacts(module: string): Promise<string> {
  return promoteContextFactsRaw(module);
}

// ---------------------------------------------------------------------------
// 4. get_module_context
// Hybrid-ranked context: business facts + knowledge notes + decision log.
// Replaces: search_context + get_module_overview + get_latest_knowledge +
// get_decision_log.
// ---------------------------------------------------------------------------

function parseJsonObject<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

type OverviewPayload = {
  module?: {
    description?: string;
    status?: string;
    updated_at?: string;
  };
  facts?: Array<{
    summary?: string;
    rationale?: string;
    status?: string;
    confidence?: number;
    created_at?: string;
  }>;
  memory_chunks?: Array<{
    kind?: string;
    summary?: string;
    content?: string;
    confidence?: number;
  }>;
  latest_knowledge?: Array<{
    topic?: string;
    summary?: string;
    version?: number;
    updated_at?: string;
  }>;
  recent_prs?: Array<{
    number?: number;
    title?: string;
  }>;
};

type DecisionPayload = {
  promoted_facts?: Array<{
    summary?: string;
    rationale?: string;
    confidence?: number;
  }>;
  bootstrap_draft_facts?: Array<{
    summary?: string;
    rationale?: string;
    confidence?: number;
    file_path?: string;
  }>;
  high_confidence_knowledge?: Array<{
    topic?: string;
    summary?: string;
    confidence?: number;
  }>;
};

type LatestKnowledgePayload = {
  latest?: Array<{
    topic?: string;
    summary?: string;
    version?: number;
  }>;
};

export async function getModuleContext(
  module: string,
  query?: string,
): Promise<string> {
  const [overview, decisions, latest, search] = await Promise.all([
    getModuleOverview(module),
    getDecisionLog(module),
    getLatestKnowledge(module, undefined, 5),
    query ? searchModuleContext(module, query, 8) : Promise.resolve(null),
  ]);

  const overviewPayload = parseJsonObject<OverviewPayload>(overview) ?? {};
  const decisionPayload = parseJsonObject<DecisionPayload>(decisions) ?? {};
  const latestPayload = parseJsonObject<LatestKnowledgePayload>(latest) ?? {};
  const searchPayload = search
    ? parseJsonObject<Record<string, unknown>>(search)
    : null;

  const description =
    overviewPayload.module?.description?.trim() ||
    "No module overview available yet.";
  const bootstrapFacts = decisionPayload.bootstrap_draft_facts ?? [];
  const promotedFacts = decisionPayload.promoted_facts ?? [];
  const latestKnowledge = latestPayload.latest ?? [];
  const memoryChunks = overviewPayload.memory_chunks ?? [];
  const recentPrs = overviewPayload.recent_prs ?? [];

  const sections: string[] = [
    `## Module: ${module}`,
    "",
    "### Summary",
    description,
  ];

  sections.push(
    "",
    "### Bootstrap Draft Facts",
    bootstrapFacts.length > 0
      ? bootstrapFacts
          .slice(0, 8)
          .map(
            (fact, index) =>
              `${index + 1}. ${fact.summary ?? "Draft fact"}${fact.file_path ? ` [${fact.file_path}]` : ""}${fact.rationale ? `\n   ${fact.rationale}` : ""}`,
          )
          .join("\n")
      : "No reverse-engineered draft facts.",
  );

  sections.push(
    "",
    "### Validated Facts",
    promotedFacts.length > 0
      ? promotedFacts
          .slice(0, 8)
          .map(
            (fact, index) =>
              `${index + 1}. ${fact.summary ?? "Fact"}${fact.rationale ? `\n   ${fact.rationale}` : ""}`,
          )
          .join("\n")
      : "No promoted facts yet.",
  );

  sections.push(
    "",
    "### Reverse-Engineered Evidence",
    memoryChunks.length > 0
      ? memoryChunks
          .slice(0, 6)
          .map(
            (chunk, index) =>
              `${index + 1}. ${chunk.summary ?? chunk.kind ?? "Evidence"}${chunk.content ? `\n   ${chunk.content}` : ""}`,
          )
          .join("\n")
      : "No supporting memory chunks.",
  );

  sections.push(
    "",
    "### Latest Knowledge",
    latestKnowledge.length > 0
      ? latestKnowledge
          .slice(0, 5)
          .map(
            (item, index) =>
              `${index + 1}. ${item.topic ?? "Knowledge"}: ${item.summary ?? ""}`,
          )
          .join("\n")
      : "No knowledge notes yet.",
  );

  sections.push(
    "",
    "### Recent PR Context",
    recentPrs.length > 0
      ? recentPrs
          .slice(0, 5)
          .map(
            (pr, index) =>
              `${index + 1}. #${pr.number ?? "?"} ${pr.title ?? ""}`,
          )
          .join("\n")
      : "No PRs linked to this module yet.",
  );

  if (searchPayload) {
    sections.push(
      "",
      "### Relevant Search Results",
      JSON.stringify(searchPayload, null, 2),
    );
  }

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// 5. get_module_graph
// Visual/structural relationships for a module.
// ---------------------------------------------------------------------------
export async function getModuleGraph(module: string): Promise<string> {
  return getModuleGraphRaw(module);
}

// ---------------------------------------------------------------------------
// 6. get_chunk_history
// How a module's knowledge evolved over time — lineage of decisions.
// Replaces: get_knowledge_lineage.
// ---------------------------------------------------------------------------
export async function getChunkHistory(module: string): Promise<string> {
  return getKnowledgeLineage(module, undefined, 20);
}

// ---------------------------------------------------------------------------
// 7. who_changed_this
// File ownership and recent commit/author context.
// ---------------------------------------------------------------------------
export async function whoChangedThis(
  file: string,
  repo?: string,
): Promise<string> {
  return whoChangedThisRaw(file, repo ?? "");
}

// ---------------------------------------------------------------------------
// 8. why_was_this_changed
// Business intent tracing: file → commit → PR → business facts.
// ---------------------------------------------------------------------------
export async function whyWasThisChanged(
  file?: string,
  sha?: string,
  repo?: string,
): Promise<string> {
  return whyWasThisChangedRaw(file, sha, repo ?? "");
}
