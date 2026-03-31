import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use the correct database path
const dbPath = "/Users/jussmor/Developer/maxwellclinic/EverBetter-Pro/.commit-rag.db";

console.log("Opening database at:", dbPath);
const db = new Database(dbPath, { readonly: true });

// Enable WAL mode for persistence
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");

// Query learned features
console.log("\n=== LEARNED FEATURES ===");
const learnedFeatures = db
  .prepare(
    `
  SELECT 
    id, scope_feature, confidence, status, created_at, content
  FROM context_facts 
  WHERE scope_feature IS NOT NULL 
  AND status = 'promoted'
  ORDER BY confidence DESC
  LIMIT 10
`
  )
  .all();

console.log("Found learned features:", learnedFeatures.length);
learnedFeatures.forEach((f) => {
  console.log(`- [${f.scope_feature}] Confidence: ${f.confidence}, Status: ${f.status}`);
  console.log(`  Content (first 200 chars): ${f.content.substring(0, 200)}...`);
});

// Query messaging feature specifically
console.log("\n=== MESSAGING FEATURE ===");
const messagingFeature = db
  .prepare(
    `
  SELECT 
    id, scope_feature, confidence, status, created_at, content
  FROM context_facts 
  WHERE scope_feature = 'messaging'
  ORDER BY created_at DESC
  LIMIT 1
`
  )
  .all();

if (messagingFeature.length > 0) {
  console.log("✅ Found messaging feature!");
  const f = messagingFeature[0];
  console.log(`Confidence: ${f.confidence}`);
  console.log(`Status: ${f.status}`);
  console.log(`Created: ${f.created_at}`);
  console.log(`Content:\n${f.content}`);
} else {
  console.log("❌ No messaging feature found in database");
}

// Query all PR metadata
console.log("\n=== PR METADATA ===");
const prMetadata = db
  .prepare(
    `
  SELECT 
    id, scope_branch, pr_number, pr_title, confidence, status
  FROM context_facts 
  WHERE pr_number IS NOT NULL
  ORDER BY confidence DESC
  LIMIT 5
`
  )
  .all();

console.log("Found PR records:", prMetadata.length);
prMetadata.forEach((pr) => {
  console.log(
    `- PR #${pr.pr_number}: "${pr.pr_title}" (${pr.confidence}, ${pr.status})`
  );
});

db.close();
