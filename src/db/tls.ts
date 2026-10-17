// TLS options for postgres.js, shared by the application and the scripts.
//
// postgres.js treats `ssl: "require"` (and "allow"/"prefer") as encryption WITHOUT verification: it sets
// `rejectUnauthorized: false` (postgres 3.4.9, src/connection.js), so any certificate is accepted. An `ssl` option
// passed in code also overrides `?sslmode=` in the URL, so `sslmode=verify-full` there would be ignored, and
// "verify-full" alone only trusts the system CAs, which do not include the CA that signs Supabase's databases.
//
// A remote database is therefore only reached with an explicit CA (DATABASE_CA_CERT, PEM) and full verification.
// postgres.js sets `servername` to a host name before applying these options, and Node then checks that the
// certificate names that host. For an IP address it sets no servername, so Node would check the certificate against
// "localhost"; the IP is passed as `host` instead. Without the CA the connection is refused, never left unverified.

import { isIP } from "node:net";

export type PostgresTls = false | "require" | { ca: string; rejectUnauthorized: true; host?: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;

/** Whether a connection string targets this machine. Anything unparseable or without a host counts as remote. */
export function isLocalDatabase(connectionString: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(connectionString).hostname);
  } catch {
    return false;
  }
}

// Node's URL error carries the input (password included) in `error.input`; this one never does.
function parseUrl(connectionString: string): URL {
  try {
    return new URL(connectionString);
  } catch {
    throw new Error("The PostgreSQL connection string is not a valid URL.");
  }
}

/** The CA bundle from DATABASE_CA_CERT. Escaped "\n" sequences are accepted for single-line environment stores. */
function readCa(value: string | undefined): string | null {
  const ca = value?.replace(/\\n/g, "\n").trim();
  if (!ca) return null;
  if (!PEM_CERTIFICATE.test(ca)) throw new Error("DATABASE_CA_CERT must contain a PEM certificate.");
  return ca;
}

/**
 * TLS for a connection string. `local` keeps each caller's behavior on this machine (the application has always
 * required TLS, the scripts connect to a local server without it); a remote host always gets a verified connection.
 */
export function postgresTls(
  connectionString: string,
  { local, env = process.env }: { local: false | "require"; env?: Record<string, string | undefined> },
): PostgresTls {
  if (isLocalDatabase(connectionString)) return local;

  const ca = readCa(env.DATABASE_CA_CERT);
  if (!ca) {
    // Never names the host or the URL: the message may reach logs.
    throw new Error("DATABASE_CA_CERT is required to verify the TLS certificate of a remote PostgreSQL database.");
  }

  const hostname = parseUrl(connectionString).hostname.replace(/^\[(.*)\]$/, "$1");

  return isIP(hostname) ? { ca, rejectUnauthorized: true, host: hostname } : { ca, rejectUnauthorized: true };
}

/** Query parameters that only select TLS, which `postgresTls` decides instead. */
const TLS_QUERY_PARAMETERS = new Set(["sslmode", "sslrootcert"]);

export type DrizzleKitCredentials =
  | { url: string }
  | { host: string; port?: number; user?: string; password?: string; database: string; ssl: PostgresTls };

/**
 * dbCredentials for drizzle-kit. Given `{ url }`, drizzle-kit opens `postgres(url, { max: 1 })` (0.31.11, bin.cjs),
 * so TLS would depend only on `?sslmode=` (unverified with "require", absent without it). A remote database is
 * therefore described field by field, which lets drizzle-kit pass the verifying `ssl` options to postgres.js. A
 * local one keeps its URL and current behavior. Other query parameters would be lost that way, so they are refused.
 */
export function drizzleKitCredentials(
  connectionString: string,
  env: Record<string, string | undefined> = process.env,
): DrizzleKitCredentials {
  if (isLocalDatabase(connectionString)) return { url: connectionString };

  const ssl = postgresTls(connectionString, { local: false, env });
  const url = parseUrl(connectionString);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));

  if (!url.hostname || !database) throw new Error("The remote PostgreSQL URL must name a host and a database.");
  if ([...url.searchParams.keys()].some((name) => !TLS_QUERY_PARAMETERS.has(name))) {
    throw new Error("The remote PostgreSQL URL has query parameters the migration credentials cannot carry.");
  }

  return {
    host: url.hostname,
    ...(url.port ? { port: Number(url.port) } : {}),
    ...(url.username ? { user: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    database,
    ssl,
  };
}
