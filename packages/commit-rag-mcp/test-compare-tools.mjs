import { buildContextPack, getFeatureResume, openDatabase } from "./dist/db/client.js";

const dbPath =
  "/Users/jussmor/Developer/maxwellclinic/EverBetter-Pro/.commit-rag.db";

console.log("=== COMPARING TOOLS ===\n");

try {
  const db = openDatabase(dbPath);

  console.log("1️⃣  get_feature_resume (learned knowledge + PRs)\n");
  console.log("---\n");
  const resume = getFeatureResume(db, {
    feature: "messaging",
    limit: 5,
  });
  console.log(resume.substring(0, 500)); // First 500 chars
  console.log("\n[... truncated ...]\n");

  console.log("\n2️⃣  build_context_pack (without feature param - generic context)\n");
  console.log("---\n");
  const pack = buildContextPack(db, {
    limit: 5,
  });
  
  // Check what was returned
  if (typeof pack === 'object' && pack !== null) {
    if (pack.learnedFeature && Array.isArray(pack.learnedFeature)) {
      console.log(`Learned Features: ${pack.learnedFeature.length} found`);
      pack.learnedFeature.slice(0, 2).forEach((f, i) => {
        console.log(`  ${i + 1}. ${f.title || f.content?.substring(0, 50)}`);
      });
    }
    if (pack.prMetadata && Array.isArray(pack.prMetadata)) {
      console.log(`\nPR Metadata: ${pack.prMetadata.length} found`);
      pack.prMetadata.slice(0, 3).forEach((pr, i) => {
        console.log(`  ${i + 1}. ${pr.title || pr.content?.substring(0, 50)}`);
      });
    }
  } else {
    console.log(String(pack).substring(0, 500));
  }

  console.log("\n\n3️⃣  build_context_pack (WITH feature param - messaging)\n");
  console.log("---\n");
  const packWithFeature = buildContextPack(db, {
    feature: "messaging",
    limit: 5,
  });
  
  if (typeof packWithFeature === 'object' && packWithFeature !== null) {
    if (packWithFeature.learnedFeature && Array.isArray(packWithFeature.learnedFeature)) {
      console.log(`Learned Features: ${packWithFeature.learnedFeature.length} found`);
      packWithFeature.learnedFeature.slice(0, 2).forEach((f, i) => {
        console.log(`  ${i + 1}. [${f.scope_feature}] ${f.title}`);
      });
    }
  }

  db.close();
} catch (error) {
  console.error("❌ Error:", error.message);
  console.error(error.stack);
}
