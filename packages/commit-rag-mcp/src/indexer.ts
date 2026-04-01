import path from "node:path";
import { closeDb, getDb } from "./db/client.js";
import { runMigrations } from "./db/schema.js";
import { extractCommitChunks } from "./git/extract.js";
import { embedText } from "./search/embeddings.js";
import type { IndexSummary } from "./types.js";

export async function indexRepository(options: {
  repoPath: string;
  limit: number;
}): Promise<IndexSummary> {
  const repoPath = path.resolve(options.repoPath);

  await runMigrations();
  const db = await getDb();

  const chunks = extractCommitChunks(repoPath, options.limit);

  let indexedChunks = 0;
  let skippedChunks = 0;
  const indexedCommits = new Set<string>();

  for (const chunk of chunks) {
    const existing = await db.query<[[{ chunk_id: string }]]>(
      "SELECT chunk_id FROM commit_chunk WHERE chunk_id = $chunk_id LIMIT 1",
      { chunk_id: chunk.chunkId },
    );

    if (existing[0]?.[0]) {
      skippedChunks += 1;
      continue;
    }

    const embedding = await embedText(chunk.indexedText);

    await db.query(
      `CREATE commit_chunk CONTENT {
        chunk_id: $chunk_id,
        sha: $sha,
        author: $author,
        date: $date,
        subject: $subject,
        body: $body,
        file_path: $file_path,
        hunk_text: $hunk_text,
        indexed_text: $indexed_text,
        embedding: $embedding
      }`,
      {
        chunk_id: chunk.chunkId,
        sha: chunk.sha,
        author: chunk.author,
        date: new Date(chunk.date),
        subject: chunk.subject,
        body: chunk.body,
        file_path: chunk.filePath,
        hunk_text: chunk.hunkText,
        indexed_text: chunk.indexedText,
        embedding,
      },
    );

    indexedChunks += 1;
    indexedCommits.add(chunk.sha);
  }

  await closeDb();

  return {
    indexedCommits: indexedCommits.size,
    indexedChunks,
    skippedChunks,
  };
}
