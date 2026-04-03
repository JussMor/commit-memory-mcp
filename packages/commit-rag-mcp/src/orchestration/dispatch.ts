import { getDb } from "../db/client.js";
import type { ResearchFinding, ResearchStep } from "../types.js";
import { assembleAnswer } from "./assemble.js";

// ---------------------------------------------------------------------------
// getPreviousFindings — aggregate findings from all steps before `beforeIndex`
// Injected as context into the next step so the agent builds on prior work.
// ---------------------------------------------------------------------------
async function getPreviousFindings(
  sessionId: string,
  beforeIndex: number,
): Promise<string> {
  const db = await getDb();

  type Row = { text: string };
  const result = (await db.query(
    `
      SELECT text FROM research_finding
      WHERE session = type::record($session)
        AND step.index < $index
      ORDER BY step.index ASC
    `,
    { session: sessionId, index: beforeIndex },
  )) as unknown[][];

  const rows = (result.at(-1) ?? []) as Row[];
  return rows.map((r) => r.text).join("\n\n");
}

// ---------------------------------------------------------------------------
// dispatchNextStep — find the next pending step, inject context, mark running
// Called recursively by executeStep after each step completes.
// ---------------------------------------------------------------------------
export async function dispatchNextStep(sessionId: string): Promise<void> {
  const db = await getDb();

  type Row = { id: string; index: number; context: string };
  const result = (await db.query(
    `
      SELECT id, index, context FROM research_step
      WHERE session = type::record($session)
        AND status = 'pending'
      ORDER BY index ASC
      LIMIT 1
    `,
    { session: sessionId },
  )) as unknown[][];

  const rows = (result.at(-1) ?? []) as Row[];

  if (!rows.length) {
    // No more pending steps — assemble final answer
    await assembleAnswer(sessionId);
    return;
  }

  const step = rows[0];

  // For step index > 0 inject prior findings into context
  if (step.index > 0) {
    const previousFindings = await getPreviousFindings(sessionId, step.index);
    if (previousFindings) {
      const augmentedContext =
        step.context + "\n\n---\nPrevious findings:\n" + previousFindings;
      await db.query(`UPDATE type::record($id) SET context = $ctx`, {
        id: String(step.id),
        ctx: augmentedContext,
      });
    }
  }

  await db.query(`UPDATE type::record($id) SET status = 'running'`, {
    id: String(step.id),
  });
  await db.query(
    `UPDATE type::record($id) SET status = 'waiting_agent', updated_at = time::now()`,
    { id: sessionId },
  );

  console.log(
    `[orchestrator] step ${step.index} dispatched for session ${sessionId}`,
  );
}

// ---------------------------------------------------------------------------
// getRunningStep — public helper for tools that need to find the active step
// ---------------------------------------------------------------------------
export async function getRunningStep(
  sessionId: string,
): Promise<ResearchStep | null> {
  const db = await getDb();

  const result = (await db.query(
    `
      SELECT * FROM research_step
      WHERE session = type::record($session)
        AND status = 'running'
      LIMIT 1
    `,
    { session: sessionId },
  )) as unknown[][];

  const rows = (result.at(-1) ?? []) as ResearchStep[];
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// getSessionFindings — all findings for a session ordered by step index
// ---------------------------------------------------------------------------
export async function getSessionFindings(
  sessionId: string,
): Promise<ResearchFinding[]> {
  const db = await getDb();

  const result = (await db.query(
    `
      SELECT *, step.index AS step_index FROM research_finding
      WHERE session = type::record($session)
      ORDER BY step_index ASC
    `,
    { session: sessionId },
  )) as unknown[][];

  return (result.at(-1) ?? []) as ResearchFinding[];
}
