---
description: "AI agent system for Maxwell Clinic with commit RAG and orchestration"
---

# Maxwell Clinic AI Agents for GitHub Copilot

Welcome! You have access to **AI agents** that extend your development workflow with intelligent capabilities. These agents are available through the MCP (Model Context Protocol) and can be used for code analysis, commit history exploration, and complex multi-step workflows.

## Available Agents

### 🔍 Commit RAG Agent

The **Commit RAG** agent provides semantic search and analysis of git commit history. Use it to:

- Find commits related to a topic or feature
- Understand why specific code changes were made
- Discover similar past work to avoid duplication
- Trace the evolution of a code area
- Get context about author decisions

#### Tools

#### `search_related_commits(query, activeFile?, limit?)`

Search for commits semantically related to your current work.

**Parameters:**

- **`query`** (string, required): Natural language description of what you're looking for
  - Examples: "authentication improvements", "bug fixes in login", "performance optimizations"
- **`activeFile`** (string, optional): Current file path (gets boosted in search scoring)
- **`limit`** (number, optional): Max results to return (default: 8)

**Returns:** List of matching commits with scores, dates, authors, and code previews

**Examples:**

```
User: "What commits are related to user authentication?"
→ search_related_commits(query="user authentication", limit=5)

User: "Show me recent bug fixes in the payment module"
→ search_related_commits(query="bug fixes payment", activeFile="src/payment/", limit=10)

User: "Find commits that improved database performance"
→ search_related_commits(query="database performance optimization")
```

#### `explain_commit_match(chunkId)`

Get detailed information about a specific commit match, including full context and code changes.

**Parameters:**

- **`chunkId`** (string, required): The chunk ID from a search result

**Returns:** Full commit details with expanded code hunks

**Example:**

```
After search_related_commits returns results:
User: "Tell me more about that JWT fix"
→ explain_commit_match(chunkId="abc123:src/auth/jwt.ts:hash1a2b")
```

#### `get_commit_diff(sha)`

Get the complete git diff for a specific commit (full patch output).

**Parameters:**

- **`sha`** (string, required): Git commit SHA

**Returns:** Full git show output with stats and patches

**Example:**

```
User: "Show me the full diff for commit 1a2b3c4d"
→ get_commit_diff(sha="1a2b3c4d")
```

#### `reindex_commits(limit?)`

Refresh the commit index from git history (useful after large merges or branch updates).

**Parameters:**

- **`limit`** (number, optional): Max commits to index (default: 400)

**Returns:** Summary of indexing results

**Example:**

```
User: "Update the commit index"
→ reindex_commits(limit=1000)
```

## How to Use

You can reference the commit RAG agent in your conversation naturally:

### Search for Related Work

**You:** "What commits are related to authentication in our codebase?"

**Copilot** will use `search_related_commits` to find semantically similar commits:

- Search results show scores, authors, dates, and code previews
- Results are ordered by relevance
- Same file gets a scoring boost
- Fallback keyword search if semantic model unavailable

### Understand Why Code Was Changed

**You:** "Why was the JWT token refresh logic changed? Find related commits."

**Copilot** will:

1. Use `search_related_commits` for "JWT token refresh"
2. Use `explain_commit_match` on top result for full context
3. Use `get_commit_diff` for complete patch if needed

### Trace Code Evolution

**You:** "Show me the history of changes to the authentication module"

**Copilot** will:

1. Search for commits affecting auth files
2. Display changes over time
3. Show authors and dates

### Find Similar Patterns

**You:** "Have we implemented password reset logic before? Search commits."

**Copilot** will find past implementations you can learn from or reuse patterns from.

### Code Review Context

**You:** "What was the context for this change? [pastes code]"

**Copilot** will search for related commits to understand the decision-making.

## Setup

The commit RAG agent requires:

1. **Git repository access** – Must be run in a git repository
2. **Optional: Ollama** for semantic embeddings
   - Set `OLLAMA_EMBED_MODEL=nomic-embed-text`
   - Set `OLLAMA_BASE_URL=http://localhost:11434`
3. **SQLite database** – Creates `.commit-rag.db` in repo root

### First Time Setup

```bash
# Index your commits (one-time)
npx commit-rag-index --repo /path/to/repo --limit 500

# Agent is now ready to use with Copilot
```

### Environment Variables

Configure the agent behavior with these variables:

| Variable             | Description          | Example                  |
| -------------------- | -------------------- | ------------------------ |
| `COMMIT_RAG_REPO`    | Repository path      | `/path/to/repo`          |
| `COMMIT_RAG_DB`      | Database location    | `.commit-rag.db`         |
| `COMMIT_RAG_LIMIT`   | Max commits to index | `400`                    |
| `OLLAMA_EMBED_MODEL` | Embedding model      | `nomic-embed-text`       |
| `OLLAMA_BASE_URL`    | Ollama API URL       | `http://127.0.0.1:11434` |

## Capabilities

✅ **Semantic Search** – Find commits by meaning, not just keywords  
✅ **Context Retrieval** – Get full diffs and code hunks  
✅ **File Awareness** – Boost results from your current file  
✅ **Author History** – See who made the change and when  
✅ **Deterministic Fallback** – Works without Ollama  
✅ **Fast Queries** – <100ms search with vector DB

## Limitations

- **Text-only** – Binary files not indexed
- **Single repo** – One agent per repository
- **Semantic dependent** – Quality depends on model and indexing
- **Historical only** – Cannot access uncommitted changes
- **No filtering** – Searches all branches (can be slow on huge repos)

## Troubleshooting

### "Agent not responding"

- Check if `.commit-rag.db` exists
- Run `commit-rag-index` to rebuild indexing
- Verify Ollama is running (if using semantic search)

### "Search results are irrelevant"

- Try more specific queries
- Check if Ollama model is loaded correctly
- Increase result limit to see more options

### "Index is out of date"

- Run `reindex_commits()` after major merges
- Manually trigger with: `npx commit-rag-index`

### "Slow searches"

- Reduce `--limit` when indexing
- Use more specific queries
- Check database file isn't corrupted

## Examples

### Find Bug Fixes

**You:** "What bug fixes were made in the last month?"  
→ `search_related_commits(query="bug fix", limit=20)`

### Understand Refactoring

**You:** "Why was this function refactored?"  
→ `search_related_commits(query="refactor database queries")`

### Onboarding

**You:** "How was authentication implemented in this codebase?"  
→ `search_related_commits(query="user authentication login")`  
→ `explain_commit_match(chunkId=...)` for each result

### Code Review

**You:** "Is there a better pattern for this? Search our history."  
→ `search_related_commits(query="error handling middleware")`

### Performance Analysis

**You:** "What optimizations have we done for this API endpoint?"  
→ `search_related_commits(query="endpoint performance API optimization")`

## Tips

💡 **Use keywords from your code** – Better search results  
💡 **Ask for context first** – "Find commits about X" before diving into details  
💡 **Combine with code review** – Compare current code with historical solutions  
💡 **Update index regularly** – After large merges or feature branches  
💡 **Be specific** – "Database connection pooling" vs just "database"

## Related Resources

- **Agent Documentation**: See `.github/agents/` for technical details
- **MCP Protocol**: https://modelcontextprotocol.io/
- **VS Code Copilot**: https://github.com/features/copilot/

---

**Need help?** Ask your development team or file an issue in the repository.
