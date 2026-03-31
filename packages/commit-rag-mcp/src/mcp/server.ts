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
  getFeatureResume,
  listLearnedFeatures,
  listAvailableBranches,
  openDatabase,
  promoteContextFacts,
  upsertContextFact,
  upsertWorktreeSession,
} from "../db/client.js";
import {
  commitDetails,
  explainPathActivity,
  extractFeatureBranchCommits,
  latestCommitForFile,
  mainBranchOvernightBrief,
  resumeFeatureSessionBrief,
  whoChangedFile,
} from "../git/insights.js";
import { listActiveWorktrees } from "../git/worktree.js";
import { syncPullRequestContext } from "../pr/sync.js";
import { callOllamaLlm } from "../search/embeddings.js";

function normalizeFeatureName(branch: string): string {
  return branch.replace(/^feature\//, "").replace(/[^a-zA-Z0-9-_]/g, "-");
}

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
          "Build a scoped context pack for a task/domain/feature/branch. Returns learned feature knowledge, branch context, and PR metadata separately.",
        inputSchema: {
          type: "object",
          properties: {
            domain: { type: "string" },
            feature: { type: "string" },
            branch: { type: "string" },
            taskType: { type: "string" },
            includeDraft: { type: "boolean" },
            limit: { type: "number" },
            forceRefresh: {
              type: "boolean",
              description: "Re-run learn_feature to update feature knowledge",
            },
            summarizePR: {
              type: "boolean",
              description:
                "Return PR metadata as summaries instead of full content",
            },
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
        name: "learn_feature",
        description:
          "Save feature knowledge to the RAG DB. If agentContent is provided (recommended), it is stored directly as the feature's understanding — the agent should investigate the source code itself and pass its findings here. If agentContent is omitted, falls back to git-commit-based inference.",
        inputSchema: {
          type: "object",
          properties: {
            featureBranch: {
              type: "string",
              description: "e.g. feature/messaging",
            },
            baseBranch: { type: "string" },
            limit: { type: "number" },
            agentContent: {
              type: "string",
              description:
                "Plain-text description of what the feature does, written by the agent after reading actual source files. When provided, this becomes the stored knowledge (confidence 0.95) and git metadata is appended as supporting context.",
            },
          },
          required: ["featureBranch"],
        },
      },
      {
        name: "sync_feature_knowledge",
        description:
          "Update the AI knowledge for a feature branch using new commits and PR decisions since the last sync. Bootstraps automatically if no prior knowledge exists.",
        inputSchema: {
          type: "object",
          properties: {
            featureBranch: { type: "string" },
            baseBranch: { type: "string" },
            owner: { type: "string" },
            repo: { type: "string" },
            limit: { type: "number" },
          },
          required: ["featureBranch"],
        },
      },
      {
        name: "get_feature_resume",
        description:
          "Combine learned feature knowledge with PR metadata and return as markdown. Does NOT require a git worktree. Use this to review a feature's complete context: what we learned about it + related PR activity.",
        inputSchema: {
          type: "object",
          properties: {
            feature: {
              type: "string",
              description: "e.g. messaging",
            },
            domain: { type: "string" },
            limit: { type: "number" },
          },
          required: ["feature"],
        },
      },
      {
        name: "list_learned_features",
        description:
          "List all learned features stored in the knowledge database with confidence levels and timestamps.",
        inputSchema: {
          type: "object",
          properties: {
            domain: { type: "string" },
            status: {
              type: "string",
              description:
                "Filter by status (promoted, draft, etc). Defaults to promoted.",
            },
          },
          required: [],
        },
      },
      {
        name: "list_available_branches",
        description:
          "List all available branches and features with knowledge context available for each.",
        inputSchema: {
          type: "object",
          properties: {
            domain: { type: "string" },
            feature: { type: "string" },
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
      const forceRefresh = Boolean(request.params.arguments?.forceRefresh);
      const summarizePR = Boolean(request.params.arguments?.summarizePR);

      const db = openDatabase(dbPath);
      try {
        const pack = buildContextPack(db, {
          domain: domain || undefined,
          feature: feature || undefined,
          branch: branch || undefined,
          taskType,
          includeDraft,
          limit: Number.isFinite(limit) && limit > 0 ? limit : 20,
          forceRefresh,
          summarizePR,
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

    if (request.params.name === "get_feature_resume") {
      const feature = String(request.params.arguments?.feature ?? "").trim();
      const domain = String(request.params.arguments?.domain ?? "").trim();
      const limit = Number(
        (request.params.arguments?.limit as number | undefined) ?? 20,
      );

      if (!feature) {
        return {
          content: [{ type: "text", text: "feature parameter is required" }],
          isError: true,
        };
      }

      const db = openDatabase(dbPath);
      try {
        const resume = getFeatureResume(db, {
          feature,
          domain: domain || undefined,
          limit: Number.isFinite(limit) && limit > 0 ? limit : 20,
        });

        return {
          content: [{ type: "text", text: resume }],
        };
      } finally {
        db.close();
      }
    }

    if (request.params.name === "list_learned_features") {
      const domain = String(request.params.arguments?.domain ?? "").trim();
      const status = String(request.params.arguments?.status ?? "").trim();

      const db = openDatabase(dbPath);
      try {
        const features = listLearnedFeatures(db, {
          domain: domain || undefined,
          status: status || undefined,
        });

        const markdown = [
          "# Learned Features",
          "",
          features.length === 0
            ? "*(No learned features yet)*"
            : `${features.length} feature(s) available:`,
          "",
        ];

        if (features.length > 0) {
          markdown.push(
            "| Feature | Domain | Branch | Confidence | Status | Last Updated |",
          );
          markdown.push(
            "|---------|--------|--------|------------|--------|--------------|",
          );

          for (const feat of features) {
            const confidence = (feat.confidence * 100).toFixed(0);
            const lastUpdated = new Date(feat.updatedAt).toLocaleDateString();
            markdown.push(
              `| **${feat.feature}** | ${feat.domain} | ${feat.branch} | ${confidence}% | ${feat.status} | ${lastUpdated} |`,
            );
          }

          markdown.push("");
          markdown.push("## Feature Details");
          markdown.push("");

          for (const feat of features) {
            markdown.push(`### ${feat.feature}`);
            markdown.push(`- **Confidence:** ${(feat.confidence * 100).toFixed(0)}%`);
            markdown.push(`- **Domain:** ${feat.domain}`);
            markdown.push(`- **Branch:** ${feat.branch}`);
            markdown.push(`- **Status:** ${feat.status}`);
            markdown.push(`- **Created:** ${new Date(feat.createdAt).toLocaleString()}`);
            markdown.push(`- **Updated:** ${new Date(feat.updatedAt).toLocaleString()}`);
            markdown.push(`- **Title:** ${feat.title}`);
            markdown.push(`- **Content size:** ${feat.contentLength} bytes`);
            markdown.push("");
          }
        }

        return {
          content: [{ type: "text", text: markdown.join("\n") }],
        };
      } finally {
        db.close();
      }
    }

    if (request.params.name === "list_available_branches") {
      const domain = String(request.params.arguments?.domain ?? "").trim();
      const feature = String(request.params.arguments?.feature ?? "").trim();

      const db = openDatabase(dbPath);
      try {
        const branches = listAvailableBranches(db, {
          domain: domain || undefined,
          feature: feature || undefined,
        });

        const markdown = [
          "# Available Branches and Features",
          "",
          branches.length === 0
            ? "*(No branches with knowledge available)*"
            : `${branches.length} branch/feature combination(s):`,
          "",
        ];

        if (branches.length > 0) {
          markdown.push(
            "| Branch | Feature | Domain | Facts | Confidence | Last Updated |",
          );
          markdown.push(
            "|--------|---------|--------|-------|------------|--------------|",
          );

          for (const branch of branches) {
            const confidence = (branch.topConfidence * 100).toFixed(0);
            const lastUpdated = new Date(branch.lastUpdated).toLocaleDateString();
            markdown.push(
              `| **${branch.branch}** | ${branch.feature} | ${branch.domain} | ${branch.factCount} | ${confidence}% | ${lastUpdated} |`,
            );
          }

          markdown.push("");
          markdown.push("## Branch Details");
          markdown.push("");

          for (const branch of branches) {
            markdown.push(`### ${branch.branch} (${branch.feature})`);
            markdown.push(`- **Domain:** ${branch.domain}`);
            markdown.push(`- **Facts stored:** ${branch.factCount}`);
            markdown.push(`- **Top confidence:** ${(branch.topConfidence * 100).toFixed(0)}%`);
            markdown.push(`- **Last updated:** ${new Date(branch.lastUpdated).toLocaleString()}`);
            markdown.push("");
          }
        }

        return {
          content: [{ type: "text", text: markdown.join("\n") }],
        };
      } finally {
        db.close();
      }
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

    if (request.params.name === "learn_feature") {
      const featureBranch = String(
        request.params.arguments?.featureBranch ?? "",
      ).trim();
      const baseBranch =
        String(request.params.arguments?.baseBranch ?? "").trim() || "main";
      const limit = Number(
        (request.params.arguments?.limit as number | undefined) ?? 50,
      );
      const agentContent =
        String(request.params.arguments?.agentContent ?? "").trim() || null;

      if (!featureBranch) {
        return {
          content: [{ type: "text", text: "featureBranch is required" }],
          isError: true,
        };
      }

      const featureName = normalizeFeatureName(featureBranch);
      const data = extractFeatureBranchCommits({
        repoPath,
        featureBranch,
        baseBranch,
        limit: Number.isFinite(limit) && limit > 0 ? limit : 50,
      });

      const authors = [...new Set(data.commits.map((c) => c.author))].join(
        ", ",
      );
      const now = new Date().toISOString();

      let content: string;
      let confidence: number;
      let aiGenerated: boolean;

      if (agentContent) {
        // Agent investigated the source code directly — highest confidence.
        // Append git metadata as supporting context.
        const gitMeta = [
          ``,
          `--- Git metadata (${data.commits.length} commits, authors: ${authors || "unknown"}) ---`,
          `Top files: ${
            data.topFiles
              .slice(0, 5)
              .map((f) => f.filePath)
              .join(", ") || "(none)"
          }`,
          `Top modules: ${data.affectedModules.slice(0, 4).join(", ") || "(none)"}`,
        ].join("\n");
        content = agentContent + gitMeta;
        confidence = 0.95;
        aiGenerated = true;
      } else {
        // Fallback: infer from git commits + optional Ollama synthesis.
        const fileList = data.topFiles
          .map((f) => `  - ${f.filePath} (touched ${f.touchCount}x)`)
          .join("\n");
        const commitList = data.commits
          .slice(0, 20)
          .map((c) => `  - ${c.subject} (${c.author})`)
          .join("\n");

        const prompt = [
          `You are analyzing a Git feature branch called "${featureBranch}".`,
          ``,
          `Top changed files:`,
          fileList || "  (none)",
          ``,
          `Commit history (most recent first):`,
          commitList || "  (none)",
          ``,
          `Answer in 3-5 sentences:`,
          `1. What does this feature do?`,
          `2. What modules/areas of the codebase does it affect?`,
          `3. What does it NOT do or what is explicitly out of scope?`,
        ].join("\n");

        const llmSummary = await callOllamaLlm(prompt);
        const fallbackSummary = [
          `Feature "${featureName}" spans ${data.commits.length} commit(s) by ${authors || "(unknown)"}.`,
          `Top modules: ${data.affectedModules.slice(0, 4).join(", ") || "(unknown)"}.`,
          `Top files: ${
            data.topFiles
              .slice(0, 3)
              .map((f) => f.filePath)
              .join(", ") || "(none)"
          }.`,
          `Commit subjects: ${data.commits
            .slice(0, 5)
            .map((c) => c.subject)
            .join("; ")}.`,
        ].join(" ");

        content = llmSummary ?? fallbackSummary;
        confidence = llmSummary ? 0.85 : 0.6;
        aiGenerated = llmSummary !== null;
      }

      const db = openDatabase(dbPath);
      try {
        upsertContextFact(db, {
          id: `feature-knowledge:${featureName}`,
          sourceType: "feature-agent",
          sourceRef: featureBranch,
          domain: "",
          feature: featureName,
          branch: featureBranch,
          taskType: "feature-knowledge",
          title: `Feature knowledge: ${featureName}`,
          content,
          priority: 0.9,
          confidence,
          status: "promoted",
          createdAt: now,
          updatedAt: now,
        });
      } finally {
        db.close();
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                featureName,
                learned: content,
                filesAnalyzed: data.topFiles.length,
                commitsAnalyzed: data.commits.length,
                agentProvided: agentContent !== null,
                aiGenerated,
                confidence,
                savedAt: now,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    if (request.params.name === "sync_feature_knowledge") {
      const featureBranch = String(
        request.params.arguments?.featureBranch ?? "",
      ).trim();
      const baseBranch =
        String(request.params.arguments?.baseBranch ?? "").trim() || "main";
      const owner = String(request.params.arguments?.owner ?? "").trim();
      const repo = String(request.params.arguments?.repo ?? "").trim();
      const limit = Number(
        (request.params.arguments?.limit as number | undefined) ?? 50,
      );

      if (!featureBranch) {
        return {
          content: [{ type: "text", text: "featureBranch is required" }],
          isError: true,
        };
      }

      const featureName = normalizeFeatureName(featureBranch);
      const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;

      // Load existing knowledge from DB
      let existingKnowledge: string | null = null;
      let existingUpdatedAt: string | null = null;
      let existingCreatedAt: string | null = null;

      const dbRead = openDatabase(dbPath);
      try {
        const existing = dbRead
          .prepare(
            "SELECT content, created_at, updated_at FROM context_facts WHERE id = ? LIMIT 1",
          )
          .get(`feature-knowledge:${featureName}`) as
          | { content: string; created_at: string; updated_at: string }
          | undefined;
        existingKnowledge = existing?.content ?? null;
        existingUpdatedAt = existing?.updated_at ?? null;
        existingCreatedAt = existing?.created_at ?? null;
      } finally {
        dbRead.close();
      }

      // Bootstrap via learn_feature logic if no prior knowledge
      if (!existingKnowledge) {
        const bootData = extractFeatureBranchCommits({
          repoPath,
          featureBranch,
          baseBranch,
          limit: safeLimit,
        });
        const bootFileList = bootData.topFiles
          .map((f) => `  - ${f.filePath} (touched ${f.touchCount}x)`)
          .join("\n");
        const bootCommitList = bootData.commits
          .slice(0, 20)
          .map((c) => `  - ${c.subject} (${c.author})`)
          .join("\n");
        const bootPrompt = [
          `You are analyzing a Git feature branch called "${featureBranch}".`,
          `Top changed files:\n${bootFileList || "  (none)"}`,
          `Commit history:\n${bootCommitList || "  (none)"}`,
          `Answer in 3-5 sentences: 1. What does this feature do? 2. What modules does it affect? 3. What is out of scope?`,
        ].join("\n\n");
        const bootLlm = await callOllamaLlm(bootPrompt);
        existingKnowledge =
          bootLlm ??
          `Feature "${featureName}" has ${bootData.commits.length} commit(s). Top modules: ${
            bootData.affectedModules.slice(0, 4).join(", ") || "(unknown)"
          }.`;
        const now = new Date().toISOString();
        const dbBoot = openDatabase(dbPath);
        try {
          upsertContextFact(dbBoot, {
            id: `feature-knowledge:${featureName}`,
            sourceType: "feature-agent",
            sourceRef: featureBranch,
            domain: "",
            feature: featureName,
            branch: featureBranch,
            taskType: "feature-knowledge",
            title: `Feature knowledge: ${featureName}`,
            content: existingKnowledge,
            priority: 0.9,
            confidence: bootLlm ? 0.85 : 0.6,
            status: "promoted",
            createdAt: now,
            updatedAt: now,
          });
        } finally {
          dbBoot.close();
        }
        existingUpdatedAt = now;
        existingCreatedAt = now;
      }

      // Fetch remote and extract commits
      fetchRemote(repoPath);
      const data = extractFeatureBranchCommits({
        repoPath,
        featureBranch,
        baseBranch,
        limit: safeLimit,
      });

      // Only process commits newer than last sync
      const newCommits = existingUpdatedAt
        ? data.commits.filter((c) => c.date > (existingUpdatedAt as string))
        : data.commits;

      // Gather PR decisions for referenced PRs in new commits
      const referencedPrNumbers = newCommits
        .map((c) => detectReferencedPrNumber(c.subject))
        .filter((n): n is number => n !== null);

      let prDecisionsSummary = "";
      if (referencedPrNumbers.length > 0) {
        const dbPr = openDatabase(dbPath);
        try {
          const parts: string[] = [];
          for (const prNum of referencedPrNumbers.slice(0, 5)) {
            const { pr, decisions } = loadPullRequestContext(
              dbPr,
              prNum,
              owner || undefined,
              repo || undefined,
            );
            if (pr) {
              parts.push(
                `PR #${prNum} "${pr["title"]}": ${decisions
                  .slice(0, 3)
                  .map((d) => d["summary"])
                  .join("; ")}`,
              );
            }
          }
          prDecisionsSummary = parts.join("\n");
        } finally {
          dbPr.close();
        }
      }

      const newCommitList = newCommits
        .slice(0, 20)
        .map((c) => `  - ${c.subject} (${c.author})`)
        .join("\n");

      const updatePrompt = [
        `You previously documented this feature:`,
        `"${existingKnowledge}"`,
        ``,
        `New commits since last sync:`,
        newCommitList || "  (no new commits)",
        prDecisionsSummary ? `\nPR decisions:\n${prDecisionsSummary}` : "",
        ``,
        `Write an updated 3-5 sentence understanding of the feature. If nothing changed, return the previous text unchanged.`,
      ].join("\n");

      const updatedSummary =
        newCommits.length > 0
          ? ((await callOllamaLlm(updatePrompt)) ?? existingKnowledge)
          : existingKnowledge;

      const now = new Date().toISOString();
      const dbWrite = openDatabase(dbPath);
      try {
        upsertContextFact(dbWrite, {
          id: `feature-knowledge:${featureName}`,
          sourceType: "feature-agent",
          sourceRef: featureBranch,
          domain: "",
          feature: featureName,
          branch: featureBranch,
          taskType: "feature-knowledge",
          title: `Feature knowledge: ${featureName}`,
          content: updatedSummary,
          priority: 0.9,
          confidence: 0.85,
          status: "promoted",
          createdAt: existingCreatedAt ?? now,
          updatedAt: now,
        });

        // Audit log row (status: draft — invisible to default build_context_pack)
        if (newCommits.length > 0) {
          const auditDate = now.split("T")[0] ?? now;
          upsertContextFact(dbWrite, {
            id: `feature-change-log:${featureName}:${auditDate}`,
            sourceType: "feature-agent",
            sourceRef: featureBranch,
            domain: "",
            feature: featureName,
            branch: featureBranch,
            taskType: "change-log",
            title: `Change log: ${featureName} on ${auditDate}`,
            content: `New commits: ${newCommits
              .map((c) => c.subject)
              .join("; ")}. ${prDecisionsSummary}`.trim(),
            priority: 0.7,
            confidence: 0.8,
            status: "draft",
            createdAt: now,
            updatedAt: now,
          });
        }
      } finally {
        dbWrite.close();
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                featureName,
                previousKnowledge: existingKnowledge,
                updatedKnowledge: updatedSummary,
                newCommitsAnalyzed: newCommits.length,
                totalCommitsInBranch: data.commits.length,
                syncedAt: now,
              },
              null,
              2,
            ),
          },
        ],
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
