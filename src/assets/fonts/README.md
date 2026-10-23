Libre Caslon Text Regular, version 1.100, from Google Fonts:
https://github.com/google/fonts/tree/9bbee7116780787a74b49dcfc956c61f96ddb0e5/ofl/librecaslontext

Distributed under the SIL Open Font License in OFL.txt. This static TTF is bundled
for Next.js ImageResponse; generating social cards does not require a font CDN.

The WOFF2 files are the Latin subsets published by Fontsource (built from Google Fonts),
taken from these npm tarballs after checking their registry integrity:

- libre-caslon-text-latin-400-normal.woff2 and libre-caslon-text-latin-700-normal.woff2:
  @fontsource/libre-caslon-text 5.3.0,
  https://registry.npmjs.org/@fontsource/libre-caslon-text/-/libre-caslon-text-5.3.0.tgz
  (sha512-zuGBMEtekNBbeH4YIbL2sUu8BZKFGr1o6b41v/QPnWaEAOgZHSf4ZFdr90YmRbE3uB5G1oAEIIACgwnFRk/F7w==).
  Same authors and license as the TTF: OFL.txt.
- literata-latin-wght-normal.woff2 (variable, wght 200–900):
  @fontsource-variable/literata 5.3.0,
  https://registry.npmjs.org/@fontsource-variable/literata/-/literata-5.3.0.tgz
  (sha512-1Jw7xvOcoGyB83lxB2nG4bfNbqtX2/TTbdh9sHAOmU064SvmSdulDtA5RBu5JYWf64fdaKX7xU+z3GO1T2bCHA==).
  SIL Open Font License in Literata-OFL.txt.
- merriweather-latin-400-normal.woff2 (static, 400 normal):
  @fontsource/merriweather 5.3.0,
  https://registry.npmjs.org/@fontsource/merriweather/-/merriweather-5.3.0.tgz
  (sha512-9LpPsNTYzRALj468Uj1K9Usl5eXk991L/kKmcpdWbTF1na9NfMyAXMgUABlMReViU1MYBz9kJ8jEzEOtX9qGDg==).
  SIL Open Font License in Merriweather-OFL.txt (the package's LICENSE).
- lexend-latin-400-normal.woff2 (static, 400 normal):
  @fontsource/lexend 5.3.0,
  https://registry.npmjs.org/@fontsource/lexend/-/lexend-5.3.0.tgz
  (sha512-4igbsooynC6xwfagkAW6eo9JMrw8ALFGkWn1YChYmYchufMJSPgWihD+cy5ruX5YX/gDk/gllcl1Oj7q6KUZmw==).
  SIL Open Font License in Lexend-OFL.txt (the package's LICENSE).

Each file is its package's Latin subset. The cmap of all three was checked to map every Spanish and English letter,
accent and punctuation mark (á é í ó ú ñ ü and their capitals, ¿ ¡ « » — – “ ” ‘ ’ … €). Lexend's package CSS
declares the subset's unicode-range (U+0000-00FF and U+2000-206F among others); Merriweather's declares none, so its
coverage rests on that cmap check alone. next/font/local sets no unicode-range either: each file serves every
character it maps.

To update one: download the new tarball from the registry URL, check that its SHA-512 matches the registry's
"integrity" field (`openssl dgst -sha512 -binary <file> | openssl base64 -A`), copy the WOFF2 from files/ and the
LICENSE, and update the version and integrity above.

They are loaded with next/font/local from src/lib/fonts.
