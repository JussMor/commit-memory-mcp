# Database Persistence Fix for commit-memory-mcp

## Problem

The `learn_feature` tool was storing context facts in the SQLite database, but the data was not being persisted to disk reliably. When the MCP server restarted, the learned feature knowledge was lost because the database wasn't properly configured for durable writes.

## Root Cause

The `openDatabase()` function in [src/db/client.ts](src/db/client.ts) was not configuring SQLite with explicit persistence pragmas. While SQLite does persist data by default, without Write-Ahead Logging (WAL) mode enabled, the timing and reliability of disk writes depends on OS-level I/O buffering.

## Solution Applied

Added three essential SQLite pragmas to the `openDatabase()` function:

```typescript
// Enable WAL mode and ensure data is persisted to disk
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");
```

### Pragma Explanations

1. **`journal_mode = WAL`** (Write-Ahead Logging)
   - Improves write performance and crash recovery
   - Writes changes to a WAL file first, then applies to main database
   - Creates `.db-wal` and `.db-shm` files alongside the main database
   - Ensures data isn't lost if the process crashes during a write

2. **`synchronous = NORMAL`**
   - Balances between safety and performance
   - Ensures data reaches the OS file buffer (sufficient for most uses)
   - Full `synchronous = FULL` is slower but adds additional fsync() call
   - Default `synchronous = OFF` would skip filesystem calls entirely

3. **`foreign_keys = ON`**
   - Enables foreign key constraint enforcement
   - Prevents data integrity issues from invalid references
   - Good practice for relational data consistency

## Impact

- ✅ `learn_feature` now persists feature knowledge permanently to disk
- ✅ Data survives across MCP server restarts
- ✅ Crash recovery improved with WAL mode
- ✅ Better data integrity with foreign key constraints

## Testing

Verified with a persistence test:

1. Creates database and writes a context fact
2. Closes and reopens database
3. Confirms data is still present after reopening
4. Tests passed ✓

## Files Modified

- [src/db/client.ts](src/db/client.ts) - Added persistence pragmas to `openDatabase()`
- No breaking changes to API or data schema
- Fully backward compatible with existing databases

## Critical: Tools Are NOW Auto-Interconnected ✓ (Fixed)

### The Problem (SOLVED)

Previously, `build_context_pack` would not automatically return learned knowledge from `learn_feature` without explicit parameter passing:

```typescript
// Stored knowledge with feature scope
learn_feature({ featureBranch: "feature/messaging" });
// → stores: scope_feature="messaging", scope_branch="feature/messaging"

// But this query returned PR metadata only ❌ [OLD BEHAVIOR]
build_context_pack();
// → returned: main branch PR facts (limit filled, learned facts never queried)
```

**Root cause**: PR metadata from `main` branch filled the result limit before learned feature facts could be included.

### The Fix: Priority-Based Knowledge Surfacing ✓

Modified `buildContextPack()` to always include learned feature facts when no explicit context is provided:

**New query priority order:**

1. **[NEW] Learned feature knowledge** (source_type='feature-agent') — reserves ~20% of limit
2. Main branch domain context (PR metadata)
3. Main branch global context (PR metadata)
4. Branch-local feature context (if branch/feature params provided)
5. Domain-wide context
6. All promoted facts (fallback)

**Behavior now:**

```typescript
// Same call returns learned knowledge ✓ [NEW BEHAVIOR]
build_context_pack();
// → returns: learned features + PR metadata
```

### How It Works

When neither `feature` nor `branch` parameters are provided, `buildContextPack` now:

1. Pre-queries all promoted `source_type='feature-agent'` facts
2. Reserves ~20% of the result limit for them
3. Then queries PR metadata for remaining slots
4. Ensures learned knowledge is never buried

### Automatic Knowledge Flow ✓

```typescript
// 1. Learn messaging feature
learn_feature({ featureBranch: "feature/messaging" });
// → stores in context_facts with source_type='feature-agent'

// 2. Later, in any session (even after server restart)
build_context_pack();
// → automatically returns:
//   - "Feature knowledge: messaging" (priority 0, confidence 0.95)
//   - + main branch PRs
//   - + other context
```

No re-learning required—knowledge persists and auto-resurfaces.

## Next Steps for Users

1. Rebuild the MCP server: `npm run build` ✓ (Already done)
2. Run `learn_feature` to store knowledge: data **will persist** across server restarts
3. Call `build_context_pack()` without parameters: learned features **will be auto-included**
4. Server restart: no knowledge loss, no re-learning needed ✓
