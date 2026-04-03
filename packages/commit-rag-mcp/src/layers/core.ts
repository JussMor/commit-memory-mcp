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

  const sections: string[] = [
    `## Module: ${module}`,
    "",
    "### Overview",
    overview,
    "",
    "### Latest Knowledge",
    latest,
    "",
    "### Decisions & Business Rules",
    decisions,
  ];

  if (search) {
    sections.push("", "### Relevant Search Results", search);
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
