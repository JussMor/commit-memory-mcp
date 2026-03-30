import type { SearchResult } from "../types.js";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ChatResponse = {
  choices?: Array<{
    message?: { content?: string };
  }>;
};

/**
 * Rerank search results using GitHub Copilot chat completions (Claude / GPT).
 *
 * Activated when COPILOT_TOKEN is set.
 * Env vars:
 *   COPILOT_TOKEN    – GitHub PAT or token with Copilot access (required)
 *   COPILOT_MODEL    – model slug (default: "gpt-4o-mini")
 *   COPILOT_BASE_URL – API base URL (default: https://api.githubcopilot.com)
 */
export async function rerankWithCopilot(
  query: string,
  results: SearchResult[],
): Promise<SearchResult[]> {
  const token = process.env.COPILOT_TOKEN;
  if (!token || results.length === 0) {
    return results;
  }

  const baseUrl =
    process.env.COPILOT_BASE_URL ?? "https://api.githubcopilot.com";
  const model = process.env.COPILOT_MODEL ?? "gpt-4o-mini";

  const commitList = results
    .map(
      (r, i) =>
        `${i + 1}. [${r.date}] ${r.author} — ${r.subject}\n   File: ${r.filePath}\n   ${r.preview.split("\n").slice(0, 3).join(" | ")}`,
    )
    .join("\n\n");

  const prompt = `You are a code search assistant. Rate each commit excerpt's relevance to the query on a scale from 0.0 to 1.0.

Query: "${query}"

Commits:
${commitList}

Respond with ONLY a JSON array of numbers, one per commit, in the same order. Example: [0.9, 0.2, 0.7]`;

  const messages: ChatMessage[] = [{ role: "user", content: prompt }];

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "Copilot-Integration-Id": "commit-memory-mcp",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      max_tokens: 256,
    }),
  });

  if (!response.ok) {
    // Fall back to original order if the API call fails
    console.error(
      `[rerank] Copilot API error ${response.status}, using original order`,
    );
    return results;
  }

  const data = (await response.json()) as ChatResponse;
  const content = data.choices?.[0]?.message?.content ?? "";

  // Extract JSON array from the response (tolerates markdown fences)
  const match = content.match(/\[[\d.,\s]+\]/);
  if (!match) {
    console.error("[rerank] Could not parse scores from Copilot response");
    return results;
  }

  let scores: number[];
  try {
    scores = JSON.parse(match[0]) as number[];
  } catch {
    return results;
  }

  return results
    .map((result, i) => ({
      ...result,
      score: typeof scores[i] === "number" ? scores[i] : result.score,
    }))
    .sort((a, b) => b.score - a.score);
}

export function copilotRerankEnabled(): boolean {
  return Boolean(process.env.COPILOT_TOKEN);
}
