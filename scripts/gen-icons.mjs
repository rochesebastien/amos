#!/usr/bin/env node
// Rasterises the AMOS mark (src/renderer/src/assets/logo.svg) into the PNGs
// electron-builder needs under build/. electron-builder derives the Windows
// .ico and the macOS .icns from a single square PNG of at least 512x512, and
// uses build/icons/*.png for Linux.
//
// Done with signed distance fields + a hand-rolled PNG writer rather than a
// rasteriser dependency: the geometry is three lines and four discs, and
// pulling sharp (a native module) into a tree that already juggles two
// better-sqlite3 ABIs would cost far more than it saves. Regenerate with
// `node scripts/gen-icons.mjs` after editing the geometry below — keep it in
// sync with logo.svg and components/Logo.tsx by hand.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// ---------------------------------------------------------------- geometry
// All coordinates in the logo.svg 64x64 viewBox; scaled to the target size.
const VIEW = 64;
const INK = [0x0a, 0x0a, 0x0a]; // tile
const PAPER = [0xfa, 0xfa, 0xfa]; // glyph

const HUB = { x: 32, y: 32, r: 7 };
const SATELLITES = [
  { x: 32, y: 12 },
  { x: 14.68, y: 42 },
  { x: 49.32, y: 42 },
];
const SATELLITE_R = 4.6;
const WIRE_HALF_W = 1.6; // stroke-width 3.2
const CORNER_R = 14;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

/** Distance to a round-capped segment — a stroked line with linecap="round". */
function sdSegment(px, py, ax, ay, bx, by, halfW) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = clamp01(len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) - halfW;
}

function sdRoundedRect(px, py, w, h, r) {
  const qx = Math.abs(px - w / 2) - (w / 2 - r);
  const qy = Math.abs(py - h / 2) - (h / 2 - r);
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  );
}

/**
 * Coverage of a shape at a pixel, from its signed distance in *pixel* units.
 * A one-pixel linear ramp across the edge is all the antialiasing this needs.
 */
const coverage = (d) => clamp01(0.5 - d);

/** Straight `src` over `dst`, both premultiplied-free RGBA in 0..255 / 0..1. */
function over(dst, rgb, alpha) {
  if (alpha <= 0) return;
  const a = alpha;
  dst[0] = rgb[0] * a + dst[0] * (1 - a);
  dst[1] = rgb[1] * a + dst[1] * (1 - a);
  dst[2] = rgb[2] * a + dst[2] * (1 - a);
  dst[3] = a + dst[3] * (1 - a);
}

/** Renders the mark at `size`x`size` into an 8-bit RGBA buffer. */
function render(size) {
  const scale = size / VIEW;
  const rgba = Buffer.alloc(size * size * 4);
  const px = [0, 0, 0, 0];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sample at pixel centres, in viewBox units, with distances converted
      // back to pixels so the antialiasing ramp stays one pixel wide.
      const ux = (x + 0.5) / scale;
      const uy = (y + 0.5) / scale;
      px[0] = px[1] = px[2] = px[3] = 0;

      over(px, INK, coverage(sdRoundedRect(ux, uy, VIEW, VIEW, CORNER_R) * scale));

      let wire = Infinity;
      for (const s of SATELLITES) {
        wire = Math.min(wire, sdSegment(ux, uy, HUB.x, HUB.y, s.x, s.y, WIRE_HALF_W));
      }
      over(px, PAPER, coverage(wire * scale) * 0.35);

      let sat = Infinity;
      for (const s of SATELLITES) {
        sat = Math.min(sat, sdCircle(ux, uy, s.x, s.y, SATELLITE_R));
      }
      over(px, PAPER, coverage(sat * scale) * 0.55);
      over(px, PAPER, coverage(sdCircle(ux, uy, HUB.x, HUB.y, HUB.r) * scale));

      const o = (y * size + x) * 4;
      rgba[o] = Math.round(px[0]);
      rgba[o + 1] = Math.round(px[1]);
      rgba[o + 2] = Math.round(px[2]);
      rgba[o + 3] = Math.round(px[3] * 255);
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
const buildDir = path.join(root, "build");
const linuxDir = path.join(buildDir, "icons");
mkdirSync(linuxDir, { recursive: true });

// 1024 is what electron-builder wants for a crisp .icns; the rest populate the
// Linux icon set (electron-builder picks them up by <size>x<size>.png name).
const written = [];
for (const size of [1024, 512, 256, 128, 64, 32, 16]) {
  const png = encodePng(render(size), size);
  if (size === 1024) {
    writeFileSync(path.join(buildDir, "icon.png"), png);
    written.push("build/icon.png");
  }
  if (size <= 512) {
    writeFileSync(path.join(linuxDir, `${size}x${size}.png`), png);
    written.push(`build/icons/${size}x${size}.png`);
  }
}
console.log(`wrote ${written.length} icons:\n  ${written.join("\n  ")}`);
