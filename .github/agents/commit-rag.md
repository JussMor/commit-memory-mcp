# Commit Memory Agent

A worktree-aware PR intelligence agent for async teams.

## Purpose

The agent answers three operational questions before planning:

1. Who changed this area?
2. Why was this change made?
3. What landed on main while my feature session was inactive?

## Current MCP Tools

### `sync_pr_context`

Syncs PR description, comments, and reviews from GitHub (via `gh`) into local SQLite context.

### `list_active_worktrees`

Lists active git worktrees and records worktree session checkpoints.

### `who_changed_this`

Shows recent commit authors and commit summaries for a target file.

### `why_was_this_changed`

Explains commit intent by combining commit metadata and synced PR decision context.

### `get_main_branch_overnight_brief`

Summarizes recent commits on `origin/main` (or custom base branch) from the selected time window.

### `resume_feature_session_brief`

Reports feature branch divergence (`ahead/behind`) and overlap risk files against base branch.

### `pre_plan_sync_brief`

Runs sync + overnight + resume analysis and returns an action-first brief before implementation planning.

## Removed Legacy Tools (Breaking Change)

The following tools are removed and must not be referenced in prompts/workflows:

- `search_related_commits`
- `explain_commit_match`
- `get_commit_diff`
- `reindex_commits`

## Source-of-Truth Policy

1. PR description is canonical for feature-level "why".
2. Comments and reviews are discussion; only promoted Decision/Blocker records are used as durable context.
3. Commit metadata remains atomic context for file-level change tracing.

## Async Team Workflow

1. Run `pre_plan_sync_brief` before generating plans.
2. Review blocker-level decisions first.
3. Resolve overlap files before widening feature scope.
4. Re-run `resume_feature_session_brief` after rebases or major merges.
