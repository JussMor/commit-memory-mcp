#!/usr/bin/env node

import path from "node:path";
import { closeDb } from "../db/client.js";
import { bootstrapFromFilesystem } from "../layers/bootstrap.js";

type BootstrapArgs = {
  repoPath: string;
  includePatterns: string[];
  resume: boolean;
  startPhase: 1 | 2;
};

function parseBootstrapArgs(argv: string[]): BootstrapArgs {
  const args: BootstrapArgs = {
    repoPath: process.cwd(),
    includePatterns: [],
    resume: false,
    startPhase: 1,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--repo") {
      args.repoPath = path.resolve(argv[i + 1] ?? process.cwd());
      i += 1;
      continue;
    }

    if (arg === "--include") {
      const pattern = (argv[i + 1] ?? "").trim();
      if (!pattern) {
        throw new Error("Invalid --include value");
      }

      args.includePatterns.push(pattern);
      i += 1;
      continue;
    }

    if (arg === "--resume") {
      args.resume = true;
      continue;
    }

    if (arg === "--start-phase") {
      const raw = argv[i + 1] ?? "";
      const phase = Number.parseInt(raw, 10);
      if (phase !== 1 && phase !== 2) {
        throw new Error("Invalid --start-phase value. Expected 1 or 2");
      }

      args.startPhase = phase;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printUsage(): void {
  process.stdout.write(
    [
      "Usage:",
      "  commit-memory bootstrap --repo <path> [--include <glob>] [--resume] [--start-phase <1|2>]",
      "",
      "Examples:",
      '  commit-memory bootstrap --repo ./my-legacy-app --include "src/**/*.ts"',
      '  commit-memory bootstrap --repo . --include "src/**/*.ts" --resume',
      '  commit-memory bootstrap --repo . --include "src/**/*.ts" --start-phase 2',
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "bootstrap") {
    const args = parseBootstrapArgs(rest);
    const summary = await bootstrapFromFilesystem(args.repoPath, {
      includePatterns: args.includePatterns,
      resume: args.resume,
      startPhase: args.startPhase,
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
