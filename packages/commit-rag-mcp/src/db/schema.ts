import { getDb } from "./client.js";

export async function runMigrations(): Promise<void> {
  const db = await getDb();

  await db.query(`
    DEFINE ANALYZER IF NOT EXISTS commit_memory_text
      TOKENIZERS blank, class, punct
      FILTERS lowercase, snowball(english);
  `);

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
    DEFINE FIELD IF NOT EXISTS source_type ON business_fact TYPE string DEFAULT 'pr';
    DEFINE FIELD IF NOT EXISTS search_text ON business_fact TYPE string;
    DEFINE FIELD IF NOT EXISTS embedding ON business_fact TYPE array<number>;
    DEFINE FIELD IF NOT EXISTS status ON business_fact TYPE string DEFAULT 'draft';
    DEFINE FIELD IF NOT EXISTS confidence ON business_fact TYPE number DEFAULT 0.8;
    DEFINE FIELD IF NOT EXISTS created_at ON business_fact TYPE datetime DEFAULT time::now();
    DEFINE FIELD IF NOT EXISTS updated_at ON business_fact TYPE datetime DEFAULT time::now();

    DEFINE INDEX IF NOT EXISTS business_fact_fts
      ON TABLE business_fact COLUMNS search_text FULLTEXT ANALYZER commit_memory_text BM25;
    DEFINE INDEX IF NOT EXISTS business_fact_embedding_idx
      ON TABLE business_fact COLUMNS embedding HNSW DIMENSION 384 DIST COSINE TYPE F32;
  `);

  await db.query(`
    DEFINE TABLE IF NOT EXISTS memory_chunk SCHEMALESS PERMISSIONS NONE;

    DEFINE FIELD IF NOT EXISTS module ON memory_chunk TYPE record<module>;
    DEFINE FIELD IF NOT EXISTS source_pr ON memory_chunk TYPE option<record<pr>>;
    DEFINE FIELD IF NOT EXISTS kind ON memory_chunk TYPE string;
    DEFINE FIELD IF NOT EXISTS source_type ON memory_chunk TYPE string;
    DEFINE FIELD IF NOT EXISTS source_ref ON memory_chunk TYPE string;
    DEFINE FIELD IF NOT EXISTS summary ON memory_chunk TYPE string;
    DEFINE FIELD IF NOT EXISTS content ON memory_chunk TYPE string;
    DEFINE FIELD IF NOT EXISTS search_text ON memory_chunk TYPE string;
    DEFINE FIELD IF NOT EXISTS embedding ON memory_chunk TYPE array<number>;
    DEFINE FIELD IF NOT EXISTS tags ON memory_chunk TYPE array<string>;
    DEFINE FIELD IF NOT EXISTS confidence ON memory_chunk TYPE number DEFAULT 0.7;
    DEFINE FIELD IF NOT EXISTS importance ON memory_chunk TYPE number DEFAULT 0.5;
    DEFINE FIELD IF NOT EXISTS status ON memory_chunk TYPE string DEFAULT 'active';
    DEFINE FIELD IF NOT EXISTS created_at ON memory_chunk TYPE datetime DEFAULT time::now();
    DEFINE FIELD IF NOT EXISTS updated_at ON memory_chunk TYPE datetime DEFAULT time::now();

    DEFINE INDEX IF NOT EXISTS memory_chunk_source_ref ON memory_chunk FIELDS source_ref;
    DEFINE INDEX IF NOT EXISTS memory_chunk_fts
      ON TABLE memory_chunk COLUMNS search_text FULLTEXT ANALYZER commit_memory_text BM25;
    DEFINE INDEX IF NOT EXISTS memory_chunk_embedding_idx
      ON TABLE memory_chunk COLUMNS embedding HNSW DIMENSION 384 DIST COSINE TYPE F32;
  `);

  await db.query(`
    DEFINE TABLE IF NOT EXISTS knowledge_note SCHEMALESS PERMISSIONS NONE;

    DEFINE FIELD IF NOT EXISTS module ON knowledge_note TYPE record<module>;
    DEFINE FIELD IF NOT EXISTS topic ON knowledge_note TYPE string;
    DEFINE FIELD IF NOT EXISTS topic_key ON knowledge_note TYPE string;
    DEFINE FIELD IF NOT EXISTS summary ON knowledge_note TYPE string;
    DEFINE FIELD IF NOT EXISTS details ON knowledge_note TYPE string;
    DEFINE FIELD IF NOT EXISTS source_type ON knowledge_note TYPE string;
    DEFINE FIELD IF NOT EXISTS source_ref ON knowledge_note TYPE string;
    DEFINE FIELD IF NOT EXISTS tags ON knowledge_note TYPE array<string>;
    DEFINE FIELD IF NOT EXISTS related_modules ON knowledge_note TYPE array<string>;
    DEFINE FIELD IF NOT EXISTS content_hash ON knowledge_note TYPE string;
    DEFINE FIELD IF NOT EXISTS version ON knowledge_note TYPE int;
    DEFINE FIELD IF NOT EXISTS is_latest ON knowledge_note TYPE bool DEFAULT true;
    DEFINE FIELD IF NOT EXISTS confidence ON knowledge_note TYPE number DEFAULT 0.75;
    DEFINE FIELD IF NOT EXISTS search_text ON knowledge_note TYPE string;
    DEFINE FIELD IF NOT EXISTS embedding ON knowledge_note TYPE array<number>;
    DEFINE FIELD IF NOT EXISTS created_at ON knowledge_note TYPE datetime DEFAULT time::now();
    DEFINE FIELD IF NOT EXISTS updated_at ON knowledge_note TYPE datetime DEFAULT time::now();

    DEFINE INDEX IF NOT EXISTS knowledge_note_topic_latest
      ON TABLE knowledge_note COLUMNS module, topic_key, is_latest;
    DEFINE INDEX IF NOT EXISTS knowledge_note_source_ref
      ON TABLE knowledge_note COLUMNS source_ref;
    DEFINE INDEX IF NOT EXISTS knowledge_note_fts
      ON TABLE knowledge_note COLUMNS search_text FULLTEXT ANALYZER commit_memory_text BM25;
    DEFINE INDEX IF NOT EXISTS knowledge_note_embedding_idx
      ON TABLE knowledge_note COLUMNS embedding HNSW DIMENSION 384 DIST COSINE TYPE F32;
  `);

  await db.query(`
  await db.query(`
    DEFINE TABLE IF NOT EXISTS commit_chunk SCHEMALESS PERMISSIONS NONE;

    DEFINE FIELD IF NOT EXISTS chunk_id ON commit_chunk TYPE string;
    DEFINE FIELD IF NOT EXISTS sha ON commit_chunk TYPE string;
    DEFINE FIELD IF NOT EXISTS author ON commit_chunk TYPE string;
    DEFINE FIELD IF NOT EXISTS date ON commit_chunk TYPE datetime;
    DEFINE FIELD IF NOT EXISTS subject ON commit_chunk TYPE string;
    DEFINE FIELD IF NOT EXISTS body ON commit_chunk TYPE string;
    DEFINE FIELD IF NOT EXISTS file_path ON commit_chunk TYPE string;
    DEFINE FIELD IF NOT EXISTS hunk_text ON commit_chunk TYPE string;
    DEFINE FIELD IF NOT EXISTS indexed_text ON commit_chunk TYPE string;
    DEFINE FIELD IF NOT EXISTS embedding ON commit_chunk TYPE array<number>;
    DEFINE FIELD IF NOT EXISTS created_at ON commit_chunk TYPE datetime DEFAULT time::now();

    DEFINE INDEX IF NOT EXISTS commit_chunk_id ON commit_chunk FIELDS chunk_id UNIQUE;
    DEFINE INDEX IF NOT EXISTS commit_chunk_embedding_idx
      ON TABLE commit_chunk COLUMNS embedding HNSW DIMENSION 384 DIST COSINE TYPE F32;
  `);

  await db.query(`
    DEFINE TABLE IF NOT EXISTS affects SCHEMALESS TYPE RELATION FROM module TO module PERMISSIONS NONE;
    DEFINE TABLE IF NOT EXISTS required_by SCHEMALESS TYPE RELATION FROM module TO module PERMISSIONS NONE;
    DEFINE TABLE IF NOT EXISTS belongs_to SCHEMALESS TYPE RELATION FROM pr TO module PERMISSIONS NONE;
    DEFINE TABLE IF NOT EXISTS part_of SCHEMALESS TYPE RELATION FROM commit TO pr PERMISSIONS NONE;
    DEFINE TABLE IF NOT EXISTS supersedes SCHEMALESS TYPE RELATION FROM knowledge_note TO knowledge_note PERMISSIONS NONE;
    DEFINE TABLE IF NOT EXISTS mentions_module SCHEMALESS TYPE RELATION FROM knowledge_note TO module PERMISSIONS NONE;
  `);

  console.log("[schema] migrations complete");
}
