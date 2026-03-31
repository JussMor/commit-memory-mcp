import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.env.HOME, '.commit-memory-mcp', 'rag.db');
const db = new Database(dbPath);

// Check if learned features exist for messaging
const learned = db.prepare(`
  SELECT id, title, content, confidence, source_type, scope_feature, status
  FROM context_facts
  WHERE source_type = 'feature-agent' AND scope_feature = 'messaging' AND status = 'promoted'
`).all();

console.log('Learned features in DB for messaging:');
console.log(JSON.stringify(learned, null, 2));

if (learned.length === 0) {
  console.log('\n⚠️ No learned features found. Checking all context facts:');
  const all = db.prepare('SELECT source_type, scope_feature, status, COUNT(*) as count FROM context_facts GROUP BY source_type, scope_feature, status').all();
  console.log(JSON.stringify(all, null, 2));
}

db.close();
