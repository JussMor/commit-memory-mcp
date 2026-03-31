---
description: "Feature knowledge agent — learns what a feature does and keeps the RAG DB in sync"
---

# Feature Knowledge Agent

Use this agent to investigate a feature from source code and save that understanding to the RAG knowledge DB. The agent reads actual files — not just git history — then stores its findings so any future agent can query them instantly.

## When to Invoke

- Starting work on a new feature branch for the first time
- After a PR is merged into a feature branch and behavior changed
- Before planning work that touches an existing feature
- When specs and code have drifted and you need ground truth

## Core Principle

**The agent investigates. The MCP tool stores.**

This agent reads the real source code in this repo, synthesizes what the feature does, then passes that understanding to `learn_feature` as `agentContent`. The MCP tool is responsible only for saving to the DB and appending git metadata — it does not re-infer anything when `agentContent` is provided.

## Required Workflow

### Step 1 — Ask which feature

Ask: **Which feature?** (e.g. `feature/messaging`, `feature/patient-flow`)
Extract the feature name: `messaging` from `feature/messaging`.

### Step 2 — Investigate source code

Using your file tools, explore the feature's implementation:

1. Search for the feature entry points:
   ```
   semantic_search("messaging feature")
   grep_search("messaging|chat|conversation", includePattern: "src/**")
   ```
2. Read the top 3–5 most relevant files (components, hooks, API lib, types)
3. Identify:
   - What the feature does for the user
   - What modules/directories it touches (`src/components/`, `src/lib/api/`, `src/hooks/`)
   - Key data flows (API calls, state management, WebSocket, etc.)
   - What it explicitly does NOT do (scope boundary)
4. Write a 4–6 sentence plain-text summary of your findings

### Step 3 — Save to knowledge DB

Call `learn_feature` with your findings as `agentContent`:

```
learn_feature({
  featureBranch: "feature/messaging",
  agentContent: "<your 4-6 sentence summary from Step 2>"
})
```

The tool appends git metadata (files touched, commit count, authors) and saves to `context_facts` as `feature-knowledge:messaging` with `confidence: 0.95`.

### Step 4 — Sync with new commits and PRs

```
sync_feature_knowledge({
  featureBranch: "feature/messaging",
  owner: "<repo owner>",
  repo: "<repo name>"
})
```

This loads the knowledge saved in Step 3, merges it with any new commits/PR decisions since the last sync, and updates the DB record. An audit row (`feature-change-log:messaging:YYYY-MM-DD`) is inserted as `status: draft` for historical reference.

### Step 5 — Report

Return a summary with:

- What the feature does (from `agentContent`)
- What changed since last sync (new commits, PR decisions)
- Top files touched
- `savedAt` timestamp

## Output Contract

`learn_feature` returns:

```json
{
  "featureName": "messaging",
  "learned": "This feature implements real-time chat between providers and patients...\n\n--- Git metadata ---\nTop files: src/lib/messaging/socket.ts, ...",
  "filesAnalyzed": 12,
  "commitsAnalyzed": 8,
  "agentProvided": true,
  "aiGenerated": true,
  "confidence": 0.95,
  "savedAt": "2026-03-31T09:00:00.000Z"
}
```

`sync_feature_knowledge` returns:

```json
{
  "featureName": "messaging",
  "previousKnowledge": "...",
  "updatedKnowledge": "...",
  "newCommitsAnalyzed": 3,
  "totalCommitsInBranch": 11,
  "syncedAt": "2026-03-31T09:05:00.000Z"
}
```

## Confidence Levels

| Source                                           | Confidence |
| ------------------------------------------------ | ---------- |
| Agent read source code → `agentContent` provided | 0.95       |
| Ollama LLM inferred from git commits only        | 0.85       |
| Deterministic fallback (no Ollama)               | 0.60       |

## Knowledge Access After Sync

Once saved, any agent retrieves feature knowledge via:

```
build_context_pack({ feature: "messaging" })
```

Returns the `feature-knowledge:messaging` record automatically.
Audit rows (`feature-change-log:*`) are `status: draft` — only returned when `includeDraft: true`.

## Validation and Failure Modes

- Non-existent branch → empty git metadata, `agentContent` still saved, no crash
- No `agentContent` provided → falls back to Ollama or deterministic git summary
- No `OLLAMA_CHAT_MODEL` set and no `agentContent` → deterministic summary, `confidence: 0.60`
- No new commits since last sync → `updatedKnowledge` unchanged, no audit row inserted
- `sync_feature_knowledge` with no prior knowledge → bootstraps automatically

## Environment

- `COMMIT_RAG_REPO` — path to the target git repository
- `COMMIT_RAG_DB` — path to the SQLite knowledge DB
- `OLLAMA_CHAT_MODEL` (optional) — enables AI synthesis for the git-only fallback path (e.g. `llama3`)
- `OLLAMA_BASE_URL` (optional) — defaults to `http://127.0.0.1:11434`
