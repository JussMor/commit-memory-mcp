import { execSync } from "node:child_process";
import { getDb } from "../db/client.js";

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

export async function syncPrContext(repo: string, limit = 20): Promise<string> {
  const db = await getDb();
  const { owner, name } = parseRepo(repo);

  const raw = execSync(
    `gh pr list --repo ${owner}/${name} --state merged --limit ${limit} --json number,title,author,mergedAt,baseRefName`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  const prs = JSON.parse(raw) as Array<{
    number: number;
    title: string;
    author: { login: string };
    mergedAt: string | null;
    baseRefName: string;
  }>;

  for (const pr of prs) {
    await db.query(
      `
        UPSERT type::thing('pr', $key) CONTENT {
          repo: $repo,
          number: $number,
          title: $title,
          author: $author,
          merged_at: $merged_at,
          base_branch: $base_branch,
          state: 'merged',
          synced_at: time::now()
        }
      `,
      {
        key: makePrKey(repo, pr.number),
        repo,
        number: pr.number,
        title: pr.title,
        author: pr.author.login,
        merged_at: pr.mergedAt,
        base_branch: pr.baseRefName,
      },
    );
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
  const db = await getDb();

  const result = await db.query(
    `
      SELECT number, title, author, merged_at
      FROM pr
      WHERE repo = $repo
        AND merged_at > time::now() - duration::from::hours($hours)
        AND state = 'merged'
      ORDER BY merged_at DESC
    `,
    { repo, hours },
  );

  const prs = ((result as unknown[])[0] as unknown[]) ?? [];
  return JSON.stringify({ hours, repo, merged_prs: prs }, null, 2);
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
        UPSERT type::thing('worktree', $key) CONTENT {
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
