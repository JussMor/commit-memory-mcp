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

export type PullRequestRecord = {
  repoOwner: string;
  repoName: string;
  number: number;
  title: string;
  body: string;
  author: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  url: string;
};

export type PullRequestCommentRecord = {
  id: string;
  prNumber: number;
  author: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
};

export type PullRequestReviewRecord = {
  id: string;
  prNumber: number;
  author: string;
  state: string;
  body: string;
  submittedAt: string;
};

export type PullRequestDecisionRecord = {
  id: string;
  prNumber: number;
  source: "description" | "comment" | "review";
  author: string;
  summary: string;
  severity: "info" | "warning" | "blocker";
  createdAt: string;
};

export type PullRequestSyncSummary = {
  syncedPrs: number;
  syncedComments: number;
  syncedReviews: number;
  promotedDecisions: number;
  repoOwner: string;
  repoName: string;
  syncedAt: string;
};

export type WorktreeRecord = {
  path: string;
  branch: string;
  headSha: string;
  isCurrent: boolean;
};

export type WorktreeSessionRecord = {
  path: string;
  branch: string;
  lastSyncedAt: string;
  baseBranch: string;
};

export type ContextFactStatus = "draft" | "promoted" | "archived";

export type ContextFactRecord = {
  id: string;
  sourceType: string;
  sourceRef: string;
  domain: string;
  feature: string;
  branch: string;
  taskType: string;
  title: string;
  content: string;
  priority: number;
  confidence: number;
  status: ContextFactStatus;
  createdAt: string;
  updatedAt: string;
};

export type ContextPackRecord = {
  id: string;
  sourceType: string;
  sourceRef: string;
  title: string;
  content: string;
  domain: string;
  feature: string;
  branch: string;
  taskType: string;
  priority: number;
  confidence: number;
  score: number;
  status: ContextFactStatus;
  updatedAt: string;
};
