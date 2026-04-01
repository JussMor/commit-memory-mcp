import { getDb } from "../db/client.js";
import { runGh } from "./gh.js";

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

function toDateOrNull(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

  if (summary) {
    await db.query(
      `
        CREATE business_fact CONTENT {
          module: type::record('module', $moduleKey),
          summary: $summary,
          rationale: $rationale,
          source_pr: type::record('pr', $prKey),
          status: 'draft',
          created_at: time::now()
        }
      `,
      {
        moduleKey,
        summary,
        rationale: rationale ?? "",
        prKey,
      },
    );
  }

  await db.query(
    `
      LET $pr = type::record('pr', $prKey);
      LET $module = type::record('module', $moduleKey);
      RELATE $pr -> belongs_to -> $module;
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
