export type CommitChunk = {
  chunkId: string;
  sha: string;
  author: string;
  date: string;
  subject: string;
  body: string;
  filePath: string;
  hunkText: string;
  indexedText: string;
};

export type SearchResult = {
  chunkId: string;
  sha: string;
  filePath: string;
  subject: string;
  score: number;
  date: string;
  author: string;
  preview: string;
};

export type IndexSummary = {
  indexedCommits: number;
  indexedChunks: number;
  skippedChunks: number;
};
