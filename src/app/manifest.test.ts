import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import manifest from "./manifest";

const publicDir = new URL("../../public/", import.meta.url);

// Width and height from a PNG's IHDR chunk.
function pngSize(path: URL) {
  const png = readFileSync(path);
  assert.equal(png.toString("latin1", 1, 4), "PNG", `${path.pathname} is not a PNG`);
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}

test("the installed app opens the whole site, standalone, at its root", () => {
  const { id, start_url, scope, display, name, short_name } = manifest();

  assert.equal(id, "/");
  assert.equal(start_url, "/");
  assert.equal(scope, "/");
  assert.equal(display, "standalone");
  assert.equal(name, "Libra");
  assert.equal(short_name, "Libra");
});

test("the splash screen and title bar take the site's paper color", () => {
  const { background_color, theme_color } = manifest();

  assert.equal(background_color, "#fcfaf6");
  assert.equal(theme_color, "#fcfaf6");
});

test("every declared icon exists in public/ with its declared size and type", () => {
  const icons = manifest().icons ?? [];

  assert.ok(icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "any"));
  assert.ok(icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "any"));

  for (const icon of icons) {
    assert.equal(icon.type, "image/png", icon.src);
    assert.ok(icon.src.startsWith("/"), icon.src);
    assert.equal(pngSize(new URL(icon.src.slice(1), publicDir)), icon.sizes, icon.src);
  }
});
