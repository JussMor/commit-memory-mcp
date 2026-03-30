import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import type { CommitChunk } from "../types.js";

function runGit(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function getChangedLines(patch: string): string[] {
  return patch
    .split("\n")
    .filter(
      (line) =>
        (line.startsWith("+") || line.startsWith("-")) &&
        !line.startsWith("+++") &&
        !line.startsWith("---"),
    )
    .slice(0, 120);
}

function createChunkId(sha: string, filePath: string, text: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(text)
    .digest("hex")
    .slice(0, 16);
  return `${sha}:${filePath}:${hash}`;
}

export function extractCommitChunks(
  repoPath: string,
  limit: number,
): CommitChunk[] {
  const shaOutput = runGit(repoPath, [
    "log",
    "--all",
    "--format=%H",
    `-n${limit}`,
  ]).trim();
  if (!shaOutput) {
    return [];
  }

  const shas = shaOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const chunks: CommitChunk[] = [];

  for (const sha of shas) {
    const meta = runGit(repoPath, [
      "show",
      "--no-color",
      "--format=%an%x1f%aI%x1f%s%x1f%b",
      "--no-patch",
      sha,
    ]).trimEnd();
    const [author = "", date = "", subject = "", body = ""] =
      meta.split("\x1f");

    const filesRaw = runGit(repoPath, [
      "show",
      "--no-color",
      "--pretty=format:",
      "--name-only",
      sha,
    ]).trim();
    const files = Array.from(
      new Set(
        filesRaw
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      ),
    );

    for (const filePath of files) {
      const patch = runGit(repoPath, [
        "show",
        "--no-color",
        "--pretty=format:",
        "--unified=0",
        sha,
        "--",
        filePath,
      ]).trim();
      const changedLines = getChangedLines(patch);
      const hunkText = changedLines.join("\n");
      if (!hunkText) {
        continue;
      }

      const indexedText = [
        `subject: ${subject}`,
        `body: ${body}`,
        `file: ${filePath}`,
        "changes:",
        hunkText,
      ].join("\n");

      const chunkId = createChunkId(sha, filePath, indexedText);
      chunks.push({
        chunkId,
        sha,
        author,
        date,
        subject,
        body,
        filePath,
        hunkText,
        indexedText,
      });
    }
  }

  return chunks;
}
