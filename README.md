# Libra

Libra is a bilingual (Spanish and English) digital library for classic literature. The web application uses
Next.js App Router, React Server Components, Tailwind CSS, next-intl, PostgreSQL and Drizzle ORM. Book covers
are served from Cloudflare R2.

## Requirements

- Node.js supported by Next.js 16 (CI runs Node.js 24)
- pnpm (the repository pins pnpm 10.29.3)
- PostgreSQL
- Cloudflare R2 credentials only when importing EPUBs that contain covers

## Setup

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env.local` and set the values required by your environment.
3. Set `DATABASE_URL` to the PostgreSQL connection string used by the application. It must support TLS.
4. For direct database scripts, set `DIRECT_DATABASE_URL` to a PostgreSQL connection string that supports TLS.
   **Use a development database here.** Every script that writes (imports, reviews, seeds) uses this variable: if it
   points at production, `--apply` writes to production. Scripts print the masked target and require
   `--confirm-database <id>` for a remote one; `pnpm db:seed` refuses remote databases entirely.
   Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for authentication (both are public by
   design; never put a service-role key in a `NEXT_PUBLIC_` variable).
   A remote database also needs `DATABASE_CA_CERT`: the PEM of the CA that signs its server certificate (see
   `src/db/tls.ts`). For Supabase, download it from the project's Database settings, SSL Configuration; the file is
   named `prod-ca-2021.crt` and `.gitignore` excludes it. Paste its contents into the variable. The certificate is
   public, but keep the downloaded file out of Git anyway.
5. In production, set `SITE_URL` to the real canonical HTTPS origin of your deployment. The value in `.env.example`
   (`https://www.example.com`) is a domain reserved for documentation: never use it, or any other placeholder, as the
   production domain. It is also used for the sitemap and robots directive. In development it may be
   omitted; titles and descriptions still work, while canonical, language-alternate and sitemap URLs are omitted.
6. Set `R2_PUBLIC_URL` to the HTTPS public base URL for the existing covers so Next.js can render them. Set the
   remaining `R2_*` values when applying imports that upload covers. `CACHE_REVALIDATION_URL` and
   `CACHE_REVALIDATION_SECRET` are optional; configure both to invalidate the deployed site's editorial cache after
   script writes.

Do not commit `.env.local` or real credentials. `.env.example` contains names and empty placeholders only.

## Development and validation

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm typecheck       # tsc --noEmit
pnpm format:check
pnpm test            # offline: no database, network or R2
pnpm check           # all of the above, as CI runs them
pnpm build           # prerenders from PostgreSQL: run it with a development or preview database
pnpm start
pnpm smoke:production
pnpm smoke:seo
```

The smoke test defaults to `http://localhost:3000`, follows the localized home/catalog/author/category routes,
checks `/sitemap.xml` and `/robots.txt`, verifies the basic response headers, and opens one published book found in the
sitemap. To target a different HTTPS origin intentionally, pass it as the first argument:

```bash
pnpm run smoke:production -- https://your-configured-domain.example
```

`pnpm smoke:seo` checks initial HTML metadata, canonical/hreflang, book JSON-LD, real 1200×630 social images,
social crawler user agents, icons and the manifest against the running server. It accepts the same origin argument
and needs at least one published book per language. See [the SEO implementation and deployment guide](docs/seo.md)
for the file inventory, local commands, caching behavior and Vercel checks.

## Production operations

The site is served from Vercel (the production responses carry `Server: Vercel` and the edge adds
`Strict-Transport-Security`), but this repository declares no Vercel project, infrastructure or deployment workflow:
the project settings (environment variables, region, firewall) live in the provider. `.github/workflows/ci.yml`
runs lint, types, formatting and the offline tests on Node.js 24 for every push to `master` and for every pull
request; pushes to other branches do not trigger it. It deliberately does not run `next build`, which prerenders from
PostgreSQL and belongs in a preview deployment that has a database configured.
Build and verify each change in a Vercel preview before promoting it.

- Set `DATABASE_URL` to a TLS-enabled PostgreSQL connection string and `SITE_URL` to the actual HTTPS origin. Set
  `R2_PUBLIC_URL` to the HTTPS origin used by the existing cover URLs. Do not use `r2.dev` as a production cover
  domain; verify a custom domain is configured for the bucket.
- `DIRECT_DATABASE_URL` is only needed by Drizzle migrations and editorial scripts. R2 write credentials are only
  needed by import scripts. Configure both cache invalidation variables when editorial scripts must invalidate
  deployed content immediately; otherwise cached content can persist until its configured expiry.
  `CACHE_REVALIDATION_URL` must be the **deployed** site's `/api/revalidate-cache` for the database being changed: a
  `localhost` URL invalidates nothing in production (the content then waits for its short `editorial` expiry).
  Only the scripts that run on your own machine read `CACHE_REVALIDATION_URL`; the deployed application only needs
  `CACHE_REVALIDATION_SECRET`. The secret must be exactly the same, without quotes, in Vercel (Production) and in the
  local environment. Vercel applies a changed variable only to **new** deployments, so redeploy Production after
  changing it. An HTTP 401 from the endpoint means the two secrets differ (or the deployment predates the change).
  Use the exact canonical origin: the client does not follow redirects, so a host that redirects (for example one
  without `www`) is reported as a failed invalidation.
- The checked-in Drizzle migrations are versioned under `drizzle/`. Review and apply them through `pnpm db:migrate`
  against the intended database, after verifying the target and testing the migration on a non-production copy.
  Do not use `drizzle-kit push` for production changes.
- `use cache` uses the Next.js runtime cache. A single server instance needs no additional cache service. If the chosen
  deployment runs multiple instances, verify that its platform coordinates Cache Components entries and tag
  invalidations across instances; this repository does not configure a shared cache handler or invalidation
  broadcast.
- No database or object-storage backup/recovery policy is defined in this repository. Before launch, confirm the
  provider's PostgreSQL backup and restore procedure, test restoration in an isolated environment, and verify how
  cover objects can be recovered from the configured R2 bucket. Do not assume a retention period from this codebase.
- The application adds `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` and a
  partial `Content-Security-Policy` (`frame-ancestors`, `base-uri`, `object-src`, `form-action`), whose directives
  cannot change what a page loads. HSTS is set by the Vercel edge. A full CSP (`script-src`, `img-src`,
  `connect-src`) is deliberately not set: it needs per-request nonces for Next.js streaming, which would make every
  page dynamic, and the Supabase and R2 origins must be enumerated first. Introduce it as `Content-Security-Policy-Report-Only`
  in a preview deployment and watch the violations before enforcing it.
- There is no application-level rate limiting: serverless instances do not share memory, so an in-process limiter
  would not limit anything. The public endpoints validate and bound their input (slug patterns, UUIDs, search length,
  payload size) and the write endpoint requires a session and a same-origin request. Configure rate limits in the
  Vercel Firewall for `/api/*`, `/auth/callback` and the Open Graph image routes, which query the database and render.

Database schema changes use Drizzle Kit:

```bash
pnpm db:generate
pnpm db:migrate
```

Review generated migrations before applying them to a production database.

## Editorial catalog

The current catalog is managed through the EPUB import and editorial-review workflow documented in
[scripts/catalog/README.md](./scripts/catalog/README.md). The batch command validates and parses local files without
writing by default:

```bash
pnpm import:collection                                     # read-only: compares every EPUB with the real database
pnpm import:collection -- --apply --confirm-database <id>  # writes, only after reading the dry run
pnpm import:gutenberg -- --help                            # single book; the only way to revise a PUBLISHED edition
pnpm db:review -- --gutenberg-id 123
pnpm db:seed:categories -- --confirm-database <id>
```

The dry run needs `DIRECT_DATABASE_URL` and fails, rather than guessing, when the database cannot be read;
`--epub-only` analyzes the file alone and says so. A published edition is never changed by a normal import, chapters
with saved reading progress are never deleted, and a publication is recorded in `edition_reviews`. Read
[scripts/catalog/README.md](./scripts/catalog/README.md) before using `--apply`.

`scripts/seed.ts` is an old development seed, not the source of the current catalog; it refuses to write to any
remote database.

## Routes

- `/es` and `/en`: Home
- `/[locale]/books`: searchable catalog and category filter
- `/[locale]/books/[slug]`: book details and chapters
- `/[locale]/books/[slug]/[chapter]`: reader
- `/[locale]/authors` and `/[locale]/authors/[slug]`: author index and bibliography
- `/[locale]/categories`: category index
- `/[locale]/library`: browser-local saved books
- `/[locale]/login`, `/register`, `/forgot-password`, `/reset-password`, `/account`: authentication (not indexed)
- Any other URL renders the localized 404 of `src/app/global-not-found.tsx` with a real 404 status (it relies on
  `experimental.globalNotFound`; see [docs/seo.md](docs/seo.md))

Favorites and reader preferences remain browser-local. Reading progress is local for guests and persistent in
`reading_progress` for authenticated users, with a separate local cache/outbox per account and edition. Unscoped
legacy keys are never automatically assigned or uploaded to an account. Resume links include `?edition=<uuid>`;
the chapter URL is an explicit navigation choice and background synchronization cannot redirect it.

Migration `0007_preserve_reading_progress` is already applied in production and recorded in the Drizzle migration
history; do not run it again by hand. It changed the chapter reference to `ON DELETE RESTRICT`, added the FK lookup
index, made authenticated grants explicit and rejects updates older than the stored position. User deletion still
cascades through the user FK. It did not create another progress table or discard existing rows. A database that does
not have it yet receives it, in order, from `pnpm db:migrate` (try that on a copy first).

Reimports reconcile existing chapter UUIDs by unique content, then unique unchanged titles/slugs; chapter numbers
are not identities. Removing or ambiguously matching a chapter with saved progress aborts the transaction and
requires an explicit editorial mapping. Unchanged paragraphs retain their position; rewritten paragraphs use a
bounded relative position inside the same matched chapter. Importing one source does not remove other editions.
Narrative prologues and epilogues are retained.

When a reimport rewrites or extends the text of a chapter that has saved reading progress, the importer keeps the
row's `chapter_id` and `updated_at` as the reader left them, keeps `paragraph_index` on the same paragraph, and
recalculates `percentage` as the share of the chapter's words that come before that paragraph. A reader who had
finished a shorter text is therefore no longer shown as finished once the chapter grows, unless the last paragraph is
still the last one. Back up the progress rows before reimporting a published edition (see
[scripts/catalog/README.md](./scripts/catalog/README.md)).

The outbox flushes on unmount, page hide and visibility changes, using keepalive requests, and replays only for its
owner on a later visit or reconnect. An offline browser still needs a future successful connection to persist to
cloud; deleting its local storage before that connection removes unsent changes.

`node scripts/test-reader-browser.mjs` mounts the real React reader/history components in a temporary headless
browser with controlled router and Supabase adapters. Set `LIBRA_TEST_BROWSER` to a Chromium executable when Edge
is unavailable. It checks one-click Next/Previous, guest reading, stale responses and account changes without a
refresh. `--baseline` loads `ReaderView` from Git `HEAD` instead of the working tree, which is only useful to compare
a local change against the committed version. These tests do not exercise production OAuth or write to PostgreSQL/R2.
