const FALLBACK_DIMENSION = 384;

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
}

function normalize(values: number[]): number[] {
  const magnitude = Math.sqrt(
    values.reduce((sum, value) => sum + value * value, 0),
  );
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    return values;
  }

  return values.map((value) => value / magnitude);
}

function fallbackEmbedding(text: string): number[] {
  const vector = new Array<number>(FALLBACK_DIMENSION).fill(0);
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);

  for (const token of tokens) {
    const index = hashToken(token) % FALLBACK_DIMENSION;
    vector[index] += 1;
  }

  return normalize(vector);
}

export async function embedText(text: string): Promise<number[]> {
  const model = process.env.OLLAMA_EMBED_MODEL;
  if (!model) {
    return fallbackEmbedding(text);
  }

  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  const response = await fetch(`${baseUrl}/api/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding request failed: ${response.status}`);
  }

  const payload = (await response.json()) as { embedding?: number[] };
  if (!payload.embedding || !Array.isArray(payload.embedding)) {
    throw new Error("Embedding response missing vector");
  }

  return normalize(payload.embedding);
}

export async function callOllamaLlm(prompt: string): Promise<string | null> {
  const model = process.env.OLLAMA_CHAT_MODEL;
  if (!model) {
    return null;
  }

  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { response?: string };
    return typeof payload.response === "string" && payload.response.trim()
      ? payload.response.trim()
      : null;
  } catch {
    return null;
  }
}

export function getExpectedDimension(): number {
  return process.env.OLLAMA_EMBED_MODEL
    ? Number.parseInt(process.env.COMMIT_RAG_DIMENSION ?? "", 10) ||
        FALLBACK_DIMENSION
    : FALLBACK_DIMENSION;
}
