// Moves the stored cover URLs (editions.cover_url) from one public R2 base to another, such as from the bucket's
// r2.dev development URL to a custom domain. Only the base changes: the object key after it is kept byte for byte, so
// the same object is served from the new base. Planning is pure; the script decides whether to write.

export interface MediaBase {
  /** The base without a trailing slash, e.g. https://covers.example.com or https://cdn.example.com/books. */
  href: string;
}

/** Validates a public media base: HTTPS, no credentials, query or fragment. Throws, naming the option, otherwise. */
export function parseMediaBase(value: string | undefined, option: string): MediaBase {
  if (!value) throw new Error(`${option} is required.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${option} must be a URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${option} must be an HTTPS URL without credentials, query or fragment.`);
  }
  return { href: `${url.origin}${url.pathname.replace(/\/$/, "")}` };
}

export interface CoverRow {
  id: string;
  coverUrl: string | null;
}

export interface CoverChange {
  id: string;
  from: string;
  to: string;
}

export interface CoverOriginPlan {
  changes: CoverChange[];
  /** Rows already under the target base: a second run finds them here and changes nothing. */
  alreadyMigrated: number;
  withoutCover: number;
  /** Covers under neither base. They are reported, never touched. */
  elsewhere: CoverRow[];
}

/** The rows whose cover is under `from`, rewritten under `to`; every other row is counted and left alone. */
export function planCoverOriginMigration(rows: readonly CoverRow[], from: MediaBase, to: MediaBase): CoverOriginPlan {
  if (from.href === to.href) throw new Error("--from and --to are the same base: there is nothing to migrate.");
  // Neither base may contain the other, or a URL could match both and a reverse run would not undo this one.
  if (`${to.href}/`.startsWith(`${from.href}/`) || `${from.href}/`.startsWith(`${to.href}/`)) {
    throw new Error("--from and --to must not contain one another.");
  }

  const plan: CoverOriginPlan = { changes: [], alreadyMigrated: 0, withoutCover: 0, elsewhere: [] };
  for (const row of rows) {
    if (!row.coverUrl) plan.withoutCover++;
    else if (row.coverUrl.startsWith(`${to.href}/`)) plan.alreadyMigrated++;
    else if (row.coverUrl.startsWith(`${from.href}/`)) {
      plan.changes.push({ id: row.id, from: row.coverUrl, to: `${to.href}${row.coverUrl.slice(from.href.length)}` });
    } else plan.elsewhere.push(row);
  }
  return plan;
}
