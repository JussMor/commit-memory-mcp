#!/usr/bin/env node

import path from "node:path";
import { indexRepository } from "../indexer.js";

type CliArgs = {
  repoPath: string;
  dbPath: string;
  limit: number;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    repoPath: process.cwd(),
    dbPath: path.resolve(process.cwd(), ".commit-rag.db"),
    limit: 400,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--repo") {
      args.repoPath = path.resolve(argv[i + 1] ?? process.cwd());
      i += 1;
      continue;
    }

    if (arg === "--db") {
      args.dbPath = path.resolve(argv[i + 1] ?? ".commit-rag.db");
      i += 1;
      continue;
    }

    if (arg === "--limit") {
      const value = Number.parseInt(argv[i + 1] ?? "", 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("Invalid --limit value");
      }
      args.limit = value;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const summary = await indexRepository(args);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
