import { Surreal } from "surrealdb";

let db: Surreal | null = null;

function buildEndpointCandidates(rawUrl: string): string[] {
  const url = rawUrl.trim();
  if (!url) {
    return ["ws://127.0.0.1:8000/rpc"];
  }

  const candidates = new Set<string>();
  candidates.add(url);

  if (/^wss?:\/\//i.test(url)) {
    if (url.endsWith("/rpc")) {
      candidates.add(url.replace(/\/rpc$/, ""));
    } else {
      candidates.add(`${url.replace(/\/+$/, "")}/rpc`);
    }
  }

  return Array.from(candidates);
}

async function connectWithFallback(
  client: Surreal,
  rawUrl: string,
): Promise<void> {
  const candidates = buildEndpointCandidates(rawUrl);
  const errors: string[] = [];

  for (const endpoint of candidates) {
    try {
      await client.connect(endpoint);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${endpoint} -> ${message}`);
    }
  }

  throw new Error(
    `Failed to connect to SurrealDB. Tried endpoints: ${errors.join(" | ")}`,
  );
}

export async function getDb(): Promise<Surreal> {
  if (db) {
    return db;
  }

  const nextDb = new Surreal();

  await connectWithFallback(
    nextDb,
    process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc",
  );
  await nextDb.signin({
    username: process.env.SURREAL_USER ?? "root",
    password: process.env.SURREAL_PASS ?? "root",
  });

  await nextDb.use({
    namespace: process.env.SURREAL_NS ?? "main",
    database: process.env.SURREAL_DB ?? "main",
  });

  db = nextDb;
  return db;
}

export async function closeDb(): Promise<void> {
  if (!db) {
    return;
  }

  await db.close();
  db = null;
}
