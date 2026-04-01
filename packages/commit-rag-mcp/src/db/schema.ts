import { getDb } from "./client.js";

export async function runMigrations(): Promise<void> {
  const db = await getDb();

  await db.query(`
    DEFINE TABLE IF NOT EXISTS pr SCHEMALESS PERMISSIONS NONE;

    DEFINE FIELD IF NOT EXISTS repo ON pr TYPE string;
    DEFINE FIELD IF NOT EXISTS number ON pr TYPE int;
    DEFINE FIELD IF NOT EXISTS title ON pr TYPE string;
    DEFINE FIELD IF NOT EXISTS body ON pr TYPE string;
    DEFINE FIELD IF NOT EXISTS author ON pr TYPE string;
    DEFINE FIELD IF NOT EXISTS base_branch ON pr TYPE string;
    DEFINE FIELD IF NOT EXISTS merged_at ON pr TYPE option<datetime>;
    DEFINE FIELD IF NOT EXISTS state ON pr TYPE string;
    DEFINE FIELD IF NOT EXISTS files ON pr TYPE array<string>;
    DEFINE FIELD IF NOT EXISTS labels ON pr TYPE array<string>;
    DEFINE FIELD IF NOT EXISTS commits ON pr TYPE array<string>;
    DEFINE FIELD IF NOT EXISTS synced_at ON pr TYPE datetime DEFAULT time::now();

    DEFINE INDEX IF NOT EXISTS pr_repo_number ON pr FIELDS repo, number UNIQUE;
  `);

  await db.query(`
    DEFINE TABLE IF NOT EXISTS commit SCHEMALESS PERMISSIONS NONE;

    DEFINE FIELD IF NOT EXISTS sha ON commit TYPE string;
    DEFINE FIELD IF NOT EXISTS repo ON commit TYPE string;
    DEFINE FIELD IF NOT EXISTS message ON commit TYPE string;
    DEFINE FIELD IF NOT EXISTS author ON commit TYPE string;
    DEFINE FIELD IF NOT EXISTS date ON commit TYPE datetime;
    DEFINE FIELD IF NOT EXISTS files ON commit TYPE array<string>;

    DEFINE INDEX IF NOT EXISTS commit_sha ON commit FIELDS sha UNIQUE;
  `);

  await db.query(`
    DEFINE TABLE IF NOT EXISTS worktree SCHEMALESS PERMISSIONS NONE;

    DEFINE FIELD IF NOT EXISTS path ON worktree TYPE string;
    DEFINE FIELD IF NOT EXISTS branch ON worktree TYPE string;
    DEFINE FIELD IF NOT EXISTS repo ON worktree TYPE string;
    DEFINE FIELD IF NOT EXISTS active ON worktree TYPE bool DEFAULT true;
    DEFINE FIELD IF NOT EXISTS last_seen ON worktree TYPE datetime DEFAULT time::now();

    DEFINE INDEX IF NOT EXISTS worktree_path ON worktree FIELDS path UNIQUE;
  `);

  await db.query(`
    DEFINE TABLE IF NOT EXISTS module SCHEMALESS PERMISSIONS NONE;

    DEFINE FIELD IF NOT EXISTS name ON module TYPE string;
    DEFINE FIELD IF NOT EXISTS description ON module TYPE string;
    DEFINE FIELD IF NOT EXISTS status ON module TYPE string DEFAULT 'active';
    DEFINE FIELD IF NOT EXISTS updated_at ON module TYPE datetime DEFAULT time::now();

    DEFINE INDEX IF NOT EXISTS module_name ON module FIELDS name UNIQUE;
  `);

  await db.query(`
    DEFINE TABLE IF NOT EXISTS business_fact SCHEMALESS PERMISSIONS NONE;

    DEFINE FIELD IF NOT EXISTS module ON business_fact TYPE record<module>;
    DEFINE FIELD IF NOT EXISTS summary ON business_fact TYPE string;
    DEFINE FIELD IF NOT EXISTS rationale ON business_fact TYPE string;
    DEFINE FIELD IF NOT EXISTS source_pr ON business_fact TYPE record<pr>;
    DEFINE FIELD IF NOT EXISTS status ON business_fact TYPE string DEFAULT 'draft';
    DEFINE FIELD IF NOT EXISTS created_at ON business_fact TYPE datetime DEFAULT time::now();
  `);

  await db.query(`
    DEFINE TABLE IF NOT EXISTS affects SCHEMALESS TYPE RELATION FROM module TO module PERMISSIONS NONE;
    DEFINE TABLE IF NOT EXISTS required_by SCHEMALESS TYPE RELATION FROM module TO module PERMISSIONS NONE;
    DEFINE TABLE IF NOT EXISTS belongs_to SCHEMALESS TYPE RELATION FROM pr TO module PERMISSIONS NONE;
    DEFINE TABLE IF NOT EXISTS part_of SCHEMALESS TYPE RELATION FROM commit TO pr PERMISSIONS NONE;
  `);

  console.log("[schema] migrations complete");
}
