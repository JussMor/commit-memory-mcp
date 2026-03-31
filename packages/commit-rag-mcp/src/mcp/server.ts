#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Database } from "better-sqlite3";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  archiveFeatureContext,
  buildContextPack,
  openDatabase,
  promoteContextFacts,
  upsertWorktreeSession,
} from "../db/client.js";
import {
  commitDetails,
  explainPathActivity,
  latestCommitForFile,
  mainBranchOvernightBrief,
  resumeFeatureSessionBrief,
  whoChangedFile,
} from "../git/insights.js";
import { listActiveWorktrees } from "../git/worktree.js";
import { syncPullRequestContext } from "../pr/sync.js";

function fetchRemote(repoPath: string): void {
  execFileSync("git", ["-C", repoPath, "fetch", "--all", "--prune"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function detectReferencedPrNumber(text: string): number | null {
  const match = text.match(/#(\d{1,8})\b/);
  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
}

function parsePrNumberFromSourceRef(sourceRef: string): number | null {
  const match = sourceRef.match(/#(\d{1,8})\b/);
  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
}

function loadPathPullRequestContext(
  db: Database,
  options: {
    targetPath: string;
    owner?: string;
    repo?: string;
    referencedPrNumbers: number[];
  },
): Array<Record<string, unknown>> {
  const prNumbers = new Set<number>(options.referencedPrNumbers);

  const likePattern = `%${options.targetPath}%`;
  const sourceRows = db
    .prepare(
      `
      SELECT source_ref
      FROM context_facts
      WHERE (title LIKE ? OR content LIKE ?)
        AND source_ref LIKE '%#%'
      ORDER BY updated_at DESC
      LIMIT 80
    `,
    )
    .all(likePattern, likePattern) as Array<{ source_ref: string }>;

  for (const row of sourceRows) {
    const number = parsePrNumberFromSourceRef(String(row.source_ref ?? ""));
    if (number) {
      prNumbers.add(number);
    }
  }

  if (prNumbers.size === 0) {
    return [];
  }

  const results: Array<Record<string, unknown>> = [];

  for (const prNumber of Array.from(prNumbers).slice(0, 20)) {
    const pr =
      options.owner && options.repo
        ? ((db
            .prepare(
              `
              SELECT repo_owner, repo_name, pr_number, title, body, author, state, created_at, updated_at, merged_at, url
              FROM prs
              WHERE repo_owner = ? AND repo_name = ? AND pr_number = ?
              LIMIT 1
            `,
            )
            .get(options.owner, options.repo, prNumber) as
            | Record<string, unknown>
            | undefined) ?? null)
        : ((db
            .prepare(
              `
              SELECT repo_owner, repo_name, pr_number, title, body, author, state, created_at, updated_at, merged_at, url
              FROM prs
              WHERE pr_number = ?
              ORDER BY updated_at DESC
              LIMIT 1
            `,
            )
            .get(prNumber) as Record<string, unknown> | undefined) ?? null);

    if (!pr) {
      continue;
    }

    const decisions = db
      .prepare(
        `
        SELECT id, source, author, summary, severity, created_at
        FROM pr_decisions
        WHERE repo_owner = ? AND repo_name = ? AND pr_number = ?
        ORDER BY created_at DESC
        LIMIT 20
      `,
      )
      .all(pr.repo_owner, pr.repo_name, pr.pr_number) as Array<
      Record<string, unknown>
    >;

    results.push({
      pr,
      decisions,
    });
  }

  return results;
}

function loadPullRequestContext(
  db: Database,
  prNumber: number,
  repoOwner?: string,
  repoName?: string,
): {
  pr: Record<string, unknown> | null;
  decisions: Array<Record<string, unknown>>;
} {
  const pr =
    repoOwner && repoName
      ? ((db
          .prepare(
            `
            SELECT repo_owner, repo_name, pr_number, title, body, author, state, created_at, updated_at, merged_at, url
            FROM prs
            WHERE repo_owner = ? AND repo_name = ? AND pr_number = ?
            LIMIT 1
          `,
          )
          .get(repoOwner, repoName, prNumber) as
          | Record<string, unknown>
          | undefined) ?? null)
      : ((db
          .prepare(
            `
            SELECT repo_owner, repo_name, pr_number, title, body, author, state, created_at, updated_at, merged_at, url
            FROM prs
            WHERE pr_number = ?
            ORDER BY updated_at DESC
            LIMIT 1
          `,
          )
          .get(prNumber) as Record<string, unknown> | undefined) ?? null);

  if (!pr) {
    return { pr: null, decisions: [] };
  }

  const decisions = db
    .prepare(
      `
      SELECT id, source, author, summary, severity, created_at
      FROM pr_decisions
      WHERE repo_owner = ? AND repo_name = ? AND pr_number = ?
      ORDER BY created_at DESC
      LIMIT 50
    `,
    )
    .all(pr.repo_owner, pr.repo_name, pr.pr_number) as Array<
    Record<string, unknown>
  >;

  return { pr, decisions };
}

function getConfig() {
  const repoPath = path.resolve(process.env.COMMIT_RAG_REPO ?? process.cwd());
  const dbPath = path.resolve(
    process.env.COMMIT_RAG_DB ?? path.join(repoPath, ".commit-rag.db"),
  );
  const limit = Number.parseInt(process.env.COMMIT_RAG_LIMIT ?? "", 10) || 400;
  return { repoPath, dbPath, limit };
}

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    {
      name: "commit-memory-mcp",
      version: "0.4.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "sync_pr_context",
        description:
          "Sync pull request description/comments/reviews from GitHub CLI into local context DB.",
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string" },
            repo: { type: "string" },
            prNumbers: {
              type: "array",
              items: { type: "number" },
            },
            domain: { type: "string" },
            feature: { type: "string" },
            branch: { type: "string" },
            taskType: { type: "string" },
            limit: { type: "number" },
          },
          required: ["owner", "repo"],
        },
      },
      {
        name: "build_context_pack",
        description:
          "Build a scoped context pack for a task/domain/feature/branch to keep agent prompts small.",
        inputSchema: {
          type: "object",
          properties: {
            domain: { type: "string" },
            feature: { type: "string" },
            branch: { type: "string" },
            taskType: { type: "string" },
            includeDraft: { type: "boolean" },
            limit: { type: "number" },
          },
          required: [],
        },
      },
      {
        name: "promote_context_facts",
        description:
          "Promote scoped draft facts into durable promoted context.",
        inputSchema: {
          type: "object",
          properties: {
            domain: { type: "string" },
            feature: { type: "string" },
            branch: { type: "string" },
            sourceType: { type: "string" },
          },
          required: [],
        },
      },
      {
        name: "archive_feature_context",
        description:
          "Archive all active facts for a domain/feature once work is complete.",
        inputSchema: {
          type: "object",
          properties: {
            domain: { type: "string" },
            feature: { type: "string" },
          },
          required: ["domain", "feature"],
        },
      },
      {
        name: "list_active_worktrees",
        description:
          "List active git worktrees for multi-session feature work.",
        inputSchema: {
          type: "object",
          properties: {
            baseBranch: { type: "string" },
          },
          required: [],
        },
      },
      {
        name: "who_changed_this",
        description:
          "Show who changed a file recently and summarize top authors.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string" },
            limit: { type: "number" },
          },
          required: ["filePath"],
        },
      },
      {
        name: "explain_path_activity",
        description:
          "Given a file or folder path, summarize activity, top files/authors, and related PR context.",
        inputSchema: {
          type: "object",
          properties: {
            targetPath: { type: "string" },
            owner: { type: "string" },
            repo: { type: "string" },
            limit: { type: "number" },
          },
          required: ["targetPath"],
        },
      },
      {
        name: "why_was_this_changed",
        description:
          "Explain intent for a commit or file using git history and synced PR decisions.",
        inputSchema: {
          type: "object",
          properties: {
            sha: { type: "string" },
            filePath: { type: "string" },
            owner: { type: "string" },
            repo: { type: "string" },
          },
          required: [],
        },
      },
      {
        name: "get_main_branch_overnight_brief",
        description:
          "Summarize what changed recently on main branch while you were offline.",
        inputSchema: {
          type: "object",
          properties: {
            baseBranch: { type: "string" },
            sinceHours: { type: "number" },
            limit: { type: "number" },
          },
          required: [],
        },
      },
      {
        name: "resume_feature_session_brief",
        description:
          "Brief branch divergence and overlap risk for a feature worktree.",
        inputSchema: {
          type: "object",
          properties: {
            worktreePath: { type: "string" },
            baseBranch: { type: "string" },
          },
          required: [],
        },
      },
      {
        name: "pre_plan_sync_brief",
        description:
          "Run sync + overnight + feature resume analysis before planning work.",
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string" },
            repo: { type: "string" },
            baseBranch: { type: "string" },
            worktreePath: { type: "string" },
            filePath: { type: "string" },
            sinceHours: { type: "number" },
            limit: { type: "number" },
          },
          required: ["owner", "repo"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { repoPath, dbPath, limit: defaultLimit } = getConfig();

    if (request.params.name === "sync_pr_context") {
      const owner = String(request.params.arguments?.owner ?? "").trim();
      const repo = String(request.params.arguments?.repo ?? "").trim();
      if (!owner || !repo) {
        return {
          content: [{ type: "text", text: "owner and repo are required" }],
          isError: true,
        };
      }

      const numbersRaw = request.params.arguments?.prNumbers as
        | Array<number>
        | undefined;
      const prNumbers = Array.isArray(numbersRaw)
        ? numbersRaw
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0)
        : undefined;
      const limit = Number(
        (request.params.arguments?.limit as number | undefined) ?? 25,
      );
      const domain = String(request.params.arguments?.domain ?? "").trim();
      const feature = String(request.params.arguments?.feature ?? "").trim();
      const branch = String(request.params.arguments?.branch ?? "").trim();
      const taskType = String(request.params.arguments?.taskType ?? "").trim();

      const summary = await syncPullRequestContext({
        repoPath,
        dbPath,
        repoOwner: owner,
        repoName: repo,
        prNumbers,
        limit,
        domain: domain || undefined,
        feature: feature || undefined,
        branch: branch || undefined,
        taskType: taskType || undefined,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }

    if (request.params.name === "build_context_pack") {
      const limit = Number(
        (request.params.arguments?.limit as number | undefined) ?? 20,
      );
      const domain = String(request.params.arguments?.domain ?? "").trim();
      const feature = String(request.params.arguments?.feature ?? "").trim();
      const branch = String(request.params.arguments?.branch ?? "").trim();
      const taskType =
        String(request.params.arguments?.taskType ?? "").trim() || "general";
      const includeDraft = Boolean(request.params.arguments?.includeDraft);

      const db = openDatabase(dbPath);
      try {
        const pack = buildContextPack(db, {
          domain: domain || undefined,
          feature: feature || undefined,
          branch: branch || undefined,
          taskType,
          includeDraft,
          limit: Number.isFinite(limit) && limit > 0 ? limit : 20,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(pack, null, 2) }],
        };
      } finally {
        db.close();
      }
    }

    if (request.params.name === "promote_context_facts") {
      const domain = String(request.params.arguments?.domain ?? "").trim();
      const feature = String(request.params.arguments?.feature ?? "").trim();
      const branch = String(request.params.arguments?.branch ?? "").trim();
      const sourceType = String(
        request.params.arguments?.sourceType ?? "",
      ).trim();

      const db = openDatabase(dbPath);
      try {
        const promotedCount = promoteContextFacts(db, {
          domain: domain || undefined,
          feature: feature || undefined,
          branch: branch || undefined,
          sourceType: sourceType || undefined,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ promotedCount }, null, 2),
            },
          ],
        };
      } finally {
        db.close();
      }
    }

    if (request.params.name === "archive_feature_context") {
      const domain = String(request.params.arguments?.domain ?? "").trim();
      const feature = String(request.params.arguments?.feature ?? "").trim();
      if (!domain || !feature) {
        return {
          content: [{ type: "text", text: "domain and feature are required" }],
          isError: true,
        };
      }

      const db = openDatabase(dbPath);
      try {
        const archivedCount = archiveFeatureContext(db, {
          domain,
          feature,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ archivedCount }, null, 2),
            },
          ],
        };
      } finally {
        db.close();
      }
    }

    if (request.params.name === "list_active_worktrees") {
      const baseBranch =
        String(request.params.arguments?.baseBranch ?? "").trim() || "main";
      const worktrees = listActiveWorktrees(repoPath);

      const db = openDatabase(dbPath);
      try {
        for (const worktree of worktrees) {
          upsertWorktreeSession(db, {
            path: worktree.path,
            branch: worktree.branch,
            baseBranch,
            lastSyncedAt: new Date().toISOString(),
          });
        }
      } finally {
        db.close();
      }

      return {
        content: [{ type: "text", text: JSON.stringify(worktrees, null, 2) }],
      };
    }

    if (request.params.name === "who_changed_this") {
      const filePath = String(request.params.arguments?.filePath ?? "").trim();
      const limit = Number(
        (request.params.arguments?.limit as number | undefined) ?? 20,
      );
      if (!filePath) {
        return {
          content: [{ type: "text", text: "filePath is required" }],
          isError: true,
        };
      }

      const output = whoChangedFile({
        repoPath,
        filePath,
        limit: Number.isFinite(limit) && limit > 0 ? limit : 20,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    }

    if (request.params.name === "explain_path_activity") {
      const targetPath = String(
        request.params.arguments?.targetPath ?? "",
      ).trim();
      const owner = String(request.params.arguments?.owner ?? "").trim();
      const repo = String(request.params.arguments?.repo ?? "").trim();
      const limit = Number(
        (request.params.arguments?.limit as number | undefined) ?? 25,
      );
      if (!targetPath) {
        return {
          content: [{ type: "text", text: "targetPath is required" }],
          isError: true,
        };
      }

      const output = explainPathActivity({
        repoPath,
        targetPath,
        limit: Number.isFinite(limit) && limit > 0 ? limit : 25,
      });

      const referencedPrNumbers = output.commits
        .map((commit) => {
          const details = commitDetails(repoPath, commit.sha);
          return detectReferencedPrNumber(
            `${details.subject}\n${details.body}`,
          );
        })
        .filter((value): value is number => Number.isFinite(value));

      const db = openDatabase(dbPath);
      try {
        const relatedPullRequests = loadPathPullRequestContext(db, {
          targetPath,
          owner: owner || undefined,
          repo: repo || undefined,
          referencedPrNumbers,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ...output,
                  relatedPullRequests,
                },
                null,
                2,
              ),
            },
          ],
        };
      } finally {
        db.close();
      }
    }

    if (request.params.name === "why_was_this_changed") {
      const owner = String(request.params.arguments?.owner ?? "").trim();
      const repo = String(request.params.arguments?.repo ?? "").trim();
      const filePath = String(request.params.arguments?.filePath ?? "").trim();
      const rawSha = String(request.params.arguments?.sha ?? "").trim();
      const sha =
        rawSha || (filePath ? latestCommitForFile(repoPath, filePath) : null);

      if (!sha) {
        return {
          content: [
            {
              type: "text",
              text: "Provide sha or a filePath that has commit history.",
            },
          ],
          isError: true,
        };
      }

      const commit = commitDetails(repoPath, sha);
      const prNumber = detectReferencedPrNumber(
        `${commit.subject}\n${commit.body}`,
      );

      let prContext: {
        pr: Record<string, unknown> | null;
        decisions: Array<Record<string, unknown>>;
      } = { pr: null, decisions: [] };

      if (prNumber) {
        const db = openDatabase(dbPath);
        try {
          prContext = loadPullRequestContext(
            db,
            prNumber,
            owner || undefined,
            repo || undefined,
          );
        } finally {
          db.close();
        }
      }

      const result = {
        filePath: filePath || null,
        commit,
        referencedPullRequestNumber: prNumber,
        pullRequest: prContext.pr,
        decisions: prContext.decisions,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (request.params.name === "get_main_branch_overnight_brief") {
      const baseBranch =
        String(request.params.arguments?.baseBranch ?? "").trim() || "main";
      const sinceHours = Number(
        (request.params.arguments?.sinceHours as number | undefined) ?? 12,
      );
      const limit = Number(
        (request.params.arguments?.limit as number | undefined) ?? defaultLimit,
      );

      fetchRemote(repoPath);
      const brief = mainBranchOvernightBrief({
        repoPath,
        baseBranch,
        sinceHours: Number.isFinite(sinceHours) ? sinceHours : 12,
        limit: Number.isFinite(limit) ? limit : defaultLimit,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(brief, null, 2) }],
      };
    }

    if (request.params.name === "resume_feature_session_brief") {
      const worktreePath =
        String(request.params.arguments?.worktreePath ?? "").trim() || repoPath;
      const baseBranch =
        String(request.params.arguments?.baseBranch ?? "").trim() || "main";

      fetchRemote(repoPath);
      const brief = resumeFeatureSessionBrief({
        worktreePath,
        baseBranch,
      });

      const db = openDatabase(dbPath);
      try {
        upsertWorktreeSession(db, {
          path: brief.worktreePath,
          branch: brief.branch,
          baseBranch,
          lastSyncedAt: new Date().toISOString(),
        });
      } finally {
        db.close();
      }

      return {
        content: [{ type: "text", text: JSON.stringify(brief, null, 2) }],
      };
    }

    if (request.params.name === "pre_plan_sync_brief") {
      const owner = String(request.params.arguments?.owner ?? "").trim();
      const repo = String(request.params.arguments?.repo ?? "").trim();
      const baseBranch =
        String(request.params.arguments?.baseBranch ?? "").trim() || "main";
      const worktreePath =
        String(request.params.arguments?.worktreePath ?? "").trim() || repoPath;
      const filePath = String(request.params.arguments?.filePath ?? "").trim();
      const sinceHours = Number(
        (request.params.arguments?.sinceHours as number | undefined) ?? 12,
      );
      const limit = Number(
        (request.params.arguments?.limit as number | undefined) ?? 25,
      );

      if (!owner || !repo) {
        return {
          content: [{ type: "text", text: "owner and repo are required" }],
          isError: true,
        };
      }

      fetchRemote(repoPath);
      const syncSummary = await syncPullRequestContext({
        repoPath,
        dbPath,
        repoOwner: owner,
        repoName: repo,
        limit,
      });

      const overnight = mainBranchOvernightBrief({
        repoPath,
        baseBranch,
        sinceHours: Number.isFinite(sinceHours) ? sinceHours : 12,
        limit,
      });
      const resume = resumeFeatureSessionBrief({
        worktreePath,
        baseBranch,
      });
      const fileFocus = filePath
        ? whoChangedFile({
            repoPath,
            filePath,
            limit: 10,
          })
        : null;

      const prePlan = {
        syncSummary,
        overnight,
        resume,
        fileFocus,
        recommendations: [
          "Review blocker-level decisions from synced PR context first.",
          "Rebase or merge main if behind is non-zero before coding.",
          "Resolve overlap files before expanding feature scope.",
        ],
      };

      return {
        content: [{ type: "text", text: JSON.stringify(prePlan, null, 2) }],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function isDirectExecution(): boolean {
  const argvPath = process.argv[1];
  if (!argvPath) {
    return false;
  }

  const directHref = pathToFileURL(path.resolve(argvPath)).href;
  if (directHref === import.meta.url) {
    return true;
  }

  try {
    const realHref = pathToFileURL(fs.realpathSync(argvPath)).href;
    return realHref === import.meta.url;
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  startMcpServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
