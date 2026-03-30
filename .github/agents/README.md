# Agent System

Documentation for the Maxwell Clinic AI agent orchestration system.

## 🚀 Using with GitHub Copilot

The commit RAG agent is configured to work seamlessly with GitHub Copilot Chat!

**Simply ask Copilot:**

- "What commits are related to authentication?"
- "Show me recent bug fixes in the payment module"
- "Find commits that improved database performance"
- "Explain this commit: [paste SHA]"

Copilot will automatically use the `search_related_commits`, `explain_commit_match`, and `get_commit_diff` tools to provide context from your git history.

👉 **See [.github/copilot-instructions.md](../copilot-instructions.md)** for full Copilot integration details.

## Overview

This folder contains specifications and patterns for the multi-agent orchestration framework that powers complex AI workflows.

## Documents

### [orchestrator.md](./orchestrator.md)

The main **Agent Orchestrator** – a workflow engine that manages multiple MCP agents, routes tasks, and tracks execution state across distributed steps.

**Key features:**

- Multi-agent lifecycle management
- Dependency-based workflow execution (DAG)
- Conditional branching and parallel execution
- Error recovery (retry, skip, continue)
- Rich execution context passing

### [commit-rag.md](./commit-rag.md)

The **Commit RAG Agent** – provides semantic search over git commit history using vector embeddings and local SQLite storage.

**Capabilities:**

- `search_related_commits` – Find semantically similar commits
- `explain_commit_match` – Get details for a specific match
- `get_commit_diff` – Retrieve full git diff for a commit
- `reindex_commits` – Update the commit index

### [agent-template.md](./agent-template.md)

A **blueprint for creating new agents** that integrate with the orchestrator.

Contains:

- Minimal MCP agent example
- Best practices and patterns
- Common implementations (database, API, file system)
- Testing and publishing workflows

## Architecture

```
┌──────────────────────────────┐
│   Workflow Definition          │
│  (Steps, Dependencies, Logic)  │
└──────────────┬─────────────────┘
               │
┌──────────────▼─────────────────┐
│   Orchestrator Engine          │
│  (Execute, Route, Track State) │
└──────────────┬─────────────────┘
               │
    ┌──────────┴──────────┬──────────┐
    │                     │          │
┌───▼────────┐  ┌────────▼──┐  ┌───▼──────┐
│   Agent 1  │  │   Agent 2  │  │ Agent 3  │
│ (Commit    │  │  (Future)  │  │(Database)│
│   RAG)     │  │            │  │          │
└────────────┘  └────────────┘  └──────────┘
```

## Quick Start

### 1. Register Agents

```typescript
import { Orchestrator } from "@maxwellclinic/agent-orchestrator";

const orchestrator = new Orchestrator();

orchestrator.registerAgent({
  name: "commit-rag",
  executable: "npx",
  args: ["commit-rag-mcp"],
  env: {
    COMMIT_RAG_REPO: "/path/to/repo",
    OLLAMA_EMBED_MODEL: "nomic-embed-text",
  },
});
```

### 2. Define Workflow

```typescript
const workflow = {
  name: "analyze-changes",
  steps: [
    {
      id: "search",
      name: "Find related commits",
      call: {
        agent: "commit-rag",
        tool: "search_related_commits",
        input: { query: "auth improvements", limit: 5 },
      },
    },
    {
      id: "explain",
      name: "Explain first match",
      call: {
        agent: "commit-rag",
        tool: "explain_commit_match",
        input: { chunkId: "${search.output.chunkId}" },
      },
      dependsOn: ["search"],
    },
  ],
};
```

### 3. Execute Workflow

```typescript
await orchestrator.initialize();
const result = await orchestrator.execute(workflow);
console.log(result);
await orchestrator.shutdown();
```

## Workflow Concepts

### Steps

Atomic units of work targeting a specific agent tool.

```typescript
{
  id: 'unique-id',
  name: 'human readable name',
  call: {
    agent: 'agent-name',
    tool: 'tool-name',
    input: { /* tool input */ }
  },
  dependsOn: ['step-id-1', 'step-id-2'], // Optional
  condition: (ctx) => ctx.data.shouldRun,  // Optional
  onError: 'fail' | 'skip' | 'retry'
}
```

### Execution Modes

**Sequential**

```
Step 1 → Step 2 → Step 3
```

**Parallel**

```
Step 1 ──┐
         ├→ Step 3
Step 2 ──┘
```

**Conditional**

```
Step 1 → if (result) Step 2 else Step 3
```

### Error Handling

| Strategy | Behavior                              |
| -------- | ------------------------------------- |
| `fail`   | Stop workflow, return error           |
| `skip`   | Skip step, continue with dependents   |
| `retry`  | Attempt step again (up to maxRetries) |

### Timeouts

- Per-step: `call.timeout`
- Per-workflow: `workflow.timeout`
- Per-call: `agentConfig.timeout`

## Integration

### With VS Code

Register workflows as Copilot actions in `.github/copilot-instructions.md`:

```markdown
You have access to the following workflow for searching git history:

- Use the `search-commits` workflow to find related commits
- Pass natural language queries and the agent will return matches
```

### With Custom Agents

Follow the [agent-template.md](./agent-template.md) to create domain-specific agents:

- Database query agent
- Code analysis agent
- API integration agent
- File search agent

### With CI/CD

Trigger workflows from GitHub Actions:

```yaml
- run: orchestrator run reindex-commits
- run: orchestrator run analyze-changes --config ./workflows/config.json
```

## Development

### Adding a New Agent

1. Read [agent-template.md](./agent-template.md)
2. Implement MCP server with tools
3. Add tool definitions (json schema)
4. Test with `orchestrator test-agent <name>`
5. Document in `.github/agents/<name>.md`
6. Register in orchestrator

### Adding a New Workflow

1. Define steps with dependencies
2. Register all required agents
3. Test with `orchestrator run <workflow>`
4. Add to examples in orchestrator docs
5. Publish to agents registry

## Management

### List Workflows

```bash
orchestrator list-workflows
```

### Run Workflow

```bash
orchestrator run my-workflow
```

### Test Agent

```bash
orchestrator test-agent commit-rag
```

### List Agents

```bash
orchestrator list-agents
```

## Troubleshooting

### Agent Won't Start

- Check executable path: `which npx`
- Verify args: `npx commit-rag-mcp --help`
- Check environment variables
- Review stderr logs

### Tool Call Fails

- Verify tool exists: `orchestrator test-agent <name>`
- Check input schema matches
- Review timeout settings
- Check agent logs

### Workflow Hangs

- Check for circular dependencies
- Verify all required agents are registered
- Increase workflow timeout
- Review execution log: `orchestrator logs`

## Performance

- Typical workflow: ~5-20s (depends on agents)
- Parallel steps: Near-linear speedup
- Memory: ~50MB base + agent overhead
- CPU: Varies by agent complexity

## Roadmap

- [ ] Streaming results from agents
- [ ] Workflow visualization UI
- [ ] Agent discovery & auto-composition
- [ ] Distributed execution (horizontal scaling)
- [ ] Advanced retry strategies (backoff, circuit breaker)
- [ ] Agent resource monitoring
- [ ] Workflow caching & memoization
- [ ] Multi-tenant support

## References

- **MCP Protocol**: https://modelcontextprotocol.io/
- **Agent Orchestration**: https://en.wikipedia.org/wiki/Orchestration_(computing)
- **Workflow Engines**: DAG-based execution (Airflow, Prefect, Dask)
- **Error Recovery**: Retry patterns, idempotency, saga pattern
