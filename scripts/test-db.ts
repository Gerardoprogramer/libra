import { config } from "dotenv";
import postgres from "postgres";

config({
  path: ".env.local",
});

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not defined");
}

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  ssl: "require",
});

async function main() {
  try {
    const result = await sql`
      select
        now() as current_time,
        current_database() as database_name
    `;

    console.log("Database connection successful");
    console.log(result[0]);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("Database connection failed");
  console.error(error);

  process.exit(1);
});