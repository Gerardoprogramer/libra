# Respaldo offline mínimo (D1b)

Cuando una navegación a una página de Libra falla por falta de conexión, el service worker responde con una página
estática que avisa de que no hay conexión, en el idioma de la URL. No permite leer libros sin conexión ni guarda
contenido de la aplicación.

## Archivos

| Archivo                                               | Función                                                                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `public/sw.js`                                        | Service worker en JavaScript plano, sin dependencias. Scope `/`.                                                      |
| `public/offline-es.html`, `public/offline-en.html`    | Páginas de respaldo autocontenidas: CSS y un script inline (tema), sin recursos de red, `noindex`.                    |
| `src/components/layout/ServiceWorkerRegistration.tsx` | Registra `/sw.js` tras la hidratación, solo en builds de producción (previews de Vercel incluidas).                   |
| `src/app/[locale]/layout.tsx`                         | Monta el registro en todas las páginas.                                                                               |
| `next.config.ts`                                      | `Cache-Control: no-cache, no-store, must-revalidate` en `/sw.js`; `X-Robots-Tag: noindex` en las páginas de respaldo. |

`src/proxy.ts` excluye las rutas con punto, así que `/sw.js` y las páginas de respaldo se sirven desde `public/` sin
redirección de idioma ni sesión de Supabase.

Las páginas de respaldo leen el tema guardado del lector (`libra:reader-preferences` en `localStorage`, el mismo origen)
con un script inline en `<head>`, antes de la primera pintura. Si es `dark`, usan los colores nocturnos del lector y su
`theme-color` (`#0a0a0a`). Cualquier otro tema, una preferencia ilegible, el almacenamiento bloqueado o JavaScript
desactivado dejan el papel claro del sitio.

## Reglas de caché

- La única caché es `libra-offline-<versión>` y solo contiene `/offline-es.html` y `/offline-en.html`, descargadas con
  `cache.addAll()` durante `install`. Si una falla, la instalación falla y el worker anterior sigue activo.
- No hay `cache.put()`: ninguna respuesta de la aplicación se guarda.
- Al activarse, el worker borra solo las cachés `libra-offline-*` de versiones anteriores.
- Si borrar una de ellas falla, el error no se oculta: la promesa de `activate` se rechaza y el navegador lo muestra en
  la consola del worker. En Chromium se comprobó que el worker nuevo queda activo de todos modos y controla las páginas;
  otros navegadores no se han verificado. La caché antigua que no se pudo borrar permanece hasta una activación
  posterior en la que la limpieza funcione.
- `skipWaiting()` y `clients.claim()` son inmediatos: el worker no cambia ninguna respuesta online, así que una versión
  nueva puede tomar el control de las páginas abiertas sin riesgo.
- Cambia `CACHE_VERSION` en `public/sw.js` con cada cambio del worker o de las páginas de respaldo.

## Qué intercepta

Solo navegaciones de documento `GET` del mismo origen a `/`, `/es`, `/es/*`, `/en` o `/en/*`. Todo lo demás (API,
`/auth` y el callback OAuth, `/_next`, peticiones RSC de la navegación del cliente, progreso de lectura, portadas,
formularios `POST`, Supabase y otros orígenes) no pasa por `respondWith`.

En una navegación interceptada, la respuesta de la red llega intacta, incluidos 404 y 500. Solo si `fetch` rechaza (sin
conexión, fallo de DNS) se responde con la página de respaldo: `/en*` en inglés; `/`, `/es*` en español, el idioma por
defecto. La URL no cambia. Si la página no está en la caché, se devuelve el error de red original sin volver a pedirla.

Sin `experimental.useOffline`, Next.js convierte una navegación del cliente cuyo fetch RSC falla en una navegación del
navegador (`fetch-server-response.js`), que es la que recibe el respaldo.

No hay respaldo en la primera visita, antes de que el worker se instale, ni en una recarga forzada (Ctrl+Shift+R), que
por especificación no pasa por ningún service worker: el navegador muestra su propio error.

## Desactivación de emergencia

No hace falta borrar nada a mano en los navegadores. Pasos:

1. Sustituye el contenido de `public/sw.js` por el siguiente worker, sin cambiar la ruta del archivo:

   ```js
   // Libra's offline fallback, turned off: removes Libra's offline caches and unregisters itself. No fetch handler,
   // so no request is intercepted.
   self.addEventListener("install", () => self.skipWaiting());

   self.addEventListener("activate", (event) => {
     event.waitUntil(
       (async () => {
         const names = await caches.keys();
         await Promise.all(
           names.filter((name) => name.startsWith("libra-offline-")).map((name) => caches.delete(name)),
         );
         await self.registration.unregister();
       })(),
     );
   });
   ```

2. Mantén `ServiceWorkerRegistration` y el header de `/sw.js`, y despliega. Con un worker instalado, cada navegación a
   Libra con conexión hace que el navegador compruebe `/sw.js` sin caché HTTP (`updateViaCache: "none"` y el header).
   Al ver la versión nueva la instala, borra las cachés `libra-offline-*` (y ninguna otra) y se desregistra. Un
   visitante nuevo registra el worker de desactivación, que se desregistra al activarse. Así el despliegue solo cambia
   un archivo.
3. Cuando haya pasado tiempo suficiente para que los usuarios habituales hayan vuelto a abrir Libra, retira el
   registro del layout, el header y `public/sw.js` en otro despliegue.

Limitaciones:

- El navegador solo comprueba si hay una versión nueva cuando el usuario abre una página de Libra con conexión. Quien no
  vuelva conserva el worker anterior, que con conexión deja pasar todas las respuestas sin cambios.
- Las páginas ya abiertas siguen controladas por el worker hasta que se recargan; el de desactivación no intercepta nada.
- Si se elimina `public/sw.js` sin publicar antes el de desactivación, las comprobaciones fallan y el worker anterior
  sigue instalado.

`src/lib/offline-service-worker.test.ts` ejecuta el bloque de código de este documento para comprobar que solo borra
las cachés `libra-offline-*`, se desregistra y no intercepta peticiones.
