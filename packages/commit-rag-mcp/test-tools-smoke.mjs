#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { closeDb, getDb } from "./dist/db/client.js";
import { registerTools } from "./dist/tools/index.js";

class CaptureServer {
  constructor() {
    this.tools = new Map();
  }

  tool(name, _description, _schema, handler) {
    this.tools.set(name, { handler });
  }
}

function textFromResponse(response) {
  if (!response || !Array.isArray(response.content)) {
    return "";
  }

  return response.content
    .filter((part) => part && part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

function parseJsonSafe(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function findInArray(arr, predicate) {
  if (!Array.isArray(arr)) {
    return undefined;
  }
  return arr.find(predicate);
}

function resolveLatestMergedPr(repo) {
  try {
    const out = execFileSync(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        repo,
        "--state",
        "merged",
        "--limit",
        "1",
        "--json",
        "number",
        "--jq",
        ".[0].number",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();

    const num = Number(out);
    return Number.isFinite(num) && num > 0 ? num : null;
  } catch {
    return null;
  }
}

// Global db reference for cleanup in error handlers
let globalDb = null;

async function main() {
  console.log("Starting smoke test...");
  const strict = process.env.SMOKE_STRICT !== "0";
  const repo = process.env.SMOKE_REPO ?? "JussMor/commit-memory-mcp";
  const baseModule = process.env.SMOKE_MODULE ?? `smoke_${Date.now()}`;
  const relatedModule = `${baseModule}_related`;
  const filePath =
    process.env.SMOKE_FILE ??
    "packages/commit-rag-mcp/src/layers/coordination.ts";
  const prNumber =
    Number(process.env.SMOKE_PR_NUMBER || "") || resolveLatestMergedPr(repo);

  // SurrealDB connection config (matching getDb() from dist)
  const surrealUrl = process.env.SURREAL_URL ?? "wss://tiny-castle-06ekdrmp2dssb3v1golua9pue0.aws-usw2.surreal.cloud/rpc";
  const surrealUser = process.env.SURREAL_USER ?? "root";
  const surrealNs = process.env.SURREAL_NS ?? "main";
  const surrealDb = process.env.SURREAL_DB ?? "main";

  console.log(`\nSurrealDB Configuration:`);
  console.log(`  URL: ${surrealUrl}`);
  console.log(`  Namespace: ${surrealNs}`);
  console.log(`  Database: ${surrealDb}`);
  console.log(`  User: ${surrealUser}\n`);

  // This test will connect to SurrealDB to validate round-trip data persistence.
  // If connection fails, tools will still run but data assertions will be skipped.
  console.log("Connecting to SurrealDB (optional for data validation)...");
  let dbConnected = false;
  try {
    globalDb = await Promise.race([
      getDb(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("DB connection timeout after 10s")), 10000)
      ),
    ]);
    const ping = await globalDb.query("RETURN { ok: true, now: time::now() };");
    if (!Array.isArray(ping) || ping.length === 0) {
      throw new Error("Connected to SurrealDB but ping query returned no result");
    }
    console.log("SurrealDB connection OK - data assertions enabled");
    dbConnected = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[INFO] DB connection unavailable: ${message}`);
    console.log("[INFO] Running tools smoke test without data persistence assertions.");
  }

  const fakeServer = new CaptureServer();
  registerTools(fakeServer);

  const expectedTools = [
    "sync_pr_context",
    "ingest_pr",
    "ingest_business_facts",
    "ingest_knowledge",
    "get_overnight_brief",
    "get_handoff_summary",
    "pre_plan_sync_brief",
    "who_changed_this",
    "why_was_this_changed",
    "get_module_overview",
    "get_latest_knowledge",
    "get_knowledge_lineage",
    "get_module_graph",
    "search_context",
    "get_decision_log",
    "get_stale_knowledge",
    "get_cross_module_impact",
    "list_active_worktrees",
    "get_team_activity",
    "promote_facts",
    "link_modules",
    "flag_decision",
  ];

  const missing = expectedTools.filter((name) => !fakeServer.tools.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing tool registrations: ${missing.join(", ")}`);
  }

  let latestKnowledgeId = null;
  const results = [];
  const state = {
    writtenKnowledge: null,
    retrievedKnowledge: null,
    linkedModules: [],
    flaggedDecisionId: null,
    searchResults: null,
    moduleGraph: null,
  };

  async function runTool(name, args, opts = {}) {
    const tool = fakeServer.tools.get(name);
    const start = Date.now();

    if (!tool) {
      results.push({
        name,
        status: "FAIL",
        durationMs: Date.now() - start,
        details: "Tool not registered",
      });
      return;
    }

    try {
      const response = await tool.handler(args);
      const output = textFromResponse(response);

      // Capture state for round-trip assertions
      if (name === "ingest_knowledge") {
        const payload = parseJsonSafe(output);
        state.writtenKnowledge = {
          topic: args.topic,
          findings: args.findings,
          module: args.module,
          relatedModules: args.related_modules || [],
          tags: args.tags || [],
        };
      }

      if (name === "get_latest_knowledge") {
        const payload = parseJsonSafe(output);
        const firstId = payload?.latest?.[0]?.id;
        latestKnowledgeId = firstId ? String(firstId) : null;
        if (payload?.latest?.[0]) {
          state.retrievedKnowledge = payload.latest[0];
        }
      }

      if (name === "link_modules") {
        state.linkedModules.push({
          from: args.from,
          to: args.to,
          relation: args.relation,
        });
      }

      if (name === "get_module_graph") {
        const payload = parseJsonSafe(output);
        state.moduleGraph = payload;
      }

      if (name === "search_context") {
        const payload = parseJsonSafe(output);
        state.searchResults = payload;
      }

      results.push({
        name,
        status: "PASS",
        durationMs: Date.now() - start,
        details: output.slice(0, 180).replace(/\s+/g, " "),
      });
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      const canSkip =
        Boolean(opts.optional) ||
        (!prNumber && (name === "ingest_pr" || name === "ingest_business_facts"));
      results.push({
        name,
        status: canSkip ? "SKIP" : "FAIL",
        durationMs: Date.now() - start,
        details,
      });
    }
  }

  await runTool("sync_pr_context", { repo, limit: 5 });
  await runTool("get_overnight_brief", { repo, hours: 48 });
  await runTool("get_handoff_summary", {
    since_hours: 48,
    modules: [baseModule],
  });
  await runTool("pre_plan_sync_brief", { repo, module: baseModule });
  await runTool("list_active_worktrees", {});
  await runTool("get_team_activity", { repo, since_hours: 24 });
  await runTool("link_modules", {
    from: baseModule,
    to: relatedModule,
    relation: "affects",
  });
  await runTool("ingest_knowledge", {
    module: baseModule,
    topic: "Smoke tool coverage",
    findings: "Smoke test knowledge note to validate tool plumbing.",
    route: "/smoke",
    feature: "tool-smoke",
    related_modules: [relatedModule],
    tags: ["smoke", "tools"],
  });
  await runTool("get_latest_knowledge", {
    module: baseModule,
    topic: "Smoke tool coverage",
    limit: 5,
  });

  if (latestKnowledgeId) {
    await runTool("flag_decision", {
      record_id: latestKnowledgeId,
      severity: "decision",
      reason: "Smoke-test flag",
    });
    state.flaggedDecisionId = latestKnowledgeId;
  } else {
    results.push({
      name: "flag_decision",
      status: strict ? "FAIL" : "SKIP",
      durationMs: 0,
      details: "No knowledge note id found from get_latest_knowledge",
    });
  }

  await runTool("get_module_overview", { module: baseModule });
  await runTool("get_knowledge_lineage", {
    module: baseModule,
    topic: "Smoke tool coverage",
    depth: 5,
  });
  await runTool("get_module_graph", { module: baseModule });
  await runTool("search_context", {
    module: baseModule,
    query: "smoke tool coverage",
    limit: 5,
  });
  await runTool("get_decision_log", {
    module: baseModule,
    include_archived: true,
  });
  await runTool("get_stale_knowledge", { module: baseModule, stale_days: 1 });
  await runTool("get_cross_module_impact", {
    repo,
    file_paths: [filePath],
  });
  await runTool("who_changed_this", { file: filePath, repo });
  await runTool("why_was_this_changed", { file: filePath, repo });
  await runTool("promote_facts", { module: baseModule });

  if (prNumber) {
    await runTool("ingest_pr", { repo, pr_number: prNumber });
    await runTool("ingest_business_facts", {
      repo,
      pr_number: prNumber,
      module: baseModule,
    });
  } else {
    results.push({
      name: "ingest_pr",
      status: strict ? "FAIL" : "SKIP",
      durationMs: 0,
      details: "No PR number available. Set SMOKE_PR_NUMBER.",
    });
    results.push({
      name: "ingest_business_facts",
      status: strict ? "FAIL" : "SKIP",
      durationMs: 0,
      details: "No PR number available. Set SMOKE_PR_NUMBER.",
    });
  }

  console.log("\nTool smoke test summary\n");
  for (const result of results) {
    const label = result.status.padEnd(4, " ");
    console.log(`${label} ${result.name} (${result.durationMs}ms)`);
    if (result.details) {
      console.log(`  ${result.details}`);
    }
  }

  const failed = results.filter((result) => result.status === "FAIL");
  const skipped = results.filter((result) => result.status === "SKIP");
  const passed = results.filter((result) => result.status === "PASS");

  console.log(
    `\nTotals: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`,
  );

  // Database round-trip assertions
  console.log("\n--- Database Round-trip Validation ---\n");
  const dbAssertions = [];

  if (state.writtenKnowledge && state.retrievedKnowledge) {
    const topicMatch =
      state.retrievedKnowledge.topic === state.writtenKnowledge.topic;
    const detailsMatch =
      state.retrievedKnowledge.details === state.writtenKnowledge.findings;
    const tagsMatch =
      state.retrievedKnowledge.tags?.length ===
      state.writtenKnowledge.tags?.length;

    dbAssertions.push({
      check: "Knowledge note persisted and retrieved",
      pass: topicMatch && detailsMatch && tagsMatch,
      details: `topic: ${topicMatch}, details: ${detailsMatch}, tags: ${tagsMatch}`,
    });
  } else {
    dbAssertions.push({
      check: "Knowledge note persisted and retrieved",
      pass: false,
      details: "Written or retrieved knowledge not captured",
    });
  }

  if (state.linkedModules.length > 0 && state.moduleGraph) {
    const linkedInGraph = state.linkedModules.every((link) => {
      const affects = state.moduleGraph.affects || [];
      return findInArray(affects, (edge) => edge.from === link.from && edge.to === link.to);
    });
    dbAssertions.push({
      check: "Module links persisted in graph",
      pass: linkedInGraph,
      details: `linked: ${state.linkedModules.length}, found in graph: ${linkedInGraph}`,
    });
  } else {
    dbAssertions.push({
      check: "Module links persisted in graph",
      pass: false,
      details: "No module links or graph data captured",
    });
  }

  if (state.flaggedDecisionId && state.retrievedKnowledge) {
    const hasDecisionTag = (state.retrievedKnowledge.tags || []).includes(
      "decision",
    );
    const confidenceHigher = state.retrievedKnowledge.confidence >= 0.95;
    dbAssertions.push({
      check: "Flagged decision persisted",
      pass: hasDecisionTag && confidenceHigher,
      details: `has decision tag: ${hasDecisionTag}, confidence >= 0.95: ${confidenceHigher}`,
    });
  } else {
    dbAssertions.push({
      check: "Flagged decision persisted",
      pass: false,
      details: "No flagged decision or retrieved knowledge to verify",
    });
  }

  if (state.writtenKnowledge && state.searchResults) {
    const searchFoundWritten = findInArray(state.searchResults.results, (r) =>
      (r.topic || "").includes(state.writtenKnowledge.topic.split(" ")[0]),
    );
    dbAssertions.push({
      check: "Semantic search finds written knowledge",
      pass: Boolean(searchFoundWritten),
      details: `search query: "${state.writtenKnowledge.topic}", found: ${Boolean(searchFoundWritten)}`,
    });
  } else {
    dbAssertions.push({
      check: "Semantic search finds written knowledge",
      pass: false,
      details: "No written knowledge or search results captured",
    });
  }

  for (const assertion of dbAssertions) {
    const label = assertion.pass ? "✓" : "✗";
    console.log(`${label} ${assertion.check}`);
    console.log(`  ${assertion.details}`);
  }

  const dbPasses = dbAssertions.filter((a) => a.pass).length;
  const dbTotal = dbAssertions.length;
  console.log(`\nDB assertions: ${dbPasses}/${dbTotal} passed`);

  const dbFailed = dbAssertions.filter((a) => !a.pass);
  const shouldExitWithError =
    failed.length > 0 ||
    (strict && skipped.length > 0) ||
    (dbConnected && dbFailed.length > 0);

  if (shouldExitWithError) {
    if (globalDb) await closeDb();
    process.exitCode = 1;
    return;
  }

  console.log(
    "\nAll requested feature tools completed successfully" +
      (dbConnected ? " and data persisted to DB." : "."),
  );
  if (globalDb) await closeDb();
}

main().catch(async (error) => {
  if (globalDb) await closeDb();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
