export { openDatabase } from "./db/client.js";
export { indexRepository } from "./indexer.js";
export { explainCommitMatch, searchRelatedCommits } from "./search/query.js";
export type { CommitChunk, IndexSummary, SearchResult } from "./types.js";
