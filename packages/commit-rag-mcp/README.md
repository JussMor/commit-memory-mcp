# @jussmor/commit-memory-mcp-surreal

**Code Digital Twin via MCP.** Synchronizes developer context asynchronously by ingesting PRs, extracting business intent via the ATOM framework, and serving hybrid-ranked knowledge to AI agents through 8 focused tools.

> Simple. Synchronized. Useful from minute one.

## How it works

```
PR merges on GitHub
       ↓
ingest_prs  (one call)
  ├─ sync raw PR metadata               (GitHub CLI → SurrealDB)
  ├─ extract business facts             (memory chunks, PR body)
  └─ ATOM 5-tuple extraction            (subject · predicate · object · t_start · t_end)
       ↓
SurrealDB knowledge graph
  ├─ Lexical graph: repository → module → file → commit
  ├─ Episodic graph: pr → business_fact ← module
  └─ Semantic memory: knowledge_note (versioned, with lineage)
       ↓
AI agent calls get_module_context / pre_plan_sync_brief
  └─ Hybrid-ranked response: BM25 + HNSW vector + confidence score
```

## Technology

- **SurrealDB** — document + graph + vector-native schema in a single engine
- **ATOM 5-tuples** — temporal business rules extracted from PR descriptions: `(subject, predicate, object, t_start, t_end)`
- **Hybrid retrieval** — BM25 full-text + HNSW vector (384-dim) + confidence weighting
- **Local embeddings** — `@xenova/transformers` (`Xenova/all-MiniLM-L6-v2`) with Ollama and deterministic hash fallbacks
- **Optional LLM** — connect any OpenAI-compatible endpoint (`COMMIT_RAG_LLM_URL`) for richer ATOM extraction

## Architecture

```
src/
  tools/index.ts          ← 8 MCP tools (single file, ~128 lines)
  layers/
    core.ts               ← Public surface: 8 functions backing the 8 tools
    business.ts           ← Knowledge retrieval, lineage, search, planning briefs
    ingest.ts             ← PR ingestion + ATOM 5-tuple extraction
    trazability.ts        ← File/commit/PR traceability via GitHub CLI + git
    coordination.ts       ← Decision logs, knowledge graph
  orchestration/
    orchestrator.ts       ← Multi-agent research: session creation, step planning
    dispatch.ts           ← Step dispatcher with prior-findings injection
    agent.ts              ← Stateless step executor (LLM-pluggable)
    assemble.ts           ← Final answer assembly, auto-promotion to knowledge_note
  db/
    schema.ts             ← SurrealDB migrations (documents, relations, vector indexes)
    client.ts             ← Connection management
  search/
    embeddings.ts         ← Local + Ollama + hash fallback
    query.ts              ← Hybrid search (BM25 + HNSW)
    rerank.ts             ← Optional Copilot/GPT reranking
```

**Data model:**

| Table                                                           | Kind | Purpose                                         |
| --------------------------------------------------------------- | ---- | ----------------------------------------------- |
| `repository`, `module`, `file`                                  | Node | Lexical graph                                   |
| `pr`, `commit`                                                  | Node | Episodic memory                                 |
| `business_fact`                                                 | Node | Semantic memory — temporal (`t_start`, `t_end`) |
| `memory_chunk`                                                  | Node | Unstructured PR context                         |
| `knowledge_note`                                                | Node | Versioned, lineage-tracked knowledge            |
| `research_session`, `research_step`, `research_finding`         | Node | Multi-agent orchestration state                 |
| `modified`, `contains`, `touches`, `extends`, `replaces`        | Edge | Lexical + knowledge graph wiring                |
| `belongs_to`, `part_of`, `affects`, `required_by`, `supersedes` | Edge | Module dependency graph                         |

## The 8 Tools

### Dev workflow

| Tool                    | When to use                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre_plan_sync_brief`   | **First thing every morning.** Syncs PRs, checks overnight merges, returns a context brief for the module you're about to work on.                          |
| `ingest_prs`            | After PRs merge, or on a schedule. Runs the full pipeline: sync → extract facts → ATOM tuples → update graph.                                               |
| `promote_context_facts` | Sprint planning. Review auto-extracted draft facts, approve the ones that are accurate. Approved facts reach confidence 1.0 and become the source of truth. |

### Agent-facing knowledge

| Tool                 | When to use                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `get_module_context` | Primary search. Returns hybrid-ranked overview + latest knowledge + decisions. Pass `query` for semantic filtering. |
| `get_module_graph`   | Understand blast radius before changing a module. Shows what it depends on and what it affects.                     |
| `get_chunk_history`  | Trace how understanding of a module evolved. Useful when a rule feels outdated.                                     |

### Traceability

| Tool                   | When to use                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `who_changed_this`     | Find the owner of a file before touching it. Returns recent authors, commits, and PR context.  |
| `why_was_this_changed` | Understand the business intent behind a change. Traverses file → commit → PR → business facts. |

## Install

```bash
npm i -g @jussmor/commit-memory-mcp-surreal
commit-memory-mcp-surreal
```

Or without a global install:

```bash
npx -y @jussmor/commit-memory-mcp-surreal
```

## Environment variables

### Required

| Variable       | Default                   | Description                  |
| -------------- | ------------------------- | ---------------------------- |
| `SURREAL_URL`  | `ws://127.0.0.1:8000/rpc` | SurrealDB WebSocket endpoint |
| `SURREAL_USER` | `root`                    | SurrealDB username           |
| `SURREAL_PASS` | `root`                    | SurrealDB password           |
| `SURREAL_NS`   | `main`                    | SurrealDB namespace          |
| `SURREAL_DB`   | `main`                    | SurrealDB database           |

### Optional

| Variable                              | Description                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `COMMIT_RAG_LLM_URL`                  | OpenAI-compatible endpoint for ATOM extraction and research agent steps (e.g. Ollama, LM Studio, OpenAI) |
| `COMMIT_RAG_LLM_API_KEY`              | Bearer token for authenticated LLM endpoints. Falls back to `COPILOT_TOKEN` or `GITHUB_TOKEN` if unset.  |
| `COMMIT_RAG_LLM_MODEL`                | Model name passed to the LLM endpoint (default: `llama3`)                                                |
| `COMMIT_RAG_EMBED_MODEL`              | Local embedding model (default: `Xenova/all-MiniLM-L6-v2`)                                               |
| `COMMIT_RAG_DISABLE_LOCAL_EMBEDDINGS` | Set `1` to skip local transformers and fall back to Ollama or hash                                       |
| `COMMIT_RAG_DIMENSION`                | Embedding dimension (default: `384`)                                                                     |
| `OLLAMA_EMBED_MODEL`                  | Ollama embedding model (used when local embeddings are disabled)                                         |
| `OLLAMA_BASE_URL`                     | Ollama base URL (default: `http://127.0.0.1:11434`)                                                      |
| `GH_BIN`                              | Absolute path to the GitHub CLI binary (e.g. `/opt/homebrew/bin/gh`)                                     |
| `COPILOT_TOKEN`                       | GitHub PAT for optional Copilot-powered reranking of commit search results                               |
| `COPILOT_MODEL`                       | Model for Copilot reranking (default: `gpt-4o-mini`)                                                     |

## VS Code MCP config

### Local SurrealDB

```json
{
  "servers": {
    "commit-memory-surreal": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@jussmor/commit-memory-mcp-surreal"],
      "env": {
        "SURREAL_URL": "ws://127.0.0.1:8000/rpc",
        "SURREAL_USER": "root",
        "SURREAL_PASS": "root",
        "SURREAL_NS": "main",
        "SURREAL_DB": "main"
      }
    }
  }
}
```

### SurrealDB Cloud + LLM extraction

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
        "SURREAL_PASS": "your-password",
        "SURREAL_NS": "main",
        "SURREAL_DB": "main",
        "COMMIT_RAG_LLM_URL": "http://localhost:11434/v1/chat/completions",
        "COMMIT_RAG_LLM_MODEL": "llama3"
      }
    }
  }
}
```

## Daily workflow

### Day-0 bootstrap (legacy or undocumented repos)

Run this one-time admin command to reverse-engineer draft business facts directly from source files and seed SurrealDB before any PR history exists.

```bash
commit-memory bootstrap --repo ./my-legacy-app --include "src/**/*.ts"
```

Resume an interrupted bootstrap without reprocessing files that already have reverse-engineered facts:

```bash
commit-memory bootstrap --repo ./my-legacy-app --include "src/**/*.ts" --resume
```

Start directly at phase 2 and rebuild module descriptions from reverse-engineered facts already stored in SurrealDB:

```bash
commit-memory bootstrap --repo ./my-legacy-app --include "src/**/*.ts" --start-phase 2
```

What it does:

- Lexical mapping: creates `module` + `file` nodes and links `module -> contains -> file`.
- File-level intent extraction: asks the LLM for ATOM-style facts from each source file.
- Graph provenance: stores facts as `source_type: reverse_engineered` with `confidence: 0.5` and links `file -> reverse_engineered_from -> business_fact`.
- Module summarization: synthesizes module-level overviews and stores them in `module.description`.
- Resume checkpointing: persists the last active file/module plus aggregate progress in `bootstrap_run` so interrupted runs can continue cleanly.

### Morning startup

```text
pre_plan_sync_brief({ repo: "owner/repo", module: "billing" })
```

Returns: overnight merges, latest facts, knowledge brief — everything needed before writing code.

### Ingest new PRs (or automate with a webhook)

```text
ingest_prs({ repo: "owner/repo", limit: 20 })
```

Runs: sync → `ingest_pr` → `extractBusinessFacts` → `atomExtract` for each merged PR.

### Ask for context before coding

```text
get_module_context({ module: "billing", query: "invoice retry timeout" })
```

### Understand a file's history

```text
who_changed_this({ file: "src/billing/invoice.ts", repo: "owner/repo" })
why_was_this_changed({ file: "src/billing/invoice.ts", repo: "owner/repo" })
```

### Sprint planning — validate auto-extracted facts

```text
promote_context_facts({ module: "billing" })
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
