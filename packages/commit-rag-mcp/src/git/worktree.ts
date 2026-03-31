import { execFileSync } from "node:child_process";
import path from "node:path";
import type { WorktreeRecord } from "../types.js";

function runGit(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function listActiveWorktrees(repoPath: string): WorktreeRecord[] {
  const root = path.resolve(repoPath);
  const output = runGit(root, ["worktree", "list", "--porcelain"]);

  const records: WorktreeRecord[] = [];
  const blocks = output
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const lines = block.split("\n");
    let recordPath = "";
    let headSha = "";
    let branch = "detached";

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        recordPath = line.slice("worktree ".length).trim();
      }

      if (line.startsWith("HEAD ")) {
        headSha = line.slice("HEAD ".length).trim();
      }

      if (line.startsWith("branch ")) {
        const fullRef = line.slice("branch ".length).trim();
        branch = fullRef.replace("refs/heads/", "");
      }
    }

    if (!recordPath) {
      continue;
    }

    records.push({
      path: recordPath,
      branch,
      headSha,
      isCurrent: path.resolve(recordPath) === root,
    });
  }

  return records;
}

export function currentBranch(repoPath: string): string {
  return runGit(path.resolve(repoPath), [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]).trim();
}
