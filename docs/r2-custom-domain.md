# Portadas en un dominio propio (R2 + caché de Cloudflare)

Plan preparado el 2026-10-29. **Nada de este documento está aplicado**: ni DNS, ni dominio en el bucket, ni variables
de Vercel, ni la migración de la base de datos. Cada fase requiere la aprobación del propietario.

## Situación actual (comprobada)

- Las portadas están en el bucket `libra-covers` y se sirven por su URL pública de desarrollo
  `https://pub-c3e001e7741948a9abd61219841b9672.r2.dev`. El bucket no tiene dominio propio.
- `editions.cover_url` guarda la URL absoluta: 36 filas, todas bajo `https://pub-….r2.dev/covers/` (34 publicadas,
  2 en borrador, ninguna sin portada). Las ilustraciones (`image_assets.object_key`) guardan solo la clave, no una URL.
- Las respuestas de r2.dev no llevan `cf-cache-status`: cada petición que llega a r2.dev es una lectura de R2.
- Los navegadores no piden r2.dev directamente: `next/image` pasa por el optimizador de Vercel (`/_next/image`,
  `MISS` y después `HIT`). r2.dev solo recibe los fallos de caché del optimizador y las lecturas de las tarjetas OG
  (`src/lib/social-image.tsx`), pero su URL aparece en el HTML y cualquiera puede pedirla.
- Los objetos se suben con `Cache-Control: public, max-age=31536000, immutable` y su clave lleva el hash del contenido
  (`covers/<slug>-<id>-<hash>.<ext>`): una URL nunca cambia de contenido.
- `alyvenor.com` es una zona de Cloudflare en la misma cuenta que el bucket. `covers.alyvenor.com` no existe
  (NXDOMAIN en 1.1.1.1).
- Dónde se usa la base pública: `next.config.ts` (`images.remotePatterns`), `src/lib/social-image.tsx` (lista de
  orígenes permitidos de la tarjeta OG), `scripts/lib/r2.ts` (URL que guarda un import al subir una portada) y
  `editions.cover_url`.

## Documentación oficial (hechos)

De [Public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/):

- El dominio debe ser una zona de la misma cuenta que el bucket. Se conecta en el bucket: Settings → Custom Domains →
  Add; Cloudflare añade el registro DNS. El estado pasa de _Initializing_ a _Active_ en unos minutos.
- Un dominio propio permite usar la caché de Cloudflare, WAF y Access; r2.dev no: «intended for non-production
  traffic», con límite de velocidad y sin caché.
- r2.dev y el dominio propio son independientes: desactivar uno no afecta al otro. No se debe crear un CNAME hacia
  r2.dev.
- Por defecto solo se cachean ciertos tipos de archivo.

De [Default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/):

- Se cachea por extensión, no por tipo MIME; JPG, JPEG, PNG y WEBP están en la lista por defecto.
- Se cachea una respuesta con `Cache-Control: public` y `max-age` mayor que 0, sin `Set-Cookie` y para `GET`; en los
  planes Free, Pro y Business se respeta el `Cache-Control` del origen.

De [R2 pricing](https://developers.cloudflare.com/r2/pricing/): Clase B $0,36 por millón con 10 millones gratis al mes;
salida de datos gratuita.

## Supuestos (por comprobar en la fase 2)

- Que un acierto de la caché de Cloudflare no cuenta como operación de R2. La documentación de precios no lo dice
  explícitamente; se comprobará con las métricas del bucket antes y después.
- Que el certificado del subdominio se emite automáticamente al conectar el dominio (la página no lo detalla); se
  comprueba en la fase 1 con una petición HTTPS.
- Que no hace falta ninguna regla de caché: las portadas son `.jpg`/`.png` con `max-age` de un año. Si
  `cf-cache-status` no llega a `HIT`, se valorará una Cache Rule acotada a `covers.alyvenor.com/covers/*`, nunca un
  «cache everything» global.

## Subdominio propuesto

`covers.alyvenor.com`: describe el contenido, no existe hoy y no depende de la ruta del bucket (las claves ya empiezan
por `covers/`, así que las URLs quedarán `https://covers.alyvenor.com/covers/<clave>`).

## Secuencia

Cada fase se verifica antes de pasar a la siguiente. Las peticiones de comprobación son pocas y manuales: sin bucles
ni pruebas de carga.

### 1. Dominio y HTTPS (dashboard; requiere aprobación)

1. R2 → `libra-covers` → Settings → Custom Domains → Add → `covers.alyvenor.com` → revisar el registro → Connect.
2. Esperar a _Active_.
3. Comprobar con una sola petición que el objeto es el mismo que en r2.dev:
   `curl -sI https://covers.alyvenor.com/covers/dracula-345-2c05b012cd42.jpg` → `200`, `content-type: image/jpeg`,
   `content-length: 208790`, el mismo `etag` que en r2.dev y certificado válido.

Nada cambia para los lectores: la aplicación sigue usando r2.dev.

### 2. Caché

1. Pedir la misma portada dos o tres veces: la primera puede dar `cf-cache-status: MISS`, las siguientes deben dar
   `HIT` con `cache-control: public, max-age=31536000, immutable`.
2. Comparar el SHA-256 del cuerpo con el de r2.dev.
3. Anotar los contadores de Clase B del bucket y repetir las peticiones con `HIT` para comprobar que no suben.

### 3. Código de transición (preparado en la rama `prep/r2-custom-domain`)

- `R2_PUBLIC_URL_PREVIOUS` (opcional): `next.config.ts` y la tarjeta OG aceptan también la base anterior. Sin esa
  variable el comportamiento es idéntico al actual. Se fusiona y despliega antes de tocar las variables.
- Después, en Vercel (Production): `R2_PUBLIC_URL=https://covers.alyvenor.com` y
  `R2_PUBLIC_URL_PREVIOUS=https://pub-c3e001e7741948a9abd61219841b9672.r2.dev`, y redesplegar (`remotePatterns` se
  fija en el build). En ese momento las portadas siguen saliendo de r2.dev porque la base de datos no ha cambiado.
- Cambiar también `R2_PUBLIC_URL` en el `.env.local` desde el que se importa, para que las portadas nuevas se guarden
  con el dominio propio.

### 4. Migración de `editions.cover_url`

`pnpm db:migrate-cover-origin --from https://pub-c3e001e7741948a9abd61219841b9672.r2.dev --to https://covers.alyvenor.com`

- Sin `--apply` es un dry run: lee en una transacción `READ ONLY` y muestra cuántas filas cambiarían (2026-10-29:
  36 de 36, 0 ya migradas, 0 fuera de ambas bases).
- `--apply --confirm-database <id>` (el id lo imprime el dry run) bloquea las filas, recalcula el plan, actualiza cada
  fila solo si aún tiene la URL prevista y revierte todo si alguna no coincide. Después invalida la caché editorial
  (`library`).
- Es idempotente: una segunda ejecución encuentra 0 filas que cambiar.

### 5. Verificación posterior y reversión

- Comprobar unas pocas fichas en `/es` y `/en`: la imagen pasa por `/_next/image?url=https%3A%2F%2Fcovers.alyvenor.com…`,
  el JSON-LD y `og:image` son correctos y la tarjeta OG lleva portada. Ejecutar `pnpm smoke:seo` una vez.
- Volver a ejecutar el dry run: 0 filas pendientes.
- **Reversión de la base de datos**: el mismo script con `--from` y `--to` intercambiados. **Reversión de la
  configuración**: volver a poner `R2_PUBLIC_URL` en r2.dev y redesplegar. Mientras r2.dev siga activo, ambos sentidos
  sirven los mismos objetos.

### 6. Fase posterior: retirar r2.dev

Solo cuando el dry run dé 0 filas bajo r2.dev, no quede código ni configuración que lo use (`grep -r r2.dev`, variables
de Vercel y `.env.local`) y las métricas no muestren tráfico que dependa de él durante un periodo razonable:

1. Quitar `R2_PUBLIC_URL_PREVIOUS` de Vercel y redesplegar.
2. Desactivar la Public Development URL del bucket (Settings → Public Development URL → Disable).

Desactivar r2.dev rompe cualquier URL antigua que alguien haya guardado o enlazado; por eso va al final y por separado.
