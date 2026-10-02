# Importar una colección

El manifiesto `initial-library.ts` referencia EPUB locales. No descarga archivos ni publica ediciones.
Los comandos se ejecutan desde la raíz del proyecto.

Para preparar nuevas ediciones españolas, consulta la [auditoría y requisitos de metadatos](./spanish-readiness.md).
El lector EPUB requiere un título y un idioma únicos y no vacíos: no inventa `Untitled` ni asume inglés.
Los idiomas de más de 10 caracteres se rechazan en vez de truncarse, de acuerdo con el límite actual del schema.

```bash
# Analiza todos los EPUB, muestra capítulos y portadas; no requiere credenciales.
pnpm import:collection

# Escribe usando el pipeline editorial existente.
pnpm import:collection -- --apply

# Opcional: detenerse ante el primer error, incluido un archivo ausente.
pnpm import:collection -- --apply --fail-fast

pnpm import:collection -- --help
```

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
4. Ejecuta el dry-run y revisa los capítulos detectados antes de usar `--apply`.

Las rutas son relativas a la raíz, deben terminar en `.epub` y permanecer dentro de `imports/`.
Se validan todos los registros antes de procesar el primero: campos desconocidos, IDs duplicados,
archivos duplicados, slugs inválidos y años que no sean enteros de PostgreSQL detienen el batch completo.
Se permite el mismo slug con distintos IDs de Gutenberg y archivos para varias ediciones de un libro.
El manifiesto inicial incluye Dracula (345) y Frankenstein (84); no exige que sus EPUB estén presentes.

Cada EPUB crea o actualiza una `Edition` enlazada al mismo `Book`; sus capítulos, idioma, portada, fuente y estado
editorial quedan asociados a esa edición. Las relaciones de categorías pertenecen al `Book` y por eso se comparten
entre sus ediciones.

## Ejecución y errores

El batch muestra `[posición/total]`, slug, ID y archivo, seguido del detalle del importer y un resultado individual.
Cada importación termina, invalida la caché y cierra su conexión antes de empezar la siguiente.
No hay importaciones paralelas ni reintentos automáticos.

- Archivo ausente: muestra `MISSING`, indica dónde colocar el EPUB y continúa con el siguiente.
- EPUB corrupto, error de acceso, R2 o PostgreSQL: muestra `FAILED` con la causa, sin volcar objetos del driver ni secretos.
- Por defecto, si falla el libro 4 de 10, se procesan también los libros 5 a 10.
- Con `--fail-fast`, se detiene en el primer fallo o archivo ausente; el resumen cuenta los restantes como no procesados.
- Al finalizar muestra cantidades de éxitos, archivos ausentes, fallos y libros no procesados.
- Código de salida `0`: todos correctos. Código `1`: opción/manifiesto inválido, archivo ausente o fallo de algún libro.
  Un éxito en dry-run significa EPUB analizado, sin escrituras; en apply significa importación completada.

El batch no es una transacción global: un fallo del libro 4 no deshace los libros 1 a 3.
Se puede volver a ejecutar el manifiesto después de corregir los errores; también se puede usar el comando individual
para reintentar solo un libro. Cada nueva ejecución vuelve a importar todas las entradas que alcance.
No ejecutes varios comandos de importación a la vez: la ejecución secuencial se garantiza dentro de cada proceso,
sin un bloqueo global entre procesos independientes.

## Pipeline y configuración

```text
import-gutenberg.ts ─┐
                    ├─ scripts/lib/import-gutenberg.ts → importGutenbergBook()
import-collection.ts┘      → parseEpub → dry-run o R2 → transacción DB → invalidación editorial
```

El pipeline de importación sigue siendo específico de Project Gutenberg (`gutenbergId`, URL y `sourceName` fijos).
El schema y el comando de revisión sí admiten otras fuentes por `sourceName` y `sourceIdentifier`, pero todavía no
existe un importador configurable para descargar o ingresar EPUBs de una fuente distinta.

El comando individual conserva sus argumentos:

```bash
pnpm import:gutenberg -- --file imports/dracula.epub --gutenberg-id 345 --slug dracula --year 1897
pnpm import:gutenberg -- --file imports/dracula.epub --gutenberg-id 345 --slug dracula --year 1897 --apply
pnpm import:gutenberg -- --file imports/dracula.epub --gutenberg-id 345 --slug dracula --year 1897 --edition-year 1920 --apply
```

The `--year` value is stored on the work (`Book.originalPublicationYear`); `--edition-year` is stored only on that
source edition (`Edition.publicationYear`). Do not copy the work's original year into the edition year unless it is
also the publication year of the particular edition being imported.

El dry-run no abre conexiones a PostgreSQL ni llama a R2 o al endpoint de invalidación.
Valida la estructura del EPUB; no verifica credenciales, permisos remotos ni conflictos con datos existentes.
Apply carga `.env.local` y necesita `DIRECT_DATABASE_URL`; los EPUB con portada necesitan las variables `R2_*`
del `.env.example`. Se reutilizan las mismas claves de portada con hash y la misma invalidación editorial.

La transacción DB y la subida a R2 no son atómicas entre sí: un fallo de PostgreSQL después de subir una portada
puede dejar un objeto sin referencia, como ya ocurría con el importer individual.
Si falla la invalidación después del commit, se conserva el éxito de la importación y el helper existente muestra
un aviso. La caché puede conservar el contenido anterior hasta expirar o invalidarse correctamente.

## Revisión, publicación y categorías

Las nuevas ediciones siguen entrando como `PENDING_REVIEW` / `DRAFT`. Los reimports mantienen `copyrightStatus`,
`publicationStatus`, `verifiedAt` y `copyrightNotes`, incluyendo `PUBLIC_DOMAIN_VERIFIED` / `PUBLISHED`.
Los capítulos se reemplazan por completo, igual que en la importación individual.

La revisión y publicación siguen siendo manuales:

```bash
pnpm db:review -- --gutenberg-id 345
# Publica con la clasificación legal que haya sido verificada independientemente:
pnpm db:review -- --gutenberg-id 345 --publish --copyright-status PUBLIC_DOMAIN_VERIFIED --notes "Revisión editorial realizada"
# Selecciona la edición publicada preferida para su idioma:
pnpm db:review -- --gutenberg-id 345 --prefer
# También se pueden revisar fuentes distintas de Gutenberg:
pnpm db:review -- --source-name "Archive name" --source-identifier "item-id"
```

`--publish` requiere que el operador proporcione `PUBLIC_DOMAIN_VERIFIED`, `LICENSED` u `ORIGINAL`; el programa no
elige ni infiere la clasificación. `--prefer` solo acepta una edición publicada con clasificación visible y sustituye
la preferencia anterior de la misma obra e idioma. Las ediciones alternativas se conservan en la base, pero no tienen
una ruta pública propia; la ficha de la obra sirve la preferida cuando está seleccionada.

Las categorías se mantienen en `categoryDefinitions` y `assignments` de `scripts/seed-categories.ts`,
mediante slugs; no se incluyen en el manifiesto de importación ni se hardcodean IDs de DB.
Después de editar esas asignaciones y de importar los libros correspondientes:

```bash
pnpm db:seed:categories
```

Ese seed reemplaza las relaciones de categorías de los libros definidos y requiere que todos existan.
Actualmente no invalida automáticamente la caché editorial; esto se mantiene como un paso separado y se debe
considerar al verificar los cambios de categorías (invalidación explícita o expiración de caché).

## Pruebas

```bash
pnpm exec tsx --test scripts/lib/import-collection.test.ts
```

Las pruebas usan archivos temporales y EPUB generados localmente. Prueban el pipeline real en dry-run;
para apply verifican el traspaso de opciones y la ejecución secuencial en el límite del importer,
sin escribir en PostgreSQL ni R2 reales.
