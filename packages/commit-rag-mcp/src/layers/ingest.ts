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
