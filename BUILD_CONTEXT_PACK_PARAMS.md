# build_context_pack — Enhanced Parameters

## New Parameters

### `forceRefresh` (boolean, optional)

Re-run the `learn_feature` process to update stored feature knowledge. Useful when you want to seed fresh context without manually calling `learn_feature` separately.

```json
{
  "feature": "messaging",
  "forceRefresh": true
}
```

### `summarizePR` (boolean, optional)

Return PR metadata as compact summaries instead of full content. Reduces token usage while preserving key information.

```json
{
  "summarizePR": true,
  "limit": 20
}
```

## Response Structure

The tool now returns a categorized object instead of a flat array:

```json
{
  "learnedFeature": [
    {
      "id": "...",
      "sourceType": "feature-agent",
      "title": "Feature knowledge: messaging",
      "content": "...",
      "confidence": 0.95,
      ...
    }
  ],
  "branchContext": [
    {
      "id": "...",
      "sourceType": "commit",
      "title": "...",
      "branch": "feature/messaging",
      ...
    }
  ],
  "prMetadata": [
    {
      "id": "...",
      "sourceType": "pr_description",
      "title": "[#2778] Messaging UI refactor",
      "content": "[#2778] Messaging UI refactor — Fixed scroll...",
      ...
    }
  ],
  "allContext": [
    // All items mixed together for backward compatibility
  ]
}
```

## Usage Examples

### Example 1: Get context with learned feature knowledge prioritized

```json
{
  "domain": "messaging",
  "feature": "messaging",
  "limit": 20
}
```

Returns:

- Learned feature facts first (if available from previous `learn_feature` calls)
- Branch-specific changes
- Recent PR metadata

### Example 2: Summarized PR context only

```json
{
  "summarizePR": true,
  "limit": 30
}
```

Returns PR metadata condensed to one-liners like:

```
"[#2778] Messaging UI refactor — Fixed scroll..."
```

### Example 3: Refresh and retrieve fresh feature context

```json
{
  "feature": "messaging",
  "forceRefresh": true,
  "summarizePR": true,
  "limit": 25
}
```

This:

1. ✓ Re-seeds feature knowledge from commits/PR data
2. ✓ Returns it with highest priority
3. ✓ Summarizes PR metadata
4. ✓ Limits to top 25 results

## How It Works

### Data Persistence

- `learn_feature` stores knowledge with `scope_feature` and `source_type='feature-agent'`
- Data persists to SQLite WAL database
- **Survives MCP server restarts** ✓
- No need to re-learn after restart

### Automatic Interconnection

1. `learn_feature` + `build_context_pack` are now **auto-connected**
2. `forceRefresh` allows explicit re-seeding without code changes
3. Learned facts are **automatically returned** in priority order
4. You don't need to specify feature parameters if learned facts exist

### Categorization Logic

- **learnedFeature**: `source_type='feature-agent'` (highest priority)
- **branchContext**: Items with `branch != 'main'` (active work)
- **prMetadata**: `source_type` starts with `pr_` (GitHub data)
- **allContext**: All results combined (backward compatibility)

## Migration Notes

Old calls without parameters still work:

```json
{
  "limit": 20
}
```

Will return the same `allContext` array as before. Use the new parameters to access categorized results.
