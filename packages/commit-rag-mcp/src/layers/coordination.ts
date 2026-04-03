import { execFileSync } from "node:child_process";
import { getDb } from "../db/client.js";

type SurrealResult = unknown[];

function getLastDefinedResult<T>(result: SurrealResult): T | undefined {
  for (let index = result.length - 1; index >= 0; index -= 1) {
    const value = result[index];
    if (value !== null && value !== undefined) {
      return value as T;
    }
  }
  return undefined;
}

function sanitizeModuleName(moduleName: string): string {
  return moduleName.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// ---------------------------------------------------------------------------
// get_handoff_summary
// Cross-module summary since a timestamp. For async team handoffs:
// "What happened while I was away, across ALL modules?"
// ---------------------------------------------------------------------------
export async function getHandoffSummary(
  sinceHours: number,
  modules?: string[],
): Promise<string> {
  const db = await getDb();
  const hours = Math.max(1, Math.min(sinceHours, 720));

  const moduleFilter =
    modules && modules.length > 0
      ? modules.map((m) => sanitizeModuleName(m))
      : null;

  const result = (await db.query(
    `
      LET $cutoff = time::now() - duration::from_hours($hours);

      LET $recent_prs = (
        SELECT number, title, author, merged_at, base_branch, files, labels
        FROM pr
        WHERE merged_at >= $cutoff
          AND state = 'merged'
        ORDER BY merged_at DESC
        LIMIT 50
      );

      LET $recent_facts = (
        SELECT id, summary, rationale, status, confidence, created_at, updated_at,
          module.name AS module_name,
          source_pr.number AS pr_number,
          source_pr.title AS pr_title
        FROM business_fact
        WHERE updated_at >= $cutoff
        ORDER BY updated_at DESC
        LIMIT 50
      );

      LET $recent_knowledge = (
        SELECT id, topic, summary, details, version, updated_at, source_type, source_ref,
          module.name AS module_name,
          tags, related_modules
        FROM knowledge_note
        WHERE updated_at >= $cutoff
          AND is_latest = true
        ORDER BY updated_at DESC
        LIMIT 50
      );

      LET $recent_chunks = (
        SELECT kind, summary, importance, confidence, created_at,
          module.name AS module_name,
          source_pr.number AS pr_number
        FROM memory_chunk
        WHERE created_at >= $cutoff
          AND status = 'active'
        ORDER BY importance DESC, created_at DESC
        LIMIT 30
      );

      LET $active_worktrees = (
        SELECT path, branch, active, last_seen
        FROM worktree
        WHERE active = true
        ORDER BY last_seen DESC
      );

      RETURN {
        since_hours: $hours,
        merged_prs: $recent_prs,
        new_business_facts: $recent_facts,
        updated_knowledge: $recent_knowledge,
        new_memory_chunks: $recent_chunks,
        active_worktrees: $active_worktrees
      }
    `,
    { hours },
  )) as SurrealResult;

  const payload = getLastDefinedResult(result) ?? {};

  if (moduleFilter) {
    const filtered = filterByModules(payload as HandoffPayload, moduleFilter);
    return JSON.stringify(filtered, null, 2);
  }

  return JSON.stringify(payload, null, 2);
}

type HandoffPayload = {
  since_hours?: number;
  merged_prs?: unknown[];
  new_business_facts?: Array<{ module_name?: string }>;
  updated_knowledge?: Array<{ module_name?: string }>;
  new_memory_chunks?: Array<{ module_name?: string }>;
  active_worktrees?: unknown[];
};

function filterByModules(
  payload: HandoffPayload,
  modules: string[],
): HandoffPayload {
  const set = new Set(modules.map((m) => m.toLowerCase()));
  const matchModule = (name?: string) =>
    !name ? false : set.has(name.toLowerCase());

  return {
    ...payload,
    new_business_facts: (payload.new_business_facts ?? []).filter((f) =>
      matchModule(f.module_name),
    ),
    updated_knowledge: (payload.updated_knowledge ?? []).filter((k) =>
      matchModule(k.module_name),
    ),
    new_memory_chunks: (payload.new_memory_chunks ?? []).filter((c) =>
      matchModule(c.module_name),
    ),
  };
}

// ---------------------------------------------------------------------------
// get_decision_log
// All promoted business facts + high-confidence knowledge for a module.
// The "source of truth" for business rules a team agreed on.
// ---------------------------------------------------------------------------
export async function getDecisionLog(
  module: string,
  includeArchived = false,
): Promise<string> {
  const db = await getDb();
  const moduleKey = sanitizeModuleName(module);

  const result = (await db.query(
    `
      LET $mod = (SELECT * FROM module WHERE name = $name LIMIT 1)[0];

      LET $promoted_facts = (
        SELECT id, summary, rationale, confidence, status, created_at, updated_at,
          source_pr.number AS pr_number,
          source_pr.title AS pr_title
        FROM business_fact
        WHERE module = $mod.id
          AND (status = 'promoted' OR ($include_archived AND status = 'archived'))
        ORDER BY updated_at DESC
      );

      LET $decision_knowledge = (
        SELECT id, topic, summary, details, version, updated_at, source_type, source_ref,
          tags, related_modules, confidence
        FROM knowledge_note
        WHERE module = $mod.id
          AND is_latest = true
          AND confidence >= 0.8
        ORDER BY updated_at DESC
      );

      LET $bootstrap_drafts = (
        SELECT id, summary, rationale, confidence, status, created_at, updated_at,
          source_file.path AS file_path
        FROM business_fact
        WHERE module = $mod.id
          AND status = 'draft'
          AND source_type = 'reverse_engineered'
        ORDER BY updated_at DESC
        LIMIT 20
      );

      RETURN {
        module: $mod.name,
        promoted_facts: $promoted_facts,
        bootstrap_draft_facts: $bootstrap_drafts,
        high_confidence_knowledge: $decision_knowledge,
        total_facts: count($promoted_facts),
        total_bootstrap_drafts: count($bootstrap_drafts),
        total_knowledge: count($decision_knowledge)
      }
    `,
    {
      name: module,
      include_archived: includeArchived,
    },
  )) as SurrealResult;

  return JSON.stringify(getLastDefinedResult(result) ?? {}, null, 2);
}

// ---------------------------------------------------------------------------
// get_stale_knowledge
// Detect knowledge notes whose related PRs/files have newer activity.
// Flags stale rules that might need re-evaluation after code changes.
// ---------------------------------------------------------------------------
export async function getStaleKnowledge(
  module: string,
  staleDays = 30,
): Promise<string> {
  const db = await getDb();
  const days = Math.max(1, Math.min(staleDays, 365));

  const result = (await db.query(
    `
      LET $mod = (SELECT * FROM module WHERE name = $name LIMIT 1)[0];
      LET $cutoff = time::now() - duration::from_days($days);

      LET $stale_facts = (
        SELECT id, summary, rationale, confidence, status, created_at, updated_at,
          source_pr.number AS pr_number,
          source_pr.title AS pr_title,
          source_type
        FROM business_fact
        WHERE module = $mod.id
          AND status INSIDE ['promoted', 'draft']
          AND updated_at < $cutoff
        ORDER BY updated_at ASC
      );

      LET $stale_knowledge = (
        SELECT id, topic, summary, details, version, updated_at, source_type, source_ref,
          tags, related_modules, confidence
        FROM knowledge_note
        WHERE module = $mod.id
          AND is_latest = true
          AND updated_at < $cutoff
        ORDER BY updated_at ASC
      );

      LET $recent_prs = (
        SELECT number, title, author, merged_at
        FROM pr
        WHERE id INSIDE (SELECT VALUE in FROM belongs_to WHERE out = $mod.id)
          AND merged_at >= $cutoff
        ORDER BY merged_at DESC
        LIMIT 10
      );

      RETURN {
        module: $mod.name,
        stale_threshold_days: $days,
        stale_business_facts: $stale_facts,
        stale_knowledge_notes: $stale_knowledge,
        recent_pr_activity: $recent_prs,
        risk: IF count($stale_facts) > 0 AND count($recent_prs) > 0 {
          'HIGH — stale rules exist but module has recent PR activity'
        } ELSE IF count($stale_facts) > 0 {
          'MEDIUM — stale rules but no recent changes'
        } ELSE {
          'LOW — knowledge is up to date'
        }
      }
    `,
    { name: module, days },
  )) as SurrealResult;

  return JSON.stringify(getLastDefinedResult(result) ?? {}, null, 2);
}

// ---------------------------------------------------------------------------
// get_cross_module_impact
// Given a PR number or file paths, show which modules are affected and what
// business facts/knowledge might need updating.
// ---------------------------------------------------------------------------
export async function getCrossModuleImpact(
  repo: string,
  prNumber?: number,
  filePaths?: string[],
): Promise<string> {
  const db = await getDb();

  let files: string[] = filePaths ?? [];

  if (prNumber) {
    const prResult = (await db.query(
      `
        SELECT files
        FROM pr
        WHERE repo = $repo AND number = $pr_number
        LIMIT 1
      `,
      { repo, pr_number: prNumber },
    )) as SurrealResult;

    const prRow = getLastDefinedResult<Array<{ files?: string[] }>>(prResult);
    const prFiles = prRow?.[0]?.files ?? [];
    files = [...new Set([...files, ...prFiles])];
  }

  if (files.length === 0) {
    return JSON.stringify({
      error: "No files found. Provide prNumber or filePaths.",
    });
  }

  // Find all modules that have PRs touching these files
  const result = (await db.query(
    `
      LET $affected_prs = (
        SELECT id, number, title, author, merged_at, files
        FROM pr
        WHERE repo = $repo
          AND files ANYINSIDE $target_files
        ORDER BY merged_at DESC
        LIMIT 20
      );

      LET $affected_modules = (
        SELECT out.name AS module_name, count() AS pr_count
        FROM belongs_to
        WHERE in INSIDE $affected_prs.id
        GROUP BY out.name
        ORDER BY pr_count DESC
      );

      LET $at_risk_facts = (
        SELECT id, summary, rationale, confidence, status, updated_at,
          module.name AS module_name,
          source_pr.number AS pr_number,
          source_type
        FROM business_fact
        WHERE module INSIDE (
          SELECT VALUE out FROM belongs_to WHERE in INSIDE $affected_prs.id
        )
          AND status INSIDE ['promoted', 'draft']
        ORDER BY updated_at DESC
        LIMIT 30
      );

      LET $at_risk_knowledge = (
        SELECT id, topic, summary, version, updated_at, source_type,
          module.name AS module_name,
          tags, related_modules, confidence
        FROM knowledge_note
        WHERE module INSIDE (
          SELECT VALUE out FROM belongs_to WHERE in INSIDE $affected_prs.id
        )
          AND is_latest = true
        ORDER BY updated_at DESC
        LIMIT 20
      );

      RETURN {
        files_analyzed: $target_files,
        pr_number: $pr_number,
        affected_prs: $affected_prs,
        affected_modules: $affected_modules,
        at_risk_business_facts: $at_risk_facts,
        at_risk_knowledge: $at_risk_knowledge,
        impact_summary: {
          modules_affected: count($affected_modules),
          facts_at_risk: count($at_risk_facts),
          knowledge_at_risk: count($at_risk_knowledge)
        }
      }
    `,
    {
      repo,
      target_files: files,
      pr_number: prNumber ?? null,
    },
  )) as SurrealResult;

  return JSON.stringify(getLastDefinedResult(result) ?? {}, null, 2);
}

// ---------------------------------------------------------------------------
// get_team_activity
// Summary of who's working on what: worktrees + recent commit authors + PR
// activity. The async standup replacement.
// ---------------------------------------------------------------------------
export async function getTeamActivity(
  repo: string,
  sinceHours = 24,
): Promise<string> {
  const db = await getDb();
  const hours = Math.max(1, Math.min(sinceHours, 720));

  // Get recent git authors from shell
  let recentAuthors: Array<{ author: string; commits: number }> = [];
  try {
    const since = `${hours} hours ago`;
    const raw = execFileSync(
      "git",
      ["log", `--since=${since}`, "--format=%an", "--all"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();

    if (raw) {
      const counts = new Map<string, number>();
      for (const author of raw.split("\n")) {
        counts.set(author, (counts.get(author) ?? 0) + 1);
      }
      recentAuthors = Array.from(counts.entries())
        .map(([author, commits]) => ({ author, commits }))
        .sort((a, b) => b.commits - a.commits);
    }
  } catch {
    // git not available or no history
  }

  const result = (await db.query(
    `
      LET $cutoff = time::now() - duration::from_hours($hours);

      LET $active_worktrees = (
        SELECT path, branch, active, last_seen
        FROM worktree
        WHERE active = true
        ORDER BY last_seen DESC
      );

      LET $recent_prs = (
        SELECT number, title, author, merged_at, state
        FROM pr
        WHERE repo = $repo
          AND merged_at >= $cutoff
        ORDER BY merged_at DESC
        LIMIT 25
      );

      LET $modules_with_activity = (
        SELECT out.name AS module_name, count() AS change_count
        FROM belongs_to
        WHERE in INSIDE (
          SELECT VALUE id FROM pr WHERE repo = $repo AND merged_at >= $cutoff
        )
        GROUP BY out.name
        ORDER BY change_count DESC
      );

      RETURN {
        since_hours: $hours,
        active_worktrees: $active_worktrees,
        recent_merged_prs: $recent_prs,
        active_modules: $modules_with_activity
      }
    `,
    { repo, hours },
  )) as SurrealResult;

  const payload = getLastDefinedResult(result) ?? {};

  return JSON.stringify(
    {
      ...(payload as Record<string, unknown>),
      git_authors: recentAuthors,
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// link_modules
// Create explicit module→module relationships (affects / required_by).
// Enables `get_module_graph` to show real dependency chains.
// ---------------------------------------------------------------------------
export async function linkModules(
  from: string,
  to: string,
  relation: "affects" | "required_by",
): Promise<string> {
  const db = await getDb();
  const fromKey = sanitizeModuleName(from);
  const toKey = sanitizeModuleName(to);

  // Ensure both modules exist
  await db.query(
    `
      UPSERT type::record('module', $fromKey) SET name = $fromName, updated_at = time::now();
      UPSERT type::record('module', $toKey) SET name = $toName, updated_at = time::now();
    `,
    { fromKey, fromName: from, toKey, toName: to },
  );

  const table = relation === "affects" ? "affects" : "required_by";

  // type::table($table) is not supported in RELATE in this SurrealDB Cloud
  // version. Interpolate the table name as a literal so the query is static.
  const relateQuery =
    table === "affects"
      ? `
      LET $from = type::record('module', $fromKey);
      LET $to   = type::record('module', $toKey);
      LET $existing = (SELECT * FROM affects WHERE in = $from AND out = $to LIMIT 1)[0];
      IF $existing = NONE {
        RELATE $from -> affects -> $to SET created_at = time::now();
      };
    `
      : `
      LET $from = type::record('module', $fromKey);
      LET $to   = type::record('module', $toKey);
      LET $existing = (SELECT * FROM required_by WHERE in = $from AND out = $to LIMIT 1)[0];
      IF $existing = NONE {
        RELATE $from -> required_by -> $to SET created_at = time::now();
      };
    `;

  await db.query(relateQuery, { fromKey, toKey });

  return JSON.stringify({
    linked: true,
    from,
    to,
    relation,
  });
}

// ---------------------------------------------------------------------------
// flag_decision
// Mark a knowledge note or business fact as a team decision/blocker.
// Bumps confidence to 0.95 and adds a "decision" tag so get_decision_log
// can surface it prominently.
// ---------------------------------------------------------------------------
export async function flagDecision(
  recordId: string,
  severity: "decision" | "blocker" | "convention",
  reason: string,
): Promise<string> {
  const db = await getDb();

  // Split "table:key" so we can use type::record() which is supported in this
  // Cloud version, whereas type::thing($var) is not.
  const colonIdx = recordId.indexOf(":");
  const recTable =
    colonIdx !== -1 ? recordId.slice(0, colonIdx) : "knowledge_note";
  const recKey = colonIdx !== -1 ? recordId.slice(colonIdx + 1) : recordId;

  if (recTable !== "knowledge_note" && recTable !== "business_fact") {
    throw new Error(
      `flagDecision only supports knowledge_note or business_fact IDs, got: ${recTable}`,
    );
  }

  // Try as knowledge_note when appropriate.
  const knResult = (await db.query(
    `
      LET $rec = type::record('knowledge_note', $recKey);
      RETURN (SELECT id, tags FROM knowledge_note WHERE id = $rec LIMIT 1)[0]
    `,
    { recKey },
  )) as SurrealResult;

  const knRow = getLastDefinedResult<{ id?: unknown; tags?: string[] }>(
    knResult,
  );

  if (recTable === "knowledge_note" && knRow?.id) {
    const existingTags: string[] = knRow.tags ?? [];
    const newTags = [
      ...new Set([...existingTags, severity, "team-decision", reason]),
    ];

    await db.query(
      `
        LET $rec = type::record('knowledge_note', $recKey);
        UPDATE $rec SET
          tags = $tags,
          confidence = 0.95,
          updated_at = time::now()
      `,
      { recKey, tags: newTags },
    );

    return JSON.stringify({
      flagged: true,
      type: "knowledge_note",
      id: recordId,
      severity,
      reason,
    });
  }

  // Update as business_fact
  await db.query(
    `
      LET $rec = type::record('business_fact', $recKey);
      UPDATE $rec SET
        status = 'promoted',
        confidence = 0.95,
        updated_at = time::now()
    `,
    { recKey },
  );

  return JSON.stringify({
    flagged: true,
    type: "business_fact",
    id: recordId,
    severity,
    reason,
  });
}

// ---------------------------------------------------------------------------
// compact_stale_knowledge
// Smart forgetting: archive stale facts, merge overlapping ones, delete
// superseded knowledge_note versions. Keeps the knowledge graph clean.
// Pass dryRun=true to preview what would be cleaned up.
// ---------------------------------------------------------------------------

type CompactionResult = {
  module: string;
  dry_run: boolean;
  archived_facts: number;
  merged_groups: number;
  deleted_old_versions: number;
  details: {
    archived_fact_ids: string[];
    merged_into_ids: string[];
    deleted_note_ids: string[];
  };
};

export async function compactStaleKnowledge(
  module: string,
  staleDays = 30,
  dryRun = true,
): Promise<string> {
  const db = await getDb();
  const days = Math.max(1, Math.min(staleDays, 365));
  const moduleKey = sanitizeModuleName(module);

  // 1. Find stale business_fact records (promoted or draft, not updated recently)
  const factResult = (await db.query(
    `
      LET $mod = (SELECT id FROM module WHERE name = $name LIMIT 1)[0];
      LET $cutoff = time::now() - duration::from_days($days);

      SELECT id, summary, rationale, confidence, status, updated_at
      FROM business_fact
      WHERE module = $mod.id
        AND status INSIDE ['promoted', 'draft']
        AND updated_at < $cutoff
      ORDER BY summary ASC
    `,
    { name: moduleKey, days },
  )) as unknown[][];

  type FactRow = {
    id: string;
    summary: string;
    rationale?: string;
    confidence: number;
    updated_at: string;
  };
  const staleFacts = (factResult.at(-1) ?? []) as FactRow[];

  // 2. Group stale facts by first 60 chars of summary (overlap detection)
  const groups = new Map<string, FactRow[]>();
  for (const fact of staleFacts) {
    const key = (fact.summary ?? "").slice(0, 60).toLowerCase().trim();
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(fact);
    groups.set(key, group);
  }

  const archivedFactIds: string[] = [];
  const mergedIntoIds: string[] = [];

  // 3. For groups with 2+ overlapping facts, merge into one
  for (const [, group] of groups) {
    if (group.length < 2) {
      // Single stale fact — just archive it
      archivedFactIds.push(String(group[0].id));
      continue;
    }

    // Pick the highest-confidence fact as the survivor
    group.sort((a, b) => b.confidence - a.confidence);
    const survivor = group[0];
    const others = group.slice(1);

    // Average confidence across the group
    const avgConfidence =
      group.reduce((sum, f) => sum + f.confidence, 0) / group.length;

    // Merge rationales
    const mergedRationale = group
      .map((f) => f.rationale)
      .filter(Boolean)
      .join(" | ");

    if (!dryRun) {
      // Update survivor with merged data
      await db.query(
        `UPDATE type::record($id) SET
          rationale = $rationale,
          confidence = $confidence,
          updated_at = time::now()`,
        {
          id: String(survivor.id),
          rationale: mergedRationale.slice(0, 1000),
          confidence: Math.round(avgConfidence * 100) / 100,
        },
      );

      // Archive the others and set t_end
      for (const other of others) {
        await db.query(
          `UPDATE type::record($id) SET
            status = 'archived',
            t_end = time::now(),
            updated_at = time::now()`,
          { id: String(other.id) },
        );
      }
    }

    mergedIntoIds.push(String(survivor.id));
    for (const other of others) {
      archivedFactIds.push(String(other.id));
    }
  }

  // 4. Find old knowledge_note versions (is_latest = false) for this module
  const noteResult = (await db.query(
    `
      LET $mod = (SELECT id FROM module WHERE name = $name LIMIT 1)[0];

      SELECT id FROM knowledge_note
      WHERE module = $mod.id
        AND is_latest = false
    `,
    { name: moduleKey },
  )) as unknown[][];

  type NoteRow = { id: string };
  const oldNotes = (noteResult.at(-1) ?? []) as NoteRow[];
  const deletedNoteIds = oldNotes.map((n) => String(n.id));

  if (!dryRun && deletedNoteIds.length > 0) {
    for (const noteId of deletedNoteIds) {
      await db.query(`DELETE type::record($id)`, { id: noteId });
    }
  }

  const result: CompactionResult = {
    module: moduleKey,
    dry_run: dryRun,
    archived_facts: archivedFactIds.length,
    merged_groups: mergedIntoIds.length,
    deleted_old_versions: deletedNoteIds.length,
    details: {
      archived_fact_ids: archivedFactIds,
      merged_into_ids: mergedIntoIds,
      deleted_note_ids: deletedNoteIds,
    },
  };

  return JSON.stringify(result, null, 2);
}
