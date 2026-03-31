# AI Plans - Maxwell Clinic

A worktree-aware PR intelligence system for GitHub Copilot and async engineering teams.

## What it does

This repository provides a local MCP server that helps teams answer:

- Who changed this area?
- Why was it changed?
- What landed on main while I was away?
- What should I review before planning new work?

Instead of relying only on commit search, the current system combines:

- local git history
- GitHub PR descriptions
- GitHub PR comments and reviews
- promoted decision/blocker context
- active git worktrees for parallel feature sessions

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

## Breaking change

These old tools were removed:

- `search_related_commits`
- `explain_commit_match`
- `get_commit_diff`
- `reindex_commits`

See [.github/copilot-instructions.md](./.github/copilot-instructions.md) for the current workflow contract.

## Why this exists

Async teams lose context in three places:

1. Commit messages describe a small change but not the final feature decision.
2. PR comments contain important discussion, but they are noisy and hard to recover later.
3. Engineers switch branches and worktrees and need a fast "what changed while I was sleeping" brief before planning.

This project makes PR description the canonical feature narrative, treats review discussion as secondary evidence, and produces a pre-plan sync brief before implementation starts.

## Quick start

### 1. Install and build

```bash
npm install
cd packages/commit-rag-mcp
npm run build
```

### 2. Configure MCP in VS Code

The workspace already includes [mcp.json](./mcp.json).

Reload VS Code and enable the `commit-memory-mcp` server in the MCP tools panel.

### 3. Authenticate GitHub CLI

```bash
gh auth status
```

If `gh` is not authenticated, PR sync tools cannot fetch PR descriptions/comments/reviews.

### 4. Start with the pre-plan brief

Ask Copilot to run:

```text
Run pre_plan_sync_brief for MaxwellClinic-Development/EverBetter-Pro
```

Or invoke the tool directly through MCP.

## Recommended team workflow

1. Start every coding session with `pre_plan_sync_brief`.
2. Review blocker-level decisions before making code changes.
3. Check `resume_feature_session_brief` after rebases or major merges.
4. Keep PR descriptions updated with final decisions from review threads.

## Context partition flow

To avoid oversized prompts as features grow, keep changing context in scoped partitions:

1. Sync context with `sync_pr_context` using domain/feature/branch/task metadata.
2. Keep non-final discussion as `draft` facts.
3. Promote approved facts with `promote_context_facts`.
4. Build small task-focused packs using `build_context_pack`.
5. Archive completed feature context with `archive_feature_context`.

This keeps agents thin and gives subagents only the context slice they need.

## Git worktree for multiple AI coding sessions

`git worktree` lets your team run parallel AI coding sessions without branch collisions.

Typical pattern:

1. Create one worktree per feature/session.
2. Run `list_active_worktrees` to discover all active sessions.
3. Run `resume_feature_session_brief` inside the target worktree.
4. Run `build_context_pack` for that feature/task before handing work to a subagent.

This allows multiple subagents to work concurrently with scoped context instead of one large global prompt.

## Use cases

### 1. Start-of-day sync

Problem:
You were offline overnight and want to know what changed on `main` before continuing work.

Use:

```text
Run get_main_branch_overnight_brief for main in the last 12 hours
```

Outcome:
You get a compact author/date/subject summary of recent main-branch commits.

### 2. Resume an unfinished feature in another worktree

Problem:
You have multiple features open in different git worktrees and need to know whether your branch is behind or colliding with main.

Use:

```text
Run resume_feature_session_brief for this worktree against main
```

Outcome:
You get branch divergence and overlapping file risk before you start planning or rebasing.

### 3. Understand who changed a file recently

Problem:
A file is behaving differently and you want the likely authors and recent commits.

Use:

```text
Run who_changed_this for src/features/auth/session.ts
```

Outcome:
You get top authors, recent commits, and a fast ownership trail.

### 4. Explain why a change was made

Problem:
A commit or file changed, but the commit alone is not enough to explain the reasoning.

Use:

```text
Run why_was_this_changed for src/features/auth/session.ts
```

Or:

```text
Run why_was_this_changed for sha abc1234
```

Outcome:
The agent combines commit metadata with synced PR description and promoted decision context.

### 5. Sync PR context before implementation planning

Problem:
Your team writes strong PR descriptions and review discussions, and you want plans to reflect that context.

Use:

```text
Run sync_pr_context for MaxwellClinic-Development/EverBetter-Pro
```

Outcome:
PR descriptions, comments, and reviews are stored locally for later author/why analysis.

### 6. One-command pre-plan briefing

Problem:
You want a single command that syncs GitHub context, checks main, checks your feature session, and tells you what to do first.

Use:

```text
Run pre_plan_sync_brief for MaxwellClinic-Development/EverBetter-Pro with baseBranch main
```

Outcome:
You get:

- PR sync status
- overnight main changes
- branch ahead/behind counts
- overlap files
- recommended first actions

### 7. Build a small context pack for a subagent

Problem:
Feature knowledge is too large for one prompt and you need a focused pack for a coding subagent.

Use:

```text
Run build_context_pack with domain billing, feature invoice-retry, branch feat/invoice-retry, taskType coding, limit 12
```

Outcome:
You get a ranked, bounded context set so the subagent receives only relevant facts.

## Architecture

```text
GitHub Copilot / MCP Client
          |
          v
 commit-memory-mcp
          |
          +-- git history
          +-- GitHub PR metadata via gh
          +-- SQLite context store
          +-- worktree session tracking
```

## Project structure

```text
packages/
  commit-rag-mcp/        MCP server and local context engine
.github/
  agents/                Agent specifications
  copilot-instructions.md
mcp.json                 Workspace MCP configuration
SETUP.md                 Setup guide
README.md                Overview and workflow guide
```

## Documentation

- [SETUP.md](./SETUP.md)
- [.github/copilot-instructions.md](./.github/copilot-instructions.md)
- [.github/agents/README.md](./.github/agents/README.md)
- [.github/agents/commit-rag.md](./.github/agents/commit-rag.md)
- [packages/commit-rag-mcp/README.md](./packages/commit-rag-mcp/README.md)

## Development notes

- Node.js 20+
- `gh` CLI is required for PR sync features
- SQLite is used as the local durable context store
- Worktree-aware planning is a first-class use case

## Next documentation step

[SETUP.md](./SETUP.md) still needs the migration and sync-before-plan update to fully match the current tool contract.
