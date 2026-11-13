# Operación: base de desarrollo, scripts que escriben y precauciones

Este documento describe procedimientos. No contiene identificadores, URLs ni datos de ninguna base real: los valores
de conexión viven en `.env.local` (no versionado) y en la configuración del proveedor.

## Base de desarrollo separada

Todos los scripts editoriales y `pnpm db:migrate` escriben en la base de `DIRECT_DATABASE_URL`. La aplicación lee la
de `DATABASE_URL`. **Si cualquiera de las dos apunta a producción, un `--apply` escribe en producción.** Usa una base de
desarrollo distinta:

1. **Proyecto de Supabase propio para desarrollo** (recomendado). Da base de datos y Auth separados de producción. Copia
   `.env.example` a `.env.local` y pon en `DATABASE_URL`, `DIRECT_DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` y
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` los valores de ese proyecto. Una base remota necesita `DATABASE_CA_CERT`
   (README, «Setup»), y los scripts exigen `--confirm-database <id>` con el id que imprimen.
2. **PostgreSQL local.** Las URL con host `localhost`, `127.0.0.1` o `::1` cuentan como locales
   (`src/db/tls.ts`): los scripts no piden CA ni `--confirm-database`, solo `--apply`. Dos requisitos que impone el
   código:
   - Las migraciones `0004` y `0007` esperan lo que Supabase ya trae: el esquema `auth` con `auth.users` y `auth.uid()`,
     y los roles `anon` y `authenticated`. `SUPABASE_SHIMS` en `scripts/lib/disposable-postgres.ts` es el mínimo que
     las pruebas crean antes de migrar.
   - La aplicación conecta a una `DATABASE_URL` local con `ssl: "require"` (`src/db/index.ts`), así que ese servidor
     debe aceptar TLS. Los scripts, en cambio, conectan sin TLS a una base local.

   Auth sigue necesitando un proyecto de Supabase (`NEXT_PUBLIC_SUPABASE_*`).

Después, con la base de desarrollo configurada:

```bash
pnpm db:migrate                 # muestra el destino enmascarado y las migraciones pendientes
pnpm db:migrate -- --apply      # local; una base remota añade --confirm-database <id>
```

Comprueba siempre la línea `Target database: … id <id>` antes de repetir un comando con `--apply`.

## Scripts que escriben y su guarda

Todos imprimen `Target database: <host enmascarado> (role …, id <id>)`, el mismo formato de `describeDatabaseTarget`
(`scripts/lib/import-plan.ts`). La guarda común está en `scripts/lib/write-guard.ts`: `parseApplyArguments` (o el parser
propio del script), `assertConfirmationNeedsApply` y `assertWriteAllowed`. `--confirm-database` sin `--apply` se rechaza
en todos.

| Script (`pnpm …`)         | Escribe en                                     | Sin `--apply`                                            | Para escribir                                                                                                                   |
| ------------------------- | ---------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `db:migrate`              | Esquema de la base                             | Lista las migraciones pendientes (lectura `READ ONLY`)   | `--apply`; base remota: `--confirm-database <id>`                                                                               |
| `import:gutenberg`        | Base, R2 (portada) y caché del sitio           | Compara el EPUB con la base y muestra el plan            | `--apply --confirm-database <id>`, también en local (`id local`); ediciones publicadas: además `--revise-published --plan-hash` |
| `import:collection`       | Base, R2 y caché                               | Igual, para cada libro del manifiesto                    | `--apply --confirm-database <id>`                                                                                               |
| `db:review`               | `editions`, `edition_reviews` y caché          | Muestra la edición, comprueba y describe la acción       | `--apply`; base remota: `--confirm-database <id>`                                                                               |
| `db:seed:categories`      | Categorías, relaciones libro–categoría y caché | Plan por libro (lectura `READ ONLY`)                     | `--apply`; base remota: `--confirm-database <id>`                                                                               |
| `db:categories:add`       | Relaciones libro–categoría y caché             | Plan de relaciones a añadir (lectura `READ ONLY`)        | `--apply`; base remota: `--confirm-database <id>`                                                                               |
| `db:replace-cover`        | R2, `editions.cover_url` y caché               | Valida la imagen y muestra portada actual, nueva y clave | `--apply --expect-current <url\|none>`; base remota: `--confirm-database <id>`                                                  |
| `db:migrate-cover-origin` | `editions.cover_url` y caché                   | Cuenta las filas que cambiarían (lectura `READ ONLY`)    | `--apply`; base remota: `--confirm-database <id>`                                                                               |
| `db:seed`                 | Base local de desarrollo                       | —                                                        | Escribe al ejecutarse, y **rechaza cualquier base remota** con cualquier flag                                                   |
| `db:studio`               | Lo que edites en su interfaz                   | **Sin guarda**                                           | Ver abajo                                                                                                                       |

«Caché del sitio»: tras escribir, los scripts piden al endpoint `/api/revalidate-cache` de `CACHE_REVALIDATION_URL` que
invalide las etiquetas afectadas (README, «Production operations»). No escriben en la base del sitio por esa vía.

Los comandos que no escriben: `smoke:production` y `smoke:seo` (solo peticiones GET), `test` (sin red ni base real; las
pruebas de integración solo aceptan el contenedor desechable de `docs/epub-images.md`), `db:generate` (escribe archivos
en `drizzle/`), `lint`, `typecheck`, `format:check`, `build` (lee la base para prerenderizar).

## Precauciones

### `pnpm db:studio`

`db:studio` abre Drizzle Studio sobre la base de `DIRECT_DATABASE_URL` (vía `drizzle.config.ts`). Es una interfaz de
edición: **puede modificar y borrar datos**, y no imprime el destino ni pide confirmación. **No lo uses contra
producción.** Antes de abrirlo, comprueba con `pnpm db:migrate` (sin `--apply`) qué destino tiene `.env.local`.

### Migraciones

- Una migración cambia el esquema de la base entera, y el migrador aplica todas las pendientes en una transacción.
  Pruébala antes en la base de desarrollo, y revisa el SQL generado por `pnpm db:generate`.
- Nunca ejecutes a mano un archivo de `drizzle/`: `pnpm db:migrate` registra cada migración en
  `drizzle.__drizzle_migrations`, y una aplicada a mano se intentaría aplicar otra vez.
- No uses `drizzle-kit push` contra una base compartida: cambia el esquema sin migración ni registro.
- Este repositorio no define copias de seguridad (README, «Production operations»): confirma la del proveedor antes de
  migrar una base con datos que importen.
