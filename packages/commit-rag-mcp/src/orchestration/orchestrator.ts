import { getDb } from "../db/client.js";
import { dispatchNextStep } from "./dispatch.js";

export interface ResearchRequest {
  question: string;
  module?: string;
  repo: string;
  maxSteps?: number;
  maxTokensPerStep?: number;
}

// ---------------------------------------------------------------------------
// getModuleContext — pre-fetch relevant context from the knowledge graph
// Returns a bounded plain-text string (~1500 tokens max) for step injection.
// ---------------------------------------------------------------------------
async function getModuleContext(
  module: string,
  question: string,
): Promise<string> {
  if (!module) return "";

  const db = await getDb();
  const safeModule = module.replace(/[^a-zA-Z0-9_-]/g, "_");

  type ContextRow = {
    summary?: string;
    details?: string;
    topic?: string;
    rationale?: string;
  };

  const result = (await db.query(
    `
      LET $mod = (SELECT id FROM module WHERE name = $name LIMIT 1)[0].id;

      LET $facts = (
        SELECT summary, rationale FROM business_fact
        WHERE module = $mod AND status IN ['promoted', 'draft']
        ORDER BY confidence DESC
        LIMIT 8
      );

      LET $notes = (
        SELECT topic, summary, details FROM knowledge_note
        WHERE module = $mod AND is_latest = true
        ORDER BY confidence DESC
        LIMIT 5
      );

      RETURN { facts: $facts, notes: $notes };
    `,
    { name: safeModule },
  )) as unknown[][];

  const payload = result.at(-1) as
    | { facts?: ContextRow[]; notes?: ContextRow[] }
    | undefined;

  if (!payload) return "";

  const lines: string[] = [`Module: ${module}`, `Question: ${question}`, ""];

  for (const f of payload.facts ?? []) {
    if (f.summary)
      lines.push(`- ${f.summary}${f.rationale ? " | " + f.rationale : ""}`);
  }
  for (const n of payload.notes ?? []) {
    if (n.topic) lines.push(`[${n.topic}] ${n.summary ?? ""}`);
  }

  return lines.join("\n").slice(0, 6000); // ~1500 tokens hard cap
}

// ---------------------------------------------------------------------------
// decomposeQuestion — rule-based step planner
// Produces up to maxSteps investigation steps from the question.
// ---------------------------------------------------------------------------
function decomposeQuestion(
  question: string,
  existingContext: string,
  maxSteps: number,
): { instruction: string; context: string }[] {
  const steps: { instruction: string; context: string }[] = [];

  steps.push({
    instruction: `Based on the existing knowledge provided, summarize what is already known about: "${question}". Identify gaps in understanding.`,
    context: existingContext,
  });

  steps.push({
    instruction: `Search recent PRs and commits for evidence related to: "${question}". Extract specific decisions and rationale.`,
    context: existingContext,
  });

  if (steps.length < maxSteps - 1) {
    steps.push({
      instruction: `Identify which modules are involved and how they interact in the context of: "${question}". Note any cross-module dependencies.`,
      context: existingContext,
    });
  }

  // Final synthesis step — context will be injected by dispatch from previous findings
  steps.push({
    instruction: `Synthesize all findings into a clear, plain-text answer to: "${question}". Maximum 400 tokens. Be direct and factual.`,
    context: "", // filled at dispatch time from previous step results
  });

  return steps.slice(0, maxSteps);
}

// ---------------------------------------------------------------------------
// startResearch — creates a session + steps and dispatches the first step
// Returns the session record ID (string).
// ---------------------------------------------------------------------------
export async function startResearch(req: ResearchRequest): Promise<string> {
  const db = await getDb();
  const maxSteps = Math.min(req.maxSteps ?? 5, 10);

  // 1. Pre-fetch relevant context from the knowledge graph
  const existingContext = await getModuleContext(
    req.module ?? "",
    req.question,
  );

  // 2. Decompose into steps
  const steps = decomposeQuestion(req.question, existingContext, maxSteps);

  // 3. Create session
  type IdRow = { id: string };
  const sessionResult = (await db.query(
    `CREATE research_session CONTENT {
      question:     $question,
      module:       $module,
      status:       'pending',
      max_steps:    $max_steps,
      steps:        [],
      findings:     [],
      final_answer: NONE,
      created_at:   time::now(),
      updated_at:   time::now()
    } RETURN id`,
    { question: req.question, module: req.module ?? null, max_steps: maxSteps },
  )) as unknown[][];

  const sessionRows = (sessionResult.at(-1) ?? []) as IdRow[];
  if (!sessionRows.length) throw new Error("Failed to create research_session");
  const sessionId = String(sessionRows[0].id);

  // 4. Persist each step
  for (let i = 0; i < steps.length; i++) {
    await db.query(
      `CREATE research_step CONTENT {
        session:      type::record($session),
        index:        $index,
        instruction:  $instruction,
        context:      $context,
        status:       'pending',
        result:       NONE,
        tokens_used:  NONE,
        created_at:   time::now(),
        completed_at: NONE
      }`,
      {
        session: sessionId,
        index: i,
        instruction: steps[i].instruction,
        context: steps[i].context,
      },
    );
  }

  // 5. Mark session running and dispatch step 0
  await db.query(
    `UPDATE type::record($id) SET status = 'running', updated_at = time::now()`,
    { id: sessionId },
  );

  await dispatchNextStep(sessionId);

  return sessionId;
}
