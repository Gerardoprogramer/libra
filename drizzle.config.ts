import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

import { drizzleKitCredentials } from "./src/db/tls";

config({
  path: ".env.local",
});

if (!process.env.DIRECT_DATABASE_URL) {
  throw new Error("DIRECT_DATABASE_URL is not defined");
}

export default defineConfig({
  schema: "./src/db/schema",
  out: "./drizzle",
  dialect: "postgresql",

  // A remote database is reached with a verified certificate (DATABASE_CA_CERT); see src/db/tls.ts.
  dbCredentials: drizzleKitCredentials(process.env.DIRECT_DATABASE_URL),

  verbose: true,
  strict: true,
});
