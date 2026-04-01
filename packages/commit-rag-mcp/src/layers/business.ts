import { getDb } from "../db/client.js";

type SurrealResult = unknown[];

export async function getModuleKnowledge(moduleName: string): Promise<string> {
  const db = await getDb();

  const result = (await db.query(
    `
      LET $mod = (SELECT * FROM module WHERE name = $name LIMIT 1)[0];

      RETURN {
        module: $mod,
        facts: (
          SELECT summary, rationale, status, created_at,
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
          WHERE $mod.id INSIDE (SELECT module FROM belongs_to WHERE in = id)
          ORDER BY merged_at DESC
          LIMIT 5
        )
      }
    `,
    { name: moduleName },
  )) as SurrealResult;

  return JSON.stringify(result[0] ?? {}, null, 2);
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

  return JSON.stringify(result[0] ?? {}, null, 2);
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

  return JSON.stringify({ promoted: result[0] ?? 0 }, null, 2);
}

export async function buildContextPack(
  moduleName: string,
  limit = 10,
): Promise<string> {
  const db = await getDb();

  const result = (await db.query(
    `
      LET $mod = (SELECT * FROM module WHERE name = $name LIMIT 1)[0];

      RETURN {
        module: $mod.name,
        status: $mod.status,
        business_context: (
          SELECT summary, rationale
          FROM business_fact
          WHERE module = $mod.id AND status = 'promoted'
          ORDER BY created_at DESC
          LIMIT $limit
        ),
        graph: {
          affects: (SELECT ->affects->module.name AS n FROM $mod.id)[0].n,
          required_by: (SELECT ->required_by->module.name AS n FROM $mod.id)[0].n
        },
        recent_decisions: (
          SELECT title, body, merged_at
          FROM pr
          WHERE $mod.id INSIDE (SELECT module FROM belongs_to WHERE in = id)
          ORDER BY merged_at DESC
          LIMIT 3
        )
      }
    `,
    { name: moduleName, limit },
  )) as SurrealResult;

  return JSON.stringify(result[0] ?? {}, null, 2);
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
            SELECT summary, rationale FROM business_fact
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
          AND merged_at > time::now() - duration::from::hours(24)
          AND state = 'merged'
        ORDER BY merged_at DESC
      `,
      { repo },
    ),
  ])) as [SurrealResult, SurrealResult];

  return JSON.stringify(
    {
      module: moduleName,
      business_context: businessResult[0] ?? {},
      overnight_prs: overnightResult[0] ?? [],
    },
    null,
    2,
  );
}
