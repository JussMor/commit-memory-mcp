import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { load } from "sqlite-vec";
import type { CommitChunk } from "../types.js";

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
