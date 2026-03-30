# Installation Guide - commit-memory-mcp v0.3.1

Your package is ready to install! Choose one of the methods below:

## Method 1: Install from Local Tarball (Recommended)

The tarball is located at:

```
/Users/jussmor/Developer/maxwellclinic/AI-Plans-FE/packages/commit-rag-mcp/commit-memory-mcp-0.3.1.tgz
```

### Install globally:

```bash
npm install -g /Users/jussmor/Developer/maxwellclinic/AI-Plans-FE/packages/commit-rag-mcp/commit-memory-mcp-0.3.1.tgz
```

### Install in a project:

```bash
npm install /Users/jussmor/Developer/maxwellclinic/AI-Plans-FE/packages/commit-rag-mcp/commit-memory-mcp-0.3.1.tgz
```

## Method 2: Install from Git Repository

```bash
npm install github:JussMor/commit-memory-mcp
```

Then import it by its published package name:

```json
{
  "dependencies": {
    "@jussmor/commit-memory-mcp": "github:JussMor/commit-memory-mcp"
  }
}
```

## Method 3: Use Directly from Source

Copy the entire package directory:

```bash
cp -r /Users/jussmor/Developer/maxwellclinic/AI-Plans-FE/packages/commit-rag-mcp /path/to/your/project/lib/commit-memory-mcp
```

Then in `package.json`:

```json
{
  "dependencies": {
    "commit-memory-mcp": "file:./lib/commit-memory-mcp"
  }
}
```

## Available Commands After Installation

### Index a Repository

```bash
npx commit-memory-index --repo /path/to/repo --db /path/to/.commit-rag.db --limit 500
```

### Start MCP Server

```bash
npx commit-memory-mcp
```

## Usage in Code

```typescript
import { openDatabase, searchRelatedCommits } from "commit-memory-mcp";

const db = openDatabase(".commit-rag.db");
const results = await searchRelatedCommits(
  db,
  "authentication improvements",
  5,
);

results.forEach((r) => {
  console.log(`${r.subject} (score: ${r.score})`);
});

db.close();
```

## Package Info

- **Name**: `commit-memory-mcp`
- **Version**: `0.3.1`
- **Size**: 7.0 kB (tarball) / 24.7 kB (unpacked)
- **Node**: ≥20.0.0
- **Type**: ES Module

## What's Included

- ✅ MCP Server for Copilot integration
- ✅ CLI tools for indexing commits
- ✅ Semantic search with fallback embeddings
- ✅ SQLite vector database support
- ✅ Full TypeScript types
- ✅ Ollama integration (optional)

## Environment Variables

```bash
# Required
COMMIT_RAG_REPO=/path/to/repo

# Optional
COMMIT_RAG_DB=.commit-rag.db
COMMIT_RAG_LIMIT=400
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_EMBED_MODEL=nomic-embed-text
```

## Example: Complete Setup

```bash
# 1. Install
npm install -g /Users/jussmor/Developer/maxwellclinic/AI-Plans-FE/packages/commit-rag-mcp/commit-memory-mcp-0.3.1.tgz

# 2. Index EverBetter-Pro repository
npx commit-memory-index \
  --repo /Users/jussmor/Developer/maxwellclinic/EverBetter-Pro \
  --db /Users/jussmor/Developer/maxwellclinic/EverBetter-Pro/.commit-rag.db \
  --limit 500

# 3. Use with Copilot (copy mcp.json to VS Code config)
cp mcp.json ~/Library/Application\ Support/Code/User/globalStorage/github.copilot-chat/mcp.json

# 4. Use in your code
import { searchRelatedCommits } from '@jussmor/commit-memory-mcp';
```

## Next Steps

1. Choose an installation method above
2. Run the appropriate install command
3. Index your repository: `commit-memory-index --repo /path/to/repo`
4. Start using with Copilot or programmatically!

---

For full documentation, see: `/Users/jussmor/Developer/maxwellclinic/AI-Plans-FE/.github/copilot-instructions.md`
