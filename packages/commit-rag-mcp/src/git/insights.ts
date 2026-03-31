import { execFileSync } from "node:child_process";
import path from "node:path";

function runGit(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function whoChangedFile(options: {
  repoPath: string;
  filePath: string;
  limit: number;
}): {
  filePath: string;
  commits: Array<{
    sha: string;
    author: string;
    date: string;
    subject: string;
  }>;
  authors: Array<{ author: string; commitCount: number; lastCommitAt: string }>;
} {
  const repoPath = path.resolve(options.repoPath);
  const output = runGit(repoPath, [
    "log",
    `-n${options.limit}`,
    "--format=%H%x1f%an%x1f%aI%x1f%s",
    "--",
    options.filePath,
  ]).trim();

  if (!output) {
    return { filePath: options.filePath, commits: [], authors: [] };
  }

  const commits = output.split("\n").map((line) => {
    const [sha = "", author = "", date = "", subject = ""] = line.split("\x1f");
    return { sha, author, date, subject };
  });

  const authorMap = new Map<
    string,
    { commitCount: number; lastCommitAt: string }
  >();
  for (const commit of commits) {
    const existing = authorMap.get(commit.author);
    if (!existing) {
      authorMap.set(commit.author, {
        commitCount: 1,
        lastCommitAt: commit.date,
      });
      continue;
    }

    existing.commitCount += 1;
    if (commit.date > existing.lastCommitAt) {
      existing.lastCommitAt = commit.date;
    }
  }

  const authors = Array.from(authorMap.entries())
    .map(([author, value]) => ({ author, ...value }))
    .sort((a, b) => b.commitCount - a.commitCount);

  return {
    filePath: options.filePath,
    commits,
    authors,
  };
}

export function explainPathActivity(options: {
  repoPath: string;
  targetPath: string;
  limit: number;
}): {
  targetPath: string;
  commits: Array<{
    sha: string;
    author: string;
    date: string;
    subject: string;
  }>;
  topAuthors: Array<{ author: string; commitCount: number }>;
  topFiles: Array<{ filePath: string; touchCount: number }>;
} {
  const repoPath = path.resolve(options.repoPath);
  const limit = Math.max(1, options.limit);
  const targetPath = options.targetPath.trim();

  const commitsRaw = runGit(repoPath, [
    "log",
    `-n${limit}`,
    "--format=%H%x1f%an%x1f%aI%x1f%s",
    "--",
    targetPath,
  ]).trim();

  if (!commitsRaw) {
    return {
      targetPath,
      commits: [],
      topAuthors: [],
      topFiles: [],
    };
  }

  const commits = commitsRaw.split("\n").map((line) => {
    const [sha = "", author = "", date = "", subject = ""] = line.split("\x1f");
    return { sha, author, date, subject };
  });

  const authorCounts = new Map<string, number>();
  const fileCounts = new Map<string, number>();

  for (const commit of commits) {
    authorCounts.set(commit.author, (authorCounts.get(commit.author) ?? 0) + 1);

    const filesRaw = runGit(repoPath, [
      "show",
      "--name-only",
      "--pretty=format:",
      commit.sha,
      "--",
      targetPath,
    ]).trim();

    if (!filesRaw) {
      continue;
    }

    for (const filePath of filesRaw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)) {
      fileCounts.set(filePath, (fileCounts.get(filePath) ?? 0) + 1);
    }
  }

  const topAuthors = Array.from(authorCounts.entries())
    .map(([author, commitCount]) => ({ author, commitCount }))
    .sort((a, b) => b.commitCount - a.commitCount)
    .slice(0, 8);

  const topFiles = Array.from(fileCounts.entries())
    .map(([filePath, touchCount]) => ({ filePath, touchCount }))
    .sort((a, b) => b.touchCount - a.touchCount)
    .slice(0, 12);

  return {
    targetPath,
    commits,
    topAuthors,
    topFiles,
  };
}

export function latestCommitForFile(
  repoPath: string,
  filePath: string,
): string | null {
  const output = runGit(path.resolve(repoPath), [
    "log",
    "-n1",
    "--format=%H",
    "--",
    filePath,
  ]).trim();
  return output || null;
}

export function commitDetails(
  repoPath: string,
  sha: string,
): {
  sha: string;
  author: string;
  date: string;
  subject: string;
  body: string;
} {
  const output = runGit(path.resolve(repoPath), [
    "show",
    "--no-color",
    "--format=%H%x1f%an%x1f%aI%x1f%s%x1f%b",
    "--no-patch",
    sha,
  ]).trimEnd();

  const [commitSha = sha, author = "", date = "", subject = "", body = ""] =
    output.split("\x1f");
  return { sha: commitSha, author, date, subject, body };
}

export function mainBranchOvernightBrief(options: {
  repoPath: string;
  baseBranch: string;
  sinceHours: number;
  limit: number;
}): {
  baseBranch: string;
  sinceHours: number;
  commits: Array<{
    sha: string;
    author: string;
    date: string;
    subject: string;
  }>;
} {
  const repoPath = path.resolve(options.repoPath);
  const since = `${Math.max(1, options.sinceHours)} hours ago`;

  const output = runGit(repoPath, [
    "log",
    `-n${Math.max(1, options.limit)}`,
    `--since=${since}`,
    "--format=%H%x1f%an%x1f%aI%x1f%s",
    `origin/${options.baseBranch}`,
  ]).trim();

  if (!output) {
    return {
      baseBranch: options.baseBranch,
      sinceHours: options.sinceHours,
      commits: [],
    };
  }

  const commits = output.split("\n").map((line) => {
    const [sha = "", author = "", date = "", subject = ""] = line.split("\x1f");
    return { sha, author, date, subject };
  });

  return {
    baseBranch: options.baseBranch,
    sinceHours: options.sinceHours,
    commits,
  };
}

export function resumeFeatureSessionBrief(options: {
  worktreePath: string;
  baseBranch: string;
}): {
  worktreePath: string;
  branch: string;
  ahead: number;
  behind: number;
  overlapFiles: string[];
} {
  const worktreePath = path.resolve(options.worktreePath);
  const branch = runGit(worktreePath, [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]).trim();
  const countRaw = runGit(worktreePath, [
    "rev-list",
    "--left-right",
    "--count",
    `origin/${options.baseBranch}...HEAD`,
  ]).trim();

  const [behindRaw = "0", aheadRaw = "0"] = countRaw.split(/\s+/);
  const behind = Number.parseInt(behindRaw, 10) || 0;
  const ahead = Number.parseInt(aheadRaw, 10) || 0;

  const mergeBase = runGit(worktreePath, [
    "merge-base",
    "HEAD",
    `origin/${options.baseBranch}`,
  ]).trim();

  const baseFilesRaw = runGit(worktreePath, [
    "diff",
    "--name-only",
    `${mergeBase}..origin/${options.baseBranch}`,
  ]).trim();
  const featureFilesRaw = runGit(worktreePath, [
    "diff",
    "--name-only",
    `${mergeBase}..HEAD`,
  ]).trim();

  const baseFiles = new Set(
    baseFilesRaw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const featureFiles = new Set(
    featureFilesRaw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );

  const overlapFiles = Array.from(featureFiles)
    .filter((file) => baseFiles.has(file))
    .slice(0, 40);

  return {
    worktreePath,
    branch,
    ahead,
    behind,
    overlapFiles,
  };
}
