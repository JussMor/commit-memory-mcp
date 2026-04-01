# AI Plans

Worktree-aware MCP context system for engineering teams using GitHub + SurrealDB.

## Why this exists

Teams lose important context between commits, PRs, and planning sessions. This project keeps that context queryable so agents and engineers can answer:

- what changed
- why it changed
- what matters before starting work
- which business decisions are already known

## What this does

This MCP server combines:

- git history for file-level traceability
- GitHub PR metadata (title/body/files/labels/commits)
- SurrealDB storage for structured facts and memory chunks
- semantic + keyword retrieval for focused context packs
- worktree awareness for parallel feature sessions

## Current MCP tools

- `sync_pr_context`
- `ingest_pr`
- `extract_business_facts`
- `search_module_context`
- `get_module_overview`
- `get_latest_module_knowledge`
- `get_knowledge_lineage`
- `get_module_graph`
- `promote_context_facts`
- `list_active_worktrees`
- `who_changed_this`
- `why_was_this_changed`
- `get_main_branch_overnight_brief`
- `pre_plan_sync_brief`

Experimental:

- `ingest_current_knowledge_demo`

## Tool guide: what, why, when

### `sync_pr_context`

What it does:
Syncs recent PR metadata from GitHub into local context.

Why it exists:
Traceability tools are weak if PR context is stale.

When useful:
Start of session, after merges, before planning.

### `ingest_pr`

What it does:
Ingests one specific PR with full details.

Why it exists:
Targeted ingestion avoids waiting for broad syncs.

When useful:
You want immediate context for one PR.

### `extract_business_facts`

What it does:
Extracts module-level business facts and raw memory chunks from PR content.

Why it exists:
PRs contain decisions that should be reusable for future work.

When useful:
After ingesting a PR or before promoting decisions.

Also updates:
It now refreshes versioned `knowledge_note` entries (source type `business_fact_auto`) so investigation memory stays current after new PR evidence is extracted.

### `ingest_current_knowledge_demo` (experimental)

What it does:
Ingests AI investigation output for a route/feature/topic into versioned knowledge notes with tag `demo`.

Why it exists:
You can save findings from ad-hoc analysis and keep them linked, queryable, and updateable instead of losing them in chat history.

When useful:
After asking an agent about route coupling, feature dependencies, or architecture links.

Latest + lineage behavior:

- one note per module/topic is marked `is_latest = true`
- updates create versions and connect through `supersedes`
- same-content updates refresh timestamp/tags instead of creating noise

### `search_module_context`

What it does:
Builds a ranked, hybrid-retrieval context pack for a module and query.

Why it exists:
Agents should get bounded, relevant context instead of full history.

When useful:
Before coding, debugging, or planning tasks.

### `get_module_overview`

What it does:
Returns a complete module snapshot: promoted facts, memory chunks, recent PRs, and latest knowledge notes.

Why it exists:
Gives a complete memory snapshot before making decisions.

When useful:
Discovery, onboarding, or feature handoff.

### `get_latest_module_knowledge`

What it does:
Returns only `is_latest = true` knowledge notes for a module, optionally filtered by exact topic.

Why it exists:
When you are saving versioned investigation notes, agents need a direct way to fetch current truth without scanning full module snapshots.

When useful:
After `ingest_current_knowledge_demo`, before prompting subagents, and when validating that the latest version was refreshed.

### `get_knowledge_lineage`

What it does:
Returns the selected latest knowledge note and walks its `supersedes` chain to show older versions.

Why it exists:
Latest-only retrieval is useful for execution, but debugging and audits need the change history behind current truth.

When useful:
Reviewing how investigation conclusions evolved over time, or validating version transitions after repeated ingests.

### `get_module_graph`

What it does:
Returns graph relationships around a module.

Why it exists:
Dependencies and impact are easier to reason about as relationships.

When useful:
Impact analysis before edits and release risk checks.

### `promote_context_facts`

What it does:
Promotes draft facts to promoted status.

Why it exists:
Keeps unreviewed extraction separate from trusted context.

When useful:
After review/approval of extracted facts.

### `list_active_worktrees`

What it does:
Lists active git worktrees.

Why it exists:
Parallel sessions need visibility to avoid branch confusion.

When useful:
Switching tasks, coordinating multiple feature branches.

### `who_changed_this`

What it does:
Shows who recently changed a file and related commits.

Why it exists:
Speeds ownership and reviewer discovery.

When useful:
Debugging regressions, picking reviewers, understanding ownership.

### `why_was_this_changed`

What it does:
Explains intent by combining git history with PR/business context.

Why it exists:
Commit messages alone rarely capture feature-level rationale.

When useful:
Refactors, bug triage, and legacy code archaeology.

### `get_main_branch_overnight_brief`

What it does:
Summarizes what merged recently on main.

Why it exists:
Daily awareness reduces merge/rebase surprises.

When useful:
Start-of-day sync and pre-rebase checks.

### `pre_plan_sync_brief`

What it does:
Generates one pre-planning brief combining fresh context and module memory.

Why it exists:
Prevents planning from stale or incomplete information.

When useful:
Always run this before implementation planning.

## Recommended usage flow

1. `pre_plan_sync_brief`
2. `sync_pr_context` if needed
3. `ingest_pr` for important PRs
4. `extract_business_facts`
5. `promote_context_facts` after review
6. `search_module_context` before coding

## Quick start

```bash
npm install
cd packages/commit-rag-mcp
npm run build
```

Requirements:

- Node.js 20+
- GitHub CLI authenticated (`gh auth status`)
- SurrealDB endpoint configured in MCP env

## Architecture

```text
GitHub Copilot / MCP Client
          |
          v
 commit-memory-mcp-surreal
          |
          +-- git history
          +-- GitHub PR metadata via gh
          +-- SurrealDB document + graph + vector storage
          +-- FULLTEXT (BM25) keyword retrieval
          +-- HNSW vector retrieval
          +-- hybrid ranking + compressed agent evidence
```

## Documentation

- [SETUP.md](./SETUP.md)
- [.github/copilot-instructions.md](./.github/copilot-instructions.md)
- [packages/commit-rag-mcp/README.md](./packages/commit-rag-mcp/README.md)
