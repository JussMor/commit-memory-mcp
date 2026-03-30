#!/usr/bin/env node

/**
 * Example: Test Commit RAG on EverBetter-Pro
 * Demonstrates query results from the indexed database
 */

import Database from 'better-sqlite3';

const dbPath = '/Users/jussmor/Developer/maxwellclinic/EverBetter-Pro/.commit-rag.db';

function main() {
  console.log('🔍 Commit RAG Example - EverBetter-Pro Repository\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const db = new Database(dbPath);

  try {
    // Get stats
    const commitCount = db
      .prepare('SELECT COUNT(*) as count FROM commits')
      .get();
    
    const chunkCount = db
      .prepare('SELECT COUNT(*) as count FROM commit_chunks')
      .get();

    console.log(`📊 Index Statistics:\n`);
    console.log(`   Total Commits: ${commitCount.count}`);
    console.log(`   Total Chunks: ${chunkCount.count}\n`);

    // Example 1: Search using keyword matching
    console.log('📍 Example 1: Finding commits mentioning "authentication"\n');
    const authResults = db
      .prepare(
        `SELECT
          c.chunk_id,
          c.sha,
          c.file_path,
          cm.subject,
          cm.date,
          cm.author,
          c.hunk_text
        FROM commit_chunks c
        JOIN commits cm ON cm.sha = c.sha
        WHERE c.indexed_text LIKE ?
        ORDER BY cm.date DESC
        LIMIT 5`
      )
      .all('%authentication%');

    if (authResults.length === 0) {
      console.log('❌ No commits found with "authentication"\n');
    } else {
      console.log(`✅ Found ${authResults.length} commits:\n`);
      authResults.forEach((result, idx) => {
        console.log(`${idx + 1}. ${result.subject}`);
        console.log(`   Author: ${result.author} | Date: ${result.date}`);
        console.log(`   File: ${result.file_path}`);
        console.log(`   Chunk ID: ${result.chunk_id}`);
        const preview = result.hunk_text.split('\n').slice(0, 3).join('\n');
        console.log(`   Changes: ${preview}...\n`);
      });
    }

    // Example 2: Search for UI/component-related commits
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📍 Example 2: Finding commits related to "component" or "UI"\n');
    const uiResults = db
      .prepare(
        `SELECT
          c.sha,
          cm.subject,
          cm.date,
          cm.author,
          c.file_path,
          COUNT(*) as changes_count
        FROM commit_chunks c
        JOIN commits cm ON cm.sha = c.sha
        WHERE c.indexed_text LIKE ? OR c.indexed_text LIKE ?
        GROUP BY c.sha
        ORDER BY cm.date DESC
        LIMIT 5`
      )
      .all('%component%', '%UI%');

    if (uiResults.length === 0) {
      console.log('❌ No commits found related to components/UI\n');
    } else {
      console.log(`✅ Found ${uiResults.length} commits:\n`);
      uiResults.forEach((result, idx) => {
        console.log(`${idx + 1}. ${result.subject}`);
        console.log(`   Author: ${result.author} | Date: ${result.date}`);
        console.log(`   Files changed: ${result.changes_count}`);
        console.log(`   Sample file: ${result.file_path}\n`);
      });
    }

    // Example 3: Search for bug fix commits
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📍 Example 3: Finding commits with "fix" in subject\n');
    const bugResults = db
      .prepare(
        `SELECT
          c.sha,
          cm.subject,
          cm.date,
          cm.author,
          c.file_path
        FROM commit_chunks c
        JOIN commits cm ON cm.sha = c.sha
        WHERE cm.subject LIKE '%fix%' OR cm.subject LIKE '%bug%'
        GROUP BY c.sha
        ORDER BY cm.date DESC
        LIMIT 5`
      )
      .all();

    if (bugResults.length === 0) {
      console.log('❌ No bug fixes found\n');
    } else {
      console.log(`✅ Found ${bugResults.length} bug fixes:\n`);
      bugResults.forEach((result, idx) => {
        console.log(`${idx + 1}. ${result.subject}`);
        console.log(`   SHA: ${result.sha.slice(0, 8)}`);
        console.log(`   Author: ${result.author}`);
        console.log(`   Date: ${result.date}\n`);
      });
    }

    // Example 4: Most recent commits
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📍 Example 4: Most recent commits\n');
    const recentResults = db
      .prepare(
        `SELECT
          c.sha,
          cm.subject,
          cm.date,
          cm.author,
          COUNT(DISTINCT c.file_path) as files_changed
        FROM commit_chunks c
        JOIN commits cm ON cm.sha = c.sha
        GROUP BY c.sha
        ORDER BY cm.date DESC
        LIMIT 10`
      )
      .all();

    console.log(`✅ Last 10 commits:\n`);
    recentResults.forEach((result, idx) => {
      console.log(`${idx + 1}. [${result.date.split('T')[0]}] ${result.subject}`);
      console.log(`   By: ${result.author} | Files: ${result.files_changed}`);
      console.log(`   SHA: ${result.sha.slice(0, 12)}\n`);
    });

    // Example 5: Commits by file type
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📍 Example 5: Activity by file type\n');
    const fileTypeResults = db
      .prepare(
        `SELECT
          CASE
            WHEN c.file_path LIKE '%.ts' THEN 'TypeScript'
            WHEN c.file_path LIKE '%.tsx' THEN 'TSX'
            WHEN c.file_path LIKE '%.js' THEN 'JavaScript'
            WHEN c.file_path LIKE '%.jsx' THEN 'JSX'
            WHEN c.file_path LIKE '%.css' THEN 'CSS'
            WHEN c.file_path LIKE '%.md' THEN 'Markdown'
            ELSE 'Other'
          END as file_type,
          COUNT(DISTINCT c.sha) as commit_count,
          COUNT(*) as chunk_count
        FROM commit_chunks c
        GROUP BY file_type
        ORDER BY commit_count DESC`
      )
      .all();

    console.log('File types with most commits:\n');
    fileTypeResults.forEach((result) => {
      console.log(`   ${result.file_type.padEnd(12)}: ${result.commit_count} commits (${result.chunk_count} chunks)`);
    });

    // Summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📊 Summary\n');
    console.log(`✅ Database: ${dbPath}`);
    console.log(`✅ All queries completed successfully!`);
    console.log(`✅ Ready for Copilot integration\n`);

  } finally {
    db.close();
  }
}

main();
