# @jussmor/commit-memory-mcp-surreal

MCP server for PR traceability + business context, backed by SurrealDB.

## Latest technology

- SurrealDB document + graph + vector-native schema
- FULLTEXT indexes (BM25) for keyword retrieval
- HNSW vector indexes for semantic retrieval
- Hybrid ranker that combines semantic similarity, full-text score, keyword overlap, and confidence/importance
- Open-source local embedding model support via `@xenova/transformers` (default: `Xenova/all-MiniLM-L6-v2`)
- Optional Ollama embeddings fallback, plus deterministic hashed fallback

## What it does

This server lets coding agents answer:

- who changed this file
- why this change happened
- what merged recently on main
- what business context to load before planning

## Architecture

This package is organized as a layered MCP server:

- Entry/runtime: `src/index.ts` starts the server, runs schema migrations, registers tools, and connects via stdio transport.
- Tool surface: `src/tools/index.ts` defines all MCP tools and maps each tool to a single orchestration function.
- Domain layers: `src/layers/*` contains business logic grouped by concern:
  - `ingest.ts`: PR ingestion and fact extraction
  - `business.ts`: knowledge retrieval, lineage, search, and planning briefs
  - `coordination.ts`: decision logs, stale knowledge checks, team/activity summaries, cross-module impact
  - `trazability.ts`: repository/PR traceability lookups
- Data layer: `src/db/*` manages SurrealDB connection and schema migrations (document, relation, and vector indexes).
- External integrations:
  - GitHub/PR sync in `src/pr/sync.ts`
  - Git/worktree intelligence in `src/git/*`
  - Embeddings and hybrid retrieval in `src/search/*`

Request flow (high-level):

1. MCP client calls a tool over stdio.
2. Tool handler in `src/tools/index.ts` validates input with Zod and dispatches to a layer function.
3. Layer function reads/writes SurrealDB records and relation edges, optionally fetching GitHub or local git context.
4. Search paths combine BM25 full-text and HNSW vector similarity, then re-rank for final response quality.
5. Handler returns structured text payload to the MCP client.

Data model (SurrealDB):

- Core records: `pr`, `commit`, `module`, `business_fact`, `memory_chunk`, `knowledge_note`, `commit_chunk`, `worktree`.
- Relation tables: `affects`, `required_by`, `belongs_to`, `part_of`, `supersedes`, `mentions_module`.
- Retrieval primitives:
  - Full-text analyzer + BM25 indexes for lexical matching
  - HNSW vector indexes (384-dim) for semantic matching
  - Hybrid ranking across semantic score, keyword overlap, and confidence signals

## Tools

- `sync_pr_context`
- `who_changed_this`
- `why_was_this_changed`
- `get_main_branch_overnight_brief`
- `list_active_worktrees`
- `ingest_pr`
- `extract_business_facts`
- `get_module_overview`
- `get_module_graph`
- `promote_context_facts`
- `search_module_context`
- `pre_plan_sync_brief`

## Install

```bash
npm i -g @jussmor/commit-memory-mcp-surreal
commit-memory-mcp-surreal
```

Or run without global install:

```bash
npx -y @jussmor/commit-memory-mcp-surreal
```

## Environment variables

- `SURREAL_URL` (default: `ws://127.0.0.1:8000/rpc`)
- `SURREAL_USER` (default: `root`)
- `SURREAL_PASS` (default: `root`)
- `SURREAL_NS` (default: `main`)
- `SURREAL_DB` (default: `main`)
- `GH_BIN` optional absolute path to GitHub CLI (for example `/opt/homebrew/bin/gh`)
- `COMMIT_RAG_EMBED_MODEL` optional local open-source embedding model id (default: `Xenova/all-MiniLM-L6-v2`)
- `COMMIT_RAG_DISABLE_LOCAL_EMBEDDINGS` set `1` to skip local transformers embeddings
- `OLLAMA_EMBED_MODEL` optional Ollama embedding model (used when local embeddings are disabled/unavailable)
- `OLLAMA_BASE_URL` optional Ollama base URL (default: `http://127.0.0.1:11434`)
- `COMMIT_RAG_DIMENSION` optional embedding dimension (default: `384`)

## VS Code MCP config examples

### 1) This package (cloud endpoint)

```json
{
  "servers": {
    "commit-memory-surreal": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@jussmor/commit-memory-mcp-surreal"],
      "env": {
        "SURREAL_URL": "wss://your-instance.aws-usw2.surreal.cloud/rpc",
        "SURREAL_USER": "root",
        "SURREAL_PASS": "root",
        "SURREAL_NS": "main",
        "SURREAL_DB": "main"
      }
    }
  }
}
```

### 2) Official SurrealMCP in parallel

```json
{
  "servers": {
    "SurrealDB": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "--pull",
        "always",
        "surrealdb/surrealmcp:latest",
        "start"
      ]
    }
  }
}
```

Note: Official SurrealMCP requires an explicit `connect_endpoint` call before query tools are usable.

## Usage examples

### Sync merged PRs

```text
sync_pr_context({
  repo: "JussMor/commit-memory-mcp",
  limit: 20
})
```

### Find who changed a file

```text
who_changed_this({
  file: "packages/commit-rag-mcp/src/db/client.ts",
  repo: "JussMor/commit-memory-mcp"
})
```

### Explain why a file changed

```text
why_was_this_changed({
  file: "packages/commit-rag-mcp/src/layers/business.ts",
  repo: "JussMor/commit-memory-mcp"
})
```

### Ingest one PR and extract business facts

```text
ingest_pr({ repo: "JussMor/commit-memory-mcp", pr_number: 123 })
extract_business_facts({ repo: "JussMor/commit-memory-mcp", pr_number: 123, module: "billing" })
```

### Promote reviewed facts

```text
promote_context_facts({ module: "billing", pr_number: 123 })
```

### Search module context before coding

```text
search_module_context({ module: "billing", query: "invoice retry timeout", limit: 10 })
```

### Retrieve complete module overview

```text
get_module_overview({ module: "billing" })
```

### Pre-plan brief (recommended before implementation)

```text
pre_plan_sync_brief({
  repo: "JussMor/commit-memory-mcp",
  module: "billing"
})
```

## Local development

```bash
cd packages/commit-rag-mcp
npm install
npm run build
node dist/index.js
```

## Publish

```bash
npm run build
npm publish --access public
```
