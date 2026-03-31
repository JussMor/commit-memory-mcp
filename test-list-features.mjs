#!/usr/bin/env node

import { openDatabase, listLearnedFeatures, listAvailableBranches } from './packages/commit-rag-mcp/dist/db/client.js';

const dbPath = '/Users/jussmor/Developer/maxwellclinic/EverBetter-Pro/.commit-rag.db';

console.log('\n📚 Testing list_learned_features...\n');

const db = openDatabase(dbPath);

try {
  // Test 1: List all learned features
  console.log('Test 1: List all learned features');
  const allFeatures = listLearnedFeatures(db);
  console.log(`✅ Found ${allFeatures.length} learned feature(s):\n`);
  
  for (const feat of allFeatures) {
    const confidence = (feat.confidence * 100).toFixed(0);
    console.log(`  • ${feat.feature} (${feat.domain})`);
    console.log(`    └─ Confidence: ${confidence}%, Branch: ${feat.branch}`);
    console.log(`       Status: ${feat.status}, Updated: ${new Date(feat.updatedAt).toLocaleString()}\n`);
  }

  // Test 2: List by domain filter
  if (allFeatures.length > 0 && allFeatures[0].domain) {
    console.log(`\nTest 2: Filter by domain "${allFeatures[0].domain}"`);
    const domainFeatures = listLearnedFeatures(db, { domain: allFeatures[0].domain });
    console.log(`✅ Found ${domainFeatures.length} feature(s) in domain\n`);
  }

  // Test 3: List available branches
  console.log('\nTest 3: List available branches');
  const branches = listAvailableBranches(db);
  console.log(`✅ Found ${branches.length} branch/feature combination(s):\n`);
  
  for (const branch of branches) {
    const confidence = (branch.topConfidence * 100).toFixed(0);
    console.log(`  • ${branch.branch} (${branch.feature}/${branch.domain})`);
    console.log(`    └─ Facts: ${branch.factCount}, Top confidence: ${confidence}%\n`);
  }

} finally {
  db.close();
}

console.log('\n✅ All tests completed!\n');
