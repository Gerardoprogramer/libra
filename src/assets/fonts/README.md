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

They are loaded with next/font/local from src/lib/fonts.
