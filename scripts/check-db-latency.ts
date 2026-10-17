import { performance } from "node:perf_hooks";

import { config } from "dotenv";
import postgres from "postgres";

import { postgresTls } from "../src/db/tls";
import { formatImportError } from "./lib/import-errors";

config({
  path: ".env.local",
});

async function testConnection(name: string, connectionString: string) {
  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    ssl: postgresTls(connectionString, { local: "require" }),
  });

  console.log("");
  console.log(`Testing ${name}...`);
  console.log("");

  try {
    for (let i = 1; i <= 20; i++) {
      const start = performance.now();

      await sql`select 1`;

      const duration = performance.now() - start;

      console.log(`Query ${String(i).padStart(2, "0")}: ${duration.toFixed(2)} ms`);
    }
  } finally {
    await sql.end();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not defined");
  }

  if (!process.env.DIRECT_DATABASE_URL) {
    throw new Error("DIRECT_DATABASE_URL is not defined");
  }

  await testConnection("Transaction pooler (DATABASE_URL)", process.env.DATABASE_URL);

  await testConnection("Session pooler (DIRECT_DATABASE_URL)", process.env.DIRECT_DATABASE_URL);
}

main().catch((error) => {
  console.error(formatImportError(error));
  process.exitCode = 1;
});
