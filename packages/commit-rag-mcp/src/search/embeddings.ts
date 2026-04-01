const FALLBACK_DIMENSION = 384;
const DEFAULT_OPEN_MODEL = "Xenova/all-MiniLM-L6-v2";

let extractorPromise: Promise<
  ((text: string, options?: Record<string, unknown>) => Promise<unknown>) | null
> | null = null;

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

function vectorFromExtractorOutput(payload: unknown): number[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const maybeData = payload as { data?: unknown };
  if (!maybeData.data || typeof maybeData.data !== "object") {
    return [];
  }

  const data = maybeData.data as ArrayLike<number>;
  const values = Array.from(data, (value) => Number(value));
  return values.filter((value) => Number.isFinite(value));
}

async function getOpenSourceExtractor(): Promise<
  ((text: string, options?: Record<string, unknown>) => Promise<unknown>) | null
> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      try {
        const transformers = await import("@xenova/transformers");
        const pipeline = transformers.pipeline as unknown as (
          task: string,
          model: string,
        ) => Promise<
          (text: string, options?: Record<string, unknown>) => Promise<unknown>
        >;

        const model = process.env.COMMIT_RAG_EMBED_MODEL ?? DEFAULT_OPEN_MODEL;
        return await pipeline("feature-extraction", model);
      } catch (error) {
        console.warn(
          "[embed] Open-source model unavailable, falling back:",
          error,
        );
        return null;
      }
    })();
  }

  return extractorPromise;
}

async function embedWithOpenSourceModel(
  text: string,
): Promise<number[] | null> {
  if (process.env.COMMIT_RAG_DISABLE_LOCAL_EMBEDDINGS === "1") {
    return null;
  }

  const extractor = await getOpenSourceExtractor();
  if (!extractor) {
    return null;
  }

  const output = await extractor(text, { pooling: "mean", normalize: true });
  const vector = vectorFromExtractorOutput(output);
  return vector.length > 0 ? normalize(vector) : null;
}

export async function embedText(text: string): Promise<number[]> {
  const openSourceVector = await embedWithOpenSourceModel(text);
  if (openSourceVector) {
    return openSourceVector;
  }

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
  return (
    Number.parseInt(process.env.COMMIT_RAG_DIMENSION ?? "", 10) ||
    FALLBACK_DIMENSION
  );
}
