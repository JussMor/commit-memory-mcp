import { getDb } from "../db/client.js";
import type { ResearchFinding, ResearchSession } from "../types.js";

// ---------------------------------------------------------------------------
// rankFindings — deduplicate by first 50 chars and sort by confidence desc
// ---------------------------------------------------------------------------
function rankFindings(findings: ResearchFinding[]): ResearchFinding[] {
  const seen = new Set<string>();
  return findings
    .filter((f) => {
      const key = f.text.slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.confidence - a.confidence);
}

// ---------------------------------------------------------------------------
// promoteToKnowledgeNote — elevates a high-confidence finding to permanent
// knowledge_note so it persists beyond the research session lifetime.
// ---------------------------------------------------------------------------
async function promoteToKnowledgeNote(
  finding: ResearchFinding,
): Promise<string | null> {
  if (!finding.text.trim()) return null;

  const db = await getDb();

  const safeModule = finding.module.replace(/[^a-zA-Z0-9_-]/g, "_");
  const moduleLookup = (await db.query(
    `SELECT id FROM module WHERE name = $name LIMIT 1`,
    { name: safeModule },
  )) as unknown[][];

  const moduleRows = (moduleLookup.at(-1) ?? []) as Array<{ id: string }>;
  if (!moduleRows.length) return null;

  const moduleId = String(moduleRows[0].id);
  const summary = finding.text.slice(0, 200);
  const topicKey = `research_${finding.session}_${finding.step}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );

  type IdRow = { id: string };
  const created = (await db.query(
    `CREATE knowledge_note CONTENT {
      module:          type::record($module_id),
      topic:           $topic,
      topic_key:       $topic_key,
      summary:         $summary,
      details:         $details,
      source_type:     'research_session',
      source_ref:      $source_ref,
      tags:            ['research', 'auto-promoted'],
      related_modules: [],
      content_hash:    $topic_key,
      version:         1,
      is_latest:       true,
      confidence:      $confidence,
      search_text:     $search_text,
      embedding:       [],
      created_at:      time::now(),
      updated_at:      time::now()
    } RETURN id`,
    {
      module_id: moduleId,
      topic: `Research finding: ${summary.slice(0, 60)}`,
      topic_key: topicKey,
      summary,
      details: finding.text,
      source_ref: String(finding.session),
      confidence: finding.confidence,
      search_text: finding.text.toLowerCase(),
    },
  )) as unknown[][];

  const createdRows = (created.at(-1) ?? []) as IdRow[];
  return createdRows[0]?.id ? String(createdRows[0].id) : null;
}

// ---------------------------------------------------------------------------
// assembleAnswer — collect all findings, deduplicate, build final_answer text,
// promote high-confidence findings to permanent knowledge.
// ---------------------------------------------------------------------------
export async function assembleAnswer(sessionId: string): Promise<void> {
  const db = await getDb();

  // Mark session as assembling
  await db.query(
    `UPDATE type::record($id) SET status = 'assembling', updated_at = time::now()`,
    { id: sessionId },
  );

  type FindingRow = ResearchFinding & { step_index?: number };
  const result = (await db.query(
    `
      SELECT text, confidence, module,
        step.index AS step_index,
        id, session, step, promotes_to, created_at
      FROM research_finding
      WHERE session = type::record($session)
      ORDER BY step_index ASC, confidence DESC
    `,
    { session: sessionId },
  )) as unknown[][];

  const findings = (result.at(-1) ?? []) as FindingRow[];

  const [sessionResult] = (await db.query(
    `SELECT question FROM research_session WHERE id = type::record($id) LIMIT 1`,
    { id: sessionId },
  )) as unknown[][];

  const sessionRows = (sessionResult ?? []) as Array<{
    question?: string;
  }>;
  const question = sessionRows[0]?.question ?? "Unknown question";

  const ranked = rankFindings(findings);

  const finalAnswer = [
    `Research Question: ${question}`,
    "",
    "Findings:",
    ...ranked.map((f, i) => `${i + 1}. ${f.text}`),
  ].join("\n");

  // Persist final answer
  await db.query(
    `UPDATE type::record($id) SET final_answer = $answer, status = 'complete', updated_at = time::now()`,
    { id: sessionId, answer: finalAnswer },
  );

  // Auto-promote high-confidence findings to permanent knowledge
  const highConfidence = findings.filter((f) => f.confidence >= 0.8);
  for (const finding of highConfidence) {
    const noteId = await promoteToKnowledgeNote(finding as ResearchFinding);
    if (noteId) {
      await db.query(
        `UPDATE type::record($id) SET promotes_to = type::record($note)`,
        { id: String(finding.id), note: noteId },
      );
    }
  }

  console.log(
    `[orchestrator] research complete for ${sessionId}. ${ranked.length} findings assembled.`,
  );
}

// ---------------------------------------------------------------------------
// promoteAllFindings — manually promote all unpromoted findings in a session
// Called by the promote_research_findings tool after dev validation.
// ---------------------------------------------------------------------------
export async function promoteAllFindings(sessionId: string): Promise<number> {
  const db = await getDb();

  const result = (await db.query(
    `
      SELECT * FROM research_finding
      WHERE session = type::record($session)
        AND promotes_to = NONE
    `,
    { session: sessionId },
  )) as unknown[][];

  const findings = (result.at(-1) ?? []) as ResearchFinding[];

  let promoted = 0;
  for (const f of findings) {
    const noteId = await promoteToKnowledgeNote(f);
    if (noteId) {
      await db.query(
        `UPDATE type::record($id) SET promotes_to = type::record($note)`,
        { id: String(f.id), note: noteId },
      );
      promoted++;
    }
  }

  return promoted;
}

// ---------------------------------------------------------------------------
// getResearchStatus — snapshot for the get_research_status tool
// ---------------------------------------------------------------------------
export async function getResearchStatus(sessionId: string): Promise<string> {
  const db = await getDb();

  const [sessionResult, stepsResult, findingsResult] = (await db.query(
    `
      SELECT * FROM type::record($session);

      SELECT index, instruction, status, tokens_used, completed_at
      FROM research_step
      WHERE session = type::record($session)
      ORDER BY index;

      SELECT text, confidence, module FROM research_finding
      WHERE session = type::record($session)
      ORDER BY step.index ASC;
    `,
    { session: sessionId },
  )) as unknown[][];

  const session = ((sessionResult ?? []) as unknown[])[0];

  return JSON.stringify(
    {
      session,
      steps: stepsResult ?? [],
      findings: findingsResult ?? [],
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// getResearchResult — returns the final answer or status if not done
// ---------------------------------------------------------------------------
export async function getResearchResult(sessionId: string): Promise<string> {
  const db = await getDb();

  const result = (await db.query(
    `SELECT status, final_answer FROM research_session WHERE id = type::record($id) LIMIT 1`,
    { id: sessionId },
  )) as unknown[][];

  const rows = (result.at(-1) ?? []) as Array<{
    status?: ResearchSession["status"];
    final_answer?: string;
  }>;

  if (!rows.length) return `Session ${sessionId} not found`;

  const row = rows[0];
  if (row.status !== "complete") {
    return `Research still in progress. Status: ${row.status ?? "unknown"}\nUse get_research_status to see step details.`;
  }

  return row.final_answer ?? "Session complete but no answer was assembled.";
}
