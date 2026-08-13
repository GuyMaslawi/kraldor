#!/usr/bin/env node
/**
 * Builds the two raster app icons out of the one source of truth,
 * `src/app/icon.svg` (itself the crest of src/components/ui/Logo.tsx):
 *
 *   src/app/favicon.ico   16 + 32 + 48, for browsers that ignore SVG favicons
 *   src/app/apple-icon.png 180x180, for an iOS home-screen bookmark
 *
 * Run it after any edit to icon.svg:  node scripts/make-favicon.mjs
 *
 * `sharp` is not a dependency of the app — it arrives under next's tree — so
 * this stays a hand-run script and never joins the build.
 *
 * The .ico is written by hand because there is no encoder for it in the tree.
 * Its entries are classic BMPs rather than embedded PNGs: PNG-in-ICO is the
 * modern spelling, but a 16x16 BMP entry is the one every renderer reads.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "src/app/icon.svg");
const ICO_SIZES = [16, 32, 48];

/** One BITMAPINFOHEADER + bottom-up BGRA + an all-opaque AND mask. */
function bmpEntry(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight — XOR and AND stacked
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // BI_RGB

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    // BMP rows run bottom-up
    const src = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x++) {
      const s = src + x * 4;
      const d = (y * size + x) * 4;
      xor[d] = rgba[s + 2]; // B
      xor[d + 1] = rgba[s + 1]; // G
      xor[d + 2] = rgba[s]; // R
      xor[d + 3] = rgba[s + 3]; // A
    }
  }

  // The 1bpp AND mask is legacy; with a real alpha channel above it, leaving it
  // zeroed (= "opaque") is what every modern renderer expects. Rows pad to 4B.
  const maskStride = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskStride * size);

  return Buffer.concat([header, xor, mask]);
}

function ico(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); // reserved
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = head.length + dir.length;

  entries.forEach(({ size, data }, i) => {
    const at = i * 16;
    dir.writeUInt8(size === 256 ? 0 : size, at);
    dir.writeUInt8(size === 256 ? 0 : size, at + 1);
    dir.writeUInt8(0, at + 2); // palette size
    dir.writeUInt8(0, at + 3); // reserved
    dir.writeUInt16LE(1, at + 4); // planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });

  return Buffer.concat([head, dir, ...entries.map((e) => e.data)]);
}

const svg = await readFile(SRC);

const entries = [];
for (const size of ICO_SIZES) {
  const { data } = await sharp(svg, { density: 384 })
    .resize(size, size)
    .raw()
    .toBuffer({ resolveWithObject: true });
  entries.push({ size, data: bmpEntry(data, size) });
}
await writeFile(path.join(root, "src/app/favicon.ico"), ico(entries));

// iOS paints a transparent home-screen icon onto black and applies its own
// rounding, so this one carries the obsidian ground itself, with the crest
// inset the way the ring insets it on the Discord icon.
const CREST = 148;
const applePad = Math.round((180 - CREST) / 2);
await sharp({
  create: {
    width: 180,
    height: 180,
    channels: 4,
    background: { r: 11, g: 10, b: 14, alpha: 1 }, // #0b0a0e, obsidian
  },
})
  .composite([
    {
      input: await sharp(svg, { density: 768 }).resize(CREST, CREST).png().toBuffer(),
      top: applePad,
      left: applePad,
    },
  ])
  .png()
  .toFile(path.join(root, "src/app/apple-icon.png"));

console.log(`favicon.ico (${ICO_SIZES.join("/")}) + apple-icon.png (180) written`);
