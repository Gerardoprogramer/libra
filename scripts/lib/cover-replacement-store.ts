// The SQL behind `pnpm db:replace-cover`: read one Project Gutenberg edition, and lock and update its cover_url. Kept
// apart from scripts/replace-cover.ts so the integration tests run exactly these statements against the disposable
// PostgreSQL (cover-replacement.integration.test.ts).
import type postgres from "postgres";

import type { CoverReplacementDependencies, ReplacementEdition } from "./cover-replacement";

export interface CoverReplacementStore {
  /** The edition, read inside a READ ONLY transaction. */
  read(): Promise<ReplacementEdition>;
  withLockedEdition: CoverReplacementDependencies["withLockedEdition"];
}

export function createCoverReplacementStore(sql: postgres.Sql, gutenbergId: string): CoverReplacementStore {
  // (source_name, source_identifier) is unique (editions_source_idx): at most one row.
  async function readEdition(tx: postgres.TransactionSql, lock: boolean): Promise<ReplacementEdition> {
    const rows = await tx<ReplacementEdition[]>`
      select e.id, b.slug as "bookSlug", e.source_identifier as "sourceIdentifier", e.cover_url as "coverUrl"
      from editions e join books b on b.id = e.book_id
      where e.source_name = 'Project Gutenberg' and e.source_identifier = ${gutenbergId}
      ${lock ? tx`for update of e` : tx``}`;
    if (rows.length !== 1) {
      throw new Error(
        `Expected one Project Gutenberg edition ${gutenbergId}, found ${rows.length}; nothing was changed.`,
      );
    }
    return rows[0];
  }

  return {
    async read() {
      return sql.begin("read only", (tx) => readEdition(tx, false));
    },
    async withLockedEdition(write) {
      await sql.begin(async (tx) => {
        const locked = await readEdition(tx, true);
        await write(locked, async (url, previousUrl) => {
          // Only cover_url and updated_at; only while the row still holds the URL the caller checked.
          const result = await tx`
            update editions set cover_url = ${url}, updated_at = now()
            where id = ${locked.id} and cover_url is not distinct from ${previousUrl}`;
          return result.count;
        });
      });
    },
  };
}
