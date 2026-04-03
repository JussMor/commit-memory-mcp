import { createHash } from "node:crypto";
import { getDb } from "../db/client.js";
import { embedText, getExpectedDimension } from "../search/embeddings.js";
import { runGh } from "./gh.js";
import { ingestKnowledgeInvestigation } from "./knowledge.js";

type GhPr = {
  number: number;
  title: string;
  body: string;
  author: { login: string };
  baseRefName: string;
  mergedAt: string | null;
  state: string;
  files: Array<{ path: string }>;
  labels: Array<{ name: string }>;
  commits?: Array<
    { oid?: string | null } | { commit?: { oid?: string | null } }
  >;
};

function parseRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo format: ${repo}. Expected owner/name.`);
  }
  return { owner, name };
}

function makePrRecordId(repo: string, prNumber: number): string {
  const safeRepo = repo.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `pr:${safeRepo}_${prNumber}`;
}

function makeModuleRecordId(moduleName: string): string {
  const safeName = moduleName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `module:${safeName}`;
}

function stableId(parts: string[]): string {
  return createHash("sha1").update(parts.join("|"), "utf8").digest("hex");
}

function makeBusinessFactKey(
  repo: string,
  prNumber: number,
  moduleName: string,
  summary: string,
): string {
  return stableId([repo, String(prNumber), moduleName, summary.trim()]);
}

function makeMemoryChunkKey(
  repo: string,
  prNumber: number,
  moduleName: string,
  kind: string,
  content: string,
): string {
  return stableId([repo, String(prNumber), moduleName, kind, content.trim()]);
}

function toDateOrNull(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fitEmbeddingDimension(embedding: number[]): number[] {
  const expected = getExpectedDimension();
  if (expected <= 0) {
    return embedding;
  }

  if (embedding.length === expected) {
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

async function makeEmbedding(text: string): Promise<number[]> {
  const normalized = text.trim();
  if (!normalized) {
    return new Array<number>(getExpectedDimension()).fill(0);
  }

  const embedding = await embedText(normalized);
  return fitEmbeddingDimension(embedding);
}

function extractCommitShas(commits: GhPr["commits"]): string[] {
  if (!Array.isArray(commits)) {
    return [];
  }

  return commits
    .map((commit) => {
      if ("oid" in commit && typeof commit.oid === "string") {
        return commit.oid;
      }

      if (
        "commit" in commit &&
        commit.commit &&
        typeof commit.commit.oid === "string"
      ) {
        return commit.commit.oid;
      }

      return null;
    })
    .filter((sha): sha is string => Boolean(sha));
}

export function fetchPrFromGh(repo: string, prNumber: number): GhPr {
  const { owner, name } = parseRepo(repo);
  const data = runGh([
    "pr",
    "view",
    String(prNumber),
    "--repo",
    `${owner}/${name}`,
    "--json",
    "number,title,body,author,baseRefName,mergedAt,state,files,labels,commits",
  ]);
  return JSON.parse(data) as GhPr;
}

export async function ingestPr(repo: string, prNumber: number): Promise<void> {
  const db = await getDb();
  const pr = fetchPrFromGh(repo, prNumber);

  const prId = makePrRecordId(repo, pr.number);

  await db.query(
    `
      UPSERT type::record('pr', $prKey) CONTENT {
        repo: $repo,
        number: $number,
        title: $title,
        body: $body,
        author: $author,
        base_branch: $base_branch,
        merged_at: $merged_at,
        state: $state,
        files: $files,
        labels: $labels,
        commits: $commits,
        synced_at: time::now()
      }
    `,
    {
      prKey: prId.replace(/^pr:/, ""),
      repo,
      number: pr.number,
      title: pr.title,
      body: pr.body,
      author: pr.author.login,
      base_branch: pr.baseRefName,
      merged_at: toDateOrNull(pr.mergedAt),
      state: pr.state,
      files: pr.files.map((f) => f.path),
      labels: pr.labels.map((l) => l.name),
      commits: extractCommitShas(pr.commits),
    },
  );

  console.log(`[ingest] PR #${prNumber} stored`);
}

async function upsertMemoryChunk(options: {
  db: Awaited<ReturnType<typeof getDb>>;
  repo: string;
  prNumber: number;
  moduleName: string;
  moduleKey: string;
  prKey: string;
  kind: string;
  summary: string;
  content: string;
  tags: string[];
  confidence: number;
  importance: number;
}): Promise<void> {
  const normalizedContent = options.content.trim();
  if (!normalizedContent) {
    return;
  }
  const searchText =
    `${options.summary.trim()}\n${normalizedContent}\n${options.tags.join(" ")}`.trim();
  const embedding = await makeEmbedding(searchText);

  const chunkKey = makeMemoryChunkKey(
    options.repo,
    options.prNumber,
    options.moduleName,
    options.kind,
    normalizedContent,
  );

  await options.db.query(
    `
      UPSERT type::record('memory_chunk', $chunkKey) CONTENT {
        module: type::record('module', $moduleKey),
        source_pr: type::record('pr', $prKey),
        kind: $kind,
        source_type: 'pr',
        source_ref: $source_ref,
        summary: $summary,
        content: $content,
        search_text: $search_text,
        embedding: $embedding,
        tags: $tags,
        confidence: $confidence,
        importance: $importance,
        status: 'active',
        created_at: time::now(),
        updated_at: time::now()
      }
    `,
    {
      chunkKey,
      moduleKey: options.moduleKey,
      prKey: options.prKey,
      kind: options.kind,
      source_ref: `${options.repo}#${options.prNumber}:${options.kind}`,
      summary: options.summary.trim() || options.kind,
      content: normalizedContent,
      search_text: searchText,
      embedding,
      tags: options.tags,
      confidence: options.confidence,
      importance: options.importance,
    },
  );
}

export async function extractBusinessFacts(
  repo: string,
  prNumber: number,
  moduleName: string,
): Promise<void> {
  const db = await getDb();
  const pr = fetchPrFromGh(repo, prNumber);

  const moduleId = makeModuleRecordId(moduleName);
  const moduleKey = moduleId.replace(/^module:/, "");
  const prId = makePrRecordId(repo, prNumber);
  const prKey = prId.replace(/^pr:/, "");

  await db.query(
    `
      UPSERT type::record('module', $moduleKey) SET
        name = $name,
        description = '',
        updated_at = time::now()
    `,
    { moduleKey, name: moduleName },
  );

  const body = pr.body ?? "";
  const summary =
    extractSection(body, "Summary|What does this PR do") ??
    extractFallbackSummary(body) ??
    pr.title.trim();
  const rationale =
    extractSection(body, "Why|Motivation|Decision") ??
    extractFallbackRationale(body);
  const tags = [moduleName, ...pr.labels.map((label) => label.name)]
    .map((tag) => tag.trim())
    .filter(
      (tag, index, values) => tag.length > 0 && values.indexOf(tag) === index,
    );

  await upsertMemoryChunk({
    db,
    repo,
    prNumber,
    moduleName,
    moduleKey,
    prKey,
    kind: "pr_title",
    summary: pr.title,
    content: pr.title,
    tags,
    confidence: 0.7,
    importance: 0.7,
  });

  await upsertMemoryChunk({
    db,
    repo,
    prNumber,
    moduleName,
    moduleKey,
    prKey,
    kind: "pr_body",
    summary: pr.title,
    content: body,
    tags,
    confidence: 0.8,
    importance: 0.8,
  });

  if (summary) {
    const factKey = makeBusinessFactKey(repo, prNumber, moduleName, summary);
    const factSearchText =
      `${summary}\n${rationale ?? ""}\n${tags.join(" ")}`.trim();
    const factEmbedding = await makeEmbedding(factSearchText);

    await db.query(
      `
        UPSERT type::record('business_fact', $factKey) CONTENT {
          module: type::record('module', $moduleKey),
          summary: $summary,
          rationale: $rationale,
          search_text: $search_text,
          embedding: $embedding,
          source_pr: type::record('pr', $prKey),
          source_type: 'pr',
          confidence: 0.85,
          status: 'draft',
          created_at: time::now(),
          updated_at: time::now()
        }
      `,
      {
        factKey,
        moduleKey,
        summary,
        rationale: rationale ?? "",
        search_text: factSearchText,
        embedding: factEmbedding,
        prKey,
      },
    );

    await upsertMemoryChunk({
      db,
      repo,
      prNumber,
      moduleName,
      moduleKey,
      prKey,
      kind: "fact_summary",
      summary,
      content: summary,
      tags,
      confidence: 0.9,
      importance: 0.95,
    });

    await upsertMemoryChunk({
      db,
      repo,
      prNumber,
      moduleName,
      moduleKey,
      prKey,
      kind: "fact_rationale",
      summary,
      content: rationale,
      tags,
      confidence: 0.8,
      importance: 0.75,
    });

    await ingestKnowledgeInvestigation({
      module: moduleName,
      topic: `PR #${prNumber}: ${pr.title}`,
      findings: [
        `Summary: ${summary}`,
        rationale ? `Rationale: ${rationale}` : "",
        `Changed files: ${pr.files.map((file) => file.path).join(", ")}`,
      ]
        .filter((value) => value.length > 0)
        .join("\n"),
      tags,
      sourceType: "business_fact_auto",
      sourceRef: `${repo}#${prNumber}`,
      tag: "auto",
      confidence: 0.8,
    });
  }

  await upsertMemoryChunk({
    db,
    repo,
    prNumber,
    moduleName,
    moduleKey,
    prKey,
    kind: "changed_files",
    summary: `${pr.files.length} changed files`,
    content: pr.files.map((file) => file.path).join("\n"),
    tags,
    confidence: 0.6,
    importance: 0.55,
  });

  await db.query(
    `
      LET $pr = type::record('pr', $prKey);
      LET $module = type::record('module', $moduleKey);
      LET $existing = (SELECT * FROM belongs_to WHERE in = $pr AND out = $module LIMIT 1)[0];
      IF $existing = NONE {
        RELATE $pr -> belongs_to -> $module;
      };
    `,
    { prKey, moduleKey },
  );

  console.log(
    `[ingest] business facts extracted for PR #${prNumber} -> ${moduleName}`,
  );
}

function extractSection(body: string, headingPattern: string): string | null {
  const regex = new RegExp(
    `#+\\s*(${headingPattern})[^\\n]*\\n([\\s\\S]*?)(?=\\n#+|$)`,
    "i",
  );
  const match = body.match(regex);
  return match?.[2]?.trim() ?? null;
}

function extractFallbackSummary(body: string): string | null {
  const lines = normalizeBodyLines(body);
  if (lines.length === 0) {
    return null;
  }

  return lines.slice(0, 3).join(" ");
}

function extractFallbackRationale(body: string): string {
  const lines = normalizeBodyLines(body);
  if (lines.length <= 1) {
    return "";
  }

  return lines.slice(1, 4).join(" ");
}

function normalizeBodyLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("#"))
    .filter((line) => !/^<img\b/i.test(line))
    .map((line) => line.replace(/^[-*+]\s+/, ""))
    .map((line) => line.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim())
    .filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------
// ATOM 5-Tuple Extraction
// Extracts (subject, predicate, object, t_start, t_end) quintuples from a PR.
// These are written as business_fact nodes with temporal validity tracking.
//
// When COMMIT_RAG_LLM_URL is set, extraction is delegated to an LLM.
// Otherwise a lightweight rule-based extractor is used as a fallback.
// ---------------------------------------------------------------------------

type AtomTuple = {
  subject: string;
  predicate: string;
  object: string;
  t_start?: string;
  t_end?: string;
  confidence: number;
};

const PREDICATE_PATTERNS: Array<{
  pattern: RegExp;
  predicate: string;
  confidence: number;
}> = [
  {
    pattern: /(?:now\s+)?(?:requires?|needs?|depends? on)\s+(.+)/i,
    predicate: "requires",
    confidence: 0.75,
  },
  {
    pattern: /(?:validates?|checks?|enforces?)\s+(.+)/i,
    predicate: "validates",
    confidence: 0.78,
  },
  {
    pattern: /(?:replaces?|supersedes?|deprecates?)\s+(.+)/i,
    predicate: "replaces",
    confidence: 0.82,
  },
  {
    pattern: /(?:restricts?|blocks?|prevents?)\s+(.+)/i,
    predicate: "restricts",
    confidence: 0.76,
  },
  {
    pattern: /(?:notifies?|alerts?|triggers?)\s+(.+)/i,
    predicate: "triggers",
    confidence: 0.72,
  },
  {
    pattern: /(?:must|should|has? to)\s+(.+)/i,
    predicate: "must",
    confidence: 0.7,
  },
  {
    pattern: /(?:no longer|removed?|deleted?)\s+(.+)/i,
    predicate: "removed",
    confidence: 0.8,
  },
  {
    pattern: /(?:adds?|introduces?|creates?)\s+(.+)/i,
    predicate: "introduces",
    confidence: 0.74,
  },
  {
    pattern: /(?:limits?|caps?)\s+(.+)/i,
    predicate: "limits",
    confidence: 0.73,
  },
];

function extractAtomTuplesFromText(
  text: string,
  subject: string,
  sourceRef: string,
  mergedAt?: string | null,
): AtomTuple[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 10 && !l.startsWith("#"));

  const tuples: AtomTuple[] = [];
  const tStart = mergedAt ?? new Date().toISOString();

  for (const line of lines) {
    for (const { pattern, predicate, confidence } of PREDICATE_PATTERNS) {
      const match = line.match(pattern);
      if (match?.[1]) {
        const object = match[1].slice(0, 200).trim();
        if (object.split(/\s+/).length >= 2) {
          tuples.push({
            subject: subject.slice(0, 120),
            predicate,
            object,
            t_start: tStart,
            t_end: undefined,
            confidence,
          });
        }
      }
    }
  }

  // Deduplicate by subject+predicate+object key
  const seen = new Set<string>();
  return tuples.filter((t) => {
    const key = `${t.subject}|${t.predicate}|${t.object}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function extractAtomTuplesWithLlm(
  url: string,
  text: string,
  subject: string,
): Promise<AtomTuple[]> {
  const prompt = `Extract business rules and facts from the following pull request description as a JSON array of objects.
Each object must have: subject (string), predicate (string), object (string), confidence (0.0-1.0).
Focus on WHY the change was made, not just what changed.
Return ONLY the JSON array, no other text.

Subject (module/feature): ${subject}

PR Description:
${text.slice(0, 3000)}`;

  const apiKey =
    process.env.COMMIT_RAG_LLM_API_KEY?.trim() ??
    process.env.COPILOT_TOKEN?.trim() ??
    process.env.GITHUB_TOKEN?.trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: process.env.COMMIT_RAG_LLM_MODEL ?? "llama3",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 800,
        temperature: 0.1,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return [];

    type LlmResponse = {
      choices?: Array<{ message?: { content?: string } }>;
      response?: string;
    };
    const json = (await response.json()) as LlmResponse;
    const raw = json.choices?.[0]?.message?.content ?? json.response ?? "";

    // Extract JSON array from the response
    const arrayMatch = raw.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return [];

    const parsed = JSON.parse(arrayMatch[0]) as AtomTuple[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * atomExtract — main entry point for ATOM 5-tuple extraction.
 * Extracts quintuples from a PR and writes them as business_fact nodes
 * with temporal validity (t_start, t_end).
 */
export async function atomExtract(
  repo: string,
  prNumber: number,
  moduleName: string,
): Promise<number> {
  const db = await getDb();
  const pr = fetchPrFromGh(repo, prNumber);

  const moduleKey = makeModuleRecordId(moduleName).replace(/^module:/, "");
  const prKey = makePrRecordId(repo, prNumber).replace(/^pr:/, "");
  const body = (pr.body ?? "").trim();
  const subject = `${moduleName}/${pr.title}`;

  // Ensure module exists
  await db.query(
    `UPSERT type::record('module', $moduleKey) SET name = $name, updated_at = time::now()`,
    { moduleKey, name: moduleName },
  );

  let tuples: AtomTuple[];
  const llmUrl = process.env.COMMIT_RAG_LLM_URL?.trim();

  if (llmUrl && body) {
    tuples = await extractAtomTuplesWithLlm(llmUrl, body, subject);
    // Fall back to rule-based if LLM returned nothing
    if (!tuples.length) {
      tuples = extractAtomTuplesFromText(
        body,
        subject,
        `${repo}#${prNumber}`,
        pr.mergedAt,
      );
    }
  } else {
    tuples = extractAtomTuplesFromText(
      body,
      subject,
      `${repo}#${prNumber}`,
      pr.mergedAt,
    );
  }

  let inserted = 0;
  for (const tuple of tuples) {
    const factText = `${tuple.subject} ${tuple.predicate} ${tuple.object}`;
    const factKey = makeBusinessFactKey(repo, prNumber, moduleName, factText);
    const searchText = `${factText} ${tuple.predicate} ${tuple.subject}`.trim();
    const embedding = await makeEmbedding(searchText);

    await db.query(
      `
        UPSERT type::record('business_fact', $factKey) CONTENT {
          module:      type::record('module', $moduleKey),
          summary:     $summary,
          rationale:   $rationale,
          search_text: $search_text,
          embedding:   $embedding,
          source_pr:   type::record('pr', $prKey),
          source_type: 'atom',
          confidence:  $confidence,
          status:      'draft',
          t_start:     type::datetime($t_start),
          t_end:       NONE,
          created_at:  time::now(),
          updated_at:  time::now()
        }
      `,
      {
        factKey,
        moduleKey,
        prKey,
        summary: factText.slice(0, 300),
        rationale: `predicate: ${tuple.predicate} | object: ${tuple.object}`,
        search_text: searchText,
        embedding,
        confidence: tuple.confidence,
        t_start: tuple.t_start ?? new Date().toISOString(),
      },
    );
    inserted++;
  }

  console.log(
    `[atom] extracted ${inserted} tuples from PR #${prNumber} -> ${moduleName}`,
  );
  return inserted;
}
