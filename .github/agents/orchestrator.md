# Agent Orchestrator

Workflow coordination guide for Commit Memory MCP.

## Mandatory Pre-Plan Sequence

Every planning workflow must begin with:

1. `sync_pr_context`
2. `get_main_branch_overnight_brief`
3. `resume_feature_session_brief`

Or use:

- `pre_plan_sync_brief` (single orchestration call)

## Recommended Workflow Definition

```typescript
const workflow = {
  name: "pre-plan-context",
  steps: [
    {
      id: "brief",
      call: {
        agent: "commit-memory",
        tool: "pre_plan_sync_brief",
        input: {
          owner: "MaxwellClinic-Development",
          repo: "EverBetter-Pro",
          baseBranch: "main",
        },
      },
    },
  ],
};
```

## Safety Rules

1. Do not plan implementation before pre-plan brief succeeds.
2. Treat blocker decisions as hard constraints.
3. If overlap files exist, prioritize sync/rebase tasks before feature expansion.

## Deprecated Workflow References

Do not compose workflows with legacy commit-only tools. They are removed from the MCP contract.
