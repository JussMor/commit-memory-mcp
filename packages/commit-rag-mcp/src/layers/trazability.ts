import { execSync } from "node:child_process";
import { getDb } from "../db/client.js";
import { runGh } from "./gh.js";

function parseRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo format: ${repo}. Expected owner/name.`);
  }
  return { owner, name };
}

function makePrKey(repo: string, number: number): string {
  const safeRepo = repo.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safeRepo}_${number}`;
}

type PullRequestListItem = {
  number: number;
  title: string;
  author?: { login?: string };
  mergedAt: string | null;
  baseRefName: string;
};

type PullRequestDetail = PullRequestListItem & {
  body?: string | null;
  files?: Array<{ path?: string | null }>;
  labels?: Array<{ name?: string | null }>;
  commits?: Array<
    { oid?: string | null } | { commit?: { oid?: string | null } }
  >;
};

function extractCommitShas(commits: PullRequestDetail["commits"]): string[] {
  if (!Array.isArray(commits)) {
    return [];
  }

  return commits
    .map((commit) => {
      if ("oid" in commit && typeof commit.oid === "string") {
        return commit.oid;
      }

      if (
        "commit" in commit &&
        commit.commit &&
        typeof commit.commit.oid === "string"
      ) {
        return commit.commit.oid;
      }

      return null;
    })
    .filter((sha): sha is string => Boolean(sha));
}

function extractFiles(files: PullRequestDetail["files"]): string[] {
  if (!Array.isArray(files)) {
    return [];
  }

  return files
    .map((file) => file.path)
    .filter((filePath): filePath is string => Boolean(filePath));
}

function extractLabels(labels: PullRequestDetail["labels"]): string[] {
  if (!Array.isArray(labels)) {
    return [];
  }

  return labels
    .map((label) => label.name)
    .filter((label): label is string => Boolean(label));
}

function fetchPullRequestDetail(
  repo: string,
  prNumber: number,
): PullRequestDetail {
  const { owner, name } = parseRepo(repo);
  const raw = runGh([
    "pr",
    "view",
    String(prNumber),
    "--repo",
    `${owner}/${name}`,
    "--json",
    "number,title,body,author,mergedAt,baseRefName,files,commits,labels",
  ]);

  return JSON.parse(raw) as PullRequestDetail;
}

function toDateOrNull(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeHours(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) {
    return 12;
  }

  return Math.floor(hours);
}

function mergedAfterHours(mergedAt: string | null, hours: number): boolean {
  if (!mergedAt) {
    return false;
  }

  const mergedDate = new Date(mergedAt);
  if (Number.isNaN(mergedDate.getTime())) {
    return false;
  }

  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return mergedDate.getTime() >= cutoff;
}

function estimateSyncLimit(hours: number): number {
  const estimated = Math.max(30, hours * 12);
  return Math.min(estimated, 200);
}

async function upsertPullRequest(
  repo: string,
  prNumber: number,
): Promise<void> {
  const db = await getDb();
  const detail = fetchPullRequestDetail(repo, prNumber);

  await db.query(
    `
      UPSERT type::record('pr', $key) CONTENT {
        repo: $repo,
        number: $number,
        title: $title,
        body: $body,
        author: $author,
        merged_at: $merged_at,
        base_branch: $base_branch,
        files: $files,
        labels: $labels,
        commits: $commits,
        state: 'merged',
        synced_at: time::now()
      }
    `,
    {
      key: makePrKey(repo, prNumber),
      repo,
      number: prNumber,
      title: detail.title,
      body: detail.body ?? "",
      author: detail.author?.login ?? "unknown",
      merged_at: toDateOrNull(detail.mergedAt),
      base_branch: detail.baseRefName,
      files: extractFiles(detail.files),
      labels: extractLabels(detail.labels),
      commits: extractCommitShas(detail.commits),
    },
  );
}

async function syncMainBranchOvernightPrs(
  repo: string,
  hours: number,
): Promise<{ scanned: number; synced: number }> {
  const { owner, name } = parseRepo(repo);
  const raw = runGh([
    "pr",
    "list",
    "--repo",
    `${owner}/${name}`,
    "--state",
    "merged",
    "--base",
    "main",
    "--limit",
    String(estimateSyncLimit(hours)),
    "--json",
    "number,mergedAt",
  ]);

  const prs = JSON.parse(raw) as Array<{
    number: number;
    mergedAt: string | null;
  }>;
  const overnight = prs.filter((pr) => mergedAfterHours(pr.mergedAt, hours));

  for (const pr of overnight) {
    await upsertPullRequest(repo, pr.number);
  }

  return { scanned: prs.length, synced: overnight.length };
}

export async function syncPrContext(repo: string, limit = 20): Promise<string> {
  const { owner, name } = parseRepo(repo);

  const raw = runGh([
    "pr",
    "list",
    "--repo",
    `${owner}/${name}`,
    "--state",
    "merged",
    "--limit",
    String(limit),
    "--json",
    "number,title,author,mergedAt,baseRefName",
  ]);

  const prs = JSON.parse(raw) as PullRequestListItem[];

  for (const pr of prs) {
    await upsertPullRequest(repo, pr.number);
  }

  return `Synced ${prs.length} PRs for ${repo}`;
}

export async function whoChangedThis(
  file: string,
  repo: string,
): Promise<string> {
  const db = await getDb();

  const result = await db.query(
    `
      SELECT author, title, merged_at, number
      FROM pr
      WHERE repo = $repo
        AND $file INSIDE files
      ORDER BY merged_at DESC
      LIMIT 5
    `,
    { repo, file },
  );

  const rows = ((result as unknown[])[0] as unknown[]) ?? [];

  const gitLog = execSync(
    `git log --follow --format="%h %an %ar %s" -10 -- "${file}"`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();

  return JSON.stringify({ prs: rows, git_log: gitLog }, null, 2);
}

export async function whyWasThisChanged(
  file: string | undefined,
  sha: string | undefined,
  repo: string,
): Promise<string> {
  const db = await getDb();

  if (sha) {
    const result = await db.query(
      `
        SELECT title, body, number
        FROM pr
        WHERE repo = $repo
          AND $sha INSIDE commits
        LIMIT 1
      `,
      { repo, sha },
    );

    const row = (((result as unknown[])[0] as unknown[]) ?? [])[0] ?? {
      message: "No PR found for this SHA",
    };

    return JSON.stringify(row, null, 2);
  }

  if (file) {
    const result = await db.query(
      `
        SELECT title, body, number, merged_at
        FROM pr
        WHERE repo = $repo
          AND $file INSIDE files
        ORDER BY merged_at DESC
        LIMIT 3
      `,
      { repo, file },
    );

    return JSON.stringify(
      ((result as unknown[])[0] as unknown[]) ?? [],
      null,
      2,
    );
  }

  return JSON.stringify({ error: "Provide file or sha" });
}

export async function getOvernightBrief(
  repo: string,
  hours = 12,
): Promise<string> {
  const normalizedHours = normalizeHours(hours);

  let syncSummary: {
    attempted: true;
    scanned: number;
    synced: number;
    error?: string;
  } = {
    attempted: true,
    scanned: 0,
    synced: 0,
  };

  try {
    const summary = await syncMainBranchOvernightPrs(repo, normalizedHours);
    syncSummary = {
      attempted: true,
      scanned: summary.scanned,
      synced: summary.synced,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    syncSummary = {
      attempted: true,
      scanned: 0,
      synced: 0,
      error: message,
    };
  }

  const db = await getDb();

  const result = await db.query(
    `
      SELECT number, title, author, merged_at
      FROM pr
      WHERE repo = $repo
        AND base_branch = 'main'
        AND merged_at > time::now() - duration::from_hours($hours)
        AND state = 'merged'
      ORDER BY merged_at DESC
    `,
    { repo, hours: normalizedHours },
  );

  const prs = ((result as unknown[])[0] as unknown[]) ?? [];
  return JSON.stringify(
    {
      hours: normalizedHours,
      repo,
      sync: syncSummary,
      merged_prs: prs,
    },
    null,
    2,
  );
}

export async function listActiveWorktrees(): Promise<string> {
  const db = await getDb();

  const raw = execSync("git worktree list --porcelain", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const worktrees = parseWorktrees(raw);

  for (const wt of worktrees) {
    const key = wt.path.replace(/[^a-zA-Z0-9_-]/g, "_");
    await db.query(
      `
        UPSERT type::record('worktree', $key) CONTENT {
          path: $path,
          branch: $branch,
          repo: $repo,
          active: true,
          last_seen: time::now()
        }
      `,
      {
        key,
        path: wt.path,
        branch: wt.branch,
        repo: wt.repo,
      },
    );
  }

  return JSON.stringify(worktrees, null, 2);
}

function parseWorktrees(
  raw: string,
): Array<{ path: string; branch: string; repo: string }> {
  const remote = execSync("git remote get-url origin", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  return raw
    .trim()
    .split("\n\n")
    .map((block) => {
      const lines = block.split("\n");
      const pathLine = lines.find((line) => line.startsWith("worktree ")) ?? "";
      const branchLine = lines.find((line) => line.startsWith("branch ")) ?? "";

      const path = pathLine.replace("worktree ", "");
      const branch = branchLine.replace("branch refs/heads/", "") || "detached";

      return { path, branch, repo: remote };
    })
    .filter((wt) => wt.path.length > 0);
}
