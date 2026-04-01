---
description: "Commit Memory MCP system with PR intelligence, async team coordination, and worktree-aware planning"
---

# Maxwell Clinic AI Agents for GitHub Copilot

This repository uses a worktree-aware Commit Memory MCP server backed by SurrealDB.

## Current Agent Focus

The active agent is optimized for async team handoffs, knowledge coordination across PRs/commits/business rules, and feature resume workflows.

## Tool Taxonomy (v2.0 — Async-First)

### Sync — Pull external data in

- `sync_pr_context` — Sync PR metadata from GitHub into the knowledge store

### Ingest — Process raw data into structured knowledge

- `ingest_pr` — Ingest a single PR
- `ingest_business_facts` — Extract business facts from a PR into a module _(renamed from extract_business_facts)_
- `ingest_knowledge` — Persist session findings into versioned module knowledge _(renamed from ingest_current_knowledge_demo)_

### Catchup — Session-start awareness

- `get_overnight_brief` — What merged on main while you were away _(renamed from get_main_branch_overnight_brief)_
- `get_handoff_summary` — **NEW** Cross-module async handoff: all new PRs, facts, knowledge, worktree activity
- `pre_plan_sync_brief` — Full pre-planning sync + checks

### Query — Read-only knowledge retrieval

- `who_changed_this` — File ownership and recent authors
- `why_was_this_changed` — Intent tracing from commits to PR decisions
- `get_module_overview` — High-level module context
- `get_latest_knowledge` — Recent knowledge entries _(renamed from get_latest_module_knowledge)_
- `get_knowledge_lineage` — Version history chain
- `get_module_graph` — Module dependency graph
- `search_context` — Semantic search across facts + memory _(renamed from search_module_context)_
- `get_decision_log` — **NEW** Source of truth for team-agreed business rules
- `get_stale_knowledge` — **NEW** Detect outdated knowledge that needs re-evaluation
- `get_cross_module_impact` — **NEW** Blast radius analysis for a PR or file changes

### Team — Collaboration awareness

- `list_active_worktrees` — Active git worktrees
- `get_team_activity` — **NEW** Async standup: who committed, which modules active

### Lifecycle — Knowledge promotion and linking

- `promote_facts` — Promote draft facts to durable status _(renamed from promote_context_facts)_
- `link_modules` — **NEW** Create module→module dependency relationships
- `flag_decision` — **NEW** Mark knowledge as team decision/blocker/convention

## Removed/Renamed Tools (Breaking Changes)

Do not call these old tool names — they have been renamed:

| Old Name                          | New Name                |
| --------------------------------- | ----------------------- |
| `get_main_branch_overnight_brief` | `get_overnight_brief`   |
| `extract_business_facts`          | `ingest_business_facts` |
| `get_latest_module_knowledge`     | `get_latest_knowledge`  |
| `promote_context_facts`           | `promote_facts`         |
| `search_module_context`           | `search_context`        |
| `ingest_current_knowledge_demo`   | `ingest_knowledge`      |

Also do not call these legacy tools (removed in previous versions):

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

## Async Team Coordination Workflow

1. **Start of day**: Run `get_handoff_summary` with `since_hours: 16` to see everything that happened overnight across all modules.
2. **Before planning**: Run `pre_plan_sync_brief` to sync PR context + check for blockers.
3. **Before large PRs**: Run `get_cross_module_impact` to assess blast radius.
4. **After discoveries**: Use `ingest_knowledge` to persist findings, then `flag_decision` for team-wide rules.
5. **Periodic health check**: Run `get_stale_knowledge` to find rules that may be outdated.
6. **Team standup replacement**: `get_team_activity` shows who's working on what.

## Source-of-Truth Rules

1. PR description is canonical for feature-level intent.
2. Review comments are discussion unless promoted via `flag_decision` as Decision/Blocker context.
3. Commit metadata is atomic and file-focused evidence.
4. `get_decision_log` is the authoritative view of team-agreed business rules.

## GitHub Access Notes

Git alone cannot read PR descriptions/comments.
Use:

- `gh pr view ... --json ...` (preferred in this repo)
- or GitHub API with token

## Environment

Required for sync features:

- `SURREAL_URL` — SurrealDB WebSocket URL
- `SURREAL_USER` — SurrealDB username
- `SURREAL_PASS` — SurrealDB password
- `gh` CLI authenticated for repository access

Optional:

- `SURREAL_NS` — SurrealDB namespace (default: main)
- `SURREAL_DB` — SurrealDB database (default: main)
- `OLLAMA_BASE_URL`
- `OLLAMA_EMBED_MODEL`

## Async Team Best Practice

1. Start session with `get_handoff_summary` or `pre_plan_sync_brief`.
2. Review blocker decisions via `get_decision_log` before coding.
3. After major work, `ingest_knowledge` + `flag_decision` for team-wide rules.
4. Re-run `get_stale_knowledge` weekly to flag outdated rules.
5. Use `link_modules` to build the dependency graph as you discover relationships.

---

## Scenarios & Usage Playbooks

### Scenario 1 — "Monday Morning Catchup" (Solo dev returning after weekend)

You were offline for 2 days. You need to know what landed before you start coding.

```
1. get_handoff_summary       → since_hours: 48
2. get_overnight_brief       → repo: "owner/repo", hours: 48
3. get_decision_log          → module: "your-module"
4. pre_plan_sync_brief       → repo: "owner/repo", module: "your-module"
```

**What you learn**: Every PR that merged, new business facts, knowledge updates, who was active, and blockers to address before writing any code.

---

### Scenario 2 — "Mid-sprint Feature Planning" (Before starting a new feature)

You're about to start building a feature that touches the `scheduling` and `messaging` modules.

```
1. pre_plan_sync_brief       → repo: "owner/repo", module: "scheduling"
2. get_module_overview        → module: "scheduling"
3. get_module_overview        → module: "messaging"
4. get_module_graph           → module: "scheduling"
5. search_context             → module: "scheduling", query: "appointment slot availability"
6. get_decision_log           → module: "scheduling"
7. get_cross_module_impact    → repo: "owner/repo", file_paths: ["src/scheduling/slots.ts", "src/messaging/notify.ts"]
```

**What you learn**: Current state of both modules, existing business rules you must respect, dependencies between them, and whether your planned file changes conflict with recent PRs.

---

### Scenario 3 — "Post-PR Knowledge Capture" (After merging a significant PR)

You just merged PR #142 which changes how patient intake forms work.

```
1. ingest_pr                  → repo: "owner/repo", pr_number: 142
2. ingest_business_facts      → repo: "owner/repo", pr_number: 142, module: "intake"
3. promote_facts              → module: "intake", pr_number: 142
4. ingest_knowledge           → module: "intake", topic: "Patient intake v2 form validation",
                                 findings: "Intake forms now validate insurance fields before submission...",
                                 related_modules: ["billing", "scheduling"]
5. flag_decision              → record_id: "knowledge_note:xyz", severity: "decision",
                                 reason: "Team agreed intake validates insurance before scheduling"
6. link_modules               → from: "intake", to: "billing", relation: "affects"
```

**What you learn**: Nothing — this is about TEACHING the system. Now every future dev who queries `intake` will see these rules, and `get_decision_log` will surface the insurance validation agreement.

---

### Scenario 4 — "Debugging a Module You Don't Own" (Unfamiliar territory)

A bug was reported in `billing` module. You've never worked on it.

```
1. get_module_overview        → module: "billing"
2. get_latest_knowledge       → module: "billing"
3. get_decision_log           → module: "billing"
4. who_changed_this           → file: "src/billing/invoice.ts", repo: "owner/repo"
5. why_was_this_changed       → file: "src/billing/invoice.ts", repo: "owner/repo"
6. search_context             → module: "billing", query: "invoice calculation discount"
7. get_module_graph           → module: "billing"
```

**What you learn**: What the billing module does, what business rules exist, who owns the code, why recent changes were made, and what other modules will break if you change billing logic.

---

### Scenario 5 — "Large PR Risk Assessment" (Before opening a cross-cutting PR)

You're about to open a PR that touches files across 4 modules.

```
1. get_cross_module_impact    → repo: "owner/repo", file_paths: [
                                   "src/auth/session.ts",
                                   "src/billing/stripe.ts",
                                   "src/scheduling/calendar.ts",
                                   "src/messaging/templates.ts"
                                 ]
2. get_decision_log           → module: "auth"
3. get_decision_log           → module: "billing"
4. get_stale_knowledge        → module: "auth"
5. get_stale_knowledge        → module: "billing"
```

**What you learn**: Which business facts and knowledge notes might need updating, which modules are impacted, and whether any stale rules should be refreshed before your PR lands.

---

### Scenario 6 — "Async Standup" (Team sync without a meeting)

Your team does async standups. Each agent runs this at start of day.

```
1. get_team_activity          → repo: "owner/repo", since_hours: 24
2. get_handoff_summary        → since_hours: 24
3. list_active_worktrees
```

**What you learn**: Who committed what, which modules had activity, which worktrees are active (who's working on what), and all new knowledge/facts that were ingested.

---

### Scenario 7 — "Knowledge Hygiene Sprint" (Monthly maintenance)

Once a month, review and clean up stale knowledge.

```
1. get_stale_knowledge        → module: "scheduling", stale_days: 30
2. get_stale_knowledge        → module: "billing", stale_days: 30
3. get_stale_knowledge        → module: "messaging", stale_days: 30
4. get_decision_log           → module: "scheduling"
   (Review each stale fact — still valid? Update or archive)
5. ingest_knowledge           → module: "scheduling", topic: "Updated: appointment rules",
                                 findings: "After reviewing stale facts, confirmed that..."
6. promote_facts              → module: "scheduling"
```

**What you learn**: Which rules have drifted from reality, which modules have high-risk stale knowledge (stale facts + recent PR activity), and what needs refreshing.

---

### Scenario 8 — "New Team Member Onboarding" (First day)

A new developer joins and needs to understand the codebase.

```
1. get_handoff_summary        → since_hours: 720   (last 30 days)
2. get_module_overview        → module: "scheduling"
3. get_module_overview        → module: "billing"
4. get_module_overview        → module: "messaging"
5. get_module_graph           → module: "scheduling"
6. get_decision_log           → module: "scheduling"
7. get_decision_log           → module: "billing"
8. get_knowledge_lineage      → module: "scheduling", topic: "appointment rules"
```

**What you learn**: Full history of what the team built, what business rules are in force, how modules relate to each other, and how understanding of key topics evolved over time.

---

### Scenario 9 — "Investigating a Regression" (Something broke after a merge)

Production broke after PR #198 merged. You need to trace what happened.

```
1. ingest_pr                  → repo: "owner/repo", pr_number: 198
2. why_was_this_changed       → sha: "abc123", repo: "owner/repo"
3. who_changed_this           → file: "src/scheduling/slots.ts", repo: "owner/repo"
4. get_cross_module_impact    → repo: "owner/repo", pr_number: 198
5. search_context             → module: "scheduling", query: "slot availability conflict"
6. get_decision_log           → module: "scheduling"
```

**What you learn**: What the PR intended to do, who changed the broken file and when, which other modules were affected by the PR's file changes, and whether any business rules were violated.

---

### Scenario 10 — "Building Module Dependencies" (Architecture documentation)

You want to map how your modules relate to each other.

```
1. link_modules               → from: "scheduling", to: "messaging", relation: "affects"
2. link_modules               → from: "billing", to: "scheduling", relation: "required_by"
3. link_modules               → from: "auth", to: "billing", relation: "affects"
4. link_modules               → from: "intake", to: "scheduling", relation: "affects"
5. get_module_graph           → module: "scheduling"
6. get_module_graph           → module: "billing"
```

**What you learn**: Nothing new — this is about TEACHING the system the architecture. Now `get_cross_module_impact` and `get_module_graph` will show real dependency chains for all future queries.

---

### Quick Reference: Which Tool When?

| I need to...                     | Tool                      |
| -------------------------------- | ------------------------- |
| Start my day / catch up          | `get_handoff_summary`     |
| See what merged overnight        | `get_overnight_brief`     |
| Plan before coding               | `pre_plan_sync_brief`     |
| Understand a module I don't know | `get_module_overview`     |
| Find specific knowledge          | `search_context`          |
| See who owns a file              | `who_changed_this`        |
| Understand why code changed      | `why_was_this_changed`    |
| Check team-agreed rules          | `get_decision_log`        |
| See if knowledge is outdated     | `get_stale_knowledge`     |
| Assess impact of my changes      | `get_cross_module_impact` |
| See who's working on what        | `get_team_activity`       |
| Record what I learned            | `ingest_knowledge`        |
| Extract facts from a PR          | `ingest_business_facts`   |
| Make facts official              | `promote_facts`           |
| Mark a rule as team-agreed       | `flag_decision`           |
| Document module dependencies     | `link_modules`            |
| See how understanding evolved    | `get_knowledge_lineage`   |
| See module relationships         | `get_module_graph`        |
