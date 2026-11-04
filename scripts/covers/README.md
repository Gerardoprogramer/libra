# Portadas propias de Libra

Portadas tipográficas creadas para Libra cuando la del EPUB de origen no sirve (marcas de la fuente, créditos que no
corresponden a la edición publicada, baja calidad). Cada portada tiene aquí su diseño (`.tsx`) y la imagen generada
(`.jpg`), que es exactamente el fichero que se sube a R2.

## Wuthering Heights (Emily Brontë, 1847)

- Diseño: `wuthering-heights.tsx`. Composición original creada para Libra: fondo crema, doble filete, autora en
  versalitas espaciadas, título en dos líneas, filetes con rombo y el año. En la base, tres líneas de horizonte que
  evocan el páramo, dibujadas como trazados SVG en el propio diseño.
- Tipografía: Libre Caslon Text Regular (`src/assets/fonts/LibreCaslonText-Regular.ttf`), SIL Open Font License
  (`src/assets/fonts/OFL.txt`). La OFL permite usar la fuente para crear imágenes.
- Sin fotografías, ilustraciones ni elementos de terceros. No reproduce la portada del EPUB de Project Gutenberg ni
  incluye sus marcas ni el crédito «Edited by Charlotte Bronte».
- Imagen: `wuthering-heights.jpg`, JPEG sRGB de 1600×2400 (2:3).

Regenerar la imagen (solo escribe el `.jpg` local; no sube nada):

```sh
pnpm exec tsx scripts/covers/wuthering-heights.tsx
```

El render usa `next/og` (Satori y resvg, la misma pila que las tarjetas sociales) y `sharp`. Si cambian sus versiones,
el JPEG puede diferir en bytes: la clave de R2 depende del contenido, así que una imagen regenerada es una portada
nueva con URL nueva.

## Sustituir la portada de una edición

`pnpm db:replace-cover` (`scripts/replace-cover.ts`) comprueba antes de conectar que `--gutenberg-id` es un número de
Project Gutenberg, que `--book` es un slug de libro (no una ruta) y que ninguna opción se repite ni llega vacía. Valida
la imagen (JPEG, PNG o WebP; 2:3 según su orientación; al menos 600 px de ancho; como mucho 8 MiB) y, sin `--apply`,
solo lee la edición en una transacción de solo lectura: muestra la portada actual (`none` si no tiene), la nueva, la
clave y las opciones exactas que necesita la escritura. Se detiene si la edición pertenece a otro libro.

### Base pública (`--expect-base`)

La URL nueva se forma con `R2_PUBLIC_URL`. Si la edición tiene portada, su base debe ser `R2_PUBLIC_URL`: así se
comprueba que el entorno local coincide con el desplegado. Si la edición no tiene portada no hay nada fiable con qué
compararla, así que hay que confirmarla con `--expect-base <base>`, que debe ser exactamente `R2_PUBLIC_URL` (HTTPS, sin
credenciales, consulta ni fragmento). Si se pasa con una edición que sí tiene portada, también debe coincidir. Antes de
confirmarla, comprobar en Vercel qué `R2_PUBLIC_URL` usa producción (ver `docs/r2-custom-domain.md`).

### Ancla de revisión (`--expect-current`)

`--apply` exige `--expect-current <url|none>`: la portada actual que mostró la ejecución en seco (`none` si no tenía).
Se compara byte a byte antes de subir nada y otra vez con la fila bloqueada, antes del `UPDATE`. Si la portada cambió,
el comando se detiene sin subir, sin escribir y sin invalidar la caché. Si la edición ya muestra exactamente esta
imagen (su URL sale de estos bytes, este libro y este id), no se sube ni se escribe nada y solo se invalida la caché.

Con `--apply`, `--expect-current` y `--confirm-database` sube la imagen con la clave
`covers/libra/<libro>-<id Gutenberg>-<hash>.<ext>` (para Wuthering Heights,
`covers/libra/wuthering-heights-768-c6ef0ae66adb.jpg`), bloquea la edición (`FOR UPDATE`), comprueba el ancla,
actualiza solo `cover_url` (y `updated_at`) donde siga siendo la esperada e invalida `library` y `book:<libro>`. El
objeto anterior sigue en R2.

```sh
# 1. Ejecución en seco: no sube ni escribe; imprime la portada actual y las opciones para el paso 2.
pnpm db:replace-cover --gutenberg-id 768 --book wuthering-heights --file scripts/covers/wuthering-heights.jpg
# 2. Escritura, con los valores exactos que imprimió el paso 1.
pnpm db:replace-cover --gutenberg-id 768 --book wuthering-heights --file scripts/covers/wuthering-heights.jpg \
  --apply --expect-current <portada actual o none> --confirm-database <id>
```

### Recuperación

- La subida falla: no se escribe nada.
- Una comprobación rechaza la escritura dentro de la transacción: se deshace; el objeto subido queda en R2 sin
  referencias.
- La escritura falla de otro modo (por ejemplo, se pierde la conexión durante el `COMMIT`): el objeto puede estar
  referenciado o no. Repetir el mismo comando, con el mismo `--expect-current`, confirma el estado: informa de que la
  edición ya muestra la imagen (e invalida la caché) o reintenta la escritura, subiendo los mismos bytes a la misma
  clave.

Las pruebas de integración de este flujo (`scripts/lib/cover-replacement.integration.test.ts`) ejecutan el SQL real
contra la base desechable de `docs/epub-images.md`:

```sh
LIBRA_DISPOSABLE_POSTGRES=1 pnpm exec tsx --test scripts/lib/cover-replacement.integration.test.ts
```

## Reimportaciones

El prefijo `covers/libra/` es lo que protege estas portadas. `buildImportDiff` (`scripts/lib/import-plan.ts`) no
planifica un cambio `cover` si la URL guardada está bajo `covers/libra/` (`isCustomCoverUrl`,
`scripts/lib/custom-cover.ts`): el plan dice `Cover: custom cover kept (…)` y, si no cambia nada más, el libro queda
`unchanged`. Vale para `pnpm import:gutenberg` y `pnpm import:collection`.

Para volver a la portada del EPUB, solo por libro:

```sh
pnpm import:gutenberg -- --file imports/<libro>.epub --gutenberg-id <id> --slug <libro> --original-title "<título>" --original-language <código> --replace-custom-cover
```

La misma opción debe ir en la ejecución en seco y en el `--apply`: la decisión forma parte del digest del plan, así
que en una edición publicada un `--plan-hash` revisado con la portada conservada no autoriza sustituirla.
`import:collection` no acepta esta opción y siempre conserva las portadas propias. Las ediciones nuevas, las que no
tienen portada y las que tienen una portada de Gutenberg (`covers/<libro>-<id>-<hash>`) siguen recibiendo la del EPUB.
