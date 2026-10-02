# Preparación del catálogo español

Auditoría del 1 de octubre de 2026. El inventario se obtuvo con una transacción PostgreSQL
`ISOLATION LEVEL REPEATABLE READ READ ONLY`. No se ejecutaron importadores, seeds, migraciones,
publicaciones ni cambios de preferencia o de estados editoriales. Este documento no evalúa derechos.

## Estado actual

| Dato                                      | Cantidad |
| ----------------------------------------- | -------: |
| Books                                     |       14 |
| Editions                                  |       14 |
| Ediciones en español                      |        2 |
| Ediciones en inglés                       |       12 |
| PUBLISHED                                 |       12 |
| Públicas: PUBLISHED + copyright admisible |       12 |
| Books con alguna edición pública          |       12 |
| DRAFT                                     |        2 |
| PENDING_REVIEW                            |        2 |
| DRAFT y PENDING_REVIEW simultáneamente    |        2 |
| isPreferred = true                        |        0 |
| Books con más de una edición              |        0 |
| Autores almacenados / con obras públicas  |  12 / 11 |
| Categorías con obras públicas             |        8 |

Los conteos DRAFT y PENDING_REVIEW corresponden a las mismas dos ediciones, no a cuatro.
Los idiomas se agruparon por idioma base, sin distinguir mayúsculas o subtags regionales.

| Obra                                          | Autor               | Año original | Año de edición almacenado | Capítulos | Fuente / identificador    |
| --------------------------------------------- | ------------------- | -----------: | ------------------------: | --------: | ------------------------- |
| Marianela                                     | Benito Pérez Galdós |         1878 |                      null |        22 | Project Gutenberg / 17340 |
| Fortunata y Jacinta: dos historias de casadas | Benito Pérez Galdós |         1887 |                      1887 |        31 | Project Gutenberg / 17013 |

Ambas tienen `language=es`, `translator=null`, `coverUrl=null`, `isPreferred=false`,
`publicationStatus=DRAFT` y `copyrightStatus=PENDING_REVIEW`. Conservan su URL de fuente.
No tienen categorías asignadas. Sus EPUB no están en el directorio local `imports/` auditado.
El manifiesto `initial-library.ts` contiene las 12 obras inglesas, no estas dos ediciones españolas.

Benito Pérez Galdós es el autor asociado a las obras españolas almacenadas; tiene dos Books
y ninguno público. Por ello no aparece en `/es/authors` ni en `/en/authors`, y su ficha pública
devuelve ausencia de autor visible. El schema no almacena nacionalidad: este inventario usa
la relación con obras en español, no una clasificación nueva de nacionalidades.

El año 1887 de la edición de Fortunata y Jacinta es un dato ya almacenado. Sin el EPUB y su
evidencia editorial no se confirmó aquí ese año específico ni se copió a otra edición.
El expediente de ambas obras continúa pendiente de ISBN/SINABI y revisión de derechos.

## Comportamiento público

El filtro exige `PUBLISHED` y uno de `PUBLIC_DOMAIN_VERIFIED`, `LICENSED` u `ORIGINAL`.
Se aplica antes de seleccionar una edición. Los siguientes casos describen `/es` sin búsqueda
por texto; también se probaron en la bibliografía de autor y la ficha de obra.

| Caso                                                        | Resultado actual                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A. Hay una edición española pública                         | Se sirve esa edición española.                                                       |
| B. No hay española, pero hay inglesa pública                | Se sirve la inglesa por fallback; sigue identificada como inglés.                    |
| C. Hay varias españolas públicas y una preferida            | Se sirve únicamente la preferida.                                                    |
| D. Solo hay española DRAFT, sin ninguna edición pública     | La obra no aparece en catálogo, Home, autores ni categorías; no tiene ficha pública. |
| E. Hay inglesa pública y española DRAFT                     | Se sirve únicamente la inglesa; el borrador no altera la selección.                  |
| F. Hay varias traducciones españolas públicas sin preferida | Se usa el fallback determinista entre las españolas, no una lista de alternativas.   |

Dentro de cada idioma base, `chooseEdition()` busca primero `isPreferred`. Si no existe,
prioriza la coincidencia exacta del código base (`es`/`en`), después las variantes regionales.
En cada grupo ordena por `createdAt` ascendente y luego por slug ascendente para desempatar.
No utiliza el año de publicación ni evalúa la calidad de una traducción. Si falta el idioma solicitado,
intenta inglés y después la primera edición pública por ese orden estable; sin candidatas no hay obra pública.

### Catálogo, Home y tarjetas

- `getBooks(locale)` agrupa los joins por `Book.id`. Usa mapas por autor, edición y categoría;
  cada obra produce una sola tarjeta aunque aumenten las filas del join.
- Home usa esa misma consulta y muestra sus primeras cinco obras. El orden parte del título
  original: no hay una prioridad global para obras españolas.
- `BookCard` muestra siempre el código del idioma seleccionado debajo de título y autor, junto
  al año original si existe, incluso cuando hay portada. El código se presenta en mayúsculas por CSS.
  Las categorías siguen visibles, con el límite de tres ya existente.
- `/es` identifica el idioma de interfaz, no promete que todo el catálogo esté traducido.
  Los textos ES/EN actuales no hacen esa promesa. Dracula muestra `EN` en la tarjeta y
  `Idioma: inglés` en su ficha española. No se añadió un aviso redundante de fallback.
- Los bloques de historial de Home reciben únicamente los Books públicos y sus metadatos
  seleccionados; no introducen ediciones alternativas en el catálogo.

### Autores y categorías

- `getAuthors()` cuenta `count(distinct books.id)` y excluye autores sin libros públicos.
  El listado es el mismo en ambos locales; los textos de interfaz están localizados.
- `getAuthorBySlug(slug, locale)` agrupa por Book y selecciona una edición por obra, con el
  mismo selector del catálogo. La bibliografía no se multiplica por traducciones.
- `getCategories(locale)` cuenta Books mediante un `Set` por categoría, aunque los joins incluyan
  varias ediciones y traducciones de categorías.
- El filtro de categoría de `getBooks()` usa `EXISTS` sobre `book_categories`; no mueve categorías
  a Edition ni descarta otras categorías de la tarjeta.
- El nombre de categoría usa el locale solicitado, después inglés y finalmente su slug.

### Ficha y navegación

`getBookBySlug(slug, locale)` recibe el idioma desde la ruta; el locale forma parte de los
argumentos y, por tanto, de la clave de caché. Los capítulos pertenecen solo a la edición elegida.
La ficha usa el título, idioma, traductor, portada y fuente de esa edición y mantiene separado
el año original de Book. `sourceName`, `sourceIdentifier` y `sourceUrl` siguen siendo genéricos.

`LanguageSwitcher` usa `usePathname()` y `router.replace(pathname, {locale})` de `next-intl`:
conserva `/books/:slug` y cambia el prefijo de locale, sin generar rutas de edición.
El comportamiento existente no conserva los filtros `?q=...&category=...` al cambiar de idioma,
porque solo pasa el pathname. No se alteró ese comportamiento ni SEO/canonical/hreflang.

## Límites encontrados

1. **Búsqueda por texto antes de seleccionar.** `getBooks()` filtra filas por título de edición,
   título original o autor antes de agrupar y llamar a `chooseEdition()`. Si la consulta solo
   coincide con un título alternativo, una edición preferida puede quedar fuera de las candidatas.
   La tarjeta puede entonces representar una edición distinta de la ficha al abrirla. Buscar solo
   por uno de varios coautores también puede reducir los nombres disponibles para la tarjeta.
   Ejemplo sintético: Book `Obra original`, traducción A `Versión antigua` y traducción preferida B
   `Versión nueva`; buscar `Versión antigua` deja solo A en el catálogo, mientras la ficha sirve B.
   No se cambió la consulta ni el selector en esta fase. Antes de introducir esos datos, conviene
   hacer que la búsqueda identifique Books y conservar sus candidatas públicas completas para
   aplicar el selector existente. Eso requiere una tarea específica de búsqueda.
2. **Metadatos ausentes o ambiguos.** El lector EPUB sustituía un título ausente por `Untitled`
   y un idioma ausente por `en`, y truncaba el idioma a diez caracteres. Se eliminó esa inferencia:
   ahora rechaza estos casos y pide metadatos no ambiguos. El parser XML conserva texto literal,
   incluidos títulos numéricos con ceros iniciales. No se alteraron registros existentes.
3. **Importador específico de Gutenberg.** El modelo y la UI son genéricos; las herramientas de
   importación actuales fijan el nombre de fuente y construyen su URL a partir de `gutenbergId`.
   No hay todavía un importador configurable para otra fuente. No debe usarse el de Gutenberg
   asignando un identificador ficticio a un EPUB de otro proveedor.
4. **Identidad de la obra en una traducción nueva.** Para un Book nuevo, el importador copia
   `originalTitle` y `originalLanguage` del EPUB. Si ese EPUB es una traducción, esos datos
   describirían la edición, no necesariamente el original. Preparar y verificar la identidad de Book
   es necesario antes de ampliar ese flujo; para una obra ya existente hay que reutilizar su slug.
5. **Autor ausente y reimportaciones.** Si faltan creadores, el parser conserva una lista vacía,
   sin inventar un autor. El importador actual no bloquea ese caso y el listado público, que hace
   inner join con autores, omitiría esa obra. La autoría requiere revisión previa. Reimportar también
   reemplaza capítulos y puede sobrescribir metadatos opcionales con null; no es una operación
   neutra sobre un borrador o una publicación existente.

## Información que debe prepararse antes de importar

| Campo                      | Origen y tratamiento actual                                                                                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identidad de Book / slug   | Decisión editorial explícita: reutilizar el slug de la misma obra; no derivarlo del título traducido si Book ya existe. El valor por defecto se calcula desde el título del EPUB.                                                              |
| Título de edición          | `dc:title` del EPUB. Se exige un único valor no vacío; no se inventa un sustituto.                                                                                                                                                             |
| Autor                      | `dc:creator`, excluyendo los marcados como traductor. El importador normaliza nombres `Apellido, Nombre`. Revisar autoría y roles: otros creadores, como editores, no siempre están distinguidos; no atribuirlos automáticamente como autores. |
| Idioma de edición          | `dc:language`, normalizado a minúsculas. Único, no vacío y de hasta diez caracteres por el schema actual; revisar que sea el código correcto. No se deduce del locale de interfaz.                                                             |
| Traductor                  | Creator o contributor con rol explícito `trl`, `translator` o `translation`: atributos EPUB2 o refinamientos EPUB3. Varios se unen con coma; sin rol de traducción se guarda null. El autor no se usa como sustituto.                          |
| Título e idioma originales | En un Book nuevo se copian actualmente del EPUB; verificar que realmente describan la obra original. En un Book existente se conservan. El CLI no ofrece campos separados para corregirlos.                                                    |
| Año original               | `--year` / `year` del manifiesto, documentado editorialmente; se guarda solo al crear Book. Omitido: null. No se extrae de `dc:date`.                                                                                                          |
| Año de edición             | `--edition-year` / `editionPublicationYear`, con evidencia de esa edición concreta. Omitido: null. No se copia del año original ni se deduce de la fecha de creación digital del EPUB.                                                         |
| Nombre de fuente           | `Edition.sourceName` admite cualquier fuente; el importador actual fija `Project Gutenberg`. No lo extrae del EPUB.                                                                                                                            |
| Identificador de fuente    | `Edition.sourceIdentifier` es genérico; actualmente se proporciona `gutenbergId`. No se copia automáticamente un ISBN, UUID u otro `dc:identifier` como ID de Gutenberg.                                                                       |
| URL de fuente              | Campo genérico; el importador actual genera `https://www.gutenberg.org/ebooks/{id}`. Para otras fuentes se necesita ampliar el flujo, no inventar esa URL.                                                                                     |
| Portada                    | Imagen `cover-image` EPUB3 o referencia de portada EPUB2. Ausente: null y portada visual de respaldo. Con apply se subiría a R2; comprobar procedencia de la imagen dentro de la revisión pendiente.                                           |
| Capítulos                  | Extraídos del spine con navegación EPUB3/NCX y estructura del contenido; revisar orden, títulos y separación. Sin capítulos legibles el parser falla. No requieren proporcionarse uno a uno.                                                   |
| Categorías                 | Pertenecen a Book y no se infieren del EPUB. El manifiesto no las admite; la herramienta existente las asigna por slugs en un paso separado. No se ejecutó ese paso.                                                                           |

El importador crea ediciones como `DRAFT / PENDING_REVIEW`; `isPreferred` queda en false por
el valor por defecto del schema. Una reimportación preserva estados, preferencia y datos de revisión,
pero actualiza título, idioma, traductor, año de edición, portada y capítulos. Book y relaciones de
autor ya existentes no se corrigen mediante esos argumentos. La deduplicación de edición se basa
en `(sourceName, sourceIdentifier)`, no en idioma: el modelo permite varias ediciones españolas.

## Cambios y pruebas de esta fase

Se conservó la UI y la selección pública. El único cambio funcional fue la validación de título
e idioma del lector EPUB. Se añadieron pruebas de queries, idioma de BookCard y metadatos EPUB;
la consulta real de PostgreSQL se limitó al inventario de solo lectura.

Las pruebas de queries cargan las funciones reales de `books.ts` con el driver en memoria
de Drizzle y caché simulada. Verifican SQL de visibilidad y conteo de Books distintos, y usan
filas simuladas para la agrupación y selección. No sustituyen un test de integración de PostgreSQL
con varias ediciones reales; actualmente no existen esos casos en la DB.

Las pruebas de EPUB generan buffers locales en memoria y llaman exclusivamente al parser.
No se ejecutó `importGutenbergBook`, `importCollection` ni un CLI de importación, ni siquiera en dry-run.

Comando de pruebas relevantes:

```powershell
pnpm exec tsx --test scripts/lib/parse-epub.test.ts src/db/queries/books.test.ts src/components/books/BookCard.test.tsx src/components/books/EditionDetails.test.tsx src/i18n/navigation.test.tsx src/i18n/message-parity.test.ts src/lib/edition-selection.test.ts src/lib/editorial-status.test.ts src/db/queries/editorial-visibility.test.ts src/lib/seo-metadata.test.ts
```

Resultado de validación de esta fase:

| Validación                                    | Resultado                               |
| --------------------------------------------- | --------------------------------------- |
| Tests del comando anterior                    | 51 aprobados; ninguno fallido u omitido |
| `pnpm lint`                                   | OK                                      |
| `pnpm exec tsc --noEmit`                      | OK                                      |
| `pnpm build`                                  | OK; 30 páginas estáticas generadas      |
| Prettier sobre los seis archivos de esta fase | OK                                      |
| `git diff --check`                            | OK                                      |

## Siguiente paso recomendado

Preparar fuera de PostgreSQL la ficha de procedencia y metadatos de cada candidata española,
incluyendo identidad de Book, atribuciones, años separados, fuente y archivo local. Mantener
Marianela y Fortunata y Jacinta pendientes. Antes de incorporar varias traducciones públicas,
resolver la búsqueda por Book; antes de importar desde otra fuente o una traducción como primera
edición, ampliar únicamente el contrato de importación necesario para esos casos.
