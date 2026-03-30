# Commit RAG Agent

A retrieval-augmented generation (RAG) agent for querying git commit history using semantic search and vector embeddings.

## Purpose

The Commit RAG agent provides intelligent search and exploration of git commits:

- Searches commits semantically (not just text matching)
- Embeddings powered by Ollama or local deterministic fallback
- Stores vectors in SQLite for fast queries
- Exposes commits as a queryable knowledge base for LLM agents

## MCP Tools

### `search_related_commits`

Find commits semantically related to a natural language query.

**Input:**

```json
{
  "query": "authentication improvements",
  "activeFile": "src/auth/login.ts",
  "limit": 8
}
```

**Output:**

```json
[
  {
    "chunkId": "abc123:file.ts:hash",
    "sha": "1a2b3c4d",
    "filePath": "src/auth/login.ts",
    "subject": "Fix: Improve JWT refresh token handling",
    "score": 0.92,
    "date": "2025-01-15T10:30:00Z",
    "author": "Jane Doe",
    "preview": "+ function refreshToken() {\n+   const exp = jwt.decode()..."
  }
]
```

**Features:**

- Semantic similarity scoring (0-1)
- Keyword fallback when Ollama unavailable
- Active file boost (same file +0.2, same directory +0.05)
- Truncated hunks (6 lines max in preview)

### `explain_commit_match`

Get full details for a specific commit chunk match.

**Input:**

```json
{
  "chunkId": "abc123:src/file.ts:hash"
}
```

**Output:**

```json
{
  "chunkId": "abc123:src/file.ts:hash",
  "sha": "1a2b3c4d",
  "filePath": "src/file.ts",
  "subject": "Fix: Improve JWT refresh token handling",
  "score": 1.0,
  "date": "2025-01-15T10:30:00Z",
  "author": "Jane Doe",
  "preview": "+ function refreshToken() {\n+   const exp = jwt.decode()...\n+   if (isExpired(exp)) {\n+     return generateNew();\n+   }\n+   return token;"
}
```

### `get_commit_diff`

Get full git diff/patch for a specific commit SHA.

**Input:**

```json
{
  "sha": "1a2b3c4d"
}
```

**Output:** Full git show output including stats and patches

### `reindex_commits`

Refresh the commit index from git history.

**Input:**

```json
{
  "limit": 500
}
```

**Output:**

```json
{
  "indexedCommits": 412,
  "indexedChunks": 1847,
  "skippedChunks": 203
}
```

## Registration

```typescript
orchestrator.registerAgent({
  name: "commit-rag",
  executable: "npx",
  args: ["commit-rag-mcp"],
  env: {
    COMMIT_RAG_REPO: "/path/to/repo",
    COMMIT_RAG_DB: "/path/to/.commit-rag.db",
    OLLAMA_EMBED_MODEL: "nomic-embed-text",
    OLLAMA_BASE_URL: "http://127.0.0.1:11434",
  },
  timeout: 30000,
  autoRestart: true,
  maxRetries: 2,
});
```

## Example Workflows

### Find Recent Bug Fixes

```
1. Query: "fix for database connection pool"
2. search_related_commits(query)
3. Filter by date (last 30 days)
4. explain_commit_match(topResult.chunkId)
5. Return with full context
```

### Code Archaeology

```
1. Input: current file path
2. search_related_commits(query, activeFile)
3. Get matches with file boost
4. get_commit_diff(sha) for each
5. Analyze change patterns
```

### Reindex After Repository Update

```
1. reindex_commits(limit=1000)
2. Wait for completion
3. Return summary stats
```

## Environment Variables

| Variable             | Default                  | Description                                     |
| -------------------- | ------------------------ | ----------------------------------------------- |
| `COMMIT_RAG_REPO`    | `process.cwd()`          | Git repository path                             |
| `COMMIT_RAG_DB`      | `.commit-rag.db`         | SQLite database path                            |
| `COMMIT_RAG_LIMIT`   | `400`                    | Max commits to index per run                    |
| `OLLAMA_BASE_URL`    | `http://127.0.0.1:11434` | Ollama API endpoint                             |
| `OLLAMA_EMBED_MODEL` | (none)                   | Embedding model name (uses fallback if not set) |

## Embeddings

### With Ollama

- **Model**: `nomic-embed-text`, `all-minilm-l6-v2`, etc.
- **Dimension**: Model-dependent (384 for nomic)
- **Quality**: Semantic similarity based on training data

### Fallback (Deterministic)

- **Dimension**: 384-d vectors
- **Algorithm**: Hash-based token frequency
- **Deterministic**: Same input always produces same vector
- **Performance**: ~1ms per query (no network)

## Data Model

### Commits Table

```sql
CREATE TABLE commits (
  sha TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  date TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL
);
```

### Commit Chunks Table

```sql
CREATE TABLE commit_chunks (
  chunk_id TEXT PRIMARY KEY,
  sha TEXT NOT NULL,
  file_path TEXT NOT NULL,
  hunk_text TEXT NOT NULL,
  indexed_text TEXT NOT NULL,
  FOREIGN KEY (sha) REFERENCES commits(sha)
);
```

### Vector Storage (sqlite-vec)

```sql
CREATE VIRTUAL TABLE chunk_vectors USING vec0(
  embedding FLOAT[384]
);

CREATE TABLE chunk_vector_map (
  chunk_id TEXT PRIMARY KEY,
  vec_rowid INTEGER NOT NULL UNIQUE,
  FOREIGN KEY (chunk_id) REFERENCES commit_chunks(chunk_id)
);
```

## Performance

- **Indexing**: ~50-100 commits/second (depends on file count)
- **Search**: <100ms (Ollama) or <10ms (fallback)
- **Database size**: ~50MB per 1000 commits with embeddings

## Limitations

- Text-based only (no binary files)
- Single repository per agent instance
- Commits indexed on-demand (not real-time)
- Embeddings dimension fixed at creation time

## Future Enhancements

- [ ] Multi-repository support
- [ ] Incremental indexing from git hooks
- [ ] Commit metadata (PR links, issue references)
- [ ] Custom text pre-processing (language-aware tokenization)
- [ ] Reranking with LLM
- [ ] Time-decay scoring (recent commits boost)
