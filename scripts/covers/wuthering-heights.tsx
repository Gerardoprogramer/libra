// Typographic cover of Wuthering Heights (Emily Brontë, 1847), designed for Libra. Everything on it is drawn here: the
// lettering uses the bundled Libre Caslon Text (SIL Open Font License, src/assets/fonts/OFL.txt) and the ornaments
// are plain SVG paths. No photograph, illustration or source-edition artwork is used. See scripts/covers/README.md.
//
// Render (writes scripts/covers/wuthering-heights.jpg; nothing is uploaded):
//   pnpm exec tsx scripts/covers/wuthering-heights.tsx
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import React from "react";
import { ImageResponse } from "next/og";
import sharp from "sharp";

export const coverSize = { width: 1600, height: 2400 } as const;
export const coverFile = join("scripts", "covers", "wuthering-heights.jpg");

const paper = "#f1e8d6";
const ink = "#1f2a24";
const soft = "#6f6a5c";
const heather = "#7a4a57";

function Rule({ width }: { width: number }) {
  return (
    <svg width={width} height="40" viewBox={`0 0 ${width} 40`}>
      <path d={`M0 20H${width / 2 - 34}M${width / 2 + 34} 20H${width}`} stroke={ink} strokeWidth="2.5" />
      <path
        d={`M${width / 2} 6L${width / 2 + 14} 20L${width / 2} 34L${width / 2 - 14} 20Z`}
        fill="none"
        stroke={heather}
        strokeWidth="2.5"
      />
      <circle cx={width / 2 - 26} cy="20" r="3.5" fill={heather} />
      <circle cx={width / 2 + 26} cy="20" r="3.5" fill={heather} />
    </svg>
  );
}

/** Three low ridgelines: an abstract moor horizon, drawn for this cover. */
function Moor() {
  return (
    <svg width="1240" height="190" viewBox="0 0 1240 190">
      <path
        d="M0 150C120 128 210 96 330 104S520 150 640 126 860 58 990 72 1170 120 1240 112"
        fill="none"
        stroke={soft}
        strokeWidth="2"
        opacity="0.55"
      />
      <path
        d="M0 172C160 150 260 132 400 140S620 172 760 152 1000 104 1120 116 1210 140 1240 136"
        fill="none"
        stroke={soft}
        strokeWidth="2"
        opacity="0.75"
      />
      <path
        d="M0 188C200 176 330 166 470 170S700 186 860 178 1100 156 1240 160"
        fill="none"
        stroke={ink}
        strokeWidth="2.5"
      />
    </svg>
  );
}

// Satori (next/og) does not read the `inset` shorthand: every frame is placed with explicit edges.
function box(margin: number) {
  return {
    position: "absolute",
    left: margin,
    top: margin,
    width: coverSize.width - 2 * margin,
    height: coverSize.height - 2 * margin,
    display: "flex",
  } as const;
}

export function WutheringHeightsCover() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: paper,
        color: ink,
        fontFamily: "Libra Serif",
      }}
    >
      <div style={{ ...box(72), border: `5px solid ${ink}` }} />
      <div style={{ ...box(96), border: `1.5px solid ${ink}` }} />
      <div
        style={{
          ...box(96),
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "150px 84px 120px",
        }}
      >
        <div style={{ fontSize: 66, letterSpacing: 16, display: "flex" }}>EMILY BRONTË</div>
        <div style={{ display: "flex", marginTop: 64 }}>
          <Rule width={520} />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginTop: 300,
            fontSize: 248,
            lineHeight: 1.02,
            letterSpacing: -4,
          }}
        >
          <div style={{ display: "flex" }}>Wuthering</div>
          <div style={{ display: "flex" }}>Heights</div>
        </div>
        <div style={{ display: "flex", marginTop: 86 }}>
          <Rule width={300} />
        </div>
        <div style={{ display: "flex", marginTop: 54, fontSize: 64, letterSpacing: 10, color: soft }}>1847</div>
        <div style={{ display: "flex", flexGrow: 1 }} />
        <Moor />
      </div>
    </div>
  );
}

async function render() {
  const font = await readFile(join("src", "assets", "fonts", "LibreCaslonText-Regular.ttf"));
  const png = await new ImageResponse(<WutheringHeightsCover />, {
    ...coverSize,
    fonts: [{ name: "Libra Serif", data: font, weight: 400, style: "normal" }],
  }).arrayBuffer();

  const jpeg = await sharp(Buffer.from(png))
    .flatten({ background: paper })
    .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toBuffer();

  await writeFile(coverFile, jpeg);
  console.log(`Wrote ${coverFile} (${coverSize.width}x${coverSize.height}, ${jpeg.length} bytes).`);
}

if (require.main === module) {
  render().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
