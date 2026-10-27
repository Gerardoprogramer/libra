# Ilustraciones de EPUB: códec, bloques y persistencia

Las ilustraciones de un EPUB se inspeccionan, se decodifican y se vuelven a codificar con sharp (libvips) antes de
guardarse. Este documento fija qué identifica al códec que las normaliza, en qué entornos se admite, cómo se guardan
los bloques de capítulo y cómo se persisten las imágenes en PostgreSQL y en el almacén de objetos (Fase 2D).

**Estado:** la persistencia está implementada y probada con un almacén de objetos en memoria y con PostgreSQL local
desechable. **La importación real de imágenes no está habilitada:** no existe un almacén conectado a un bucket, y un
import que escribiría imágenes se rechaza antes de escribir nada (ver «Habilitación pendiente»).

## Archivos

| Archivo                                | Función                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `scripts/lib/epub-images.ts`           | Inspección, límites (`IMAGE_LIMITS`), tamaño normalizado y `processImage`.                              |
| `scripts/lib/sharp-codec.ts`           | El códec real, `sharpCodecId`, la allowlist de entornos y `createVerifiedSharpCodec`.                   |
| `scripts/lib/sharp-golden.ts`          | Entradas de oro para comprobar los bytes que escribe un entorno.                                        |
| `scripts/lib/parse-epub.ts`            | Con un códec, normaliza cada imagen de figura y devuelve `images` e `imageWarnings`.                    |
| `src/lib/chapter-blocks.ts`            | Contrato de bloques y `ChapterText`, la única forma de escribir el texto de un capítulo.                |
| `scripts/lib/import-plan.ts`           | Diff con cambios de bloques e imágenes; digest del plan v3.                                             |
| `scripts/lib/object-store.ts`          | Interfaz `ObjectStore` y verificación de objetos.                                                       |
| `scripts/lib/object-store-fixtures.ts` | `MemoryObjectStore`, el almacén en memoria para pruebas; ningún módulo de producción lo importa.        |
| `scripts/lib/import-database.ts`       | Estado con bloques y asociaciones; escritura de recursos, asociaciones y comprobación previa al commit. |
| `scripts/lib/import-gutenberg.ts`      | Orquestación: códec verificado, plan, almacén fuera de la transacción, transacción corta.               |
| `scripts/lib/disposable-postgres.ts`   | Base PostgreSQL desechable para las pruebas de integración.                                             |
| `src/db/schema/assets.ts`              | `image_assets` (un recurso normalizado) y `edition_assets` (qué ruta del EPUB usa cada edición).        |

## Identidad de un recurso

Un recurso de `image_assets` se identifica por `(source_sha256, codec_id, max_width)`: el SHA-256 de los bytes
originales, el identificador del códec y el ancho máximo de normalización. La clave del objeto es el SHA-256 de los
bytes normalizados con la extensión de su formato (`illustrations/<sha256>.<jpg|png|webp>`), y la tabla comprueba que
lo sea. El identificador del códec debe cambiar siempre que puedan cambiar los bytes normalizados.

## Identificador del códec

`sharpCodecId` construye el identificador con las versiones efectivas que informa `sharp.versions` y los ajustes que
determinan los bytes. Con la compilación aprobada (Windows x64):

```text
sharp@0.35.5/libvips@8.18.7/mozjpeg@0826579/png@1.6.58/zlib-ng@2.3.3/webp@1.6.0/lcms@2.19.1/exif@0.6.26/highway@1.4.0/win32-x64/simd/settings-v2.013fec5dc66c
```

| Parte                       | Por qué cambia los bytes                                                             |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `sharp@…`                   | Traduce las opciones a operaciones de libvips.                                       |
| `libvips@…`                 | Decodificación, orientación, remuestreo y conversión de color.                       |
| `mozjpeg@…`                 | Codificador y decodificador JPEG (trellis y tablas de cuantización de mozjpeg).      |
| `png@…`, `zlib-ng@…`        | libpng y la compresión deflate de los PNG.                                           |
| `webp@…`                    | Codificador y decodificador WebP.                                                    |
| `lcms@…`                    | Conversión de perfiles ICC (P3, CMYK) a sRGB.                                        |
| `exif@…`                    | Lectura de la orientación EXIF.                                                      |
| `highway@…`                 | Rutas SIMD del remuestreo.                                                           |
| plataforma (`win32-x64`, …) | Los binarios precompilados son distintos por plataforma; glibc y musl se distinguen. |
| `simd` / `nosimd`           | Las rutas vectorial y escalar pueden redondear distinto (`sharp.simd()`).            |
| `settings-v<n>.<12 hex>`    | Versión manual de la canalización y digest de `SHARP_PIPELINE` y `SHARP_ENCODING`.   |

Reglas:

- Si falta la versión de cualquiera de esas bibliotecas, o alguna tiene un formato inesperado, `sharpCodecId` falla en
  lugar de emitir una identidad incompleta. Es el caso de una libvips instalada globalmente.
- Cambiar un ajuste de `SHARP_PIPELINE` o `SHARP_ENCODING` cambia el digest y, por tanto, el identificador.
- Un cambio en `normalize` que esos ajustes no reflejen exige incrementar `SHARP_SETTINGS_VERSION`.
- El identificador cabe en `image_assets_codec_id_check` (200 caracteres); si no cupiera, `sharpCodecId` falla.

## Entornos admitidos

Un import normaliza imágenes solo con un códec verificado por `createVerifiedSharpCodec`, antes de analizar el EPUB:
un entorno no admitido no procesa ninguna imagen ni sube nada. La verificación exige tres comprobaciones
independientes, en este orden:

1. **Identificador en la allowlist.** El identificador calculado en este proceso debe ser exactamente uno de
   `SUPPORTED_SHARP_ENVIRONMENTS`. Hoy solo figura `win32-x64/simd` con sharp 0.35.5. Linux, WASM, SIMD desactivado y
   cualquier otra versión quedan fuera.
2. **Binario nativo precompilado.** `process.report.getReport().sharedObjects` debe listar
   `@img/sharp-<plataforma>/lib/sharp-<plataforma>-<versión>.node` y la `libvips-cpp-<versión>` de sharp, y ningún
   otro binario de sharp.
3. **Hashes de oro.** Las entradas de `sharp-golden.ts` deben normalizarse exactamente a los SHA-256 registrados para
   ese entorno. Cubren JPEG con perfil P3 y orientación EXIF, WebP con alfa y un PNG ancho que se remuestrea.

Limitaciones de `sharedObjects`, por las que no es la única comprobación:

- Muestra rutas, no contenidos: un archivo sustituido en la misma ruta la pasaría. Los hashes de oro lo detectan.
- Solo lista bibliotecas que carga el sistema operativo. El build WASM no carga ninguna, por eso se rechaza; pero esa
  ausencia también ocurriría si el informe no estuviera disponible, y en ese caso la comprobación también falla.
- Un binario compilado desde fuente se carga desde `sharp/src/build/`, que se rechaza por su ruta.

Añadir un entorno exige registrar en ese mismo entorno su identificador, comprobar allí su binario nativo y registrar
allí sus hashes de oro; nunca copiarlos de otro. Las 656 imágenes del corpus dieron los mismos bytes en Windows y Linux
con las configuraciones probadas, pero esa evidencia no basta para admitir Linux.

Consecuencia: otra plataforma o versión produce otro identificador y, por tanto, filas nuevas en `image_assets`. Si
los bytes coinciden, la clave del objeto es la misma: el objeto no se duplica, solo la fila.

## Imágenes no disponibles

Si una imagen referenciada por una figura no supera la inspección o la normalización, o falta, la figura se conserva
con `image: null`, con su `alt` y su pie. El parser devuelve un aviso estructurado (`ImageWarning`: capítulo, título,
referencia, ruta, código y motivo). El importador lo convierte en un aviso que nombra la edición (Gutenberg id):

- Los avisos bloquean el import por defecto. Solo continúa con `--accept-warnings`.
- La lista de avisos y la aceptación forman parte del digest del plan. El dry run que da el digest a aprobar debe
  llevar el mismo `--accept-warnings` que la escritura.
- Una imagen rechazada no tiene recurso, ni asociación, ni objeto: ninguna figura apunta a algo inexistente.
- Los errores de integridad (bloques fuera del contrato, rutas inseguras, texto que no se deriva de los bloques) nunca
  son avisos: abortan.

## Escritura de capítulos

`chapters.blocks` está tipado como `unknown`. La garantía está en el punto de escritura, no en el tipo:

- `ChapterText` es la única forma de producir las columnas de texto (`content`, `word_count`, `blocks`), que siempre se
  escriben juntas. `ChapterText.withBlocks(content, blocks)` valida bloques no confiables con
  `chapterBlocksForStorage`: esquema, versión, campos, marcas, rutas de imagen y que deriven exactamente `content`.
  `ChapterText.textOnly(content)` escribe `blocks = NULL` de forma explícita. Nada inventa bloques ni repara bloques
  inválidos.
- `src/lib/chapter-writes.test.ts` lee el código del repositorio y falla si un archivo distinto de
  `scripts/lib/import-database.ts` (capítulos importados) o `scripts/seed.ts` (texto de desarrollo) escribe en
  `chapters`, si alguna escritura fija a mano una columna de texto, o si alguna se hace con SQL crudo.
- La lectura sigue pasando por `readStoredChapterBlocks`. Los capítulos con `blocks = NULL` se leen desde `content`
  como antes.

## Plan del import

- Un capítulo cuyo texto no cambia pero cuyos bloques sí (o que no tiene bloques, o los tiene inválidos) es un cambio
  `blocks`. Las imágenes se planifican por ruta: nueva, cambiada, igual o retirada, comparadas con las asociaciones
  de la edición.
- Cualquier cambio de bloques o imágenes en una edición `PUBLISHED` exige `--revise-published` y un `--plan-hash`
  vigente, recalculado bajo el advisory lock.
- El digest v3 incluye los bloques, las imágenes normalizadas (ruta, identidad, hash, clave, tipo, tamaño), las
  asociaciones existentes, los avisos y su aceptación. Las listas se ordenan y el JSON se canoniza, así que el orden
  de datos equivalentes no cambia el digest.

## Flujo de importación

1. **Códec verificado**, antes de leer el EPUB.
2. **Análisis y normalización**, sin red: bloques validados, una imagen normalizada por ruta de figura (se normaliza
   una sola vez por SHA-256 de origen), avisos.
3. **Plan y política**: dry run de solo lectura. El dry run nunca usa el almacén de objetos.
4. **Comprobación previa de solo lectura** con `--apply`. Si la política rechaza el plan, no se guarda nada.
5. **Almacén de objetos, fuera de cualquier transacción.** Para cada clave: si el objeto existe, se comprueban su
   tamaño y su tipo, se lee y se calcula su SHA-256 aquí. Nunca se usa el ETag como SHA-256. Un objeto con otro
   contenido detiene el import y no se sobrescribe. Si no existe, se sube y se verifica igual. La existencia de una
   fila en `image_assets` no se toma como prueba de que el objeto esté en este almacén.
6. **Transacción corta**, sin llamadas de red para las imágenes:
   - advisory lock y plan recalculado bajo el lock;
   - si ese plan necesita imágenes que no se verificaron en el paso 5, aborta y pide otro intento;
   - recursos por identidad con `ON CONFLICT DO NOTHING`; si ya existía (otro import, o un import concurrente que
     ganó), su fila debe describir exactamente los mismos bytes, o el import aborta;
   - capítulos con `ChapterText`;
   - asociaciones cambiadas o retiradas solo de esta edición;
   - comprobación previa al commit: bloques válidos que derivan su texto, cada figura con su asociación al recurso
     planificado y con el mismo tipo, ninguna asociación sin usar. Cualquier discrepancia hace rollback.
7. **Revalidación de caché** tras el commit, como antes.

Recuperación:

| Fallo                                          | Estado                                          | Reintento                                        |
| ---------------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| Entorno no admitido                            | Nada procesado                                  | Mismo rechazo hasta usar un entorno aprobado     |
| Subida, lectura o verificación fallida         | Ningún objeto válido, ninguna fila              | Sube o verifica de nuevo                         |
| Objeto existente con otro contenido            | Objeto intacto, ninguna fila                    | Requiere revisión humana                         |
| Fallo de PostgreSQL tras subir                 | Objeto huérfano y sin referencias, ninguna fila | Verifica y reutiliza el objeto                   |
| El plan cambia entre la comprobación y el lock | Rollback                                        | El nuevo intento prepara las imágenes que faltan |
| Recurso de la misma identidad con otros bytes  | Rollback                                        | Requiere revisión: el códec no es reproducible   |
| Dos imports concurrentes de la misma imagen    | El índice único serializa los inserts           | Ambos usan el mismo recurso                      |

Garantías que da la aplicación y no el esquema: el contrato completo de bloques, que `content` derive de los bloques,
que cada figura tenga su asociación (no hay FK posible desde `jsonb`), que una asociación apunte al recurso de los
bytes de origen de esa ruta, que el objeto exista en el almacén y que el códec esté admitido. El esquema garantiza la
envoltura de los bloques, la identidad única, la clave derivada del hash, las rutas seguras, la unicidad por edición y
ruta, que un recurso asociado no se borre y que borrar una edición borre sus asociaciones.

No se borra ningún objeto ni ningún recurso automáticamente. Una limpieza de huérfanos sería una tarea aparte,
explícita y revisada, que tendría en cuenta todas las bases que usen el mismo bucket.

## Pruebas de integración con PostgreSQL desechable

`scripts/lib/import-persistence.integration.test.ts` aplica las migraciones 0000–0010 a una base temporal y ejecuta el
importador real contra ella. Solo corre con `LIBRA_DISPOSABLE_POSTGRES=1`, y el destino es la configuración fija de
`disposable-postgres.ts`. No lee `.env.local` ni ninguna variable de conexión. Antes de conectar exige `127.0.0.1`,
un usuario de pruebas y una base `libra_disposable_*`. Después exige el marcador `cluster_name` del contenedor y crea
una base nueva y vacía, que borra al terminar. Crea también los mínimos de Supabase que las migraciones esperan
(`auth.users`, `auth.uid()`, roles `anon` y `authenticated`).

```sh
docker run -d --rm --name libra-2d-disposable-pg -p 127.0.0.1:54361:5432 \
  -e POSTGRES_USER=libra_test -e POSTGRES_PASSWORD=libra-disposable-test-only \
  -e POSTGRES_DB=libra_disposable_admin postgres:17 -c cluster_name=libra_disposable_test
LIBRA_DISPOSABLE_POSTGRES=1 pnpm exec tsx --test scripts/lib/import-persistence.integration.test.ts
docker stop libra-2d-disposable-pg
```

## Habilitación pendiente

Antes de cualquier import real de imágenes hace falta, en una tarea revisada y autorizada aparte:

- un `ObjectStore` respaldado por un bucket, aislado y deshabilitado por defecto;
- una comprobación explícita del bucket esperado y de su entorno, parecida a `--confirm-database`. Ni el nombre del
  bucket, ni una variable de entorno, ni una configuración ausente prueban que el destino sea de desarrollo;
- no asumir que desarrollo y producción comparten bucket.

Riesgo preexistente, fuera de esta fase: la portada se sube a R2 dentro de la transacción de escritura del import
(`import-gutenberg.ts`). La transacción y el advisory lock quedan abiertos durante esa llamada de red. Debe corregirse
en una tarea independiente.
