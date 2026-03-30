# @jussmor/commit-memory-mcp

Local commit-aware RAG package powered by sqlite-vec with MCP tool endpoints.

## Features

- Indexes git commits across branches into commit-file chunks
- Embeds chunks using a local embedding source (Ollama when configured)
- Stores vectors in sqlite-vec (SQLite)
- Exposes MCP tools for agent workflows

## MCP tools

- `search_related_commits`
- `explain_commit_match`
- `get_commit_diff`

## Quick start

```bash
npm install @jussmor/commit-memory-mcp
npx commit-memory-index --repo /path/to/repo --db /path/to/repo/.commit-rag.db --limit 400
npx commit-memory-mcp
```

## Publish

```bash
npm run build
npm publish --access public
mcp-publisher login github
mcp-publisher publish
```

## VS Code MCP registration

Copy `mcp.config.example.json` entries into your user MCP config and adjust paths/env values.

For MCP Registry publication, keep `package.json` `mcpName` and `server.json` `name` in sync.

## Environment

- `COMMIT_RAG_REPO` default repository path for MCP
- `COMMIT_RAG_DB` sqlite db path
- `COMMIT_RAG_LIMIT` max commits to index per run
- `OLLAMA_BASE_URL` local ollama URL (default `http://127.0.0.1:11434`)
- `OLLAMA_EMBED_MODEL` local embedding model name

If `OLLAMA_EMBED_MODEL` is not set, the package uses deterministic local fallback embeddings.

### Copilot LLM reranking (optional)

Set `COPILOT_TOKEN` to a GitHub token with Copilot access to enable LLM-based reranking.
After initial vector/keyword retrieval, results are sent to Copilot for semantic scoring and re-sorted.

- `COPILOT_TOKEN` GitHub PAT or token with Copilot access (enables reranking)
- `COPILOT_MODEL` model slug (default: `gpt-4o-mini`, supports `claude-sonnet-4-5`, `gpt-4o`, etc.)
- `COPILOT_BASE_URL` API base URL (default: `https://api.githubcopilot.com`)

Reranking works alongside or instead of Ollama — no embedding model required.
