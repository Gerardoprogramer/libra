import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// A throwaway PostgreSQL database for integration tests, in a local Docker container started by hand for that
// purpose (see docs/epub-images.md). Nothing here reads .env.local or any environment variable for the connection:
// the target is the explicit configuration below, checked by disposableTargetProblems before any connection, and the
// server must then prove it is that container (its cluster_name marker) before a database is created. Each run
// creates a database with a recognizable temporary name, applies the migrations to it, and drops it.

/** The container's fixed, test-only settings. The password protects nothing: the port is bound to 127.0.0.1. */
export const DISPOSABLE_POSTGRES = {
  host: "127.0.0.1",
  port: 54361,
  user: "libra_test",
  password: "libra-disposable-test-only",
  adminDatabase: "libra_disposable_admin",
  /** Set with `-c cluster_name=...` when the container starts; a real server does not carry it. */
  clusterName: "libra_disposable_test",
} as const;

export interface DisposableTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

const DATABASE_NAME = /^libra_disposable_[a-z0-9_]{1,40}$/;

/**
 * Why a target is not the local disposable server; empty when it is. Only the IPv4 loopback literal is accepted (a
 * host name could resolve elsewhere), a database named as temporary, and nothing that looks like a hosted service.
 */
export function disposableTargetProblems(target: DisposableTarget): string[] {
  const problems: string[] = [];
  if (target.host !== "127.0.0.1") problems.push(`host ${JSON.stringify(target.host)} is not 127.0.0.1`);
  if (!Number.isInteger(target.port) || target.port < 1024 || target.port > 65535) {
    problems.push(`port ${target.port} is not a local unprivileged port`);
  }
  if (!DATABASE_NAME.test(target.database)) {
    problems.push(`database ${JSON.stringify(target.database)} is not named libra_disposable_*`);
  }
  if (!/^[a-z_]{1,32}$/.test(target.user) || target.user === "postgres") {
    problems.push(`user ${JSON.stringify(target.user)} is not a dedicated test user`);
  }
  for (const value of [target.host, target.user, target.database]) {
    if (/supabase|pooler|amazonaws|neon|\.com|\.co\b/i.test(value))
      problems.push(`${value} looks like a hosted service`);
  }
  return problems;
}

function connect(target: DisposableTarget) {
  const problems = disposableTargetProblems(target);
  if (problems.length) {
    throw new Error(`Refusing to connect: not the local disposable PostgreSQL.\n  - ${problems.join("\n  - ")}`);
  }
  return postgres({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: target.database,
    ssl: false,
    max: 1,
    prepare: false,
    connect_timeout: 5,
    onnotice: () => {},
  });
}

async function assertDisposableServer(client: postgres.Sql, database: string) {
  const [row] = await client`SELECT current_setting('cluster_name') AS cluster, current_database() AS database`;
  if (row?.cluster !== DISPOSABLE_POSTGRES.clusterName || row?.database !== database) {
    throw new Error(
      `Refusing to continue: the server is not the disposable test container (cluster_name ${JSON.stringify(row?.cluster)}, database ${JSON.stringify(row?.database)}).`,
    );
  }
}

/** What migrations 0004 and 0007 expect from Supabase: the auth schema, auth.users, auth.uid() and two roles. */
const SUPABASE_SHIMS = [
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
   END $$`,
  "CREATE SCHEMA auth",
  "CREATE TABLE auth.users (id uuid PRIMARY KEY)",
  "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid'",
];

export interface DisposableDatabase {
  /** Connection string of the new database, for the code under test. */
  url: string;
  database: string;
  /** A client on the new database, for setup and assertions. */
  sql: postgres.Sql;
  drop(): Promise<void>;
}

/**
 * Creates a fresh database on the disposable server, proves it is that server, applies every migration in drizzle/
 * (0000 to the last) to it, and returns it. Refuses anything that is not the local disposable server.
 */
export async function createDisposableDatabase(): Promise<DisposableDatabase> {
  const admin = connect({ ...DISPOSABLE_POSTGRES, database: DISPOSABLE_POSTGRES.adminDatabase });
  try {
    await assertDisposableServer(admin, DISPOSABLE_POSTGRES.adminDatabase);
    const database = `libra_disposable_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const target = { ...DISPOSABLE_POSTGRES, database };
    const problems = disposableTargetProblems(target);
    if (problems.length) throw new Error(problems.join("; "));
    // Fails if the name exists: the database is always one this run created.
    await admin.unsafe(`CREATE DATABASE "${database}"`);

    const sql = connect(target);
    await assertDisposableServer(sql, database);
    const [{ tables }] =
      await sql`SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema = 'public'`;
    if (tables !== 0) throw new Error(`Refusing to migrate: ${database} is not empty`);

    for (const statement of SUPABASE_SHIMS) await sql.unsafe(statement);
    await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });

    return {
      url: `postgres://${target.user}:${target.password}@${target.host}:${target.port}/${database}`,
      database,
      sql,
      async drop() {
        await sql.end();
        const cleanup = connect({ ...DISPOSABLE_POSTGRES, database: DISPOSABLE_POSTGRES.adminDatabase });
        try {
          await assertDisposableServer(cleanup, DISPOSABLE_POSTGRES.adminDatabase);
          if (DATABASE_NAME.test(database)) await cleanup.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        } finally {
          await cleanup.end();
        }
      },
    };
  } finally {
    await admin.end();
  }
}
