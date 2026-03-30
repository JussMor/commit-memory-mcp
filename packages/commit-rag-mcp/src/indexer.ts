import path from "node:path";
import {
  hasChunk,
  openDatabase,
  touchIndexState,
  upsertChunk,
} from "./db/client.js";
import { extractCommitChunks } from "./git/extract.js";
import { embedText } from "./search/embeddings.js";
import type { IndexSummary } from "./types.js";

export async function indexRepository(options: {
  repoPath: string;
  dbPath: string;
  limit: number;
}): Promise<IndexSummary> {
  const repoPath = path.resolve(options.repoPath);
  const dbPath = path.resolve(options.dbPath);

  const chunks = extractCommitChunks(repoPath, options.limit);
  const db = openDatabase(dbPath);

  let indexedChunks = 0;
  let skippedChunks = 0;
  const indexedCommits = new Set<string>();

  const pendingInserts: Array<{
    chunk: (typeof chunks)[number];
    embedding: number[];
  }> = [];

  for (const chunk of chunks) {
    if (hasChunk(db, chunk.chunkId)) {
      skippedChunks += 1;
      continue;
    }

    const embedding = await embedText(chunk.indexedText);
    pendingInserts.push({ chunk, embedding });
    indexedChunks += 1;
    indexedCommits.add(chunk.sha);
  }

  const writeTransaction = db.transaction((rows: typeof pendingInserts) => {
    for (const row of rows) {
      upsertChunk(db, row.chunk, row.embedding);
    }
  });

  writeTransaction(pendingInserts);

  touchIndexState(db);
  db.close();

  return {
    indexedCommits: indexedCommits.size,
    indexedChunks,
    skippedChunks,
  };
}
