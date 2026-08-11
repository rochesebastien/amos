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

const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";
const npx = isWindows ? "npx.cmd" : "npx";

// On Windows the launchers are batch files, and since Node 18.20.2 / 20.12.2 /
// 22 `spawn` refuses to execute a `.cmd`/`.bat` without a shell (it fails with
// EINVAL — the CVE-2024-27980 hardening). Go through cmd.exe there. Every
// argument below is a hard-coded literal, so there is nothing to quote.
function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit", shell: isWindows });
}

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
  run(npm, ["rebuild", "better-sqlite3"]);
  // Proof, since this script runs under plain Node. Opening a database is what
  // actually dlopens the addon — `require` alone loads it lazily and would
  // succeed against the wrong ABI.
  const Database = createRequire(import.meta.url)("better-sqlite3");
  new Database(":memory:").close();
  console.log("native deps: better-sqlite3 ready for Node");
} else {
  // `install-app-deps` rebuilds every native module for the Electron ABI, in
  // dependency order: better-sqlite3 (required) before node-pty (optional).
  // node-pty builds from source, so on a machine that cannot fetch Electron
  // headers it fails — but better-sqlite3 has already finished by then, and the
  // terminals panel degrades to a piped fallback without a PTY. So a node-pty
  // failure is a warning, not a fatal build error.
  try {
    run(npx, ["electron-builder", "install-app-deps"]);
    console.log("native deps: better-sqlite3 + node-pty ready for Electron");
  } catch {
    console.warn(
      "native deps: a native module failed to rebuild for Electron (usually " +
        "node-pty, which needs Electron headers). better-sqlite3 rebuilds first " +
        "and is ready; terminals will use the piped fallback until node-pty can " +
        "be rebuilt with network access.",
    );
  }
}
