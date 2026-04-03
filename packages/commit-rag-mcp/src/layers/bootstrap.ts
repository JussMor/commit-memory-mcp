import fg from "fast-glob";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getDb } from "../db/client.js";
import { runMigrations } from "../db/schema.js";
import { callOllamaLlm, embedText } from "../search/embeddings.js";

type ExtractedFact = {
  subject: string;
  predicate: string;
  object: string;
  rationale: string;
  confidence: number;
};

type HeuristicSignal = {
  predicate: string;
  pattern: RegExp;
  template: (match: string) => string;
};

type ModuleAccumulator = {
  facts: string[];
  overview?: string;
};

type BootstrapPhase = 1 | 2;

type BootstrapOptions = {
  repoPath: string;
  includePatterns: string[];
  resume?: boolean;
  startPhase?: BootstrapPhase;
};

type BootstrapCheckpoint = {
  id: string;
  repo: string;
  include_patterns: string[];
  include_hash: string;
  status: string;
  current_phase: number;
  last_file?: string | null;
  last_module?: string | null;
  files_total: number;
  files_processed: number;
  files_skipped: number;
  facts_inserted: number;
  modules_total: number;
  modules_summarized: number;
  summarized_modules?: string[];
  completed_at?: string | null;
};

type BootstrapSummary = {
  repoPath: string;
  filesScanned: number;
  filesSkipped: number;
  modulesMapped: number;
  factsInserted: number;
  modulesSummarized: number;
  resumed: boolean;
  startPhase: BootstrapPhase;
  durationMs: number;
};

const DEFAULT_INCLUDE_PATTERNS = [
  "src/**/*.{ts,tsx,js,jsx,mjs,cjs}",
  "packages/**/*.{ts,tsx,js,jsx,mjs,cjs}",
];

const IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/*.min.*",
  "**/*.map",
  "**/*.lock",
  "**/*.png",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.gif",
  "**/*.webp",
  "**/*.svg",
  "**/*.pdf",
  "**/*.zip",
  "**/*.tar",
  "**/*.gz",
  "**/*.wasm",
];

const COMMON_CONTAINER_DIRS = new Set([
  "src",
  "app",
  "apps",
  "packages",
  "libs",
  "services",
  "modules",
]);

const HEURISTIC_SIGNALS: HeuristicSignal[] = [
  {
    predicate: "validates",
    pattern: /\b(validate|validation|schema|zod|ajv)\b/gi,
    template: (match) => `input and contract constraints (${match})`,
  },
  {
    predicate: "requires",
    pattern: /\b(auth|authorize|permission|role|rbac|token)\b/gi,
    template: (match) => `authorization requirement (${match})`,
  },
  {
    predicate: "limits",
    pattern: /\b(rate\s*limit|throttle|quota|timeout|retry|backoff)\b/gi,
    template: (match) => `operational guardrail (${match})`,
  },
  {
    predicate: "persists",
    pattern:
      /\b(create|insert|update|delete|upsert|transaction|database|surreal)\b/gi,
    template: (match) => `stateful data behavior (${match})`,
  },
  {
    predicate: "coordinates",
    pattern: /\b(queue|event|worker|cron|schedule|orchestrat|dispatch)\b/gi,
    template: (match) => `workflow coordination (${match})`,
  },
];

function stableId(parts: string[]): string {
  return createHash("sha1").update(parts.join("|"), "utf8").digest("hex");
}

function makeModuleKey(moduleName: string): string {
  return moduleName.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function makeFileKey(repoPath: string, relativePath: string): string {
  return stableId([repoPath, relativePath]);
}

function makeBootstrapRunKey(
  repoPath: string,
  includePatterns: string[],
): string {
  return stableId([repoPath, ...includePatterns]);
}

function inferModuleFromPath(relativePath: string): string {
  const normalized = relativePath.split(path.sep).join("/");
  const segments = normalized
    .split("/")
    .filter((segment) => segment.length > 0);
  if (segments.length <= 1) {
    return "root";
  }

  if (COMMON_CONTAINER_DIRS.has(segments[0]) && segments.length >= 3) {
    return segments[1];
  }

  return segments[0];
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    // Keep prompts bounded and avoid huge generated/vendor files.
    if (stat.size > 150_000) {
      return null;
    }

    const content = await fs.readFile(filePath, "utf8");
    if (!content.trim()) {
      return null;
    }

    return content;
  } catch {
    return null;
  }
}

function normalizeFactTuple(raw: Partial<ExtractedFact>): ExtractedFact | null {
  const subject = String(raw.subject ?? "").trim();
  const predicate = String(raw.predicate ?? "").trim();
  const object = String(raw.object ?? "").trim();
  if (!subject || !predicate || !object) {
    return null;
  }

  const rationale = String(raw.rationale ?? "").trim();
  const confidence = Number(raw.confidence ?? 0.5);

  return {
    subject: subject.slice(0, 180),
    predicate: predicate.slice(0, 120),
    object: object.slice(0, 260),
    rationale: rationale.slice(0, 360),
    confidence: Number.isFinite(confidence)
      ? Math.max(0.3, Math.min(0.7, confidence))
      : 0.5,
  };
}

function extractJsonArray(raw: string): unknown[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    return [];
  }

  try {
    const parsed = JSON.parse(match[0]) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function extractExportedSymbols(code: string): string[] {
  const symbols = new Set<string>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g,
    /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*/g,
    /export\s+class\s+([A-Za-z0-9_]+)/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(code))) {
      if (match[1]) {
        symbols.add(match[1]);
      }
    }
  }

  return Array.from(symbols).slice(0, 8);
}

function extractHeuristicFactsFromCode(options: {
  moduleName: string;
  relativePath: string;
  code: string;
}): ExtractedFact[] {
  const subject = `${options.moduleName} module`;
  const seen = new Set<string>();
  const facts: ExtractedFact[] = [];

  const symbols = extractExportedSymbols(options.code);
  if (symbols.length > 0) {
    const object = `public API includes ${symbols.join(", ")}`;
    seen.add(`${subject}|exposes|${object}`);
    facts.push({
      subject,
      predicate: "exposes",
      object,
      rationale: `Derived from exported symbols in ${options.relativePath}`,
      confidence: 0.56,
    });
  }

  for (const signal of HEURISTIC_SIGNALS) {
    const matches = Array.from(
      new Set(
        Array.from(options.code.matchAll(signal.pattern))
          .map((entry) => entry[0]?.toLowerCase().trim() ?? "")
          .filter(Boolean),
      ),
    ).slice(0, 3);

    for (const match of matches) {
      const object = signal.template(match);
      const key = `${subject}|${signal.predicate}|${object}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      facts.push({
        subject,
        predicate: signal.predicate,
        object,
        rationale: `Keyword-level reverse engineering from ${options.relativePath}`,
        confidence: 0.52,
      });
    }
  }

  return facts.slice(0, 8);
}

function extractImportsFromCode(code: string): string[] {
  const imports = new Set<string>();

  // ES6 imports
  const importRegex =
    /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|(?:\w+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?)?))\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(code))) {
    const importPath = match[1]?.trim();
    if (importPath) {
      imports.add(importPath);
    }
  }

  // CommonJS require
  const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
  while ((match = requireRegex.exec(code))) {
    const importPath = match[1]?.trim();
    if (importPath) {
      imports.add(importPath);
    }
  }

  return Array.from(imports);
}

function resolveImportPathToModule(
  importPath: string,
  sourceFile: string,
): string | null {
  // Normalize path separators
  const normalized = importPath.replace(/\\\\/g, "/");

  // Skip node_modules and external packages for now (they're out of scope)
  if (normalized.includes("node_modules")) {
    return null;
  }

  // Skip relative paths that go too far up
  if (normalized.startsWith("../../../")) {
    return null;
  }

  // Relative imports: resolve against source file's module
  if (normalized.startsWith("..") || normalized.startsWith(".")) {
    const sourceDir = path.dirname(sourceFile).split(path.sep).join("/");
    const sourceModulePath = sourceDir.split("/").slice(0, 2).join("/"); // Top 2 levels = module

    const resolvedPath = path
      .normalize(path.join(sourceDir, normalized))
      .split(path.sep)
      .join("/");

    const resolvedModulePath = resolvedPath.split("/").slice(0, 2).join("/");

    if (resolvedModulePath !== sourceModulePath) {
      return resolvedModulePath;
    }
    return null;
  }

  // Absolute-style paths (from repo root)
  const modulePath = normalized.split("/").slice(0, 2).join("/");
  return modulePath;
}

async function extractAndLinkModuleDependencies(
  db: Awaited<ReturnType<typeof getDb>>,
  repoPath: string,
  normalizedFiles: string[],
): Promise<number> {
  const linkedDeps = new Set<string>();

  for (const filePath of normalizedFiles) {
    try {
      const fullPath = path.join(repoPath, filePath);
      const content = await fs.readFile(fullPath, "utf8");
      const imports = extractImportsFromCode(content);
      const sourceModule = filePath.split("/").slice(0, 2).join("/");

      for (const importPath of imports) {
        const targetModule = resolveImportPathToModule(importPath, filePath);
        if (targetModule && targetModule !== sourceModule) {
          const edgeKey = `${sourceModule}|affects|${targetModule}`;
          if (linkedDeps.has(edgeKey)) continue;

          try {
            await db.query(
              `
                LET $from = (SELECT * FROM module WHERE name = $fromName LIMIT 1);
                LET $to = (SELECT * FROM module WHERE name = $toName LIMIT 1);
                IF $from AND $to {
                  LET $existing = (SELECT * FROM affects WHERE in = $from.id AND out = $to.id LIMIT 1)[0];
                  IF $existing = NONE {
                    RELATE $from.id -> affects -> $to.id SET confidence = 0.75;
                  };
                };
              `,
              { fromName: sourceModule, toName: targetModule },
            );
            linkedDeps.add(edgeKey);
          } catch {
            // Silently skip if module doesn't exist yet
          }
        }
      }
    } catch {
      // Silently skip files that can't be read
    }
  }

  return linkedDeps.size;
}

async function callOpenAiCompatible(prompt: string): Promise<string | null> {
  const url = process.env.COMMIT_RAG_LLM_URL?.trim();
  if (!url) {
    return null;
  }

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
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: process.env.COMMIT_RAG_LLM_MODEL ?? "llama3",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 1200,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    type LlmResponse = {
      choices?: Array<{ message?: { content?: string } }>;
      response?: string;
    };

    const payload = (await response.json()) as LlmResponse;
    const content = payload.choices?.[0]?.message?.content ?? payload.response;
    return typeof content === "string" ? content.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function extractFactsFromCode(options: {
  moduleName: string;
  relativePath: string;
  code: string;
}): Promise<ExtractedFact[]> {
  const prompt = [
    "You are reverse-engineering business rules from raw code.",
    "Extract core business facts as ATOM 5-tuples from this single file.",
    "Return ONLY a JSON array.",
    "Each item must include: subject, predicate, object, rationale, confidence.",
    "Do not output implementation trivia; focus on business intent and domain rules.",
    "When uncertain, use confidence 0.5.",
    `Module: ${options.moduleName}`,
    `Source file: ${options.relativePath}`,
    "Code:",
    options.code.slice(0, 10_000),
  ].join("\n\n");

  const llmRaw = await callOpenAiCompatible(prompt);
  const fallbackRaw = llmRaw ?? (await callOllamaLlm(prompt));
  const parsed = fallbackRaw ? extractJsonArray(fallbackRaw) : [];

  const tuples = parsed
    .map((entry) => normalizeFactTuple(entry as Partial<ExtractedFact>))
    .filter((tuple): tuple is ExtractedFact => Boolean(tuple));

  if (tuples.length > 0) {
    return tuples;
  }

  const heuristicFacts = extractHeuristicFactsFromCode(options);
  if (heuristicFacts.length > 0) {
    return heuristicFacts;
  }

  const fallbackSubject = `${options.moduleName} module`;
  return [
    {
      subject: fallbackSubject,
      predicate: "is implemented in",
      object: options.relativePath,
      rationale:
        "Fallback draft fact generated because LLM extraction returned no tuples.",
      confidence: 0.5,
    },
  ];
}

async function synthesizeModuleOverview(
  moduleName: string,
  facts: string[],
): Promise<string> {
  const compactFacts = facts.slice(0, 30);
  if (compactFacts.length === 0) {
    return "No reverse-engineered facts found yet for this module.";
  }

  const prompt = [
    "You are summarizing reverse-engineered business facts at module level.",
    "Write a concise high-level module overview in 4-6 sentences.",
    "Include core responsibilities, key constraints, and side effects.",
    `Module: ${moduleName}`,
    "Facts:",
    compactFacts.map((fact) => `- ${fact}`).join("\n"),
  ].join("\n\n");

  const llmRaw = await callOpenAiCompatible(prompt);
  const fallbackRaw = llmRaw ?? (await callOllamaLlm(prompt));

  if (fallbackRaw && fallbackRaw.trim().length > 0) {
    return fallbackRaw.trim().slice(0, 1400);
  }

  return compactFacts.slice(0, 6).join("; ");
}

function ensureIncludePatterns(patterns: string[]): string[] {
  const cleaned = patterns
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return cleaned.length > 0 ? cleaned : DEFAULT_INCLUDE_PATTERNS;
}

function normalizeBootstrapOptions(
  options: string[] | Partial<BootstrapOptions> | undefined,
): { includePatterns: string[]; resume: boolean; startPhase: BootstrapPhase } {
  if (Array.isArray(options)) {
    return {
      includePatterns: ensureIncludePatterns(options),
      resume: false,
      startPhase: 1,
    };
  }

  const includePatterns = ensureIncludePatterns(options?.includePatterns ?? []);
  const startPhase = options?.startPhase === 2 ? 2 : 1;

  return {
    includePatterns,
    resume: options?.resume === true,
    startPhase,
  };
}

function getLastRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) {
    return [];
  }

  return ((result as unknown[][]).at(-1) ?? []) as T[];
}

async function getBootstrapCheckpoint(
  db: Awaited<ReturnType<typeof getDb>>,
  runKey: string,
): Promise<BootstrapCheckpoint | null> {
  const result = await db.query(
    `SELECT * FROM type::record('bootstrap_run', $runKey)`,
    {
      runKey,
    },
  );

  const rows = getLastRows<BootstrapCheckpoint>(result);
  return rows[0] ?? null;
}

async function updateBootstrapCheckpoint(
  db: Awaited<ReturnType<typeof getDb>>,
  runKey: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const mergeFields: Record<string, unknown> = {};
  const clearKeys: string[] = [];
  const nowKeys = ["updated_at"];

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }

    if (value === null) {
      clearKeys.push(key);
      continue;
    }

    if (value === "__commit_rag_now__") {
      nowKeys.push(key);
      continue;
    }

    mergeFields[key] = value;
  }

  const nowStatements = nowKeys
    .map(
      (key) =>
        `UPDATE type::record('bootstrap_run', $runKey) SET ${key} = time::now();`,
    )
    .join("\n");
  const clearStatements = clearKeys
    .map(
      (key) =>
        `UPDATE type::record('bootstrap_run', $runKey) SET ${key} = NONE;`,
    )
    .join("\n");

  await db.query(
    `UPSERT type::record('bootstrap_run', $runKey) MERGE $fields;${nowStatements}${clearStatements}`,
    {
      runKey,
      fields: mergeFields,
    },
  );
}

const NOW_TOKEN = "__commit_rag_now__";

async function loadProcessedFilePaths(
  db: Awaited<ReturnType<typeof getDb>>,
  repoPath: string,
): Promise<Set<string>> {
  const result = await db.query(
    `SELECT VALUE path FROM file
     WHERE repo = $repo
       AND id INSIDE (SELECT VALUE in FROM reverse_engineered_from)`,
    { repo: repoPath },
  );

  const rows = getLastRows<string>(result);
  return new Set(rows.map((value) => String(value)));
}

async function loadModuleFactsFromDb(
  db: Awaited<ReturnType<typeof getDb>>,
  repoPath: string,
  filePaths: string[],
): Promise<Map<string, ModuleAccumulator>> {
  if (filePaths.length === 0) {
    return new Map();
  }

  type FileRow = {
    id: unknown;
  };

  const fileResult = await db.query(
    `SELECT id FROM file WHERE repo = $repo AND path INSIDE $paths`,
    {
      repo: repoPath,
      paths: filePaths,
    },
  );
  const fileRows = getLastRows<FileRow>(fileResult);
  const fileIds = Array.from(
    new Set(
      fileRows
        .map((row) => row.id)
        .filter((id): id is NonNullable<typeof id> => id != null),
    ),
  );
  if (fileIds.length === 0) {
    return new Map();
  }

  type RelationRow = {
    out: unknown;
  };

  const relationResult = await db.query(
    `SELECT out FROM reverse_engineered_from WHERE in INSIDE $fileIds`,
    {
      fileIds,
    },
  );
  const relationRows = getLastRows<RelationRow>(relationResult);
  const factIds = Array.from(
    new Set(
      relationRows
        .map((row) => row.out)
        .filter((id): id is NonNullable<typeof id> => id != null),
    ),
  );
  if (factIds.length === 0) {
    return new Map();
  }

  type FactRow = {
    summary: string;
    module: unknown;
  };

  const factResult = await db.query(
    `SELECT summary, module
     FROM business_fact
     WHERE source_type = 'reverse_engineered' AND id INSIDE $factIds`,
    {
      factIds,
    },
  );
  const factRows = getLastRows<FactRow>(factResult);
  const moduleIds = Array.from(
    new Set(
      factRows
        .map((row) => row.module)
        .filter((id): id is NonNullable<typeof id> => id != null),
    ),
  );
  if (moduleIds.length === 0) {
    return new Map();
  }

  type ModuleRow = {
    id: string;
    name: string;
  };

  const moduleResult = await db.query(
    `SELECT id, name FROM module WHERE id INSIDE $moduleIds`,
    {
      moduleIds,
    },
  );
  const moduleRows = getLastRows<ModuleRow>(moduleResult);
  const moduleNameById = new Map(
    moduleRows.map((row) => [String(row.id), String(row.name)]),
  );

  const moduleMap = new Map<string, ModuleAccumulator>();
  for (const row of factRows) {
    const moduleName = moduleNameById.get(String(row.module));
    const summary = String(row.summary ?? "").trim();
    if (!moduleName || !summary) {
      continue;
    }

    const accumulator = moduleMap.get(moduleName) ?? { facts: [] };
    accumulator.facts.push(summary);
    moduleMap.set(moduleName, accumulator);
  }

  return moduleMap;
}

function installInterruptHandlers(
  onInterrupt: () => Promise<void>,
): () => void {
  let handled = false;

  const handler = (): void => {
    if (handled) {
      process.exit(130);
      return;
    }

    handled = true;
    void onInterrupt().finally(() => {
      process.exit(130);
    });
  };

  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);

  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  };
}

// ---------------------------------------------------------------------------
// Progress bar — writes to stderr so it never pollutes JSON stdout output.
// ---------------------------------------------------------------------------
const BAR_WIDTH = 30;

function renderBar(
  phase: string,
  current: number,
  total: number,
  label: string,
): void {
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(BAR_WIDTH * pct);
  const empty = BAR_WIDTH - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const pctStr = String(Math.round(pct * 100)).padStart(3, " ");
  const labelTrunc =
    label.length > 40 ? `…${label.slice(-39)}` : label.padEnd(40, " ");
  process.stderr.write(
    `\r  ${phase}  [${bar}] ${pctStr}%  ${current}/${total}  ${labelTrunc}`,
  );
}

function clearBar(): void {
  process.stderr.write("\r" + " ".repeat(process.stdout.columns ?? 120) + "\r");
}

export async function bootstrapFromFilesystem(
  dir: string,
  options: string[] | Partial<BootstrapOptions> = DEFAULT_INCLUDE_PATTERNS,
): Promise<BootstrapSummary> {
  const startedAt = Date.now();
  const repoPath = path.resolve(dir);
  const normalizedOptions = normalizeBootstrapOptions(options);
  const patterns = normalizedOptions.includePatterns;
  const runKey = makeBootstrapRunKey(repoPath, patterns);

  await runMigrations();
  const db = await getDb();

  const files = await fg(patterns, {
    cwd: repoPath,
    onlyFiles: true,
    absolute: false,
    unique: true,
    dot: false,
    ignore: IGNORE_GLOBS,
  });

  const checkpoint = await getBootstrapCheckpoint(db, runKey);
  const resumed =
    normalizedOptions.resume && checkpoint?.status !== "completed";
  const normalizedFiles = files.map((relativePath) =>
    relativePath.split(path.sep).join("/"),
  );
  let interruptedPhase: BootstrapPhase = normalizedOptions.startPhase;
  let interruptedFile: string | null = checkpoint?.last_file ?? null;
  let interruptedModule: string | null = checkpoint?.last_module ?? null;
  let filesProcessed = resumed ? (checkpoint?.files_processed ?? 0) : 0;
  let filesSkipped = resumed ? (checkpoint?.files_skipped ?? 0) : 0;
  let factsInserted = resumed ? (checkpoint?.facts_inserted ?? 0) : 0;
  let modulesSummarized = resumed ? (checkpoint?.modules_summarized ?? 0) : 0;
  let summarizedModules = new Set<string>(
    resumed ? (checkpoint?.summarized_modules ?? []) : [],
  );

  await updateBootstrapCheckpoint(db, runKey, {
    repo: repoPath,
    include_patterns: patterns,
    include_hash: stableId(patterns),
    status: "running",
    current_phase: normalizedOptions.startPhase,
    last_file: null,
    last_module: null,
    files_total: normalizedFiles.length,
    files_processed: filesProcessed,
    files_skipped: filesSkipped,
    facts_inserted: factsInserted,
    modules_total: checkpoint?.modules_total ?? 0,
    modules_summarized: modulesSummarized,
    summarized_modules: Array.from(summarizedModules),
    started_at: resumed ? undefined : NOW_TOKEN,
    completed_at: null,
  });

  const disposeInterruptHandlers = installInterruptHandlers(async () => {
    await updateBootstrapCheckpoint(db, runKey, {
      status: "interrupted",
      current_phase: interruptedPhase,
      last_file: interruptedFile,
      last_module: interruptedModule,
      files_total: normalizedFiles.length,
      files_processed: filesProcessed,
      files_skipped: filesSkipped,
      facts_inserted: factsInserted,
      modules_summarized: modulesSummarized,
      summarized_modules: Array.from(summarizedModules),
    });
  });

  try {
    if (normalizedOptions.startPhase === 1) {
      const processedFilePaths = resumed
        ? await loadProcessedFilePaths(db, repoPath)
        : new Set<string>();

      process.stderr.write(
        `\nPhase 1/2  Scanning ${normalizedFiles.length} files...\n`,
      );

      for (const normalizedPath of normalizedFiles) {
        interruptedPhase = 1;
        interruptedFile = normalizedPath;
        interruptedModule = null;
        renderBar(
          "1/2 extract",
          filesProcessed + filesSkipped,
          normalizedFiles.length,
          normalizedPath,
        );

        if (resumed && processedFilePaths.has(normalizedPath)) {
          filesSkipped += 1;
          await updateBootstrapCheckpoint(db, runKey, {
            current_phase: 1,
            last_file: normalizedPath,
            files_processed: filesProcessed,
            files_skipped: filesSkipped,
            facts_inserted: factsInserted,
          });
          continue;
        }

        await updateBootstrapCheckpoint(db, runKey, {
          current_phase: 1,
          last_file: normalizedPath,
          last_module: null,
        });

        const fullPath = path.join(repoPath, normalizedPath);
        const moduleName = inferModuleFromPath(normalizedPath);
        const code = await readTextFile(fullPath);
        if (!code) {
          continue;
        }

        const moduleKey = makeModuleKey(moduleName);
        const fileKey = makeFileKey(repoPath, normalizedPath);

        await db.query(
          `
            UPSERT type::record('module', $moduleKey) SET
              name = $moduleName,
              description = (SELECT VALUE description FROM type::record('module', $moduleKey) LIMIT 1)[0] ?? '',
              updated_at = time::now();

            UPSERT type::record('file', $fileKey) CONTENT {
              path: $path,
              repo: $repo,
              module: type::record('module', $moduleKey),
              updated_at: time::now()
            };

            LET $module = type::record('module', $moduleKey);
            LET $file = type::record('file', $fileKey);

            LET $containsExisting = (SELECT * FROM contains WHERE in = $module AND out = $file LIMIT 1)[0];
            IF $containsExisting = NONE {
              RELATE $module -> contains -> $file SET confidence = 1.0;
            };
          `,
          {
            moduleKey,
            moduleName,
            fileKey,
            path: normalizedPath,
            repo: repoPath,
          },
        );

        const tuples = await extractFactsFromCode({
          moduleName,
          relativePath: normalizedPath,
          code,
        });

        for (const tuple of tuples) {
          const summary =
            `${tuple.subject} ${tuple.predicate} ${tuple.object}`.slice(0, 320);
          const searchText =
            `${summary}\n${tuple.rationale}\n${normalizedPath}`.trim();
          const factKey = stableId([repoPath, normalizedPath, summary]);
          const embedding = await embedText(searchText);

          await db.query(
            `
              UPSERT type::record('business_fact', $factKey) CONTENT {
                module: type::record('module', $moduleKey),
                source_file: type::record('file', $fileKey),
                summary: $summary,
                rationale: $rationale,
                search_text: $search_text,
                embedding: $embedding,
                source_pr: NONE,
                source_type: 'reverse_engineered',
                confidence: $confidence,
                status: 'draft',
                created_at: time::now(),
                updated_at: time::now()
              };

              UPSERT type::record('memory_chunk', $factKey) CONTENT {
                module: type::record('module', $moduleKey),
                source_file: type::record('file', $fileKey),
                source_pr: NONE,
                kind: 'reverse_engineered_fact',
                source_type: 'reverse_engineered',
                source_ref: $source_ref,
                summary: $summary,
                content: $content,
                search_text: $search_text,
                embedding: $embedding,
                tags: [$moduleName, 'bootstrap', 'reverse_engineered'],
                confidence: $confidence,
                importance: 0.72,
                status: 'active',
                created_at: time::now(),
                updated_at: time::now()
              };

              LET $file = type::record('file', $fileKey);
              LET $fact = type::record('business_fact', $factKey);
              LET $existing = (SELECT * FROM reverse_engineered_from WHERE in = $file AND out = $fact LIMIT 1)[0];
              IF $existing = NONE {
                RELATE $file -> reverse_engineered_from -> $fact SET confidence = 0.5;
              };
            `,
            {
              factKey,
              moduleKey,
              fileKey,
              moduleName,
              summary,
              rationale: tuple.rationale,
              content: `${tuple.rationale}\nSource file: ${normalizedPath}`,
              source_ref: normalizedPath,
              search_text: searchText,
              embedding,
              confidence: tuple.confidence,
            },
          );

          factsInserted += 1;
        }

        filesProcessed += 1;
        await updateBootstrapCheckpoint(db, runKey, {
          current_phase: 1,
          last_file: normalizedPath,
          files_processed: filesProcessed,
          files_skipped: filesSkipped,
          facts_inserted: factsInserted,
        });
      }

      clearBar();
      process.stderr.write(
        `  Phase 1/2 done  ${filesProcessed} files  ${filesSkipped} skipped  ${factsInserted} facts\n\n`,
      );
    }

    const moduleMap = await loadModuleFactsFromDb(
      db,
      repoPath,
      normalizedFiles,
    );
    const moduleEntries = Array.from(moduleMap.entries());

    if (!resumed || normalizedOptions.startPhase === 2) {
      summarizedModules = new Set<string>();
      modulesSummarized = 0;
    }

    await updateBootstrapCheckpoint(db, runKey, {
      current_phase: 2,
      last_file: null,
      last_module: null,
      modules_total: moduleEntries.length,
      modules_summarized: modulesSummarized,
      summarized_modules: Array.from(summarizedModules),
    });

    process.stderr.write(
      `Phase 2/2  Summarizing ${moduleEntries.length} modules...\n`,
    );

    for (const [moduleName, accumulator] of moduleEntries) {
      interruptedPhase = 2;
      interruptedFile = null;
      interruptedModule = moduleName;

      if (resumed && summarizedModules.has(moduleName)) {
        continue;
      }

      renderBar(
        "2/2 summarize",
        modulesSummarized,
        moduleEntries.length,
        moduleName,
      );

      await updateBootstrapCheckpoint(db, runKey, {
        current_phase: 2,
        last_file: null,
        last_module: moduleName,
        modules_total: moduleEntries.length,
      });

      const moduleKey = makeModuleKey(moduleName);
      const overview = await synthesizeModuleOverview(
        moduleName,
        accumulator.facts,
      );

      await db.query(
        `
          UPDATE type::record('module', $moduleKey) SET
            description = $description,
            updated_at = time::now();
        `,
        {
          moduleKey,
          description: overview,
        },
      );

      accumulator.overview = overview;
      summarizedModules.add(moduleName);
      modulesSummarized += 1;
      await updateBootstrapCheckpoint(db, runKey, {
        current_phase: 2,
        last_module: moduleName,
        modules_total: moduleEntries.length,
        modules_summarized: modulesSummarized,
        summarized_modules: Array.from(summarizedModules),
      });
    }

    clearBar();

    // Phase 2.5: Extract module dependencies from imports
    process.stderr.write(`Phase 2.5/2 Extracting module dependencies...\n`);
    const linkedDependencies = await extractAndLinkModuleDependencies(
      db,
      repoPath,
      normalizedFiles,
    );
    process.stderr.write(
      `  Phase 2.5/2 done  ${linkedDependencies} module dependencies linked\n\n`,
    );

    await updateBootstrapCheckpoint(db, runKey, {
      status: "completed",
      current_phase: 2,
      last_file: null,
      last_module: null,
      files_total: normalizedFiles.length,
      files_processed: filesProcessed,
      files_skipped: filesSkipped,
      facts_inserted: factsInserted,
      modules_total: moduleEntries.length,
      modules_summarized: modulesSummarized,
      summarized_modules: Array.from(summarizedModules),
      completed_at: NOW_TOKEN,
    });

    return {
      repoPath,
      filesScanned: normalizedFiles.length,
      filesSkipped,
      modulesMapped: moduleEntries.length,
      factsInserted,
      modulesSummarized,
      resumed,
      startPhase: normalizedOptions.startPhase,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    await updateBootstrapCheckpoint(db, runKey, {
      status: "interrupted",
      current_phase: interruptedPhase,
      last_file: interruptedFile,
      last_module: interruptedModule,
      files_total: normalizedFiles.length,
      files_processed: filesProcessed,
      files_skipped: filesSkipped,
      facts_inserted: factsInserted,
      modules_summarized: modulesSummarized,
      summarized_modules: Array.from(summarizedModules),
    });
    throw error;
  } finally {
    disposeInterruptHandlers();
  }
}

export type { BootstrapOptions, BootstrapSummary };
