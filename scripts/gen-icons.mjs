#!/usr/bin/env node
// Rasterises the AMOS mark (src/renderer/src/assets/logo-mark.png) into the
// PNGs electron-builder needs under build/, plus the renderer favicon.
// electron-builder derives the Windows .ico and the macOS .icns from a single
// square PNG of at least 512x512, and uses build/icons/*.png for Linux.
//
// The mark ships as white-on-transparent artwork — the same file the UI masks
// with `currentColor` — so this script only has to composite it, at the right
// scale, over a rounded tile. Decoding and encoding are hand-rolled on
// node:zlib rather than pulling a rasteriser in: a tree that already juggles
// two better-sqlite3 ABIs does not need sharp for one build step.
//
// Run `node scripts/gen-icons.mjs` after replacing the artwork.

import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = path.join(root, "src/renderer/src/assets/logo-mark.png");

// The tile: near-black `--background` of the dark theme, white glyph, corner
// radius and inset as fractions of the icon so every size matches.
const TILE = [0x0a, 0x0a, 0x0a];
const GLYPH = [0xfa, 0xfa, 0xfa];
const CORNER_FRACTION = 14 / 64;
const GLYPH_FRACTION = 0.62; // share of the icon's width the mark occupies

// ------------------------------------------------------------ PNG decoding
/** Decodes an 8-bit, non-interlaced RGBA PNG into {width, height, pixels}. */
function decodePng(buffer) {
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString("ascii", pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [depth, colour, , , interlace] = [data[8], data[9], data[10], data[11], data[12]];
      if (depth !== 8 || colour !== 6 || interlace !== 0) {
        throw new Error("logo-mark.png must be an 8-bit non-interlaced RGBA PNG");
      }
    } else if (type === "IDAT") {
      idat.push(data);
    }
    pos += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(height * stride);
  let read = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[read++];
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    raw.copy(row, 0, read, read + stride);
    read += stride;
    const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? row[i - 4] : 0;
      const b = prior ? prior[i] : 0;
      const c = prior && i >= 4 ? prior[i - 4] : 0;
      let value = row[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = value & 0xff;
    }
  }
  return { width, height, pixels };
}

// --------------------------------------------------------------- rendering
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function sdRoundedRect(px, py, size, r) {
  const qx = Math.abs(px - size / 2) - (size / 2 - r);
  const qy = Math.abs(py - size / 2) - (size / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** A one-pixel linear ramp across the edge is all the antialiasing this needs. */
const coverage = (d) => clamp01(0.5 - d);

/**
 * Average alpha of the source rectangle a destination pixel maps onto — a box
 * filter, which is what a 388px mark scaled to 16px needs to stay readable.
 */
function sampleAlpha(mark, x0, y0, x1, y1) {
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const right = Math.min(mark.width, Math.ceil(x1));
  const bottom = Math.min(mark.height, Math.ceil(y1));
  if (right <= left || bottom <= top) return 0;
  let sum = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      sum += mark.pixels[(y * mark.width + x) * 4 + 3];
    }
  }
  return sum / ((right - left) * (bottom - top) * 255);
}

/** Renders the icon at `size`x`size` into an 8-bit RGBA buffer. */
function render(mark, size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * CORNER_FRACTION;
  const glyphSize = size * GLYPH_FRACTION;
  const offset = (size - glyphSize) / 2;
  const scale = mark.width / glyphSize; // source pixels per destination pixel

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tile = coverage(sdRoundedRect(x + 0.5, y + 0.5, size, radius));
      const glyph =
        tile <= 0
          ? 0
          : sampleAlpha(
              mark,
              (x - offset) * scale,
              (y - offset) * scale,
              (x + 1 - offset) * scale,
              (y + 1 - offset) * scale,
            );

      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        rgba[o + c] = Math.round(TILE[c] * (1 - glyph) + GLYPH[c] * glyph);
      }
      rgba[o + 3] = Math.round(tile * 255);
    }
  }
  return rgba;
}

// --------------------------------------------------------------- PNG writer
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(rgba, size) {
  // One filter byte (0 = None) per scanline, then the raw RGBA row.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// -------------------------------------------------------------------- main
const mark = decodePng(readFileSync(SOURCE));
const buildDir = path.join(root, "build");
const linuxDir = path.join(buildDir, "icons");
mkdirSync(linuxDir, { recursive: true });

// 1024 is what electron-builder wants for a crisp .icns; the rest populate the
// Linux icon set (electron-builder picks them up by <size>x<size>.png name).
const written = [];
for (const size of [1024, 512, 256, 128, 64, 32, 16]) {
  const png = encodePng(render(mark, size), size);
  if (size === 1024) {
    writeFileSync(path.join(buildDir, "icon.png"), png);
    written.push("build/icon.png");
  }
  if (size <= 512) {
    writeFileSync(path.join(linuxDir, `${size}x${size}.png`), png);
    written.push(`build/icons/${size}x${size}.png`);
  }
  if (size === 64) {
    // The browser-tab icon of the renderer: the tiled version, because a
    // white-on-transparent mark would vanish on a light tab.
    writeFileSync(path.join(root, "src/renderer/src/assets/favicon.png"), png);
    written.push("src/renderer/src/assets/favicon.png");
  }
}
console.log(`wrote ${written.length} icons:\n  ${written.join("\n  ")}`);
