# Libra

Libra is a bilingual (Spanish and English) digital library for classic literature. The web application uses
Next.js App Router, React Server Components, Tailwind CSS, next-intl, PostgreSQL and Drizzle ORM. Book covers
are served from Cloudflare R2.

## Requirements

- Node.js supported by Next.js 16
- pnpm (the repository pins pnpm 10.29.3)
- PostgreSQL
- Cloudflare R2 credentials only when importing EPUBs that contain covers

## Setup

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env.local` and set the values required by your environment.
3. Set `DATABASE_URL` to the PostgreSQL connection string used by the application. It must support TLS.
4. For direct database scripts, set `DIRECT_DATABASE_URL` to a PostgreSQL connection string that supports TLS.
5. In production, set `SITE_URL` to the real canonical HTTPS origin (for example, `SITE_URL=https://dominio-real.com`).
   Do not use a placeholder domain. It is also used for the sitemap and robots directive. In development it may be
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
pnpm exec tsc --noEmit
pnpm exec prettier --check .
pnpm build
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

This repository does not declare a hosting provider, container image, CI deployment workflow, or infrastructure
configuration. Deploy to a Node.js runtime compatible with Next.js 16 and Cache Components. Confirm streaming support
and configure production environment variables in the chosen provider; the README's prior create-next-app deployment
boilerplate did not represent a verified Libra deployment.

- Set `DATABASE_URL` to a TLS-enabled PostgreSQL connection string and `SITE_URL` to the actual HTTPS origin. Set
  `R2_PUBLIC_URL` to the HTTPS origin used by the existing cover URLs. Do not use `r2.dev` as a production cover
  domain; verify a custom domain is configured for the bucket.
- `DIRECT_DATABASE_URL` is only needed by Drizzle migrations and editorial scripts. R2 write credentials are only
  needed by import scripts. Configure both cache invalidation variables when editorial scripts must invalidate
  deployed content immediately; otherwise cached content can persist until its configured expiry.
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
- The application adds `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, and `Permissions-Policy`.
  Configure HSTS at the HTTPS edge only after the production domain and TLS setup are verified. No CSP is set because
  the image, script, and streaming origins have not been verified for the production deployment.

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
pnpm import:collection
pnpm import:collection -- --apply
pnpm import:gutenberg -- --file imports/book.epub --gutenberg-id 123 --slug book
pnpm db:review -- --gutenberg-id 123
pnpm db:seed:categories
```

Use `--apply` only after reviewing a dry run and confirming the configured database and R2 bucket. Publication is a
separate manual review step. The category seed updates only the category definitions and assignments in its script;
review those assignments before running it.

`scripts/seed.ts` is an old development seed, not the source of the current catalog. Do not run it against the
production catalog.

## Routes

- `/es` and `/en`: Home
- `/[locale]/books`: searchable catalog and category filter
- `/[locale]/books/[slug]`: book details and chapters
- `/[locale]/books/[slug]/[chapter]`: reader
- `/[locale]/authors` and `/[locale]/authors/[slug]`: author index and bibliography
- `/[locale]/categories`: category index
- `/[locale]/library`: browser-local saved books

Favorites, reading progress and reader preferences are stored in the user's browser; they are not account data.
