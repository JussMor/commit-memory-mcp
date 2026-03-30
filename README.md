# AI Plans - Maxwell Clinic

An intelligent AI agent system for GitHub Copilot that provides semantic search over git commit history and multi-agent workflow orchestration.

## Features

✨ **Semantic Commit Search** – Find related commits by meaning, not just keywords  
🔄 **Automatic Context** – Copilot automatically searches your git history for answers  
🛠️ **Multi-Agent Orchestration** – Chain agents into complex workflows  
⚡ **Fast Local Search** – SQLite vectors with optional Ollama embeddings  
🎯 **Copilot Integration** – Works seamlessly with GitHub Copilot Chat

## Quick Start

### 1️⃣ Setup

```bash
npm install
npx commit-rag-index --repo ${PWD}
```

### 2️⃣ Configure Copilot

Copy `mcp.json` to your VS Code MCP config location (see [SETUP.md](./SETUP.md))

### 3️⃣ Ask Copilot

```
What commits are related to authentication?
```

👉 **See [SETUP.md](./SETUP.md) for detailed setup instructions**

## Agents

### 🔍 Commit RAG Agent

Semantic search over git commits with optional Ollama embeddings.

**Tools:**

- `search_related_commits` – Find related commits by query
- `explain_commit_match` – Get detailed info for a commit
- `get_commit_diff` – Retrieve full git diff
- `reindex_commits` – Update commit index

📖 [Full docs](./packages/commit-rag-mcp/README.md)

### 🎼 Agent Orchestrator (Coming Soon)

Multi-agent workflow engine for complex AI tasks.

## Documentation

| Document                                                               | Purpose                      |
| ---------------------------------------------------------------------- | ---------------------------- |
| [SETUP.md](./SETUP.md)                                                 | Installation and setup guide |
| [.github/copilot-instructions.md](./.github/copilot-instructions.md)   | How to use with Copilot      |
| [.github/agents/README.md](./.github/agents/README.md)                 | Agent system overview        |
| [.github/agents/commit-rag.md](./.github/agents/commit-rag.md)         | Commit RAG agent spec        |
| [.github/agents/orchestrator.md](./.github/agents/orchestrator.md)     | Orchestrator design          |
| [.github/agents/agent-template.md](./.github/agents/agent-template.md) | Build new agents             |

## Project Structure

```
├── packages/
│   ├── commit-rag-mcp/          MCP server for semantic commit search
│   └── agent-orchestrator/      Workflow engine for multi-agent systems
├── .github/
│   ├── agents/                  Agent specifications & templates
│   └── copilot-instructions.md  Copilot integration guide
├── mcp.json                     Copilot MCP configuration
├── SETUP.md                     Installation & setup guide
└── README.md                    This file
```

## How It Works

```
┌─────────────────────────────┐
│   GitHub Copilot Chat       │
│  "Find auth bugs"           │
└────────────┬────────────────┘
             │
┌────────────▼────────────────┐
│    MCP Protocol             │
│  (Tool Discovery & Calls)   │
└────────────┬────────────────┘
             │
┌────────────▼────────────────┐
│  Commit RAG Agent           │
│  • Search commits           │
│  • Explain matches          │
│  • Get diffs                │
└────────────┬────────────────┘
             │
┌────────────▼────────────────┐
│  SQLite Vector DB           │
│  + Optional Ollama          │
└─────────────────────────────┘
```

## Environment Variables

### Required

- `COMMIT_RAG_REPO` – Path to git repository (defaults to workspace)

### Optional

- `COMMIT_RAG_DB` – Path to SQLite database (default: `.commit-rag.db`)
- `OLLAMA_EMBED_MODEL` – Use semantic embeddings (e.g., `nomic-embed-text`)
- `OLLAMA_BASE_URL` – Ollama server URL (default: `http://127.0.0.1:11434`)

See [SETUP.md](./SETUP.md) for configuration details.

## Usage Examples

### With Copilot Chat

**Find related work:**

```
@Copilot What authentication improvements have been made?
```

**Understand code changes:**

```
@Copilot Why was the JWT refresh logic changed? Show me related commits.
```

**Research features:**

```
@Copilot Have we implemented password reset before? Search our history.
```

**Code review context:**

```
@Copilot What was the context for [paste code]? Find related commits.
```

### Programmatic Use

```typescript
import { Orchestrator, workflow } from "@maxwellclinic/agent-orchestrator";

const orchestrator = new Orchestrator();
orchestrator.registerAgent({
  name: "commit-rag",
  executable: "npx",
  args: ["commit-rag-mcp"],
});

await orchestrator.initialize();
const result = await orchestrator.execute({
  name: "search",
  steps: [
    {
      id: "1",
      name: "Search commits",
      call: {
        agent: "commit-rag",
        tool: "search_related_commits",
        input: { query: "authentication" },
      },
    },
  ],
});
```

## Development

### Build

```bash
# Build all packages
cd packages/commit-rag-mcp && npm run build
cd packages/agent-orchestrator && npm run build
```

### Test

```bash
# Test commit-rag agent
npx commit-rag-index --repo ${PWD} --limit 10
npx commit-rag-mcp
```

### Create New Agent

Follow [.github/agents/agent-template.md](./.github/agents/agent-template.md)

## Troubleshooting

- **Copilot doesn't see agent?** → See [SETUP.md#troubleshooting](./SETUP.md#troubleshooting)
- **No search results?** → Run `npx commit-rag-index` to index commits
- **Slow searches?** → Install Ollama for semantic embeddings
- **Questions?** → Check [.github/copilot-instructions.md](./.github/copilot-instructions.md)

## Tech Stack

- **Node.js 20+** – Runtime
- **TypeScript** – Language
- **MCP** – Protocol for tool discovery
- **SQLite + sqlite-vec** – Vector database
- **Ollama** – Optional semantic embeddings
- **VS Code Copilot** – AI interface

## Architecture

- Modular monorepo structure
- Each agent is an independent MCP server
- Orchestrator coordinates multi-agent workflows
- Copilot Chat as the primary user interface

## Future Roadmap

- [ ] Database query agent
- [ ] Code analysis and refactoring agent
- [ ] PR/Issue summarization
- [ ] Distributed workflow execution
- [ ] Web UI for agent management
- [ ] Advanced retry and error recovery

## License

MIT

## Support

For issues, questions, or contributions:

1. Check documentation in `.github/agents/`
2. Review troubleshooting in [SETUP.md](./SETUP.md)
3. File an issue in the repository

---

**Ready to get started?** 👉 [SETUP.md](./SETUP.md)
