---
description: "Commit Memory MCP system with PR intelligence and worktree-aware async planning"
---

# Maxwell Clinic AI Agents for GitHub Copilot

This repository uses a worktree-aware Commit Memory MCP server.

## Current Agent Focus

The active agent is optimized for async team handoffs and feature resume workflows.

## Current MCP Tools

- `sync_pr_context`
- `list_active_worktrees`
- `who_changed_this`
- `why_was_this_changed`
- `get_main_branch_overnight_brief`
- `resume_feature_session_brief`
- `pre_plan_sync_brief`
- `learn_feature`
- `sync_feature_knowledge`

## Removed Tools (Breaking Change)

Do not call these old tools:

- `search_related_commits`
- `explain_commit_match`
- `get_commit_diff`
- `reindex_commits`

## Required Workflow for Planning

Before generating implementation plans, run `pre_plan_sync_brief`.

This enforces:

1. PR context sync from GitHub.
2. Overnight main-branch change awareness.
3. Branch divergence and overlap-risk visibility.

## Source-of-Truth Rules

1. PR description is canonical for feature-level intent.
2. Review comments are discussion unless promoted as Decision/Blocker context.
3. Commit metadata is atomic and file-focused evidence.

## GitHub Access Notes

Git alone cannot read PR descriptions/comments.
Use:

- `gh pr view ... --json ...` (preferred in this repo)
- or GitHub API with token

## Environment

Required for sync features:

- `gh` CLI authenticated for repository access
- `COMMIT_RAG_REPO`
- `COMMIT_RAG_DB`

Optional:

- `COMMIT_RAG_LIMIT`
- `OLLAMA_BASE_URL`
- `OLLAMA_EMBED_MODEL`

## Async Team Best Practice

1. Start session with `pre_plan_sync_brief`.
2. Review blocker decisions before coding.
3. Re-run `resume_feature_session_brief` after rebasing or major merges.
