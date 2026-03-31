# Agent System

Documentation for the Maxwell Clinic AI agent stack.

## Primary Agent

The active production agent is Commit Memory (PR intelligence + worktree context).

### Key outcomes

- Identify who changed files/components.
- Explain why changes were made using PR canonical context.
- Generate async-safe start-of-day and resume-session briefs.

## Tool Contract

Current tools:

- `sync_pr_context`
- `list_active_worktrees`
- `who_changed_this`
- `why_was_this_changed`
- `get_main_branch_overnight_brief`
- `resume_feature_session_brief`
- `pre_plan_sync_brief`

Removed tools (breaking change):

- `search_related_commits`
- `explain_commit_match`
- `get_commit_diff`
- `reindex_commits`

## Required Team Workflow

1. Run `pre_plan_sync_brief` before implementation planning.
2. Resolve blocker-level decision context first.
3. Validate overlap files when feature branch is behind main.
4. Update PR description with final decisions from review discussion.

## Context Priority Rules

1. PR description (canonical)
2. Promoted decision/blocker records from comments/reviews
3. Commit metadata

## Migration Guidance

If old prompts/workflows still reference removed tools, migrate them to:

- `search_related_commits` -> `who_changed_this` + `why_was_this_changed`
- `explain_commit_match` -> `why_was_this_changed`
- `reindex_commits` -> `sync_pr_context`
- `get_commit_diff` -> use local git commands in shell when needed
