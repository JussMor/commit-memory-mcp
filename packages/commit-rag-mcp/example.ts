#!/usr/bin/env node

/**
 * Example: Query Commit RAG Agent on EverBetter-Pro
 *
 * This demonstrates:
 * 1. Opening the commit database
 * 2. Searching for related commits with semantic similarity
 * 3. Explaining specific matches
 */

import { execFileSync } from "node:child_process";
import { openDatabase } from "./dist/db/client.js";
import { searchRelatedCommits } from "./dist/search/query.js";

const dbPath =
  "/Users/jussmor/Developer/maxwellclinic/EverBetter-Pro/.commit-rag.db";
const repoPath = "/Users/jussmor/Developer/maxwellclinic/EverBetter-Pro";

async function main() {
  console.log("🔍 Commit RAG Example - EverBetter-Pro Repository\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const db = openDatabase(dbPath);

  try {
    // Example 1: Search for authentication-related commits
    console.log('📍 Example 1: Finding commits related to "authentication"\n');
    const authResults = await searchRelatedCommits(
      db,
      "authentication login user session",
      5,
      undefined,
    );

    if (authResults.length === 0) {
      console.log("❌ No results found for authentication\n");
    } else {
      console.log(`✅ Found ${authResults.length} related commits:\n`);
      authResults.forEach((result, idx) => {
        console.log(
          `${idx + 1}. [${result.score.toFixed(3)}] ${result.subject}`,
        );
        console.log(`   Author: ${result.author} | Date: ${result.date}`);
        console.log(`   File: ${result.filePath}`);
        console.log(
          `   Preview:\n${result.preview
            .split("\n")
            .map((l) => "   " + l)
            .join("\n")}\n`,
        );
      });
    }

    // Example 2: Search for performance-related commits
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    console.log(
      '📍 Example 2: Finding commits related to "performance optimization"\n',
    );
    const perfResults = await searchRelatedCommits(
      db,
      "performance optimization caching speed",
      5,
      undefined,
    );

    if (perfResults.length === 0) {
      console.log("❌ No results found for performance\n");
    } else {
      console.log(`✅ Found ${perfResults.length} related commits:\n`);
      perfResults.forEach((result, idx) => {
        console.log(
          `${idx + 1}. [${result.score.toFixed(3)}] ${result.subject}`,
        );
        console.log(`   Author: ${result.author} | Date: ${result.date}`);
        console.log(`   File: ${result.filePath}\n`);
      });
    }

    // Example 3: Search for bug fixes
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    console.log('📍 Example 3: Finding commits related to "bug fixes"\n');
    const bugResults = await searchRelatedCommits(
      db,
      "bug fix error handling issue",
      5,
      undefined,
    );

    if (bugResults.length === 0) {
      console.log("❌ No results found for bug fixes\n");
    } else {
      console.log(`✅ Found ${bugResults.length} related commits:\n`);
      bugResults.forEach((result, idx) => {
        console.log(
          `${idx + 1}. [${result.score.toFixed(3)}] ${result.subject}`,
        );
        console.log(`   SHA: ${result.sha}`);
        console.log(`   Author: ${result.author}\n`);
      });

      // Example 4: Get full diff of top result
      if (bugResults.length > 0) {
        console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        console.log(`📍 Example 4: Getting full diff for top result\n`);
        console.log(`Commit: "${bugResults[0].subject}"`);
        console.log(`SHA: ${bugResults[0].sha}\n`);

        try {
          const diff = execFileSync(
            "git",
            ["-C", repoPath, "show", "--stat", bugResults[0].sha],
            { encoding: "utf8" },
          );

          const lines = diff.split("\n");
          console.log(lines.slice(0, 20).join("\n"));
          if (lines.length > 20) {
            console.log(`\n... (${lines.length - 20} more lines)\n`);
          }
        } catch (error) {
          console.log("❌ Could not fetch diff\n");
        }
      }
    }

    // Example 5: Search with file boost
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    console.log("📍 Example 5: Search with active file boost\n");

    // Find a real file from recent commits
    const recentResults = await searchRelatedCommits(
      db,
      "changes modifications updates",
      10,
      undefined,
    );

    if (recentResults.length > 0) {
      const activeFile = recentResults[0].filePath;
      console.log(`Searching with file boost for: ${activeFile}\n`);

      const boostedResults = await searchRelatedCommits(
        db,
        "changes modifications updates",
        5,
        activeFile,
      );

      console.log("Results (sorted by score, with file boost applied):\n");
      boostedResults.forEach((result, idx) => {
        const boostIndicator = result.filePath === activeFile ? "⭐" : "  ";
        console.log(
          `${boostIndicator} ${idx + 1}. [${result.score.toFixed(3)}] ${result.subject}`,
        );
        console.log(`   File: ${result.filePath}\n`);
      });
    }

    // Summary
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    console.log("📊 Summary\n");
    console.log(`✅ Database: ${dbPath}`);
    console.log(`✅ Repository: ${repoPath}`);
    console.log(`✅ All queries completed successfully!\n`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
