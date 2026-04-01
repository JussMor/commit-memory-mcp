import { execFileSync } from "node:child_process";

function detectGhBinary(): string {
  const candidates = [
    process.env.GH_BIN,
    "/opt/homebrew/bin/gh",
    "/usr/local/bin/gh",
    "gh",
  ].filter((value): value is string => Boolean(value && value.trim()));

  return candidates[0];
}

export function runGh(args: string[]): string {
  const ghBinary = detectGhBinary();

  try {
    return execFileSync(ghBinary, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to run GitHub CLI (${ghBinary}). Set GH_BIN or ensure gh is in PATH. Details: ${message}`,
    );
  }
}
