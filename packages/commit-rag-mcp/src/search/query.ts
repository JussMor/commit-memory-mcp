import type { Database } from "better-sqlite3";
import type { SearchResult } from "../types.js";
import { embedText } from "./embeddings.js";

type VecRow = {
  distance: number;
  chunk_id: string;
  sha: string;
  file_path: string;
  subject: string;
  date: string;
  author: string;
  hunk_text: string;
};

type KeywordRow = Omit<VecRow, "distance">;

function scoreWithBoost(
  base: number,
  row: { file_path: string; hunk_text: string },
  activeFile?: string,
): number {
  let score = base;
  if (activeFile && row.file_path === activeFile) {
    score += 0.2;
  }

  if (activeFile) {
    const parent = activeFile.split("/").slice(0, -1).join("/");
    if (parent && row.file_path.startsWith(parent)) {
      score += 0.05;
    }
  }

  return score;
}

function createPreview(hunkText: string): string {
  return hunkText.split("\n").slice(0, 6).join("\n");
}

export async function searchRelatedCommits(
  db: Database,
  query: string,
  limit: number,
  activeFile?: string,
): Promise<SearchResult[]> {
  const embedding = await embedText(query);
  const embeddingJson = JSON.stringify(embedding);

  try {
    const rows = db
      .prepare(
        `
        SELECT
          v.distance AS distance,
          c.chunk_id AS chunk_id,
          c.sha AS sha,
          c.file_path AS file_path,
          cm.subject AS subject,
          cm.date AS date,
          cm.author AS author,
          c.hunk_text AS hunk_text
        FROM chunk_vectors v
        JOIN chunk_vector_map m ON m.vec_rowid = v.rowid
        JOIN commit_chunks c ON c.chunk_id = m.chunk_id
        JOIN commits cm ON cm.sha = c.sha
        WHERE v.embedding MATCH ? AND k = ?
      `,
      )
      .all(embeddingJson, limit) as VecRow[];

    return rows.map((row) => {
      const base = 1 / (1 + Math.max(0, row.distance));
      const score = scoreWithBoost(base, row, activeFile);
      return {
        chunkId: row.chunk_id,
        sha: row.sha,
        filePath: row.file_path,
        subject: row.subject,
        score,
        date: row.date,
        author: row.author,
        preview: createPreview(row.hunk_text),
      };
    });
  } catch {
    const rows = db
      .prepare(
        `
        SELECT
          c.chunk_id AS chunk_id,
          c.sha AS sha,
          c.file_path AS file_path,
          cm.subject AS subject,
          cm.date AS date,
          cm.author AS author,
          c.hunk_text AS hunk_text
        FROM commit_chunks c
        JOIN commits cm ON cm.sha = c.sha
        WHERE c.indexed_text LIKE ?
        ORDER BY cm.date DESC
        LIMIT ?
      `,
      )
      .all(`%${query}%`, limit) as KeywordRow[];

    return rows.map((row, idx) => ({
      chunkId: row.chunk_id,
      sha: row.sha,
      filePath: row.file_path,
      subject: row.subject,
      score: scoreWithBoost(
        Math.max(0.01, 1 - idx / (limit + 1)),
        row,
        activeFile,
      ),
      date: row.date,
      author: row.author,
      preview: createPreview(row.hunk_text),
    }));
  }
}

export function explainCommitMatch(
  db: Database,
  chunkId: string,
): SearchResult | null {
  const row = db
    .prepare(
      `
      SELECT
        c.chunk_id AS chunk_id,
        c.sha AS sha,
        c.file_path AS file_path,
        cm.subject AS subject,
        cm.date AS date,
        cm.author AS author,
        c.hunk_text AS hunk_text
      FROM commit_chunks c
      JOIN commits cm ON cm.sha = c.sha
      WHERE c.chunk_id = ?
      LIMIT 1
    `,
    )
    .get(chunkId) as KeywordRow | undefined;

  if (!row) {
    return null;
  }

  return {
    chunkId: row.chunk_id,
    sha: row.sha,
    filePath: row.file_path,
    subject: row.subject,
    score: 1,
    date: row.date,
    author: row.author,
    preview: createPreview(row.hunk_text),
  };
}
