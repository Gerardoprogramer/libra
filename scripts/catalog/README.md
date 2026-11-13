# Importar una colección

El manifiesto `initial-library.ts` referencia EPUB locales. No descarga archivos ni publica ediciones.
Los comandos se ejecutan desde la raíz del proyecto.

Para preparar nuevas ediciones españolas, consulta la [auditoría y requisitos de metadatos](./spanish-readiness.md).
El lector EPUB requiere un título y un idioma únicos y no vacíos: no inventa `Untitled` ni asume inglés.
Los idiomas de más de 10 caracteres se rechazan en vez de truncarse, de acuerdo con el límite actual del schema.

> **Antes de nada: ¿a qué base de datos apunta `.env.local`?** Los scripts escriben en `DIRECT_DATABASE_URL`.
> Si esa variable es la base de producción, `--apply` modifica producción. Cada ejecución imprime
> `Target database: <host enmascarado> (role <rol>, id <id>)` y `--apply` exige repetir ese `<id>` con
> `--confirm-database <id>`. El `<id>` es el valor enmascarado **tal como lo imprime el script** (por ejemplo
> `abc..xy`), no el identificador completo del proyecto: con el identificador completo el importador rechaza la
> escritura. Usa una base de desarrollo para ensayar.

## Flujo seguro

```bash
# 1. Dry-run: compara cada EPUB con la base de datos REAL (lectura, transacción READ ONLY).
pnpm import:collection

# 2. Revisa el plan de cada libro y, solo si es correcto, escribe:
pnpm import:collection -- --apply --confirm-database <id>

pnpm import:collection -- --help
```

El dry-run **siempre** compara con la base de datos: lista capítulos nuevos, modificados, que desaparecerían,
cambios de título, de slug (URL), de número de orden y de metadatos, y las secciones que el extractor descartó.
Si no puede leer la base de datos **falla** (`Could not read the current database state … no plan is reported`):
nunca interpreta una conexión caída como una base vacía ni informa «0 capítulos a eliminar» sin haber comparado.

`--epub-only` es el único modo sin base de datos. Solo analiza el archivo y lo dice explícitamente
(`EPUB-ONLY ANALYSIS: … NOT compared with the database`); no afirma nada sobre qué se conservaría o se eliminaría.
No se puede combinar con `--apply`.

### Qué bloquea un plan

Cada libro termina en uno de estos estados: `planned`, `unchanged`, `BLOCKED`, `FAILED`. Un plan `BLOCKED`
no se escribe y hace que el comando termine con código `1`; el motivo se imprime.

| Situación                                                              | Qué hace falta                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Capítulos que desaparecen del EPUB                                     | `--allow-removals` tras revisar la lista                                             |
| Capítulos con progreso de lectura que desaparecerían                   | Nada lo permite: el importador no los borra; hace falta un mapeo editorial explícito |
| La extracción emitió avisos (texto descartado, portada ignorada, etc.) | `--accept-warnings` tras leerlos                                                     |
| La edición está `PUBLISHED` y el plan la cambia                        | Solo `pnpm import:gutenberg --revise-published --plan-hash <digest>` (ver abajo)     |
| Cambiarían URL de capítulos de una edición publicada                   | Además `--allow-slug-changes`                                                        |
| El slug se derivó del título y ya pertenece a otro libro               | Pasar `--slug` explícito                                                             |
| El EPUB no declara creador y el libro no tiene autores                 | Corregir el EPUB o el libro: no aparecería en el catálogo                            |

Una portada propia de Libra (bajo `covers/libra/`, ver `scripts/covers/README.md`) nunca se sustituye por la del EPUB:
el plan dice `custom cover kept`. Solo `pnpm import:gutenberg --replace-custom-cover` la sustituye, libro a libro.

Una edición publicada **sin cambios** no se toca (ni escrituras, ni subida de portada, ni invalidación de caché).
El `--apply` de una colección nunca modifica una edición publicada: esa revisión es siempre por libro.

### Revisar una edición publicada

```bash
# 1. Dry-run con el flag de intención: imprime el plan y su «Plan digest».
pnpm import:gutenberg -- --file imports/dracula.epub --gutenberg-id 345 --slug dracula \
  --original-title "Dracula" --original-language en --revise-published

# 2. Tras revisar el plan, aplica con el digest exacto. Si el EPUB o la base cambiaron desde la revisión, se rechaza.
pnpm import:gutenberg -- --file imports/dracula.epub --gutenberg-id 345 --slug dracula \
  --original-title "Dracula" --original-language en \
  --revise-published --plan-hash <digest> --apply --confirm-database <id>
```

La política se vuelve a evaluar **dentro de la transacción de escritura**, con la edición, sus capítulos y las
posiciones de lectura bloqueados (`FOR UPDATE`) y bajo un `advisory lock` por fuente: un error a mitad de la
operación no deja una edición parcialmente modificada, y un cambio concurrente invalida el digest.
La edición **no** cambia de `PUBLISHED` a `DRAFT`: se conserva su estado editorial y se registra el cambio.

### Antes de reimportar: respaldo y progreso de lectura

Reescribir una edición publicada sobrescribe el texto de sus capítulos. Antes de aplicar, haz un respaldo de **solo
lectura** de los capítulos y de las filas de `reading_progress` de esa edición, fuera del repositorio y sin
`user_id` (para restaurar basta el `id` de la fila). El texto anterior no se conserva en ninguna otra parte.

Qué hace el importador con esos datos:

- Los capítulos se emparejan por identidad (contenido único; después título y slug únicos), nunca por número. Los
  UUID, slugs y URL se conservan, y un capítulo con progreso guardado nunca se borra.
- En los capítulos cuyo contenido cambia, cada fila de progreso conserva `chapter_id` y `updated_at`, y su
  `paragraph_index` sigue apuntando al mismo párrafo (si ese párrafo existe una sola vez en el texto nuevo; si no,
  usa una posición relativa dentro del mismo capítulo).
- `percentage` se recalcula como la parte de las palabras del capítulo que quedan antes de ese párrafo. Quien había
  terminado un texto más corto deja de figurar como «terminado» cuando el capítulo crece, salvo que su último
  párrafo siga siendo el último. Ejemplo (_Fortunata y Jacinta_, capítulo 1): párrafo 9 de 10 al 100 % pasa a
  párrafo 9 de 19 al 49 %.
- El progreso que solo vive en el navegador de un invitado (`localStorage`) no se puede remapear desde el servidor.

## Agregar un libro

1. Coloca manualmente el EPUB en `imports/`.
2. Añade una entrada a `scripts/catalog/initial-library.ts`:

   ```ts
   {
     file: "imports/dracula.epub",
     gutenbergId: 345,
     slug: "dracula",
     // Original work's first publication year.
     year: 1897,
     // Optional: publication year of the specific source edition.
     editionPublicationYear: 1920,
   }
   ```

3. Usa el ID que corresponda al EPUB descargado y un slug estable para la obra. `year` es el año de publicación
   original de la obra; `editionPublicationYear` es opcional y solo debe proporcionarse cuando se conozca el año de
   esa edición concreta.
4. Ejecuta el dry-run y revisa los capítulos y el informe de cobertura antes de usar `--apply`.

Las rutas son relativas a la raíz, deben terminar en `.epub` y permanecer dentro de `imports/`.
Se validan todos los registros antes de procesar el primero: campos desconocidos, IDs duplicados,
archivos duplicados, slugs inválidos y años que no sean enteros de PostgreSQL detienen el batch completo.
Se permite el mismo slug con distintos IDs de Gutenberg y archivos para varias ediciones de un libro
(por ejemplo `treasure-island` en inglés y en español).

Cada EPUB crea o actualiza una `Edition` enlazada al mismo `Book`; sus capítulos, idioma, portada, fuente y estado
editorial quedan asociados a esa edición. Las relaciones de categorías pertenecen al `Book` y por eso se comparten
entre sus ediciones.

## Informe de extracción (cobertura)

Cada importación imprime qué hizo el extractor con el texto del EPUB:

```text
Text coverage: 393005 of 393123 readable words in 31 chapter(s), 167 numbered subsection(s) merged into their chapters; 8 closing line(s) kept at the end of their chapters; 118 discarded in 16 section(s), 0 before the first section.
Discarded sections:
  - contents            40 words  ÍNDICE
  ? part-divider         2 words  PARTE PRIMERA
```

(Salida real de _Fortunata y Jacinta_, Project Gutenberg 17013.)

- `-` descarte definitivo (índice, portada, licencia, paratexto inequívoco como «Preface» o «Notas del traductor»);
  `?` descarte heurístico (divisor de «Parte» numerada).
- Un subapartado numerado en minúscula (`-ii-`, `-iii-`) **continúa su capítulo**: se añade a él con el marcador
  como párrafo; nunca se descarta.
- Las líneas de cierre de una parte, es decir la línea de lugar y fecha (`Madrid.—Enero de 1886.`) y la fórmula en
  mayúsculas `FIN DE LA PRIMERA PARTE`, `FIN DE LA PARTE SEGUNDA` o `FIN DE LA NOVELA`, se conservan como los últimos
  párrafos del último capítulo de esa parte. Nunca pasan a un título ni crean un capítulo, y el informe las cuenta
  como `closing line(s)`. La regla es deliberadamente estrecha: otros encabezados cortos se siguen descartando.
- Títulos que solo contienen «parte», «notas», «introducción»… (`Una parte de la verdad`, `Notas de un viajero`)
  son capítulos literarios y se conservan.
- Se avisa (y el `--apply` exige `--accept-warnings`) cuando: una sección heurística descartada tiene ≥ 100 palabras,
  una sección definitiva descarta ≥ 1500 palabras, hay texto antes de la primera sección, más del 15 % del texto se
  descarta, un enlace de navegación no resuelve, o la portada se ignora.
- El recuento `conservado + descartado + previo = total` se comprueba siempre; si no cuadra, se avisa.

Un recuento de palabras no demuestra por sí solo que no falte nada: revisa también la lista de capítulos y las
secciones descartadas.

### Límites y portadas

El EPUB se rechaza si el archivo supera 200 MB, una entrada expande más de 100 MB, el total supera 600 MB o tiene más
de 20 000 entradas (se lee el tamaño declarado antes de descomprimir). La portada debe ser JPEG, PNG o WebP según sus
bytes (no según el `media-type` del manifiesto) y no superar 10 MB; si no, se ignora con un aviso. Las claves de R2
llevan el hash del contenido y **nunca se borran**: una portada subida cuya transacción hizo rollback queda como objeto
sin referencia, inofensivo; nunca una referencia rota. Si la portada no cambió, no se vuelve a subir.

## Ejecución y errores

El batch muestra `[posición/total]`, slug, ID y archivo, seguido del detalle del importer y un resultado individual.
Cada importación termina, invalida la caché y cierra su conexión antes de empezar la siguiente.
No hay importaciones paralelas ni reintentos automáticos.

- Archivo ausente: muestra `MISSING`, indica dónde colocar el EPUB y continúa con el siguiente.
- EPUB corrupto, error de acceso, R2 o PostgreSQL: muestra `FAILED` con la causa, sin volcar objetos del driver ni secretos.
- Plan bloqueado por la política: muestra `BLOCKED` y los motivos.
- Por defecto, si falla el libro 4 de 10, se procesan también los libros 5 a 10.
- Con `--fail-fast`, se detiene en el primer fallo o archivo ausente; el resumen cuenta los restantes como no procesados.
- Al finalizar muestra éxitos, ausentes, fallos, bloqueados y no procesados.
- Código de salida `0`: todos correctos. Código `1`: opción/manifiesto inválido, archivo ausente, fallo o plan bloqueado.

El batch no es una transacción global: un fallo del libro 4 no deshace los libros 1 a 3.
Cada libro sí es atómico: o se escribe entero o no se escribe nada.
No ejecutes varios comandos de importación a la vez; además, un `advisory lock` por fuente evita que dos procesos
modifiquen el mismo libro simultáneamente.

## Pipeline y configuración

```text
import-gutenberg.ts ─┐
                    ├─ scripts/lib/import-gutenberg.ts → importGutenbergBook()
import-collection.ts┘      → parseEpub → estado de la BD (solo lectura) → plan (diff + política + digest)
                            → [--apply] transacción: bloqueo + estado + política otra vez → R2 → escritura → invalidación
```

Módulos: `import-plan.ts` (diff, política y digest, puros), `import-database.ts` (lectura `READ ONLY` y escritura
transaccional), `epub-sections.ts` (extracción y informe), `reimport-chapters.ts` (emparejado de capítulos por
identidad: contenido único, luego título y slug únicos; nunca por número).

El pipeline de importación sigue siendo específico de Project Gutenberg (`gutenbergId`, URL y `sourceName` fijos).
El schema y el comando de revisión sí admiten otras fuentes por `sourceName` y `sourceIdentifier`.

El comando individual:

```bash
pnpm import:gutenberg -- --help
pnpm import:gutenberg -- --file imports/dracula.epub --gutenberg-id 345 --slug dracula \
  --original-title "Dracula" --original-language en --year 1897
```

`--year` se guarda en la obra (`Book.originalPublicationYear`); `--edition-year` solo en esa edición
(`Edition.publicationYear`). No copies el año original de la obra al de la edición salvo que coincidan.

Los argumentos se validan antes de leer el EPUB: `--slug` con el mismo patrón que el manifiesto, `--gutenberg-id`
entero positivo, idioma, años enteros de PostgreSQL y combinaciones contradictorias.
Sin `--slug`, el slug se deriva del título del EPUB y **no puede** añadir la fuente a un libro ya existente.

### Autores

Los autores solo se enlazan cuando el libro aún no tiene ninguno. Un autor existente (mismo slug) **se reutiliza tal
como está guardado**: la importación no lo renombra, así que una corrección manual (tildes, orden del nombre) no se
pierde. Si el nombre del EPUB difiere, el plan lo indica. Dos personas distintas con el mismo nombre comparten slug:
el importador no puede distinguirlas; revisa el plan.

## Revisión, publicación y categorías

Las nuevas ediciones siguen entrando como `PENDING_REVIEW` / `DRAFT`. Los reimports no tocan `copyrightStatus`,
`publicationStatus`, `verifiedAt` ni `copyrightNotes`.

```bash
pnpm db:review -- --gutenberg-id 345
# Publica con la clasificación legal verificada independientemente y los motivos de la decisión (--notes es obligatorio):
pnpm db:review -- --gutenberg-id 345 --publish --copyright-status PUBLIC_DOMAIN_VERIFIED \
  --notes "Bram Stoker murió en 1912; dominio público en Costa Rica (vida + 70 años)"
# Lo mismo con --apply escribe; con una base remota, también --confirm-database <id> (el id que imprimió el paso anterior):
pnpm db:review -- --gutenberg-id 345 --publish --copyright-status PUBLIC_DOMAIN_VERIFIED \
  --notes "Bram Stoker murió en 1912; dominio público en Costa Rica (vida + 70 años)" --apply --confirm-database <id>
# Selecciona la edición publicada preferida para su idioma (primero sin --apply):
pnpm db:review -- --gutenberg-id 345 --prefer --apply --confirm-database <id>
pnpm db:review -- --source-name "Archive name" --source-identifier "item-id"
```

`show` (sin acción) es de solo lectura y muestra capítulos, palabras y autores. Una acción sin `--apply` es una
ejecución en seco: imprime la base de destino enmascarada (`Target database: … id <id>`), comprueba lo mismo que la
escritura sin bloquear la fila, describe el cambio y no escribe nada. Con `--apply` escribe y, si la base es remota,
exige `--confirm-database <id>`. `--confirm-database` sin `--apply` se rechaza. `--publish` además exige, comprobado dentro de la transacción con la
edición bloqueada: al menos un capítulo, ninguno vacío, texto legible, título, idioma y `--notes` con los motivos
(≥ 10 caracteres). No exige autor: una obra anónima no tiene filas en `book_authors` y el catálogo la muestra como
«Anónimo» / «Anonymous». `--publish` requiere que el operador proporcione `PUBLIC_DOMAIN_VERIFIED`, `LICENSED` u
`ORIGINAL`; el programa no elige ni infiere la clasificación, y no emite conclusiones jurídicas.

Cada decisión (`PUBLISH`, `REJECT`, `ARCHIVE`, `PREFER`) se registra en la tabla `edition_reviews` en la **misma
transacción**: quién (usuario del sistema operativo), cuándo, estado anterior y nuevo, notas, capítulos y palabras. Una
decisión sin su registro no puede confirmarse. La migración `0008_edition_reviews` **ya está aplicada en producción**
(ver «Migraciones aplicadas»). En una base de desarrollo que aún no la tenga, aplícala antes con `pnpm db:migrate`:
sin la tabla, la transacción falla y no cambia nada.

Las categorías se mantienen en `categoryDefinitions` y `assignments` de `scripts/seed-categories.ts`,
mediante slugs; no se incluyen en el manifiesto de importación ni se hardcodean IDs de DB:

```bash
pnpm db:seed:categories -- --confirm-database <id>
```

Reemplaza las relaciones de categorías de los libros definidos y requiere que todos existan. Tras confirmar, invalida la
caché editorial. `pnpm db:seed` (semilla de desarrollo) **se niega a escribir en una base remota**, con cualquier flag.

Para añadir categorías a libros nuevos sin tocar los demás, usa `scripts/add-book-categories.ts`, que solo inserta las
relaciones que faltan en los libros de su lista (nunca borra ni reordena otras, y repetirlo no cambia nada):

```bash
pnpm db:categories:add                                      # dry-run, transacción READ ONLY
pnpm db:categories:add -- --apply --confirm-database <id>
```

## Migraciones aplicadas

Estas dos migraciones **ya están aplicadas en producción** y registradas en el historial de Drizzle
(`drizzle.__drizzle_migrations`); se verificó el 15 de octubre de 2026, con una lectura de solo lectura:

- `0008_edition_reviews`: tabla de auditoría editorial (RLS activado, sin políticas).
- `0009_book_authors_author_index`: índice por `author_id`.

No deben volver a ejecutarse a mano. `pnpm db:migrate` aplica, en orden, las migraciones que falten en la base de
datos de destino, así que contra producción no hace nada con estas dos; contra una copia de desarrollo que no las
tenga, las aplica. Comprueba siempre el destino (`Target database` / `DIRECT_DATABASE_URL`) antes de migrar.
Se conserva `0006_reading_progress_grants.sql`, que está vacía: ya forma parte del historial compartido
(`_journal.json` y snapshots); borrarla no aporta nada y arriesga la coherencia con bases que ya la registraron.

## Pruebas

```bash
pnpm test        # toda la suite, sin red ni base de datos
pnpm check       # lint + tipos + prettier + tests (es lo que ejecuta CI)
pnpm exec tsx --test scripts/lib/import-gutenberg.test.ts
```

Las pruebas usan archivos temporales, EPUB generados en memoria y una base de datos simulada. Prueban el plan, la
política y la reevaluación bajo bloqueo; no escriben en PostgreSQL ni en R2 reales, y no sustituyen una prueba de
importación en una copia de la base.
