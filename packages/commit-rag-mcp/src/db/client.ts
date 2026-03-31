import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { load } from "sqlite-vec";
import type {
  CommitChunk,
  ContextFactRecord,
  ContextPackRecord,
  PullRequestCommentRecord,
  PullRequestDecisionRecord,
  PullRequestRecord,
  PullRequestReviewRecord,
  WorktreeSessionRecord,
} from "../types.js";

export type RagDatabase = Database.Database;

export function openDatabase(dbPath: string): RagDatabase {
  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  const db = new Database(resolved);
  load(db);

  // Enable WAL mode and ensure data is persisted to disk
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS commits (
      sha TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      date TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commit_chunks (
      chunk_id TEXT PRIMARY KEY,
      sha TEXT NOT NULL,
      file_path TEXT NOT NULL,
      hunk_text TEXT NOT NULL,
      indexed_text TEXT NOT NULL,
      FOREIGN KEY (sha) REFERENCES commits(sha)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(
      embedding FLOAT[384]
    );

    CREATE TABLE IF NOT EXISTS chunk_vector_map (
      chunk_id TEXT PRIMARY KEY,
      vec_rowid INTEGER NOT NULL UNIQUE,
      FOREIGN KEY (chunk_id) REFERENCES commit_chunks(chunk_id)
    );

    CREATE TABLE IF NOT EXISTS index_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_indexed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prs (
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      author TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      merged_at TEXT,
      url TEXT NOT NULL,
      PRIMARY KEY (repo_owner, repo_name, pr_number)
    );

    CREATE TABLE IF NOT EXISTS pr_comments (
      id TEXT PRIMARY KEY,
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      url TEXT NOT NULL,
      FOREIGN KEY (repo_owner, repo_name, pr_number)
        REFERENCES prs(repo_owner, repo_name, pr_number)
    );

    CREATE TABLE IF NOT EXISTS pr_reviews (
      id TEXT PRIMARY KEY,
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      author TEXT NOT NULL,
      state TEXT NOT NULL,
      body TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      FOREIGN KEY (repo_owner, repo_name, pr_number)
        REFERENCES prs(repo_owner, repo_name, pr_number)
    );

    CREATE TABLE IF NOT EXISTS pr_decisions (
      id TEXT PRIMARY KEY,
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      source TEXT NOT NULL,
      author TEXT NOT NULL,
      summary TEXT NOT NULL,
      severity TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (repo_owner, repo_name, pr_number)
        REFERENCES prs(repo_owner, repo_name, pr_number)
    );

    CREATE TABLE IF NOT EXISTS pr_sync_state (
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      last_synced_at TEXT NOT NULL,
      PRIMARY KEY (repo_owner, repo_name)
    );

    CREATE TABLE IF NOT EXISTS worktree_sessions (
      path TEXT PRIMARY KEY,
      branch TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      last_synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS context_facts (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      scope_domain TEXT NOT NULL,
      scope_feature TEXT NOT NULL,
      scope_branch TEXT NOT NULL,
      scope_task_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      priority REAL NOT NULL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_context_scope
      ON context_facts(scope_domain, scope_feature, scope_branch, scope_task_type, status, updated_at);

    CREATE TABLE IF NOT EXISTS context_fact_archive (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      scope_domain TEXT NOT NULL,
      scope_feature TEXT NOT NULL,
      scope_branch TEXT NOT NULL,
      scope_task_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      priority REAL NOT NULL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT NOT NULL
    );
  `);

  return db;
}

export function hasChunk(db: RagDatabase, chunkId: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM commit_chunks WHERE chunk_id = ? LIMIT 1")
    .get(chunkId) as { ok: number } | undefined;
  return Boolean(row?.ok);
}

export function upsertChunk(
  db: RagDatabase,
  chunk: CommitChunk,
  embedding: number[],
): void {
  db.prepare(
    `
      INSERT INTO commits (sha, author, date, subject, body)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(sha) DO UPDATE SET
        author = excluded.author,
        date = excluded.date,
        subject = excluded.subject,
        body = excluded.body
    `,
  ).run(chunk.sha, chunk.author, chunk.date, chunk.subject, chunk.body);

  db.prepare(
    `
      INSERT INTO commit_chunks (chunk_id, sha, file_path, hunk_text, indexed_text)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        sha = excluded.sha,
        file_path = excluded.file_path,
        hunk_text = excluded.hunk_text,
        indexed_text = excluded.indexed_text
    `,
  ).run(
    chunk.chunkId,
    chunk.sha,
    chunk.filePath,
    chunk.hunkText,
    chunk.indexedText,
  );

  const existing = db
    .prepare("SELECT vec_rowid FROM chunk_vector_map WHERE chunk_id = ?")
    .get(chunk.chunkId) as { vec_rowid: number } | undefined;
  const embeddingJson = JSON.stringify(embedding);

  if (existing) {
    db.prepare("UPDATE chunk_vectors SET embedding = ? WHERE rowid = ?").run(
      embeddingJson,
      existing.vec_rowid,
    );
    return;
  }

  const result = db
    .prepare("INSERT INTO chunk_vectors (embedding) VALUES (?)")
    .run(embeddingJson);
  const rowid = Number(result.lastInsertRowid);

  db.prepare(
    "INSERT INTO chunk_vector_map (chunk_id, vec_rowid) VALUES (?, ?)",
  ).run(chunk.chunkId, rowid);
}

export function touchIndexState(db: RagDatabase): void {
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO index_state (id, last_indexed_at)
      VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_indexed_at = excluded.last_indexed_at
    `,
  ).run(now);
}

export function upsertPullRequest(
  db: RagDatabase,
  pr: PullRequestRecord,
): void {
  db.prepare(
    `
      INSERT INTO prs (
        repo_owner,
        repo_name,
        pr_number,
        title,
        body,
        author,
        state,
        created_at,
        updated_at,
        merged_at,
        url
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(repo_owner, repo_name, pr_number) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        author = excluded.author,
        state = excluded.state,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        merged_at = excluded.merged_at,
        url = excluded.url
    `,
  ).run(
    pr.repoOwner,
    pr.repoName,
    pr.number,
    pr.title,
    pr.body,
    pr.author,
    pr.state,
    pr.createdAt,
    pr.updatedAt,
    pr.mergedAt,
    pr.url,
  );
}

export function replacePullRequestComments(
  db: RagDatabase,
  repoOwner: string,
  repoName: string,
  prNumber: number,
  comments: PullRequestCommentRecord[],
): void {
  db.prepare(
    `
      DELETE FROM pr_comments
      WHERE repo_owner = ? AND repo_name = ? AND pr_number = ?
    `,
  ).run(repoOwner, repoName, prNumber);

  const insert = db.prepare(
    `
      INSERT INTO pr_comments (
        id,
        repo_owner,
        repo_name,
        pr_number,
        author,
        body,
        created_at,
        updated_at,
        url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );

  for (const comment of comments) {
    insert.run(
      comment.id,
      repoOwner,
      repoName,
      prNumber,
      comment.author,
      comment.body,
      comment.createdAt,
      comment.updatedAt,
      comment.url,
    );
  }
}

export function replacePullRequestReviews(
  db: RagDatabase,
  repoOwner: string,
  repoName: string,
  prNumber: number,
  reviews: PullRequestReviewRecord[],
): void {
  db.prepare(
    `
      DELETE FROM pr_reviews
      WHERE repo_owner = ? AND repo_name = ? AND pr_number = ?
    `,
  ).run(repoOwner, repoName, prNumber);

  const insert = db.prepare(
    `
      INSERT INTO pr_reviews (
        id,
        repo_owner,
        repo_name,
        pr_number,
        author,
        state,
        body,
        submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );

  for (const review of reviews) {
    insert.run(
      review.id,
      repoOwner,
      repoName,
      prNumber,
      review.author,
      review.state,
      review.body,
      review.submittedAt,
    );
  }
}

export function replacePullRequestDecisions(
  db: RagDatabase,
  repoOwner: string,
  repoName: string,
  prNumber: number,
  decisions: PullRequestDecisionRecord[],
): void {
  db.prepare(
    `
      DELETE FROM pr_decisions
      WHERE repo_owner = ? AND repo_name = ? AND pr_number = ?
    `,
  ).run(repoOwner, repoName, prNumber);

  const insert = db.prepare(
    `
      INSERT INTO pr_decisions (
        id,
        repo_owner,
        repo_name,
        pr_number,
        source,
        author,
        summary,
        severity,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );

  for (const decision of decisions) {
    insert.run(
      decision.id,
      repoOwner,
      repoName,
      prNumber,
      decision.source,
      decision.author,
      decision.summary,
      decision.severity,
      decision.createdAt,
    );
  }
}

export function touchPullRequestSyncState(
  db: RagDatabase,
  repoOwner: string,
  repoName: string,
): void {
  db.prepare(
    `
      INSERT INTO pr_sync_state (repo_owner, repo_name, last_synced_at)
      VALUES (?, ?, ?)
      ON CONFLICT(repo_owner, repo_name) DO UPDATE SET
        last_synced_at = excluded.last_synced_at
    `,
  ).run(repoOwner, repoName, new Date().toISOString());
}

export function upsertWorktreeSession(
  db: RagDatabase,
  session: WorktreeSessionRecord,
): void {
  db.prepare(
    `
      INSERT INTO worktree_sessions (path, branch, base_branch, last_synced_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        branch = excluded.branch,
        base_branch = excluded.base_branch,
        last_synced_at = excluded.last_synced_at
    `,
  ).run(session.path, session.branch, session.baseBranch, session.lastSyncedAt);
}

export function upsertContextFact(
  db: RagDatabase,
  fact: ContextFactRecord,
): void {
  db.prepare(
    `
      INSERT INTO context_facts (
        id,
        source_type,
        source_ref,
        scope_domain,
        scope_feature,
        scope_branch,
        scope_task_type,
        title,
        content,
        priority,
        confidence,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_type = excluded.source_type,
        source_ref = excluded.source_ref,
        scope_domain = excluded.scope_domain,
        scope_feature = excluded.scope_feature,
        scope_branch = excluded.scope_branch,
        scope_task_type = excluded.scope_task_type,
        title = excluded.title,
        content = excluded.content,
        priority = excluded.priority,
        confidence = excluded.confidence,
        status = excluded.status,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
  ).run(
    fact.id,
    fact.sourceType,
    fact.sourceRef,
    fact.domain,
    fact.feature,
    fact.branch,
    fact.taskType,
    fact.title,
    fact.content,
    fact.priority,
    fact.confidence,
    fact.status,
    fact.createdAt,
    fact.updatedAt,
  );
}

export function promoteContextFacts(
  db: RagDatabase,
  options: {
    domain?: string;
    feature?: string;
    branch?: string;
    sourceType?: string;
  },
): number {
  const clauses: string[] = ["status = 'draft'"];
  const params: Array<string> = [];

  if (options.domain) {
    clauses.push("scope_domain = ?");
    params.push(options.domain);
  }
  if (options.feature) {
    clauses.push("scope_feature = ?");
    params.push(options.feature);
  }
  if (options.branch) {
    clauses.push("scope_branch = ?");
    params.push(options.branch);
  }
  if (options.sourceType) {
    clauses.push("source_type = ?");
    params.push(options.sourceType);
  }

  const sql = `
    UPDATE context_facts
    SET status = 'promoted', updated_at = ?
    WHERE ${clauses.join(" AND ")}
  `;
  const now = new Date().toISOString();
  const result = db.prepare(sql).run(now, ...params);
  return Number(result.changes ?? 0);
}

function summarizePRMetadata(fact: ContextPackRecord): string {
  // Extract key info from PR metadata to keep it concise
  if (fact.sourceType.startsWith("pr_")) {
    const lines = fact.content.split("\n").slice(0, 2).join(" ");
    return `[${fact.sourceRef}] ${fact.title} — ${lines.substring(0, 100)}`;
  }
  return fact.content;
}

export function buildContextPack(
  db: RagDatabase,
  options: {
    domain?: string;
    feature?: string;
    branch?: string;
    taskType?: string;
    includeDraft?: boolean;
    limit: number;
    forceRefresh?: boolean;
    summarizePR?: boolean;
  },
): {
  learnedFeature: ContextPackRecord[];
  branchContext: ContextPackRecord[];
  prMetadata: ContextPackRecord[];
  allContext: ContextPackRecord[];
} {
  const taskType = options.taskType ?? "general";
  const GLOBAL_BRANCH = "main";

  function runQuery(params: {
    includeDomain: boolean;
    includeFeature: boolean;
    includeBranch: boolean;
    forcedBranch?: string;
  }): ContextPackRecord[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [taskType];

    if (params.includeDomain && options.domain) {
      clauses.push("scope_domain = ?");
      values.push(options.domain);
    }
    if (params.includeFeature && options.feature) {
      clauses.push("scope_feature = ?");
      values.push(options.feature);
    }
    if (params.forcedBranch) {
      clauses.push("scope_branch = ?");
      values.push(params.forcedBranch);
    } else if (params.includeBranch && options.branch) {
      clauses.push("scope_branch = ?");
      values.push(options.branch);
    }

    if (options.includeDraft) {
      clauses.push("status IN ('promoted', 'draft')");
    } else {
      clauses.push("status = 'promoted'");
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const sql = `
    SELECT
      id,
      source_type,
      source_ref,
      title,
      content,
      scope_domain,
      scope_feature,
      scope_branch,
      scope_task_type,
      priority,
      confidence,
      status,
      updated_at,
      ((priority * 0.40) + (confidence * 0.30) +
        CASE
          WHEN scope_task_type = ? THEN 0.30
          WHEN scope_task_type = 'general' THEN 0.15
          ELSE 0.0
        END +
        CASE
          WHEN source_type = 'pr_description' THEN 0.15
          WHEN source_type LIKE 'pr_%' THEN 0.08
          ELSE 0.0
        END) AS score
    FROM context_facts
    ${where}
    ORDER BY score DESC, updated_at DESC
    LIMIT ?
  `;

    values.push(options.limit);
    const rows = db.prepare(sql).all(...values) as Array<
      Record<string, unknown>
    >;

    return rows.map((row) => ({
      id: String(row.id ?? ""),
      sourceType: String(row.source_type ?? ""),
      sourceRef: String(row.source_ref ?? ""),
      title: String(row.title ?? ""),
      content: String(row.content ?? ""),
      domain: String(row.scope_domain ?? ""),
      feature: String(row.scope_feature ?? ""),
      branch: String(row.scope_branch ?? ""),
      taskType: String(row.scope_task_type ?? ""),
      priority: Number(row.priority ?? 0),
      confidence: Number(row.confidence ?? 0),
      score: Number(row.score ?? 0),
      status: String(row.status ?? "promoted") as ContextPackRecord["status"],
      updatedAt: String(row.updated_at ?? ""),
    }));
  }

  const seenIds = new Set<string>();
  const pack: ContextPackRecord[] = [];
  const addRows = (rows: ContextPackRecord[]) => {
    for (const row of rows) {
      if (pack.length >= options.limit) {
        return;
      }
      if (seenIds.has(row.id)) {
        continue;
      }
      seenIds.add(row.id);
      pack.push(row);
    }
  };

  // PRIORITY 0) Learned feature knowledge is always included first when available.
  // This ensures feature knowledge isn't lost behind PR metadata.
  if (!options.feature && !options.branch) {
    // Auto-discover recently learned features (source_type='feature-agent')
    const learnedFacts = (
      db.prepare(`
        SELECT
          id,
          source_type,
          source_ref,
          title,
          content,
          scope_domain,
          scope_feature,
          scope_branch,
          scope_task_type,
          priority,
          confidence,
          status,
          updated_at,
          ((priority * 0.40) + (confidence * 0.30) + 0.25) AS score
        FROM context_facts
        WHERE source_type = 'feature-agent' AND status = 'promoted'
        ORDER BY updated_at DESC, priority DESC
        LIMIT ?
      `) as any
    ).all(Math.max(3, Math.floor(options.limit * 0.2))) as Array<
      Record<string, unknown>
    >;

    const learnedRows = learnedFacts.map((row) => ({
      id: String(row.id ?? ""),
      sourceType: String(row.source_type ?? ""),
      sourceRef: String(row.source_ref ?? ""),
      title: String(row.title ?? ""),
      content: String(row.content ?? ""),
      domain: String(row.scope_domain ?? ""),
      feature: String(row.scope_feature ?? ""),
      branch: String(row.scope_branch ?? ""),
      taskType: String(row.scope_task_type ?? ""),
      priority: Number(row.priority ?? 0),
      confidence: Number(row.confidence ?? 0),
      score: Number(row.score ?? 0),
      status: String(row.status ?? "promoted") as ContextPackRecord["status"],
      updatedAt: String(row.updated_at ?? ""),
    }));
    addRows(learnedRows);
  }

  // 1) Main branch domain context is the durable source-of-truth baseline.
  if (pack.length < options.limit) {
    addRows(
      runQuery({
        includeDomain: true,
        includeFeature: false,
        includeBranch: false,
        forcedBranch: GLOBAL_BRANCH,
      }),
    );
  }

  // 2) Main branch global context fills any remaining baseline slots.
  if (pack.length < options.limit) {
    addRows(
      runQuery({
        includeDomain: false,
        includeFeature: false,
        includeBranch: false,
        forcedBranch: GLOBAL_BRANCH,
      }),
    );
  }

  // 3) Branch-local feature context overlays main for active, in-flight work.
  addRows(
    runQuery({
      includeDomain: true,
      includeFeature: true,
      includeBranch: true,
    }),
  );

  // 4) Domain-wide branch context provides additional short-lived signal.
  if (pack.length < options.limit) {
    addRows(
      runQuery({
        includeDomain: true,
        includeFeature: false,
        includeBranch: false,
      }),
    );
  }

  // 5) Final safety net from all promoted context.
  if (pack.length < options.limit) {
    addRows(
      runQuery({
        includeDomain: false,
        includeFeature: false,
        includeBranch: false,
      }),
    );
  }

  // Categorize results and apply summarization if requested
  const learnedFeature: ContextPackRecord[] = [];
  const branchContext: ContextPackRecord[] = [];
  const prMetadata: ContextPackRecord[] = [];

  for (const item of pack) {
    if (item.sourceType === "feature-agent") {
      learnedFeature.push(item);
    } else if (item.sourceType.startsWith("pr_")) {
      if (options.summarizePR) {
        prMetadata.push({
          ...item,
          content: summarizePRMetadata(item),
        });
      } else {
        prMetadata.push(item);
      }
    } else if (item.branch && item.branch !== "main") {
      branchContext.push(item);
    } else {
      // Fallback for other context types
      if (options.summarizePR && item.sourceType.startsWith("pr_")) {
        branchContext.push({
          ...item,
          content: summarizePRMetadata(item),
        });
      } else {
        branchContext.push(item);
      }
    }
  }

  return {
    learnedFeature,
    branchContext,
    prMetadata,
    allContext: pack,
  };
}

export function archiveFeatureContext(
  db: RagDatabase,
  options: { domain: string; feature: string },
): number {
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `
        INSERT OR REPLACE INTO context_fact_archive (
          id,
          source_type,
          source_ref,
          scope_domain,
          scope_feature,
          scope_branch,
          scope_task_type,
          title,
          content,
          priority,
          confidence,
          status,
          created_at,
          updated_at,
          archived_at
        )
        SELECT
          id,
          source_type,
          source_ref,
          scope_domain,
          scope_feature,
          scope_branch,
          scope_task_type,
          title,
          content,
          priority,
          confidence,
          'archived',
          created_at,
          updated_at,
          ?
        FROM context_facts
        WHERE scope_domain = ? AND scope_feature = ?
      `,
    ).run(now, options.domain, options.feature);

    return db
      .prepare(
        `
          DELETE FROM context_facts
          WHERE scope_domain = ? AND scope_feature = ?
        `,
      )
      .run(options.domain, options.feature);
  });

  const result = tx();
  return Number(result.changes ?? 0);
}
