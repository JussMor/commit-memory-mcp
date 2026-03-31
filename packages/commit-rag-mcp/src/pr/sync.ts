import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  openDatabase,
  replacePullRequestComments,
  replacePullRequestDecisions,
  replacePullRequestReviews,
  touchPullRequestSyncState,
  upsertContextFact,
  upsertPullRequest,
} from "../db/client.js";
import type {
  PullRequestCommentRecord,
  PullRequestDecisionRecord,
  PullRequestRecord,
  PullRequestReviewRecord,
  PullRequestSyncSummary,
} from "../types.js";

type GitHubUser = { login?: string };

type GitHubComment = {
  id?: string | number;
  body?: string;
  author?: GitHubUser;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
};

type GitHubReview = {
  id?: string | number;
  body?: string;
  state?: string;
  author?: GitHubUser;
  submittedAt?: string;
};

type GitHubPullRequest = {
  number?: number;
  title?: string;
  body?: string;
  author?: GitHubUser;
  state?: string;
  createdAt?: string;
  updatedAt?: string;
  mergedAt?: string | null;
  url?: string;
  comments?: GitHubComment[];
  reviews?: GitHubReview[];
};

function runGh(repoPath: string, args: string[]): string {
  return execFileSync("gh", args, {
    cwd: repoPath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function summarize(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "No summary available.";
  }

  if (compact.length <= 280) {
    return compact;
  }

  return `${compact.slice(0, 277)}...`;
}

function classifySeverity(text: string): "info" | "warning" | "blocker" {
  if (
    /\b(block|blocking|must|required|cannot|can't|broken|fail)\b/i.test(text)
  ) {
    return "blocker";
  }

  if (/\b(should|consider|follow\s*up|todo|risk|later)\b/i.test(text)) {
    return "warning";
  }

  return "info";
}

function isDecisionSignal(text: string): boolean {
  return /\b(decision|decide|decided|agreed|resolved|approved|final|ship|merged?)\b/i.test(
    text,
  );
}

function parseComments(
  prNumber: number,
  comments: GitHubComment[] | undefined,
): PullRequestCommentRecord[] {
  if (!Array.isArray(comments)) {
    return [];
  }

  return comments.map((comment, index) => ({
    id: String(comment.id ?? `${prNumber}-comment-${index + 1}`),
    prNumber,
    author: comment.author?.login ?? "unknown",
    body: comment.body?.trim() ?? "",
    createdAt: comment.createdAt ?? new Date(0).toISOString(),
    updatedAt:
      comment.updatedAt ?? comment.createdAt ?? new Date(0).toISOString(),
    url: comment.url ?? "",
  }));
}

function parseReviews(
  prNumber: number,
  reviews: GitHubReview[] | undefined,
): PullRequestReviewRecord[] {
  if (!Array.isArray(reviews)) {
    return [];
  }

  return reviews.map((review, index) => ({
    id: String(review.id ?? `${prNumber}-review-${index + 1}`),
    prNumber,
    author: review.author?.login ?? "unknown",
    state: review.state ?? "COMMENTED",
    body: review.body?.trim() ?? "",
    submittedAt: review.submittedAt ?? new Date(0).toISOString(),
  }));
}

function createDecisionRecords(options: {
  pr: PullRequestRecord;
  comments: PullRequestCommentRecord[];
  reviews: PullRequestReviewRecord[];
}): PullRequestDecisionRecord[] {
  const decisions: PullRequestDecisionRecord[] = [];

  if (options.pr.body.trim()) {
    decisions.push({
      id: `pr-${options.pr.number}-description`,
      prNumber: options.pr.number,
      source: "description",
      author: options.pr.author,
      summary: summarize(options.pr.body),
      severity: classifySeverity(options.pr.body),
      createdAt: options.pr.updatedAt,
    });
  }

  for (const review of options.reviews) {
    if (!review.body && review.state === "COMMENTED") {
      continue;
    }

    if (
      review.state === "CHANGES_REQUESTED" ||
      review.state === "APPROVED" ||
      isDecisionSignal(review.body)
    ) {
      const text = [review.state, review.body].filter(Boolean).join(" - ");
      decisions.push({
        id: `pr-${options.pr.number}-review-${review.id}`,
        prNumber: options.pr.number,
        source: "review",
        author: review.author,
        summary: summarize(text),
        severity:
          review.state === "CHANGES_REQUESTED"
            ? "blocker"
            : classifySeverity(text),
        createdAt: review.submittedAt,
      });
    }
  }

  for (const comment of options.comments) {
    if (!comment.body || !isDecisionSignal(comment.body)) {
      continue;
    }

    decisions.push({
      id: `pr-${options.pr.number}-comment-${comment.id}`,
      prNumber: options.pr.number,
      source: "comment",
      author: comment.author,
      summary: summarize(comment.body),
      severity: classifySeverity(comment.body),
      createdAt: comment.updatedAt,
    });
  }

  return decisions;
}

function parsePullRequest(
  repoOwner: string,
  repoName: string,
  raw: GitHubPullRequest,
): {
  pr: PullRequestRecord;
  comments: PullRequestCommentRecord[];
  reviews: PullRequestReviewRecord[];
  decisions: PullRequestDecisionRecord[];
} {
  const number = Number(raw.number ?? 0);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error("Invalid pull request number returned by gh");
  }

  const pr: PullRequestRecord = {
    repoOwner,
    repoName,
    number,
    title: raw.title?.trim() ?? "",
    body: raw.body?.trim() ?? "",
    author: raw.author?.login ?? "unknown",
    state: raw.state ?? "UNKNOWN",
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? new Date(0).toISOString(),
    mergedAt: raw.mergedAt ?? null,
    url: raw.url ?? "",
  };

  const comments = parseComments(number, raw.comments);
  const reviews = parseReviews(number, raw.reviews);
  const decisions = createDecisionRecords({ pr, comments, reviews });

  return { pr, comments, reviews, decisions };
}

function listRecentPullRequestNumbers(
  repoPath: string,
  repoOwner: string,
  repoName: string,
  limit: number,
): number[] {
  const output = runGh(repoPath, [
    "pr",
    "list",
    "-R",
    `${repoOwner}/${repoName}`,
    "--state",
    "merged",
    "--limit",
    String(limit),
    "--json",
    "number",
  ]);

  const rows = JSON.parse(output) as Array<{ number?: number }>;
  return rows
    .map((row) => Number(row.number ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function fetchPullRequest(
  repoPath: string,
  repoOwner: string,
  repoName: string,
  prNumber: number,
): GitHubPullRequest {
  const output = runGh(repoPath, [
    "pr",
    "view",
    String(prNumber),
    "-R",
    `${repoOwner}/${repoName}`,
    "--json",
    "number,title,body,author,state,createdAt,updatedAt,mergedAt,url,comments,reviews",
  ]);
  return JSON.parse(output) as GitHubPullRequest;
}

export async function syncPullRequestContext(options: {
  repoPath: string;
  dbPath: string;
  repoOwner: string;
  repoName: string;
  prNumbers?: number[];
  limit?: number;
  domain?: string;
  feature?: string;
  branch?: string;
  taskType?: string;
}): Promise<PullRequestSyncSummary> {
  const repoPath = path.resolve(options.repoPath);
  const dbPath = path.resolve(options.dbPath);
  const limit = Number.isFinite(options.limit) ? Number(options.limit) : 20;

  const prNumbers =
    options.prNumbers && options.prNumbers.length > 0
      ? options.prNumbers
      : listRecentPullRequestNumbers(
          repoPath,
          options.repoOwner,
          options.repoName,
          limit,
        );

  const db = openDatabase(dbPath);

  let syncedPrs = 0;
  let syncedComments = 0;
  let syncedReviews = 0;
  let promotedDecisions = 0;

  const tx = db.transaction(() => {
    for (const prNumber of prNumbers) {
      const raw = fetchPullRequest(
        repoPath,
        options.repoOwner,
        options.repoName,
        prNumber,
      );
      const parsed = parsePullRequest(options.repoOwner, options.repoName, raw);

      upsertPullRequest(db, parsed.pr);
      replacePullRequestComments(
        db,
        options.repoOwner,
        options.repoName,
        parsed.pr.number,
        parsed.comments,
      );
      replacePullRequestReviews(
        db,
        options.repoOwner,
        options.repoName,
        parsed.pr.number,
        parsed.reviews,
      );
      replacePullRequestDecisions(
        db,
        options.repoOwner,
        options.repoName,
        parsed.pr.number,
        parsed.decisions,
      );

      const scopeDomain = (options.domain ?? options.repoName).trim();
      const scopeFeature =
        (options.feature ?? `pr-${parsed.pr.number}`).trim() ||
        `pr-${parsed.pr.number}`;
      const scopeBranch = (options.branch ?? "main").trim() || "main";
      const taskType = (options.taskType ?? "planning").trim() || "planning";

      upsertContextFact(db, {
        id: `pr:${options.repoOwner}/${options.repoName}#${parsed.pr.number}:description`,
        sourceType: "pr_description",
        sourceRef: `${options.repoOwner}/${options.repoName}#${parsed.pr.number}`,
        domain: scopeDomain,
        feature: scopeFeature,
        branch: scopeBranch,
        taskType,
        title: parsed.pr.title,
        content: parsed.pr.body,
        priority: 0.85,
        confidence: 0.9,
        status: "promoted",
        createdAt: parsed.pr.createdAt,
        updatedAt: parsed.pr.updatedAt,
      });

      for (const decision of parsed.decisions) {
        upsertContextFact(db, {
          id: `decision:${options.repoOwner}/${options.repoName}#${parsed.pr.number}:${decision.id}`,
          sourceType: `pr_${decision.source}`,
          sourceRef: `${options.repoOwner}/${options.repoName}#${parsed.pr.number}`,
          domain: scopeDomain,
          feature: scopeFeature,
          branch: scopeBranch,
          taskType,
          title: `Decision ${parsed.pr.number} (${decision.source})`,
          content: decision.summary,
          priority: decision.severity === "blocker" ? 1 : 0.75,
          confidence: 0.8,
          status: decision.source === "description" ? "promoted" : "draft",
          createdAt: decision.createdAt,
          updatedAt: decision.createdAt,
        });
      }

      syncedPrs += 1;
      syncedComments += parsed.comments.length;
      syncedReviews += parsed.reviews.length;
      promotedDecisions += parsed.decisions.length;
    }

    touchPullRequestSyncState(db, options.repoOwner, options.repoName);
  });

  tx();
  db.close();

  return {
    syncedPrs,
    syncedComments,
    syncedReviews,
    promotedDecisions,
    repoOwner: options.repoOwner,
    repoName: options.repoName,
    syncedAt: new Date().toISOString(),
  };
}
