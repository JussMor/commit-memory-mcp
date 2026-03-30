# Agent Orchestrator

An intelligent workflow coordinator that manages multi-agent systems using MCP (Model Context Protocol).

## Purpose

The agent orchestrator enables complex, multi-step AI workflows by:

- Managing lifecycle of multiple MCP agents concurrently
- Routing tasks to appropriate agents based on capabilities
- Tracking execution state across distributed steps
- Recovering from failures with retry and fallback strategies
- Composing simple agent tools into sophisticated workflows

## Architecture

```
User Request
    ↓
Orchestrator (Workflow Parser)
    ↓
Agent Registry (Lifecycle Manager)
    ↓
[Agent 1] [Agent 2] [Agent 3] ...
   MCP       MCP       MCP
```

## Core Components

### 1. **Agent Registry**

Manages agent lifecycle: registration, initialization, health checks, graceful shutdown.

- `registerAgent(config)` – Register an MCP agent
- `startAgent(name)` – Start an agent process
- `stopAgent(name)` – Stop an agent
- `pingAgent(name)` – Check agent health
- `listAgents()` – Get all agent info

### 2. **Orchestrator**

Main execution engine for workflows.

- `registerAgent(config)` – Add agents to orchestrator
- `initialize(agentNames?)` – Start agents
- `execute(workflow)` – Run a workflow definition
- `shutdown()` – Clean up all agents

### 3. **Workflow Engine**

Defines and executes workflows with dependencies and conditional logic.

**Step types:**

- **Sequential**: Steps run one after another
- **Parallel**: Independent steps run concurrently (limited by depends-on)
- **Conditional**: Branch based on previous results

**Error handling:**

- `fail` – Stop workflow on error (default)
- `skip` – Skip step on error, continue
- `retry` – Retry step on failure

### 4. **MCP Client Wrapper**

Manages connection to agents via stdio and tool invocation.

## Workflow Definition

```typescript
const workflow: WorkflowDefinition = {
  name: "analyze-commits",
  description: "Search and explain commit changes",
  timeout: 60000,
  steps: [
    {
      id: "step-1",
      name: "Find related commits",
      call: {
        agent: "commit-rag",
        tool: "search_related_commits",
        input: { query: "auth improvements", limit: 5 },
      },
      dependsOn: [],
      onError: "fail",
    },
    {
      id: "step-2",
      name: "Explain first result",
      call: {
        agent: "commit-rag",
        tool: "explain_commit_match",
        input: { chunkId: "${step-1.output.chunkId}" },
      },
      dependsOn: ["step-1"],
      onError: "skip",
    },
  ],
};
```

## Agent Configuration

```typescript
const agentConfig: AgentConfig = {
  name: "commit-rag",
  executable: "npx",
  args: ["commit-rag-mcp"],
  env: {
    COMMIT_RAG_REPO: "/api/repo",
    OLLAMA_EMBED_MODEL: "nomic-embed-text",
  },
  timeout: 30000,
  autoRestart: true,
  maxRetries: 2,
};
```

## Capabilities

- ✅ Multi-agent coordination
- ✅ Tool routing and dispatch
- ✅ Dependency management (DAG execution)
- ✅ Conditional branching
- ✅ Parallel execution
- ✅ Error recovery (retry, skip, fail)
- ✅ Execution logging & tracing
- ✅ CLI for workflow management
- ✅ Rich execution context passing

## Execution Flow

1. **Parse workflow** – Validate workflow definition
2. **Initialize agents** – Start all required agents
3. **Build dependency graph** – Topological sort of steps
4. **Execute steps** – Process in dependency order
   - For each ready step:
     - Check condition
     - Route to agent
     - Call tool
     - Capture result
     - Pass output to context
5. **Error handling** – Apply onError strategy
6. **Cleanup** – Stop all agents gracefully
7. **Return results** – Structured workflow result

## Example Workflows

### Search Commits

```
1. Search for commits matching query → commit-rag
2. Display top results to user
```

### Code Review Workflow

```
1. Extract changes from PR → git-agent
2. Search related commits → commit-rag
3. Generate review comments → LLM-agent
4. Post to PR → github-agent
```

### Multi-agent Investigation

```
1. Search for related code → code-search
2. Search related commits (parallel) → commit-rag
3. Get git blame → git-agent
4. Aggregate findings → orchestrator
5. Generate summary → llm-agent
```

## CLI Usage

```bash
# List available workflows
orchestrator list-workflows

# Run a workflow
orchestrator run search-commits

# List registered agents
orchestrator list-agents

# Test agent connectivity
orchestrator test-agent commit-rag

# Run with custom config
orchestrator run analyze-commits --config /path/to/config.json
```

## Integration Points

- **VS Code**: Register orchestrator workflows as Copilot actions
- **MCP Registry**: Compose tools from multiple MCP servers
- **Custom Agents**: Add domain-specific agents (ML, data analysis, etc.)
- **Observability**: Integrate with tracing/monitoring systems

## Future Enhancements

- [ ] Streaming results from agent tools
- [ ] Workflow visualization dashboard
- [ ] Agent capability discovery & auto-routing
- [ ] Caching of agent responses
- [ ] Distributed execution (multi-process/multi-machine)
- [ ] Workflow versioning and rollback
- [ ] Agent resource monitoring (memory, CPU, timeouts)
- [ ] Advanced retry strategies (exponential backoff, circuit breaker)
