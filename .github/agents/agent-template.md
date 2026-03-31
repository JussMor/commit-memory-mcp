# Agent Template (Current Contract)

Use this template when creating new MCP agents for Maxwell Clinic.

## Required Characteristics

1. Explicit tool schemas.
2. Deterministic output shape.
3. Migration notes for breaking changes.
4. Async-team-safe pre-plan context integration.

## Minimal Tool Set Structure

```typescript
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "example_tool",
      description: "Describe what this tool guarantees.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
  ],
}));
```

## Documentation Requirements

Each new agent must document:

1. Canonical source-of-truth hierarchy.
2. Required pre-plan sequence.
3. Deprecated tools (if any) with migration mapping.
4. Validation and failure modes.

## Team Policy Hook

If your agent affects planning quality, provide a single orchestration tool equivalent to `pre_plan_sync_brief`.
