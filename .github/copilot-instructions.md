---
description: "Commit Memory MCP system with current tool surface and source-of-truth guidance"
---

# Maxwell Clinic AI Agents for GitHub Copilot

This repository uses a worktree-aware Commit Memory MCP server backed by SurrealDB.

## Source Of Truth (Read This First)

When tool names or behavior disagree between docs:

1. Treat `packages/commit-rag-mcp/src/tools/index.ts` as canonical for available MCP tools.
2. Treat `README.md` as canonical for workflow intent and usage guidance.
3. If these diverge, prefer the latest implementation in code and explicitly call out the mismatch.

## Current Agent Focus

The active agent is optimized for pre-planning sync, PR-derived knowledge retrieval, and traceability across files/commits/PR intent.

## Current MCP Tools (Implemented)

These are the currently implemented tools exposed by this repo's MCP server:

- `pre_plan_sync_brief`
- `ingest_prs`
- `promote_context_facts`
- `get_module_context`
- `get_module_graph`
- `get_chunk_history`
- `who_changed_this`
- `why_was_this_changed`
- `compact_stale_knowledge`
- `start_research`
- `get_research_status`
- `execute_research_step`
- `get_research_result`
- `promote_research_findings`

## Required Workflow For Planning

Before generating implementation plans, run `pre_plan_sync_brief`.

This enforces fresh context retrieval before coding.

## Tool Intent Quick Guide

- `pre_plan_sync_brief`: Run first; creates an async research session for overnight sync + module brief. Returns a session ID immediately.
- `ingest_prs`: Bulk ingest newly merged PRs into graph/memory.
- `promote_context_facts`: Human-in-the-loop promotion of draft facts.
- `get_module_context`: Primary retrieval API for module context, with optional semantic query.
- `get_module_graph`: Module relationships and blast-radius context.
- `get_chunk_history`: Historical lineage of extracted module knowledge.
- `who_changed_this`: Ownership/recent authorship for a file path.
- `why_was_this_changed`: Trace file/commit intent back to PR/business context.
- `compact_stale_knowledge`: Smart forgetting — archives stale facts, merges overlapping ones, deletes old knowledge versions. Use `dry_run=true` to preview.
- `start_research`: Create a multi-step async research session. Returns session ID for polling.
- `get_research_status`: Check step-by-step progress of a research session.
- `execute_research_step`: Advance the next pending step in a research session (agent-facing).
- `get_research_result`: Retrieve the final assembled answer from a completed research session.
- `promote_research_findings`: Promote research findings to permanent knowledge after dev review.

## Legacy Name Mapping (Use For Migration Only)

Some docs and older prompts may still use previous names. Map them as follows:

- `search_module_context` -> `get_module_context`
- `extract_business_facts` -> `ingest_prs` + `promote_context_facts` (workflow replacement)
- `get_main_branch_overnight_brief` -> `pre_plan_sync_brief` (current entrypoint)
- `get_latest_module_knowledge` -> use `get_module_context` and parse latest knowledge section
- `get_knowledge_lineage` -> `get_chunk_history`

## Behavioral Guardrails

1. Never assume a tool exists because of stale docs; verify against `src/tools/index.ts`.
2. If a user references a legacy name, translate it to the current tool and proceed.
3. If ambiguity remains, ask one concise clarifying question.
4. Keep recommendations aligned with the currently exported tools only.
