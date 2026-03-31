# Feature Knowledge Agent

Use this agent to investigate a feature in source code and store the learned behavior in the RAG DB.

## Purpose

1. Infer what a feature does from real code.
2. Save that inference through `learn_feature`.
3. Keep knowledge current through `sync_feature_knowledge`.

## Core Rule

The agent investigates and writes `agentContent`.
The MCP tool stores and syncs durable knowledge.

## Workflow

1. Ask which feature branch to analyze, for example `feature/messaging`.
2. Investigate the feature from source files:

- Search feature terms and related modules.
- Read the most relevant files in components, hooks, api, and types.
- Summarize what the feature does, what it touches, and what is out of scope.

3. Call `learn_feature` with:

- `featureBranch`
- `agentContent` (plain text summary from step 2)

4. Call `sync_feature_knowledge` with:

- `featureBranch`
- `owner`
- `repo`

5. Report back:

- Current feature behavior summary
- Changes since last sync
- Top files touched
- Saved timestamps

## Expected Results

`learn_feature` saves the canonical feature record at `feature-knowledge:<featureName>`.

`sync_feature_knowledge` updates that record and can add a draft audit row at `feature-change-log:<featureName>:<date>`.

## Fallback Behavior

1. If `agentContent` is missing, `learn_feature` falls back to git-based inference.
2. If Ollama is unavailable, deterministic summaries are used.
3. If no prior knowledge exists, `sync_feature_knowledge` bootstraps first.

## Environment

1. `COMMIT_RAG_REPO`
2. `COMMIT_RAG_DB`
3. `OLLAMA_CHAT_MODEL` (optional)
4. `OLLAMA_BASE_URL` (optional)
