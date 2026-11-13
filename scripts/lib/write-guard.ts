import { postgresTls, type PostgresTls } from "../../src/db/tls";

import { describeDatabaseTarget, type DatabaseTarget } from "./import-plan";

/** A remote database is reached with a verified certificate (see src/db/tls.ts); a local server offers no TLS. */
export function sslFor(connectionString: string, env?: Record<string, string | undefined>): PostgresTls {
  return postgresTls(connectionString, { local: false, env });
}

/** Reads the value of `--confirm-database <id>` from a raw argument list. */
export function readConfirmedDatabase(args: readonly string[]): string | undefined {
  const index = args.indexOf("--confirm-database");
  const value = index === -1 ? undefined : args[index + 1];

  return value && !value.startsWith("--") ? value : undefined;
}

/** The masked target line every editorial script prints, the same as the import dry run. */
export function formatDatabaseTarget(target: DatabaseTarget): string {
  return `Target database: ${target.host} (role ${target.role}, id ${target.token})`;
}

/**
 * Closing lines of a dry run: nothing was written, and the exact flags that would write to this target. A local
 * database needs only --apply; a remote one also needs its id, as assertWriteAllowed requires.
 */
export function dryRunNotice(target: DatabaseTarget): string[] {
  const flags = target.isLocal ? "--apply" : `--apply --confirm-database ${target.token}`;

  return ["Dry run: nothing was written.", `To write, repeat the command with ${flags}.`];
}

/**
 * Gate for scripts that write to PostgreSQL. A local database is always fine. A remote one needs the target id
 * (shown in the error) to be repeated with --confirm-database, and some scripts must never write to a remote
 * database at all. Throws before any connection is opened.
 */
export function assertWriteAllowed({
  connectionString,
  args,
  script,
  allowRemote,
}: {
  connectionString: string;
  args: readonly string[];
  script: string;
  allowRemote: boolean;
}): DatabaseTarget {
  const target = describeDatabaseTarget(connectionString);

  if (target.isLocal) return target;

  if (!allowRemote) {
    throw new Error(
      `${script} never writes to a remote database (target ${target.host}, role ${target.role}). Point DIRECT_DATABASE_URL at a local development database.`,
    );
  }

  if (readConfirmedDatabase(args) !== target.token) {
    throw new Error(
      `${script} would write to ${target.host} (role ${target.role}). Repeat the command with --confirm-database ${target.token} to confirm that target.`,
    );
  }

  return target;
}
