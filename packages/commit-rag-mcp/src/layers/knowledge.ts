import { createHash } from "node:crypto";
import { getDb } from "../db/client.js";
import { embedText, getExpectedDimension } from "../search/embeddings.js";

type SurrealResult = unknown[];

type KnowledgeNote = {
  id?: string;
  version?: number;
  content_hash?: string;
  tags?: string[];
  related_modules?: string[];
};

type IngestKnowledgeOptions = {
  module: string;
  topic: string;
  findings: string;
  route?: string;
  feature?: string;
  relatedModules?: string[];
  tags?: string[];
  sourceType?: string;
  sourceRef?: string;
  tag?: string;
  confidence?: number;
};

function sanitizeModuleName(moduleName: string): string {
  return moduleName.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeList(values: string[] | undefined): string[] {
  if (!values) {
    return [];
  }

  return Array.from(
    new Set(
      values.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  );
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

function makeContentHash(value: string): string {
  return createHash("sha1").update(value, "utf8").digest("hex");
}

function getFirstResult<T>(result: SurrealResult): T | undefined {
  const first = result[0];
  if (!Array.isArray(first)) {
    return undefined;
  }

  return first[0] as T | undefined;
}

async function ensureModule(
  moduleName: string,
): Promise<{ id: string; key: string }> {
  const db = await getDb();
  const moduleKey = sanitizeModuleName(moduleName);

  await db.query(
    `
      UPSERT type::record('module', $moduleKey) SET
        name = $name,
        description = '',
        updated_at = time::now()
    `,
    { moduleKey, name: moduleName },
  );

  return { id: `module:${moduleKey}`, key: moduleKey };
}

export async function ingestKnowledgeInvestigation(
  options: IngestKnowledgeOptions,
): Promise<{ action: string; module: string; topic: string; version: number }> {
  const db = await getDb();
  const moduleName = options.module.trim();
  const topic = options.topic.trim();
  const findings = options.findings.trim();

  if (!moduleName || !topic || !findings) {
    throw new Error("module, topic and findings are required");
  }

  const moduleRecord = await ensureModule(moduleName);
  const topicKey = normalizeSearchText(topic).slice(0, 120) || "general";
  const sourceType = options.sourceType ?? "investigation";
  const sourceRef = options.sourceRef ?? `${moduleName}:${topicKey}`;
  const tags = normalizeList([
    ...(options.tags ?? []),
    options.tag ?? "demo",
    moduleName,
    options.route ? `route:${options.route}` : "",
    options.feature ? `feature:${options.feature}` : "",
  ]);
  const relatedModules = normalizeList(options.relatedModules).filter(
    (relatedModule) => relatedModule !== moduleName,
  );
  const summary = topic.slice(0, 240);
  const details = findings;
  const searchText = [
    summary,
    details,
    tags.join(" "),
    relatedModules.join(" "),
  ]
    .join("\n")
    .trim();
  const embedding = await makeEmbedding(searchText);
  const contentHash = makeContentHash(`${topicKey}\n${searchText}`);
  const confidence = Math.max(0, Math.min(1, options.confidence ?? 0.75));

  const existingResult = (await db.query(
    `
      SELECT *
      FROM knowledge_note
      WHERE module = type::record('module', $moduleKey)
        AND topic_key = $topic_key
        AND is_latest = true
      ORDER BY version DESC
      LIMIT 1
    `,
    { moduleKey: moduleRecord.key, topic_key: topicKey },
  )) as SurrealResult;

  const existing = getFirstResult<KnowledgeNote>(existingResult);
  if (existing?.id && existing.content_hash === contentHash) {
    const mergedTags = normalizeList([...(existing.tags ?? []), ...tags]);
    const mergedRelatedModules = normalizeList([
      ...(existing.related_modules ?? []),
      ...relatedModules,
    ]);

    await db.query(
      `
        UPDATE $noteId SET
          summary = $summary,
          details = $details,
          tags = $tags,
          related_modules = $related_modules,
          source_type = $source_type,
          source_ref = $source_ref,
          confidence = $confidence,
          search_text = $search_text,
          embedding = $embedding,
          updated_at = time::now()
      `,
      {
        noteId: existing.id,
        summary,
        details,
        tags: mergedTags,
        related_modules: mergedRelatedModules,
        source_type: sourceType,
        source_ref: sourceRef,
        confidence,
        search_text: searchText,
        embedding,
      },
    );

    return {
      action: "refreshed",
      module: moduleName,
      topic,
      version: existing.version ?? 1,
    };
  }

  if (existing?.id) {
    await db.query(
      `
        UPDATE $noteId SET
          is_latest = false,
          updated_at = time::now()
      `,
      { noteId: existing.id },
    );
  }

  const version = (existing?.version ?? 0) + 1;
  const createResult = (await db.query(
    `
      CREATE knowledge_note CONTENT {
        module: type::record('module', $moduleKey),
        topic: $topic,
        topic_key: $topic_key,
        summary: $summary,
        details: $details,
        source_type: $source_type,
        source_ref: $source_ref,
        tags: $tags,
        related_modules: $related_modules,
        content_hash: $content_hash,
        version: $version,
        is_latest: true,
        confidence: $confidence,
        search_text: $search_text,
        embedding: $embedding,
        created_at: time::now(),
        updated_at: time::now()
      }
    `,
    {
      moduleKey: moduleRecord.key,
      topic,
      topic_key: topicKey,
      summary,
      details,
      source_type: sourceType,
      source_ref: sourceRef,
      tags,
      related_modules: relatedModules,
      content_hash: contentHash,
      version,
      confidence,
      search_text: searchText,
      embedding,
    },
  )) as SurrealResult;

  const created = getFirstResult<{ id?: string }>(createResult);
  if (!created?.id) {
    throw new Error("failed to create knowledge note");
  }

  if (existing?.id) {
    await db.query(
      `
        RELATE $newId -> supersedes -> $oldId
      `,
      { newId: created.id, oldId: existing.id },
    );
  }

  for (const relatedModuleName of relatedModules) {
    const relatedModule = await ensureModule(relatedModuleName);
    await db.query(
      `
        LET $existing = (
          SELECT * FROM mentions_module
          WHERE in = $noteId
            AND out = $relatedModuleId
          LIMIT 1
        )[0];
        IF $existing = NONE {
          RELATE $noteId -> mentions_module -> $relatedModuleId;
        };
      `,
      { noteId: created.id, relatedModuleId: relatedModule.id },
    );
  }

  return {
    action: "created",
    module: moduleName,
    topic,
    version,
  };
}
