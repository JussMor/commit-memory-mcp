import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { load } from "sqlite-vec";
import type {
  CommitChunk,
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
