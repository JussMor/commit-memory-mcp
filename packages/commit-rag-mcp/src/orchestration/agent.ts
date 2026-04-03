import { getDb } from "../db/client.js";
import type { ResearchFinding, ResearchStep } from "../types.js";
import { dispatchNextStep } from "./dispatch.js";

const MAX_STEP_TOKENS = 1500;
const MAX_RESULT_CHARS = MAX_STEP_TOKENS * 4; // ~4 chars per token

// ---------------------------------------------------------------------------
// buildStepPrompt — formats the instruction + context for the research agent.
// This is what would be sent to an LLM when integrated with one.
// ---------------------------------------------------------------------------
export function buildStepPrompt(step: ResearchStep): string {
  return `You are a research agent investigating a codebase.
Your task for this step is:

${step.instruction}

Relevant context (do not repeat this — use it to inform your answer):
${step.context || "(no prior context)"}

Instructions:
- Be specific and factual
- Reference PR numbers or module names when relevant
- Keep your answer under 400 tokens
- If you find nothing relevant, say so explicitly`.trim();
}

// ---------------------------------------------------------------------------
// extractFindings — splits a step result text into discrete finding records.
// Each paragraph (>20 chars) becomes a separate research_finding entry.
// In production this would use structured LLM output.
// ---------------------------------------------------------------------------
function extractFindings(
  result: string,
  step: ResearchStep,
  defaultModule: string,
): { module: string; text: string; confidence: number }[] {
  return result
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 20)
    .map((paragraph) => ({
      module: defaultModule,
      text: paragraph,
      confidence: 0.6,
    }));
}

// ---------------------------------------------------------------------------
// executeStep — core research agent work unit.
// Reads a running step, processes it, writes findings, advances the session.
// ---------------------------------------------------------------------------
export async function executeStep(stepId: string): Promise<void> {
  const db = await getDb();

  type RawStep = ResearchStep & {
    session: { id?: string } | string;
    module?: string;
  };
  const stepResult = (await db.query(`SELECT * FROM type::record($id)`, {
    id: stepId,
  })) as unknown[][];
  const stepRows = (stepResult.at(-1) ?? []) as RawStep[];
  const step = stepRows[0] ?? null;

  if (!step || step.status !== "running") {
    console.warn(`[agent] step ${stepId} not found or not running`);
    return;
  }

  const sessionId =
    typeof step.session === "string"
      ? step.session
      : ((step.session as { id?: string }).id ?? String(step.session));

  try {
    // Build the prompt that would be sent to an LLM
    const prompt = buildStepPrompt(step as ResearchStep);

    // When COMMIT_RAG_LLM_URL is configured, delegate to an external LLM.
    // Otherwise produce a bounded placeholder result so the session can advance.
    let result: string;

    const llmUrl = process.env.COMMIT_RAG_LLM_URL?.trim();
    if (llmUrl) {
      result = await callExternalLlm(llmUrl, prompt);
    } else {
      // Graceful no-LLM fallback: echo the instruction as a to-do note so
      // the session still advances and findings populate the graph.
      result = `[Pending LLM evaluation]\n\nStep ${step.index}: ${step.instruction}\n\nContext available: ${step.context ? "yes" : "no"}`;
    }

    // Trim to token budget
    const bounded = result.slice(0, MAX_RESULT_CHARS);

    // Extract findings and persist
    const findings = extractFindings(
      bounded,
      step as ResearchStep,
      step.module ?? "unknown",
    );

    for (const finding of findings) {
      await db.query(
        `CREATE research_finding CONTENT {
          session:     type::record($session),
          step:        type::record($step),
          module:      $module,
          text:        $text,
          confidence:  $confidence,
          promotes_to: NONE,
          created_at:  time::now()
        }`,
        {
          session: sessionId,
          step: stepId,
          module: finding.module,
          text: finding.text,
          confidence: finding.confidence,
        },
      );
    }

    // Mark step complete
    await db.query(
      `UPDATE type::record($id) SET status = 'complete', result = $result, tokens_used = $tokens, completed_at = time::now()`,
      { id: stepId, result: bounded, tokens: Math.ceil(bounded.length / 4) },
    );

    // Advance session — dispatch next pending step (or assemble if done)
    await dispatchNextStep(sessionId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.query(
      `UPDATE type::record($id) SET status = 'failed', result = $msg`,
      { id: stepId, msg: message },
    );
    await db.query(
      `UPDATE type::record($id) SET status = 'failed', updated_at = time::now()`,
      { id: sessionId },
    );
  }
}

// ---------------------------------------------------------------------------
// callExternalLlm — POST to COMMIT_RAG_LLM_URL with an OpenAI-compatible body.
// Supports Ollama, LM Studio, OpenAI, Anthropic-compatible proxies, etc.
// ---------------------------------------------------------------------------
async function callExternalLlm(url: string, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.COMMIT_RAG_LLM_MODEL ?? "llama3",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
        temperature: 0.2,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `LLM request failed: ${response.status} ${response.statusText}`,
      );
    }

    type LlmResponse = {
      choices?: Array<{ message?: { content?: string } }>;
      response?: string; // Ollama generate format
      content?: Array<{ text?: string }>; // Anthropic format
    };
    const json = (await response.json()) as LlmResponse;

    return (
      json.choices?.[0]?.message?.content ??
      json.response ??
      json.content?.[0]?.text ??
      "No content in LLM response"
    );
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// markStepFailed — public helper for manual error recovery via tools
// ---------------------------------------------------------------------------
export async function markStepFailed(
  stepId: string,
  reason: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE type::record($id) SET status = 'failed', result = $reason, completed_at = time::now()`,
    { id: stepId, reason },
  );
}

// ---------------------------------------------------------------------------
// getSessionFindings — exported for use by assemble + tools
// ---------------------------------------------------------------------------
export async function getSessionFindingList(
  sessionId: string,
): Promise<ResearchFinding[]> {
  const db = await getDb();

  const result = (await db.query(
    `
      SELECT *, step.index AS step_index FROM research_finding
      WHERE session = type::record($session)
      ORDER BY step_index ASC, confidence DESC
    `,
    { session: sessionId },
  )) as unknown[][];

  return (result.at(-1) ?? []) as ResearchFinding[];
}
