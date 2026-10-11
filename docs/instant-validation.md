# Diagnóstico de Instant Validation — 11 de octubre de 2026

La causa reproducida es la combinación de metadata dinámica y `htmlLimitedBots: /.*/`
con la validación de Cache Components en Next.js 16.4.0. La expresión global convierte
también las peticiones de navegadores en respuestas con metadata bloqueante. El
validador no atribuye correctamente ese bloqueo y termina en un `InvariantError`.

## Estado inicial e historial

Se revisaron `git status`, el diff completo, `git diff --stat` y los últimos diez commits.
El HEAD era `ba34357`, en `master`, alineado con `origin/master`.

Cambios que ya estaban sin commit antes del diagnóstico:

- `package.json` y `pnpm-lock.yaml`: Next.js 16.3.7 → 16.4.0 y dependencias relacionadas.
- `LanguageMenu.tsx`: resolución de la ruta traducida antes de `router.replace`.
- `db/queries/books.ts`: `getLocalizedChapterPath`, con `use cache` y perfil editorial.
- `src/app/api/reader/locale-path/route.ts`: endpoint nuevo, todavía sin seguimiento en Git.
- `scripts/lib/epub-sections.ts`: cambios del importador, ajenos al render de las páginas.

`Header`, `LanguageSwitcher`, las páginas, el layout y la configuración i18n no tenían
cambios respecto a HEAD. Las pruebas anteriores descritas por el usuario ya estaban revertidas.

El commit `1b04598` del 11 de octubre, 06:45:27 -06:00, añadió `htmlLimitedBots: /.*/`
en `next.config.ts:32`, además de los límites de concurrencia de prerender. Es anterior
a los cambios sin commit del selector. Git permite identificar ese cambio desencadenante,
pero no fechar el primer error ni ordenar las ediciones sin commit.

## Cadena causal y ubicaciones

1. `next.config.ts`: el antiguo `htmlLimitedBots: /.*/` deshabilitaba el streaming de
   metadata para cualquier User-Agent. La política corregida está en las líneas 31–35.
2. `src/app/[locale]/books/page.tsx:35`: `generateMetadata` espera `searchParams` para
   decidir el `noindex` de las búsquedas. Esto requiere datos de la petición.
3. `src/app/[locale]/books/[slug]/[chapter]/page.tsx:31`: `generateMetadata` espera los
   parámetros del capítulo y después sus datos. El capítulo no tiene `generateStaticParams`;
   esa metadata puede necesitar datos que todavía no están disponibles para la navegación instantánea.
4. `node_modules/next/dist/lib/metadata/metadata.js:94`: el componente interno
   `MetadataBlocker` espera la metadata cuando `serveStreamingMetadata` es falso.
   `MetadataOutlet` también tiene una rama sin su `Suspense` de streaming.
5. `node_modules/next/dist/server/app-render/dynamic-rendering.js:1069`: Next.js emite
   el invariant cuando la validación produce un preámbulo vacío, no registra un motivo
   dinámico que explicar y ya se renderizaron los límites requeridos.

El elemento común es la política global de metadata y los componentes internos que
la aplican. No es necesario que falle un componente compartido de Libra. El `Suspense`
del contenido del catálogo y el `loading.tsx` del lector no eliminan el bloqueo global
de metadata.

`instant = false` en `src/app/[locale]/layout.tsx:14` permite bloquear ese segmento y
relaja la comprobación de la envoltura estática. No desactiva la validación de todas
las páginas descendientes, que se validan implícitamente en esta versión.

## Pruebas controladas

Se usó una copia local del proyecto, con las mismas dependencias y datos, sin detener
el servidor del usuario. Se observaron los logs posteriores a cada respuesta: HTTP 200
por sí solo no demuestra que Instant Validation haya pasado.

| Prueba                                                                          | Resultado                                                                                                            |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Libra, Turbopack, configuración original, UA `Mozilla/5.0`                      | Catálogo y capítulo EN: HTTP 200 con contenido; ambos invariants reproducidos.                                       |
| Misma copia; quitar solamente `htmlLimitedBots: /.*/`                           | Ambas rutas: HTTP 200, sin los invariants. Caché, i18n y selector activos.                                           |
| Reproducción mínima sin next-intl, DB, selector ni rutas localizadas; Turbopack | El UA con metadata bloqueante reproduce exactamente el invariant; el UA de navegador no.                             |
| Misma reproducción mínima; Webpack                                              | Mismo resultado. No es exclusivo de Turbopack.                                                                       |
| Libra, Turbopack, lista final de bots, UA de navegador                          | Catálogo, búsqueda, ficha y capítulo en ES/EN: ocho comprobaciones correctas, sin invariants.                        |
| Endpoint EN→ES y ES→EN                                                          | HTTP 200; devuelve exactamente los slugs correspondientes de Treasure Island.                                        |
| Smoke SEO con `SITE_URL` local, en la copia aislada                             | Correcto: canonical, hreflang, JSON-LD, PNG OG, bots, navegadores, iconos, sitemap, robots, noindex y 404 de imagen. |

También se intentó Webpack con Libra completo: la primera compilación superó el límite
de 55 segundos de la petición. Esa prueba es inconclusa; la comparación entre motores
se sustenta en la reproducción mínima, que sí completó con ambos.

No hizo falta desactivar Cache Components: manteniendo la caché se pudo activar y
desactivar el error al cambiar únicamente la política de metadata o el User-Agent.

## Reproducción mínima para un reporte upstream

En una aplicación aparte con Next.js 16.4.0 y React/React DOM 19.2.8:

```js
// next.config.mjs
export default {
  cacheComponents: true,
  partialPrefetching: false,
  htmlLimitedBots: /LibraDiagnosticBot/,
};
```

```jsx
// app/layout.js
export const instant = false;
export default function Layout({ children }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
```

```jsx
// app/page.js
import { Suspense } from "react";

export async function generateMetadata({ searchParams }) {
  const { q } = await searchParams;
  return { title: q || "Metadata reproduction" };
}

async function Content({ searchParams }) {
  const { q } = await searchParams;
  return <main>Catalog {q}</main>;
}

export default function Page({ searchParams }) {
  return (
    <Suspense fallback={<p>Loading</p>}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
```

Ejecutar `next dev` y pedir `/?q=diagnostic` con `User-Agent: Mozilla/5.0`, después
con `User-Agent: LibraDiagnosticBot` y otra vez con `Mozilla/5.0`. Todas devuelven 200;
solo la petición del bot genera el invariant en el servidor. Repetir con `next dev --webpack`.

## Clasificación de las hipótesis

| Hipótesis                             | Conclusión                                                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Error real del render de las rutas | No observado en las rutas reproducidas: contenido, metadata y respuestas correctos. Los errores antiguos de consultas SQL en el log son un problema distinto.    |
| B. Uso incorrecto de Cache Components | No demostrado: las consultas siguen usando su caché y perfil válidos; quitar solo el bloqueo global corrige las peticiones de navegador.                         |
| C. Error de Instant Validation        | Confirmado y reproducido sin código de Libra. La rama bloqueante de metadata lleva al fallo interno del validador.                                               |
| D. Bug exclusivo de Turbopack         | Descartado por la reproducción mínima con Webpack.                                                                                                               |
| E. Incompatibilidad next-intl/Next.js | No es necesaria para reproducir el fallo. `request.ts` obtiene el idioma de `next/root-params`, sin leer `requestLocale`/`headers`.                              |
| F. Cambio de nuestro código           | Sí: la política global de metadata introducida en `1b04598` activa el fallo para todos los visitantes. El cambio del selector no es necesario para reproducirlo. |

`getLocale`, `getMessages` y `getTranslations` usan la configuración i18n existente;
las lecturas de `headers` de next-intl no se activan simplemente por importar esas APIs.
`usePathname` y `useRouter` ya estaban en el componente cliente. La consulta nueva del
endpoint recibe locales explícitos y no añade `headers`/`cookies` a las páginas.
`setRequestLocale` es una API legacy compatible; migrarla no es necesario para esta corrección.

## Cambio aplicado y límites

- `next.config.ts`: sustituir el catch-all por la lista de bots HTML de Next.js 16.4,
  añadiendo Googlebot y TelegramBot. Conserva la metadata inicial para esos agentes;
  los navegadores reciben metadata en streaming. La lista personalizada reemplaza
  la predeterminada y debe revisarse al actualizar Next.js.
- `scripts/smoke-seo.ts`: comprobar `<head>` con un UA real de crawler y el documento
  completo con UA de navegador. La comprobación de noindex de una respuesta en streaming
  también debe inspeccionar el documento completo. Se añadió TelegramBot sin alias.
- `docs/seo.md`: actualizar la política documentada. Las páginas, el selector, el
  endpoint y las consultas no se modificaron durante el diagnóstico.

No se desactivaron Cache Components, Instant Validation ni Turbopack. El cambio evita
el disparador para navegadores; **no corrige el defecto interno de Next.js**. Una petición
de bot en desarrollo todavía puede registrar el invariant y a la vez devolver HTML SEO
correcto. Esto se observó durante el smoke y requiere una corrección upstream para
eliminarlo también en esa rama. No se parcheó `node_modules` ni se publicó un issue.

TypeScript (`tsc --noEmit --incremental false`) y ESLint de los archivos de código
modificados pasaron. El MCP del servidor original pasó de reportar el invariant del
catálogo a `configErrors: []` y `sessionErrors: []` tras aplicar la configuración.

El entorno original no tenía `SITE_URL`: su smoke se detuvo porque el sitemap estaba
vacío. Se repitió correctamente con `SITE_URL=http://127.0.0.1:3100` solo en el proceso
de diagnóstico, sin editar `.env.local`. No se ejecutó un build de producción ni una
prueba automatizada de clics del selector; sí se verificaron el endpoint en ambos sentidos
y el contenido/metadata/JSON-LD de los capítulos resultantes.

## Documentación e issues consultados

- [htmlLimitedBots](https://nextjs.org/docs/app/api-reference/config/next-config-js/htmlLimitedBots):
  el catch-all desactiva streaming y una lista personalizada sustituye la predeterminada.
- [instant](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/instant):
  alcance por segmento y validación implícita de páginas.
- [Configuración next-intl](https://next-intl.dev/docs/routing/setup): soporte de
  `next/root-params` y estado legacy de `setRequestLocale`.
- [Release v16.4.0](https://github.com/vercel/next.js/releases/tag/v16.4.0) y
  [PR #96367](https://github.com/vercel/next.js/pull/96367): historial relacionado
  con metadata bloqueante y Cache Components.
- [Issue #98037](https://github.com/vercel/next.js/issues/98037): también relaciona
  `htmlLimitedBots: /.*/` con PPR, pero describe navegación incorrecta en producción
  en 16.3.3. **No es este mismo fallo de validación** ni prueba que esté corregido.

No se encontró un issue o changelog que confirmara una corrección publicada para este
invariant exacto. La conclusión se basa en las pruebas locales y el código instalado,
no solamente en el texto que dice «This is a bug in Next.js».
