import { getDb } from "../db/client.js";
import { embedText, getExpectedDimension } from "../search/embeddings.js";

type SurrealResult = unknown[];

type ModuleFact = {
  id?: string;
  summary?: string;
  rationale?: string;
  status?: string;
  created_at?: string;
  pr_title?: string;
  pr_number?: number;
  confidence?: number;
  embedding?: number[];
};

type MemoryChunk = {
  id?: string;
  kind?: string;
  summary?: string;
  content?: string;
  tags?: string[];
  importance?: number;
  confidence?: number;
  created_at?: string;
  pr_title?: string;
  pr_number?: number;
  embedding?: number[];
};

type ModuleKnowledge = {
  module?: unknown;
  facts?: ModuleFact[];
  recent_prs?: unknown[];
  memory_chunks?: MemoryChunk[];
};

type ContextPack = {
  module?: string;
  status?: string;
  business_context?: ModuleFact[];
  memory_context?: MemoryChunk[];
  graph?: {
    affects?: string[];
    required_by?: string[];
  };
  recent_decisions?: unknown[];
};

function getLastDefinedResult<T>(result: SurrealResult): T | undefined {
  for (let index = result.length - 1; index >= 0; index -= 1) {
    const value = result[index];
    if (value !== null && value !== undefined) {
      return value as T;
    }
  }

  return undefined;
}

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fitEmbeddingDimension(embedding: number[]): number[] {
  const expected = getExpectedDimension();
  if (expected <= 0 || embedding.length === expected) {
    return embedding;
  }

  if (embedding.length > expected) {
    return embedding.slice(0, expected);
  }

  return [
    ...embedding,
    ...new Array<number>(expected - embedding.length).fill(0),
  ];
}

async function makeQueryEmbedding(query?: string): Promise<number[] | null> {
  const normalized = (query ?? "").trim();
  if (!normalized) {
    return null;
  }

  const embedding = await embedText(normalized);
  return fitEmbeddingDimension(embedding);
}

function cosineSimilarity(
  left: number[] | undefined,
  right: number[] | null | undefined,
): number {
  if (!left || !right || left.length === 0 || right.length === 0) {
    return 0;
  }

  const size = Math.min(left.length, right.length);
  if (size === 0) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < size; index += 1) {
    const leftValue = Number(left[index] ?? 0);
    const rightValue = Number(right[index] ?? 0);

    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }

  return dot / denominator;
}

function getQueryTerms(query?: string): string[] {
  const terms = normalizeSearchText(query)
    .split(/\s+/)
    .filter((term) => term.length >= 2);

  return Array.from(new Set(terms));
}

function scoreMatch(
  values: Array<string | null | undefined>,
  terms: string[],
): number {
  if (terms.length === 0) {
    return 1;
  }

  const haystack = normalizeSearchText(values.filter(Boolean).join(" "));
  if (!haystack) {
    return 0;
  }

  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 1;
    }
  }

  return score;
}

function dedupeByKey<T>(items: T[], makeKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const item of items) {
    const key = makeKey(item);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function sortByCreatedAtDesc<T extends { created_at?: string }>(
  items: T[],
): T[] {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.created_at ?? "") || 0;
    const rightTime = Date.parse(right.created_at ?? "") || 0;
    return rightTime - leftTime;
  });
}

function dedupeFacts(facts: ModuleFact[]): ModuleFact[] {
  return dedupeByKey(sortByCreatedAtDesc(facts), (fact) =>
    [fact.pr_number ?? "", fact.summary ?? "", fact.rationale ?? ""].join("|"),
  );
}

function compactFacts(
  facts: ModuleFact[],
): Array<Omit<ModuleFact, "embedding" | "id">> {
  return facts.map(({ id: _id, embedding: _embedding, ...fact }) => fact);
}

function compactMemoryChunks(
  chunks: MemoryChunk[],
): Array<Omit<MemoryChunk, "embedding" | "id">> {
  return chunks.map(({ id: _id, embedding: _embedding, ...chunk }) => chunk);
}

function dedupeMemoryChunks(chunks: MemoryChunk[]): MemoryChunk[] {
  return dedupeByKey(sortByCreatedAtDesc(chunks), (chunk) =>
    [chunk.kind ?? "", chunk.summary ?? "", chunk.content ?? ""].join("|"),
  );
}

function rankFacts(
  facts: ModuleFact[],
  limit: number,
  query?: string,
  queryEmbedding?: number[] | null,
  ftsScores?: Map<string, number>,
): ModuleFact[] {
  const terms = getQueryTerms(query);
  const dedupedFacts = dedupeFacts(facts);
  const ranked = dedupedFacts
    .map((fact) => ({
      fact,
      keywordScore: terms.length
        ? scoreMatch([fact.summary, fact.rationale, fact.pr_title], terms) /
          terms.length
        : 1,
      semanticScore: cosineSimilarity(fact.embedding, queryEmbedding),
      ftsScore: Math.max(0, ftsScores?.get(fact.id ?? "") ?? 0),
      confidenceBoost: Math.max(0, Math.min(1, fact.confidence ?? 0.8)),
      createdAt: Date.parse(fact.created_at ?? "") || 0,
    }))
    .map((entry) => ({
      ...entry,
      score:
        entry.semanticScore * 0.65 +
        entry.keywordScore * 0.2 +
        entry.ftsScore * 0.05 +
        entry.confidenceBoost * 0.1,
    }))
    .filter(
      (entry) =>
        terms.length === 0 || entry.keywordScore > 0 || entry.semanticScore > 0,
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.createdAt - left.createdAt;
    });

  return ranked.slice(0, limit).map((entry) => entry.fact);
}

function rankMemoryChunks(
  chunks: MemoryChunk[],
  limit: number,
  query?: string,
  queryEmbedding?: number[] | null,
  ftsScores?: Map<string, number>,
): MemoryChunk[] {
  const terms = getQueryTerms(query);
  const dedupedChunks = dedupeMemoryChunks(chunks);
  const ranked = dedupedChunks
    .map((chunk) => ({
      chunk,
      keywordScore: terms.length
        ? scoreMatch(
            [chunk.summary, chunk.content, ...(chunk.tags ?? [])],
            terms,
          ) / terms.length
        : 1,
      semanticScore: cosineSimilarity(chunk.embedding, queryEmbedding),
      ftsScore: Math.max(0, ftsScores?.get(chunk.id ?? "") ?? 0),
      importance: chunk.importance ?? 0,
      confidence: chunk.confidence ?? 0,
      createdAt: Date.parse(chunk.created_at ?? "") || 0,
    }))
    .map((entry) => ({
      ...entry,
      score:
        entry.semanticScore * 0.65 +
        entry.keywordScore * 0.15 +
        entry.ftsScore * 0.05 +
        Math.max(0, Math.min(1, entry.importance)) * 0.1 +
        Math.max(0, Math.min(1, entry.confidence)) * 0.05,
    }))
    .filter(
      (entry) =>
        terms.length === 0 || entry.keywordScore > 0 || entry.semanticScore > 0,
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.importance !== left.importance) {
        return right.importance - left.importance;
      }

      return right.createdAt - left.createdAt;
    });

  return ranked.slice(0, limit).map((entry) => entry.chunk);
}

export async function getModuleKnowledge(moduleName: string): Promise<string> {
  const db = await getDb();

  const result = (await db.query(
    `
      LET $mod = (SELECT * FROM module WHERE name = $name LIMIT 1)[0];

      RETURN {
        module: $mod,
        facts: (
          SELECT id, summary, rationale, status, confidence, created_at,
            embedding,
            source_pr.title AS pr_title,
            source_pr.number AS pr_number
          FROM business_fact
          WHERE module = $mod.id
            AND status = 'promoted'
          ORDER BY created_at DESC
        ),
        recent_prs: (
          SELECT number, title, author, merged_at
          FROM pr
          WHERE id INSIDE (SELECT VALUE in FROM belongs_to WHERE out = $mod.id)
          ORDER BY merged_at DESC
          LIMIT 5
        ),
        memory_chunks: (
          SELECT id, kind, summary, content, importance, confidence, created_at,
            source_pr.title AS pr_title,
            source_pr.number AS pr_number,
            embedding
          FROM memory_chunk
          WHERE module = $mod.id
            AND status = 'active'
          ORDER BY importance DESC, created_at DESC
          LIMIT 10
        )
      }
    `,
    { name: moduleName },
  )) as SurrealResult;

  const knowledge = (getLastDefinedResult(result) ?? {}) as ModuleKnowledge;

  return JSON.stringify(
    {
      ...knowledge,
      facts: compactFacts(dedupeFacts(knowledge.facts ?? [])),
      memory_chunks: compactMemoryChunks(
        dedupeMemoryChunks(knowledge.memory_chunks ?? []),
      ),
    },
    null,
    2,
  );
}

export async function getModuleGraph(moduleName: string): Promise<string> {
  const db = await getDb();

  const result = (await db.query(
    `
      LET $mod = (SELECT * FROM module WHERE name = $name LIMIT 1)[0];

      RETURN {
        module: $mod.name,
        affects: (SELECT ->affects->module.name AS name FROM $mod.id)[0].name,
        required_by: (SELECT ->required_by->module.name AS name FROM $mod.id)[0].name,
        affected_by: (SELECT <-affects<-module.name AS name FROM $mod.id)[0].name
      }
    `,
    { name: moduleName },
  )) as SurrealResult;

  return JSON.stringify(getLastDefinedResult(result) ?? {}, null, 2);
}

export async function promoteContextFacts(
  moduleName: string,
  prNumber?: number,
): Promise<string> {
  const db = await getDb();

  const result = (await db.query(
    `
      LET $mod = (SELECT * FROM module WHERE name = $name LIMIT 1)[0];
      LET $facts = (
        SELECT id, source_pr.number AS pr_number
        FROM business_fact
        WHERE module = $mod.id
          AND status = 'draft'
      );
      FOR $f IN $facts {
        IF $pr_number = NONE OR $f.pr_number = $pr_number {
          UPDATE $f.id SET status = 'promoted';
        };
      };
      RETURN (SELECT count() AS promoted FROM business_fact WHERE module = $mod.id AND status = 'promoted');
    `,
    { name: moduleName, pr_number: prNumber ?? null },
  )) as SurrealResult;

  const promotedRows =
    getLastDefinedResult<Array<{ promoted?: number }>>(result);
  const promoted = Array.isArray(promotedRows)
    ? promotedRows.reduce(
        (maxPromoted, row) => Math.max(maxPromoted, row.promoted ?? 0),
        0,
      )
    : 0;

  return JSON.stringify({ promoted }, null, 2);
}

export async function buildContextPack(
  moduleName: string,
  limit = 10,
  query?: string,
): Promise<string> {
  const db = await getDb();
  const candidateLimit = Math.max(limit * 5, 25);
  const queryEmbedding = await makeQueryEmbedding(query);
  const normalizedQuery = query?.trim() ?? "";

  let factFtsResult: SurrealResult = [];
  let chunkFtsResult: SurrealResult = [];
  if (normalizedQuery.length > 0) {
    try {
      [factFtsResult, chunkFtsResult] = (await Promise.all([
        db.query(
          `
            LET $mod = (SELECT * FROM module WHERE name = $name LIMIT 1)[0];
            RETURN (
              SELECT id, search::score(1) AS fts_score
              FROM business_fact
              WHERE module = $mod.id
                AND status = 'promoted'
                AND search_text @1@ $query
              ORDER BY fts_score DESC
              LIMIT $candidate_limit
            )
          `,
          {
            name: moduleName,
            query: normalizedQuery,
            candidate_limit: candidateLimit,
          },
        ),
        db.query(
          `
            LET $mod = (SELECT * FROM module WHERE name = $name LIMIT 1)[0];
            RETURN (
              SELECT id, search::score(1) AS fts_score
              FROM memory_chunk
              WHERE module = $mod.id
                AND status = 'active'
                AND search_text @1@ $query
              ORDER BY fts_score DESC
              LIMIT $candidate_limit
            )
          `,
          {
            name: moduleName,
            query: normalizedQuery,
            candidate_limit: candidateLimit,
          },
        ),
      ])) as [SurrealResult, SurrealResult];
    } catch {
      factFtsResult = [];
      chunkFtsResult = [];
    }
  }

  const factFtsScores = new Map<string, number>(
    (
      getLastDefinedResult<Array<{ id?: string; fts_score?: number }>>(
        factFtsResult,
      ) ?? []
    )
      .filter((row) => typeof row.id === "string")
      .map((row) => [row.id as string, row.fts_score ?? 0]),
  );
  const chunkFtsScores = new Map<string, number>(
    (
      getLastDefinedResult<Array<{ id?: string; fts_score?: number }>>(
        chunkFtsResult,
      ) ?? []
    )
      .filter((row) => typeof row.id === "string")
      .map((row) => [row.id as string, row.fts_score ?? 0]),
  );

  const result = (await db.query(
    `
      LET $mod = (SELECT * FROM module WHERE name = $name LIMIT 1)[0];

      RETURN {
        module: $mod.name,
        status: $mod.status,
        business_context: (
          SELECT id, summary, rationale, confidence, created_at, embedding,
            source_pr.title AS pr_title,
            source_pr.number AS pr_number
          FROM business_fact
          WHERE module = $mod.id AND status = 'promoted'
          ORDER BY created_at DESC
          LIMIT $candidate_limit
        ),
        memory_context: (
          SELECT id, kind, summary, content, tags, importance, confidence, created_at,
            source_pr.title AS pr_title,
            source_pr.number AS pr_number,
            embedding
          FROM memory_chunk
          WHERE module = $mod.id
            AND status = 'active'
          ORDER BY importance DESC, created_at DESC
          LIMIT $candidate_limit
        ),
        graph: {
          affects: (SELECT ->affects->module.name AS n FROM $mod.id)[0].n,
          required_by: (SELECT ->required_by->module.name AS n FROM $mod.id)[0].n
        },
        recent_decisions: (
          SELECT title, body, merged_at
          FROM pr
          WHERE id INSIDE (SELECT VALUE in FROM belongs_to WHERE out = $mod.id)
          ORDER BY merged_at DESC
          LIMIT 3
        )
      }
    `,
    { name: moduleName, candidate_limit: candidateLimit },
  )) as SurrealResult;

  const contextPack = (getLastDefinedResult(result) ?? {}) as ContextPack;

  return JSON.stringify(
    {
      ...contextPack,
      business_context: compactFacts(
        rankFacts(
          contextPack.business_context ?? [],
          limit,
          query,
          queryEmbedding,
          factFtsScores,
        ),
      ),
      memory_context: compactMemoryChunks(
        rankMemoryChunks(
          contextPack.memory_context ?? [],
          limit,
          query,
          queryEmbedding,
          chunkFtsScores,
        ),
      ),
    },
    null,
    2,
  );
}

type AgentEvidenceItem = {
  type: "business_fact" | "memory_chunk";
  score: number;
  summary: string;
  why_relevant: string;
  source: {
    pr_number?: number;
    pr_title?: string;
    created_at?: string;
    kind?: string;
  };
};

export async function agentRetrieveContext(
  moduleName: string,
  query: string,
  limit = 8,
): Promise<string> {
  const db = await getDb();
  const candidateLimit = Math.max(limit * 6, 30);
  const queryEmbedding = await makeQueryEmbedding(query);
  const terms = getQueryTerms(query);

  let factFtsResult: SurrealResult = [];
  let chunkFtsResult: SurrealResult = [];
  try {
    [factFtsResult, chunkFtsResult] = (await Promise.all([
      db.query(
        `
          LET $mod = (SELECT * FROM module WHERE name = $name LIMIT 1)[0];
          RETURN (
            SELECT id, search::score(1) AS fts_score
            FROM business_fact
            WHERE module = $mod.id
              AND status = 'promoted'
              AND search_text @1@ $query
            ORDER BY fts_score DESC
            LIMIT $candidate_limit
          )
        `,
        { name: moduleName, query, candidate_limit: candidateLimit },
      ),
      db.query(
        `
          LET $mod = (SELECT * FROM module WHERE name = $name LIMIT 1)[0];
          RETURN (
            SELECT id, search::score(1) AS fts_score
            FROM memory_chunk
            WHERE module = $mod.id
              AND status = 'active'
              AND search_text @1@ $query
            ORDER BY fts_score DESC
            LIMIT $candidate_limit
          )
        `,
        { name: moduleName, query, candidate_limit: candidateLimit },
      ),
    ])) as [SurrealResult, SurrealResult];
  } catch {
    factFtsResult = [];
    chunkFtsResult = [];
  }

  const factFtsScores = new Map<string, number>(
    (
      getLastDefinedResult<Array<{ id?: string; fts_score?: number }>>(
        factFtsResult,
      ) ?? []
    )
      .filter((row) => typeof row.id === "string")
      .map((row) => [row.id as string, row.fts_score ?? 0]),
  );
  const chunkFtsScores = new Map<string, number>(
    (
      getLastDefinedResult<Array<{ id?: string; fts_score?: number }>>(
        chunkFtsResult,
      ) ?? []
    )
      .filter((row) => typeof row.id === "string")
      .map((row) => [row.id as string, row.fts_score ?? 0]),
  );

  const result = (await db.query(
    `
      LET $mod = (SELECT * FROM module WHERE name = $name LIMIT 1)[0];

      RETURN {
        module: $mod.name,
        status: $mod.status,
        facts: (
          SELECT id, summary, rationale, confidence, created_at, embedding,
            source_pr.title AS pr_title,
            source_pr.number AS pr_number
          FROM business_fact
          WHERE module = $mod.id
            AND status = 'promoted'
          ORDER BY created_at DESC
          LIMIT $candidate_limit
        ),
        chunks: (
          SELECT id, kind, summary, content, tags, importance, confidence, created_at, embedding,
            source_pr.title AS pr_title,
            source_pr.number AS pr_number
          FROM memory_chunk
          WHERE module = $mod.id
            AND status = 'active'
          ORDER BY importance DESC, created_at DESC
          LIMIT $candidate_limit
        )
      }
    `,
    { name: moduleName, candidate_limit: candidateLimit },
  )) as SurrealResult;

  const context =
    (getLastDefinedResult(result) as {
      module?: string;
      status?: string;
      facts?: ModuleFact[];
      chunks?: MemoryChunk[];
    }) ?? {};

  const rankedFacts = rankFacts(
    context.facts ?? [],
    limit,
    query,
    queryEmbedding,
    factFtsScores,
  );
  const rankedChunks = rankMemoryChunks(
    context.chunks ?? [],
    limit,
    query,
    queryEmbedding,
    chunkFtsScores,
  );

  const evidence: AgentEvidenceItem[] = [
    ...rankedFacts.map((fact) => ({
      type: "business_fact" as const,
      score:
        cosineSimilarity(fact.embedding, queryEmbedding) * 0.65 +
        (terms.length
          ? scoreMatch([fact.summary, fact.rationale, fact.pr_title], terms) /
            terms.length
          : 1) *
          0.2 +
        (factFtsScores.get(fact.id ?? "") ?? 0) * 0.05 +
        (fact.confidence ?? 0.8) * 0.1,
      summary: (fact.summary ?? "").slice(0, 320),
      why_relevant: (fact.rationale ?? fact.summary ?? "").slice(0, 220),
      source: {
        pr_number: fact.pr_number,
        pr_title: fact.pr_title,
        created_at: fact.created_at,
      },
    })),
    ...rankedChunks.map((chunk) => ({
      type: "memory_chunk" as const,
      score:
        cosineSimilarity(chunk.embedding, queryEmbedding) * 0.65 +
        (terms.length
          ? scoreMatch(
              [chunk.summary, chunk.content, ...(chunk.tags ?? [])],
              terms,
            ) / terms.length
          : 1) *
          0.15 +
        (chunkFtsScores.get(chunk.id ?? "") ?? 0) * 0.05 +
        (chunk.importance ?? 0.5) * 0.1 +
        (chunk.confidence ?? 0.7) * 0.05,
      summary: (chunk.summary ?? chunk.kind ?? "evidence").slice(0, 320),
      why_relevant: (chunk.content ?? "")
        .split("\n")
        .slice(0, 2)
        .join(" ")
        .slice(0, 220),
      source: {
        pr_number: chunk.pr_number,
        pr_title: chunk.pr_title,
        created_at: chunk.created_at,
        kind: chunk.kind,
      },
    })),
  ]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  return JSON.stringify(
    {
      module: context.module ?? moduleName,
      status: context.status ?? "unknown",
      query,
      evidence,
    },
    null,
    2,
  );
}

export async function prePlanSyncBrief(
  repo: string,
  moduleName: string,
): Promise<string> {
  const db = await getDb();

  const [businessResult, overnightResult] = (await Promise.all([
    db.query(
      `
        LET $mod = (SELECT * FROM module WHERE name = $name LIMIT 1)[0];
        RETURN {
          facts: (
            SELECT summary, rationale, created_at FROM business_fact
            WHERE module = $mod.id AND status = 'promoted'
            ORDER BY created_at DESC LIMIT 5
          ),
          graph: {
            affects: (SELECT ->affects->module.name AS n FROM $mod.id)[0].n,
            required_by: (SELECT ->required_by->module.name AS n FROM $mod.id)[0].n
          }
        }
      `,
      { name: moduleName },
    ),
    db.query(
      `
        SELECT number, title, author, merged_at
        FROM pr
        WHERE repo = $repo
          AND merged_at > time::now() - duration::from_hours(24)
          AND state = 'merged'
        ORDER BY merged_at DESC
      `,
      { repo },
    ),
  ])) as [SurrealResult, SurrealResult];

  return JSON.stringify(
    {
      module: moduleName,
      business_context: getLastDefinedResult(businessResult) ?? {},
      overnight_prs: overnightResult[0] ?? [],
    },
    null,
    2,
  );
}
