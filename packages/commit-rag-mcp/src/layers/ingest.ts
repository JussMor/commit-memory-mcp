import { execSync } from "node:child_process";
import { getDb } from "../db/client.js";

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

export function fetchPrFromGh(repo: string, prNumber: number): GhPr {
  const { owner, name } = parseRepo(repo);
  const cmd = `gh pr view ${prNumber} --repo ${owner}/${name} --json number,title,body,author,baseRefName,mergedAt,state,files,labels`;
  const data = execSync(cmd, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(data) as GhPr;
}

export async function ingestPr(repo: string, prNumber: number): Promise<void> {
  const db = await getDb();
  const pr = fetchPrFromGh(repo, prNumber);

  const prId = makePrRecordId(repo, pr.number);

  await db.query(
    `
      UPSERT type::thing('pr', $prKey) CONTENT {
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
      merged_at: pr.mergedAt,
      state: pr.state,
      files: pr.files.map((f) => f.path),
      labels: pr.labels.map((l) => l.name),
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
      UPSERT type::thing('module', $moduleKey) SET
        name = $name,
        updated_at = time::now()
    `,
    { moduleKey, name: moduleName },
  );

  const summary = extractSection(pr.body ?? "", "Summary|What does this PR do");
  const rationale = extractSection(pr.body ?? "", "Why|Motivation|Decision");

  if (summary) {
    await db.query(
      `
        CREATE business_fact CONTENT {
          module: type::thing('module', $moduleKey),
          summary: $summary,
          rationale: $rationale,
          source_pr: type::thing('pr', $prKey),
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
      RELATE type::thing('pr', $prKey) -> belongs_to -> type::thing('module', $moduleKey)
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
