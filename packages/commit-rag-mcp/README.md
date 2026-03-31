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

### Find ownership for a file

```text
who_changed_this({
  filePath: "src/features/auth/session.ts",
  limit: 15
})
```

Use this to discover recent authors and commit history for a target file.

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
