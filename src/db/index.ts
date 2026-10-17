import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { postgresTls } from "./tls";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not defined");
}

const client = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  ssl: postgresTls(process.env.DATABASE_URL, { local: "require" }),
});

export const db = drizzle({
  client,
});
