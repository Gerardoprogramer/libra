# SEO y previews de Libra

## Qué existía y qué se conservó

- `src/lib/seo-metadata-core.ts` centraliza canonical, hreflang y metadata por ruta.
- `getBookBySlug` elige la edición pública del idioma solicitado, con el fallback editorial existente.
  Su caché usa `cacheLife("editorial")` y las etiquetas `library:editorial` y `book:<slug>`.
- La portada procede de `editions.coverUrl`; `next.config.ts` limita `next/image` al dominio y ruta de `R2_PUBLIC_URL`.
- `sitemap.ts`, `public-index.ts` y `getSitemapContent` ya incluyen los índices públicos, autores, libros y capítulos
  de las ediciones publicadas, con los idiomas reales y sin biblioteca personal ni endpoints. Se conservan.
- `robots.ts` permite rastrear el contenido público y bloquea `/api/`. La biblioteca personal y las búsquedas
  mantienen `noindex`: se permite rastrearlas para que los buscadores puedan leer esa instrucción.
- El JSON-LD existente usa `WebPage`, `Book` y `BreadcrumbList`; `JsonLd.tsx` ya escapa `<` correctamente.
- Las portadas de las tarjetas de catálogo tienen `alt=""` porque el mismo enlace incluye título y autor visibles.
  Se conserva ese tratamiento decorativo. La portada principal de la ficha tiene ahora un alt traducido.

No se modificaron la base de datos, autenticación, selección de ediciones, lector, rutas públicas ni dependencias.

## Archivos y responsabilidades

| Archivo                                                                | Implementación                                                                                                                                                                          |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/[locale]/layout.tsx`                                          | Metadata global traducida, `metadataBase`, autoría del sitio, robots y color del navegador. Canonical y hreflang permanecen en cada página.                                             |
| `src/lib/seo-metadata-core.ts`                                         | Imagen general por idioma, dimensiones/tipo de imagen, `og:type=book`, autores OG y canonical explícito para fichas con edición de fallback.                                            |
| `src/lib/social-metadata.ts`                                           | URLs absolutas, alt y dimensiones de las imágenes compartidas entre OG y Twitter.                                                                                                       |
| `src/app/[locale]/books/[slug]/(book)/page.tsx`                        | Metadata del libro con autores reales, canonical por idioma, imagen OG específica, alt de portada, breadcrumbs visibles y JSON-LD coherente incluso al mostrar una edición de fallback. |
| `src/app/[locale]/books/[slug]/opengraph-image.tsx`                    | Consulta la misma edición pública que la ficha y devuelve una imagen o 404 si el libro no está disponible.                                                                              |
| `src/app/[locale]/opengraph-image.tsx`                                 | Tarjeta general traducida de Libra para inicio, catálogo y demás páginas públicas. Lee los mensajes existentes sin usar APIs de página dentro del Route Handler.                        |
| `src/components/seo/SocialCard.tsx`                                    | Composición 1200×630 con portada, título, autores y marca; contempla títulos largos y ausencia de portada.                                                                              |
| `src/lib/social-image.tsx`                                             | Render con `ImageResponse`, fuente local, descarga limitada de portadas R2, caché editorial, timeout y alternativa ante imágenes dañadas.                                               |
| `next.config.ts`                                                       | Metadata en el `<head>` inicial para rastreadores y vistas previas; streaming para navegadores y concurrencia de prerender limitada para PostgreSQL.                                    |
| `src/proxy.ts`                                                         | Excluye las rutas de PNG OG de la negociación de idioma/cookies; las rutas de página conservan su comportamiento.                                                                       |
| `src/app/icon.svg`, `src/app/favicon.ico`, `src/app/apple-icon.png`    | Símbolo de libro abierto de Libra, favicon de 16/32/48 px y Apple touch icon de 180 px mediante convenciones App Router.                                                                |
| `public/icons/libra-192.png`, `public/icons/libra-512.png`             | Iconos instalables; el de 512 px tiene margen para uso maskable.                                                                                                                        |
| `src/app/manifest.ts`                                                  | Manifest básico, colores y acceso desde `/`, donde i18n resuelve el idioma. Sin service worker ni modo offline.                                                                         |
| `scripts/generate-icons.mjs`                                           | Regenera los PNG y el ICO desde el SVG, reutilizando Sharp incluido con Next.js.                                                                                                        |
| `src/assets/fonts/LibreCaslonText-Regular.ttf`, `OFL.txt`, `README.md` | Fuente serif estática, licencia y procedencia; no se descarga una fuente al compartir enlaces.                                                                                          |
| `messages/en.json`, `messages/es.json`                                 | Alt y textos de navegación de las fichas.                                                                                                                                               |
| `src/lib/seo-metadata.test.ts`, `src/lib/social-image.test.tsx`        | Pruebas de URLs, idiomas, metadata y render real con portadas válidas, ausentes o dañadas.                                                                                              |
| `scripts/smoke-seo.ts`, `package.json`                                 | Comando `pnpm smoke:seo`: valida HTML servido, PNG, bots, sitemap, robots, iconos, manifest, noindex de páginas inexistentes y 404 de sus imágenes.                                     |
| `README.md`, `docs/seo.md`                                             | Instrucciones de uso y validación.                                                                                                                                                      |

## Cómo funciona una preview

Para `https://www.alyvenor.com/en/books/dracula`:

1. `generateMetadata` obtiene la edición pública seleccionada y sus autores. Usa la descripción editorial cuando
   existe; en caso contrario, un texto traducido con título y autor, sin inventar una sinopsis.
2. Canonical y `og:url` apuntan a esa ficha. `og:type` es `book`; los autores OG enlazan a sus fichas públicas.
3. OG y Twitter usan la misma URL absoluta:
   `https://www.alyvenor.com/en/books/dracula/opengraph-image`.
4. El Route Handler usa `ImageResponse` para generar un PNG 1200×630 con la portada real de R2.
5. Si falta la portada o falla su descarga/render, se muestra una cubierta tipográfica con los datos del libro.
   Las fuentes se incluyen en el despliegue. Una caída de PostgreSQL sigue siendo un error de servidor y no se
   disfraza de libro inexistente.

Esto se aplica a cualquier slug publicado, incluidos los incorporados después del build.

Cuando el libro no existe o no tiene una edición pública, la página llama a `notFound()` y `generateMetadata` no genera
metadata de un libro inexistente: solo devuelve el título del 404 con `noindex`, sin canonical ni hreflang, como las
páginas de autor y de capítulo. Con Cache Components, Next.js puede haber enviado el shell estático con estado 200; ese
`noindex` excluye igualmente la URL de búsqueda. La prueba verifica esa instrucción y la ausencia de canonical y JSON-LD
de libro. La ruta de imagen sí devuelve un 404 HTTP. Es el comportamiento documentado de
[notFound con streaming](https://nextjs.org/docs/app/api-reference/functions/not-found), conservando la arquitectura actual.

Dos casos sí devuelven un 404 HTTP real porque se deciden antes de que empiece el streaming: una URL que no coincide con
ninguna ruta y un capítulo que no existe en ninguna edición pública del libro (`chapterExistsInPublicEdition`,
comprobado en la página antes del límite de Suspense; `generateStaticParams` prerrenderiza un capítulo por libro e
idioma y el resto se genera en la primera visita). Un capítulo que existe pero no en la edición pedida con `?edition=`
sigue siendo un soft 404 con `noindex`.

Las URL sin ruta (`/es/…`, `/en/…`, y también `/api/…` si no existe un manejador) las atiende
`src/app/global-not-found.tsx`, activado con `experimental.globalNotFound` en `next.config.ts`. El layout raíz vive bajo
el segmento dinámico `[locale]`, por lo que Next.js no tiene un layout en el que renderizar esas URL y respondería con su
carcasa de error sin idioma (`<html id="__next_error__">`); una ruta comodín `[locale]/[...rest]` no lo evita. La página
global es un documento completo con `<html lang>`, título, cabecera mínima, `<h1>` y mensaje en el HTML inicial, y
Next.js le añade `noindex`. El idioma sale de la cabecera `x-next-intl-locale` que next-intl fija desde `src/proxy.ts`
(`src/lib/not-found-locale.ts`); sin ella, por ejemplo en `/api/…`, usa el idioma por defecto. Leer la cabecera hace que
la ruta se renderice por petición (`export const instant = false`): estas respuestas no se cachean en el CDN. Es una
opción experimental de Next.js y su layout es reducido (sin la navegación completa). Los 404 de libros y capítulos
siguen usando `src/app/[locale]/not-found.tsx` dentro del layout del idioma. `pnpm smoke:seo` comprueba ambos idiomas,
el `<h1>` en la respuesta inicial y que un 404 no tenga directivas `robots` contradictorias.

Las fichas `/es/...` y `/en/...` tienen canonical propio. Se conservó la política editorial: si solo existe una edición
inglesa, la ficha española puede mostrarla y compartirse, pero mantiene `noindex` y no se anuncia como traducción
en hreflang o sitemap. Si existen ediciones públicas en ambos idiomas, se emiten alternates recíprocos.
No se añade `x-default` a los libros ni una traducción inexistente.

## Categorías del catálogo

Una categoría es el catálogo filtrado: `/{locale}/books?category={slug}`. El slug es el mismo en ambos idiomas
(`categories.slug`); solo el nombre se traduce (`category_translations`).

- Una categoría con libros públicos tiene canonical propio con `?category=`, hreflang hacia los idiomas en los que
  tiene nombre traducido (solo si el idioma de la página es uno de ellos) y título y descripción propios. Aparece en el
  sitemap en esos mismos idiomas.
- Cualquier URL con `q`, con o sin categoría, es `noindex, follow`, sin canonical ni hreflang, y no está en el sitemap.

### Categorías inexistentes: limitación conocida

Una categoría que no existe (`/es/books?category=x`, `/en/books?category=Adventure`) llama a `notFound()` en la
página, antes de su límite de `Suspense`. Eso no basta para un 404 HTTP universal:

- **Navegadores normales: HTTP 200.** Con Cache Components, Next.js envía primero el shell prerenderizado de
  `/[locale]/books` (layout y cabecera) y después la parte que depende de `searchParams`, que solo existe en la
  petición. Cuando la página llega a `notFound()`, el estado 200 ya se envió y no puede cambiarse; la página termina
  renderizando el estado not-found dentro de ese 200 (véase "The HTTP contract" en
  `node_modules/next/dist/docs/01-app/02-guides/streaming.md`).
- **Googlebot: HTTP 404 real.** Pertenece a `htmlLimitedBots` (`next.config.ts`), por lo que no recibe el shell
  prerenderizado sino un render bloqueante, y `notFound()` llega antes de las cabeceras.

En ambos casos la respuesta lleva el título de página no encontrada (`src/app/[locale]/not-found.tsx`), `noindex,
follow` (además del `noindex` que añade Next.js) y ningún canonical ni hreflang. Ese archivo declara su propia
metadata porque, al renderizar la convención not-found, Next.js compone el `<head>` con los layouts y ese archivo, sin
la `generateMetadata` de la página; sin ella quedarían el título del layout y su `index, follow`.

Es una limitación conocida de la arquitectura actual, no un 404 HTTP universal, y no garantiza un impacto SEO nulo:
otros rastreadores que no estén en `htmlLimitedBots`, herramientas de auditoría o clientes que solo miren el código de
estado ven un 200. Un 404 para todos exigiría decidir antes de las cabeceras: un `proxy` que conozca las categorías o
una ruta con la categoría como parámetro (por ejemplo `/[locale]/categories/[slug]`), que cambiaría las URLs.
`pnpm smoke:seo` comprueba los dos comportamientos por separado: 404 con Googlebot y, para el navegador, el 200
señalado como `KNOWN LIMITATION`, con el mismo `<head>` de no encontrado.

## Probar localmente

Configurar `DATABASE_URL`, `R2_PUBLIC_URL` y `SITE_URL`. Para desarrollo, `SITE_URL=http://localhost:3000`
está permitido. Para `pnpm build`/`pnpm start`, se requiere el origen HTTPS canónico.
En PowerShell se puede sobreescribir solo para la sesión, sin editar `.env.local`:

```powershell
$env:SITE_URL = 'https://www.alyvenor.com'
pnpm lint
pnpm exec tsc --noEmit
pnpm exec tsx --test src/lib/seo-metadata.test.ts src/lib/public-index.test.ts src/lib/social-image.test.tsx src/i18n/message-parity.test.ts src/db/queries/editorial-visibility.test.ts
pnpm build
pnpm start
```

Desde otra terminal:

```powershell
pnpm smoke:production http://localhost:3000
pnpm smoke:seo http://localhost:3000
```

`smoke:seo` toma hasta dos libros publicados por idioma del sitemap; requiere al menos uno en cada idioma.
Los canonical conservan el dominio de producción, pero el script pide las imágenes al servidor local.
Valida los bytes PNG, dimensiones, tamaño menor de 5 MB e imágenes diferentes, además del HTML inicial con
User Agents de Google, WhatsApp, Facebook, Discord, Telegram, Twitter y LinkedIn. Estas peticiones simulan sus
agentes; no son una validación efectuada por las plataformas externas. Las comprobaciones del `<head>` usan
un User-Agent de rastreador; las de navegador verifican el documento completo, incluida la metadata en streaming.

Abrir `/en/books/dracula/opengraph-image` y otra ficha publicada para revisar visualmente las tarjetas.
Regenerar los iconos con `node scripts/generate-icons.mjs` si cambia `src/app/icon.svg`.

## Validación realizada

Sobre el build local de producción, usando `SITE_URL=https://www.alyvenor.com` y el puerto 3100:

- `pnpm exec tsc --noEmit` y `pnpm lint`: sin errores.
- El comando de pruebas indicado arriba: 25 pruebas aprobadas.
- `pnpm build`: completado; 61 páginas generadas.
- `pnpm smoke:seo http://localhost:3100`: aprobado, incluyendo dos libros publicados por idioma,
  metadatos en el HTML inicial para siete agentes de crawlers, PNG distintos, sitemap, robots e iconos.
- `pnpm smoke:production http://localhost:3100`: aprobado para las 12 rutas del chequeo existente.
- Inspección adicional de `/en/books/dracula`, `/es/books/dracula` y `/en/books/frankenstein`:
  canonical, OG, Twitter, JSON-LD y datos reales correctos; portadas R2 accesibles sin autenticación con HTTP 200.
  Las tres imágenes devuelven PNG distintos de 1200×630; también se revisaron visualmente Dracula y Frankenstein.

Con el catálogo actual, Dracula solo tiene edición inglesa: su ficha española conserva la interfaz en español,
canonical propio y `noindex`; el `Book` declara correctamente `inLanguage: en`.
Estas comprobaciones no sustituyen las del dominio desplegado ni las cachés de las plataformas sociales.

## Comprobar después del deploy en Vercel

- Configurar `SITE_URL=https://www.alyvenor.com`, conexión PostgreSQL con TLS y `R2_PUBLIC_URL` público HTTPS.
  `SITE_URL` se usa en build y runtime; cambiarlo requiere un nuevo despliegue.
- Confirmar que el dominio canónico resuelva a la aplicación y que las páginas e imágenes de producción sean
  accesibles sin autenticación. Usar el runtime Node.js predeterminado para PostgreSQL y fuentes locales.
- Ejecutar `pnpm smoke:seo https://www.alyvenor.com` y `pnpm smoke:production https://www.alyvenor.com`.
- Revisar `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, favicon, icono SVG y Apple touch icon.
- Inspeccionar las URLs y enviar el sitemap en Google Search Console. Revisar breadcrumbs en
  [Rich Results Test](https://search.google.com/test/rich-results) y el grafo completo en
  [Schema Markup Validator](https://validator.schema.org/).
- Probar una ficha con [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) y
  [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/), y compartir enlaces reales en las apps.
  Las plataformas pueden conservar su propia preview después de actualizar la imagen.

## Decisiones y límites

- No se añade `lastModified`: las fechas existentes de libros/ediciones no representan de forma completa los cambios
  de autores, categorías y capítulos de cada ruta. El sitemap conserva URLs veraces sin fechas artificiales.
- El manifest aporta iconos y acceso desde la pantalla de inicio; no promete lectura offline ni una PWA completa.
- Las portadas deben ser JPEG, PNG o WebP, públicas, dentro de `R2_PUBLIC_URL`, sin redirecciones y de hasta 8 MB;
  hay un timeout de 5 segundos. El resto usa la cubierta alternativa.
- La caché editorial mantiene su revalidación de 60 segundos y expiración de 300 segundos. Los PNG permiten
  caché CDN de 60 segundos y hasta 300 segundos adicionales mientras se revalidan. Las apps sociales tienen
  cachés independientes, por lo que una edición o retirada puede no reflejarse inmediatamente en ellas.
- La metadata bloquea únicamente para los rastreadores de HTML de Next.js 16.4 y para Googlebot/TelegramBot.
  Los navegadores reciben metadata en streaming. No usar `htmlLimitedBots: /.*/`: con metadata dinámica provoca
  un fallo de Instant Validation en Next.js 16.4. Véanse las pruebas en [el diagnóstico](./instant-validation.md).
  Revisar la lista de agentes al actualizar Next.js, porque una expresión personalizada reemplaza la predeterminada.
- El prerender se limita a dos trabajadores y dos páginas simultáneas por trabajador mediante las opciones
  experimentales de Next.js `cpus` y `staticGenerationMaxConcurrency`. El cliente PostgreSQL existente usa una
  conexión por proceso; este límite evita acumular muchas consultas durante el build en máquinas con muchos núcleos.
  No cambia la concurrencia de las peticiones de producción. Se debe revisar al actualizar Next.js.
- No se inventa un editor del libro: `publisher: Libra` identifica el sitio en la metadata global, pero no se añade
  como editorial del `Book` en JSON-LD. Tampoco se convierte el año original en fecha de una traducción.
- No se garantiza indexación ni una presentación idéntica en todas las plataformas: queda por verificar el despliegue
  real y sus cachés. Este trabajo no publica un despliegue en Vercel.

Referencias: [Metadata y OG de Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image),
[iconos App Router](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons),
[protocolo Open Graph](https://ogp.me/). También se consultaron las guías incluidas en Next.js 16.3.7 instalado.
