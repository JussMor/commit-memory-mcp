# Agent Template

A blueprint for creating new MCP agents that integrate with the orchestrator.

## Structure

Every agent should have:

1. **Agent Server** – MCP stdio server that exposes tools
2. **Tool Definitions** – JSON schemas describing capabilities
3. **Implementation** – Tool handlers with input validation & error handling
4. **Configuration** – Registration details for orchestrator

## Minimal Agent Example

```typescript
#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

async function main() {
  const server = new Server(
    { name: "my-agent", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // Define available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "greet",
        description: "Greet a person by name",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Person to greet" },
          },
          required: ["name"],
        },
      },
    ],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "greet") {
      const name = request.params.arguments?.name || "World";
      return {
        content: [{ type: "text", text: `Hello, ${name}!` }],
      };
    }

    return {
      content: [{ type: "text", text: "Unknown tool" }],
      isError: true,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

## Package Setup

```json
{
  "name": "@maxwellclinic/my-agent",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "my-agent": "./dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.11.0"
  }
}
```

## Registration with Orchestrator

```typescript
const orchestrator = new Orchestrator();

orchestrator.registerAgent({
  name: "my-agent",
  executable: "npx",
  args: ["@maxwellclinic/my-agent"],
  timeout: 10000,
  autoRestart: true,
  maxRetries: 1,
});

// Use in workflows
const result = await orchestrator.execute({
  name: "demo",
  steps: [
    {
      id: "greet-step",
      name: "Greet User",
      call: {
        agent: "my-agent",
        tool: "greet",
        input: { name: "Alice" },
      },
    },
  ],
});
```

## Best Practices

### 1. **Tool Design**

- Keep tools focused and single-purpose
- Use clear, descriptive names (verb-noun pattern)
- Provide detailed descriptions and examples in input schema

### 2. **Error Handling**

```typescript
if (request.params.name === "myTool") {
  try {
    const result = await doWork(request.params.arguments);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : "Unknown error",
        },
      ],
      isError: true,
    };
  }
}
```

### 3. **Input Validation**

```typescript
const input = request.params.arguments as Record<string, unknown>;
const query = String(input.query ?? "").trim();

if (!query) {
  return {
    content: [{ type: "text", text: "query is required" }],
    isError: true,
  };
}
```

### 4. **Resource Management**

- Close connections on stdin error
- Handle SIGTERM gracefully
- Clean up temp files on exit
- Set reasonable timeouts

### 5. **Logging**

- Log important events to stderr (stdout reserved for MCP protocol)
- Include timestamps and context
- Use structured logging for parsing

```typescript
const log = (msg: string) => {
  process.stderr.write(`[my-agent] ${new Date().toISOString()} ${msg}\n`);
};
```

## Common Patterns

### Database Agent

```typescript
const server = new Server(...);
let db; // Connection pool

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'query',
      description: 'Execute SQL query',
      inputSchema: { /* schema */ }
    },
    {
      name: 'schema',
      description: 'Get database schema',
      inputSchema: { /* schema */ }
    }
  ]
}));
```

### API Agent

```typescript
const server = new Server(...);

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'api_call') {
    const url = request.params.arguments?.url;
    const response = await fetch(url);
    const data = await response.json();
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  }
});
```

### File System Agent

```typescript
const server = new Server(...);

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'read_file') {
    const path = request.params.arguments?.path;
    const content = await fs.readFile(path, 'utf8');
    return { content: [{ type: 'text', text: content }] };
  }
});
```

## Testing

```typescript
// test-agent.ts
import { MCPClientWrapper } from "@maxwellclinic/agent-orchestrator";

async function testAgent() {
  const client = new MCPClientWrapper();

  // Start agent process
  const proc = spawn("npx", ["my-agent"]);

  await client.connect({ process: proc });

  // List tools
  const tools = await client.getClient().listTools();
  console.log("Available tools:", tools);

  // Call tool
  const result = await client.getClient().callTool({
    name: "greet",
    arguments: { name: "Test" },
  });

  console.log("Result:", result);
}
```

## Publishing

```bash
npm run build
npm publish --access public
```

Then agents can be installed:

```bash
npm install @maxwellclinic/my-agent
orchestrator register my-agent @maxwellclinic/my-agent
```

## Integration Checklist

- [ ] Tool descriptions are clear and informative
- [ ] Input schemas are complete with required fields
- [ ] Error messages are helpful
- [ ] Agent starts cleanly (< 1sec)
- [ ] Tool calls complete within timeout
- [ ] Resources are cleaned up properly
- [ ] Published to npm with clear versioning
- [ ] Compatible with Node.js ≥ 20
- [ ] Documented in agent registry
