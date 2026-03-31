# @jussmor/commit-memory-mcp

A local MCP server for PR intelligence, author tracing, and worktree-aware async planning.

## Purpose

This package helps agents answer:

- who changed a file or area
- why a change was made
- what landed on main recently
- what context should be reviewed before planning

## Current MCP tools

- `sync_pr_context`
- `build_context_pack`
- `promote_context_facts`
- `archive_feature_context`
- `list_active_worktrees`
- `who_changed_this`
- `why_was_this_changed`
- `get_main_branch_overnight_brief`
- `resume_feature_session_brief`
- `pre_plan_sync_brief`

## Removed tools

The following legacy tools were removed:

- `search_related_commits`
- `explain_commit_match`
- `get_commit_diff`
- `reindex_commits`

## Quick start

```bash
npm install @jussmor/commit-memory-mcp
npx commit-memory-mcp
```

For local development in this repository:

```bash
cd packages/commit-rag-mcp
npm install
npm run build
node dist/mcp/server.js
```

## Requirements

- Node.js 20+
- `gh` CLI authenticated for GitHub PR sync features
- a git repository available through `COMMIT_RAG_REPO`

## Environment variables

- `COMMIT_RAG_REPO` repository path used by the MCP server
- `COMMIT_RAG_DB` SQLite database path
- `COMMIT_RAG_LIMIT` default sync/query limit
- `OLLAMA_BASE_URL` optional Ollama base URL
- `OLLAMA_EMBED_MODEL` optional embedding model
- `COPILOT_TOKEN` optional Copilot reranking token
- `COPILOT_MODEL` optional Copilot model override
- `COPILOT_BASE_URL` optional Copilot API base URL

## Use cases

### Sync GitHub PR context

```text
sync_pr_context({
  owner: "MaxwellClinic-Development",
  repo: "EverBetter-Pro",
  domain: "billing",
  feature: "invoice-retry",
  branch: "feat/invoice-retry",
  taskType: "planning",
  limit: 20
})
```

Use this before planning when you need fresh PR descriptions, comments, and reviews.

### List active worktrees

```text
list_active_worktrees({
  baseBranch: "main"
})
```

Use this when your team works on multiple features in parallel and wants session-aware context.

### Build a scoped context pack

```text
build_context_pack({
  domain: "billing",
  feature: "invoice-retry",
  branch: "feat/invoice-retry",
  taskType: "coding",
  includeDraft: false,
  limit: 12
})
```

Use this before invoking a coding subagent to keep prompts small and focused.
The pack is assembled main-first: promoted facts on `main` are treated as baseline truth, then branch/feature facts are added as in-flight overlay.
If no rows are found in strict scope, the server falls back automatically to broader scope levels.

Important: if you provide `domain`/`feature`/`branch` tags in `build_context_pack`, use the same tags during `sync_pr_context` for best precision.

### Promote draft facts after review

```text
promote_context_facts({
  domain: "billing",
  feature: "invoice-retry",
  branch: "feat/invoice-retry"
})
```

Use this when discussion outcomes are approved and should become durable context.

### Archive completed feature context

```text
archive_feature_context({
  domain: "billing",
  feature: "invoice-retry"
})
```

Use this after merge/closure to prevent active context bloat.

### Find ownership for a file

```text
who_changed_this({
  filePath: "src/features/auth/session.ts",
  limit: 15
})
```

Use this to discover recent authors and commit history for a target file.

### Explain what is happening in a Next.js folder

```text
explain_path_activity({
  targetPath: "app/dashboard",
  owner: "MaxwellClinic-Development",
  repo: "EverBetter-Pro",
  limit: 30
})
```

Use this when you want a fast folder-level summary for areas like `app/dashboard`, `app/(authenticated)`, or `src/components`.
It returns recent commits, top authors, most touched files, and related PR context/decisions when available.

### Explain intent for a change

```text
why_was_this_changed({
  filePath: "src/features/auth/session.ts",
  owner: "MaxwellClinic-Development",
  repo: "EverBetter-Pro"
})
```

Use this to combine commit metadata with synced PR context.

### Get an overnight main-branch brief

```text
get_main_branch_overnight_brief({
  baseBranch: "main",
  sinceHours: 12,
  limit: 25
})
```

Use this at the start of the day to review what landed while you were offline.

### Resume a feature worktree

```text
resume_feature_session_brief({
  worktreePath: "/path/to/worktree",
  baseBranch: "main"
})
```

Use this before resuming unfinished work in a separate worktree.

### Run the full pre-plan sync flow

```text
pre_plan_sync_brief({
  owner: "MaxwellClinic-Development",
  repo: "EverBetter-Pro",
  baseBranch: "main",
  worktreePath: "/path/to/worktree",
  sinceHours: 12,
  limit: 25
})
```

Use this as the default entrypoint for async team planning.

## Multi-session git worktree flow

For parallel AI coding sessions:

1. Create one git worktree per feature branch.
2. Use `list_active_worktrees` to enumerate active sessions.
3. Use `resume_feature_session_brief` per worktree to check divergence and overlap risks.
4. Generate a worktree-specific `build_context_pack` and hand it to the target subagent.

This pattern avoids one giant shared context and scales better as features grow.

## Data model overview

The package stores local context for:

- commits
- pull requests
- PR comments
- PR reviews
- promoted decision/blocker summaries
- worktree session checkpoints

## Publishing

```bash
npm run build
npm publish --access public
```

For MCP Registry publication, keep `package.json` `mcpName` and `server.json` `name` aligned.
