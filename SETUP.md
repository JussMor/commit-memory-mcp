# Maxwell Clinic AI Plans - Setup Guide

## Quick Start with Copilot

This project is configured to work with **GitHub Copilot Chat** using MCP agents for extended capabilities.

### 1. Install Dependencies

```bash
# Install at root (if you have a root package.json)
npm install

# Or install individual packages
cd packages/commit-rag-mcp
npm install

cd ../agent-orchestrator
npm install
```

### 2. Index Your Commits (One-time)

Initialize the commit RAG database:

```bash
npx commit-rag-index --repo ${PWD} --limit 500
```

This creates `.commit-rag.db` in your repo root with indexed commits ready for semantic search.

### 3. Enable MCP in VS Code

The project includes `mcp.json` with Copilot configuration. To activate:

**Option A: User-level MCP config**

```bash
# Copy to VS Code config directory
cp mcp.json ~/.config/Code/User/globalStorage/github.copilot-chat/mcp.json

# macOS users:
cp mcp.json ~/Library/Application\ Support/Code/User/globalStorage/github.copilot-chat/mcp.json
```

**Option B: Workspace settings**
If your workspace has `.vscode/settings.json`, add:

```json
{
  "mcpServers": {
    "commit-rag": {
      "command": "npx",
      "args": ["commit-rag-mcp"],
      "env": {
        "COMMIT_RAG_REPO": "${workspaceFolder}",
        "COMMIT_RAG_DB": "${workspaceFolder}/.commit-rag.db"
      }
    }
  }
}
```

### 4. Use with Copilot Chat

Open Copilot Chat and ask:

```
What commits are related to authentication?
```

Copilot will automatically search your git history using the commit-rag agent.

## Environment Setup

### Optional: Enable Semantic Search with Ollama

For better search results using semantic embeddings:

1. **Install Ollama**: https://ollama.ai/
2. **Pull embedding model**:
   ```bash
   ollama pull nomic-embed-text
   ```
3. **Start Ollama**:
   ```bash
   ollama serve
   ```
4. **Verify in mcp.json**:
   ```json
   {
     "OLLAMA_BASE_URL": "http://127.0.0.1:11434",
     "OLLAMA_EMBED_MODEL": "nomic-embed-text"
   }
   ```

Without Ollama, the agent uses a deterministic fallback (still works, but less precise).

## Project Structure

```
├── packages/
│   ├── commit-rag-mcp/          # Commit RAG agent (MCP server)
│   └── agent-orchestrator/      # Multi-agent workflow engine (coming soon)
├── .github/
│   ├── agents/                  # Agent specifications
│   │   ├── README.md            # Agent system overview
│   │   ├── orchestrator.md      # Orchestrator documentation
│   │   ├── commit-rag.md        # RAG agent spec
│   │   └── agent-template.md    # Blueprint for new agents
│   └── copilot-instructions.md  # Copilot integration guide
├── mcp.json                      # Copilot MCP server config
└── README.md                     # This file
```

## Available Commands

### Commit RAG Agent

```bash
# Index commits
npx commit-rag-index --repo /path/to/repo --limit 500

# Start MCP server (for debugging)
npx commit-rag-mcp

# Reindex after large merges
npx commit-rag-index --repo ${PWD} --limit 1000
```

### Agent Orchestrator (Coming Soon)

```bash
# List available workflows
orchestrator list-workflows

# Run a workflow
orchestrator run search-commits

# Test agent connectivity
orchestrator test-agent commit-rag
```

## Troubleshooting

### Copilot doesn't see the agent

1. Check that MCP config is in the right location:
   - **macOS**: `~/Library/Application Support/Code/User/globalStorage/github.copilot-chat/mcp.json`
   - **Linux**: `~/.config/Code/User/globalStorage/github.copilot-chat/mcp.json`
   - **Windows**: `%APPDATA%\Code\User\globalStorage\github.copilot-chat\mcp.json`

2. Restart VS Code or reload window (Cmd+Shift+P → "Developer: Reload Window")

3. Check Copilot Chat extension is installed and updated

### Search returns no results

1. Verify database exists:

   ```bash
   ls -lah .commit-rag.db
   ```

2. Check if indexed:

   ```bash
   npx commit-rag-index --repo ${PWD}
   ```

3. Try with specific keywords:
   ```
   "bug fixes in authentication"
   ```

### Slow searches

1. Verify Ollama is running: `curl http://localhost:11434/api/tags`
2. Check database file isn't corrupted: `sqlite3 .commit-rag.db "SELECT COUNT(*) FROM commits;"`
3. Reduce number of indexed commits: `npx commit-rag-index --limit 200`

## Next Steps

1. **Read Agent Documentation**: See [.github/agents/README.md](./.github/agents/README.md)
2. **Explore Copilot Integration**: See [.github/copilot-instructions.md](./.github/copilot-instructions.md)
3. **Build Your Own Agents**: See [.github/agents/agent-template.md](./.github/agents/agent-template.md)
4. **Understand Orchestration**: See [.github/agents/orchestrator.md](./.github/agents/orchestrator.md)

## Support

For questions or issues:

- Check `.github/agents/` for detailed documentation
- Review troubleshooting in [.github/copilot-instructions.md](./.github/copilot-instructions.md)
- File an issue in the repository
