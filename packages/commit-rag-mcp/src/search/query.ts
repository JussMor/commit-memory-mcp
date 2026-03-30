import type { Database } from "better-sqlite3";
import type { SearchResult } from "../types.js";
import { embedText } from "./embeddings.js";
import { copilotRerankEnabled, rerankWithCopilot } from "./rerank.js";

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
  // Fetch extra candidates when Copilot reranking is enabled so the LLM has
  // more to work with before we trim to the requested limit.
  const fetchLimit = copilotRerankEnabled() ? limit * 2 : limit;

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
      .all(embeddingJson, fetchLimit) as VecRow[];

    const candidates = rows.map((row) => {
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
    const reranked = await rerankWithCopilot(query, candidates);
    return reranked.slice(0, limit);
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
      .all(`%${query}%`, fetchLimit) as KeywordRow[];

    const keywordCandidates = rows.map((row, idx) => ({
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
    const rerankedKeyword = await rerankWithCopilot(query, keywordCandidates);
    return rerankedKeyword.slice(0, limit);
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
