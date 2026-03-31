import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import the built functions
import { getFeatureResume, openDatabase } from "./dist/db/client.js";

const dbPath =
  "/Users/jussmor/Developer/maxwellclinic/EverBetter-Pro/.commit-rag.db";

console.log("🔍 Getting feature resume for messaging...\n");
console.log(`Using database at: ${dbPath}\n`);

try {
  const db = openDatabase(dbPath);
  
  const resume = getFeatureResume(db, {
    feature: "messaging",
    limit: 10,
  });

  console.log("✅ SUCCESS! Got feature resume:\n");
  console.log(resume);
  
  db.close();
} catch (error) {
  console.error("❌ Error:", error.message);
  console.error(error.stack);
}
