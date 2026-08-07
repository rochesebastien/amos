// Swap the native modules (today: better-sqlite3) between the Node ABI and the
// Electron ABI.
//
// AMOS needs both: `vitest` exercises the database layer in plain Node, while
// `electron-vite dev|build` loads the very same module inside Electron, whose
// NODE_MODULE_VERSION differs. Only one compiled `.node` can sit in
// node_modules at a time, so every entry point declares which flavour it wants
// (`npm test` → node, `npm run dev|build` → electron).
//
// Both directions are cheap: the prebuilt binaries are cached by
// prebuild-install / @electron/rebuild after the first fetch.
//
// Usage: node scripts/native-deps.mjs <node|electron>
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const target = process.argv[2];

if (target !== "node" && target !== "electron") {
  console.error("usage: node scripts/native-deps.mjs <node|electron>");
  process.exit(2);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

// @electron/rebuild stamps the ABI it last built into this marker and skips the
// module when it still matches — even though `npm rebuild` may have replaced
// the binary underneath with a Node-ABI one. Drop the marker so the Electron
// rebuild always actually runs.
const forgeMeta = path.join(
  root,
  "node_modules/better-sqlite3/build/Release/.forge-meta",
);
fs.rmSync(forgeMeta, { force: true });

if (target === "node") {
  execFileSync(npm, ["rebuild", "better-sqlite3"], { cwd: root, stdio: "inherit" });
  // Proof, since this script runs under plain Node. Opening a database is what
  // actually dlopens the addon — `require` alone loads it lazily and would
  // succeed against the wrong ABI.
  const Database = createRequire(import.meta.url)("better-sqlite3");
  new Database(":memory:").close();
  console.log("native deps: better-sqlite3 ready for Node");
} else {
  execFileSync(npx, ["electron-builder", "install-app-deps"], { cwd: root, stdio: "inherit" });
  console.log("native deps: better-sqlite3 ready for Electron");
}
