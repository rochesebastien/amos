import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CLI_VENDORS,
  type CliAuth,
  type CliDetection,
  type CliSource,
  type CliStatus,
  type CliVendor,
} from "../../shared/chat.js";

/**
 * Finding the vendor CLIs. AMOS never ships them and never authenticates on
 * the user's behalf: it drives whatever `claude` / `codex` the user already
 * installed and logged into, so the whole job here is locating the binary and
 * saying, honestly, how sure we are that it will work.
 */

/** Extra places to look when the binary is not on `PATH`. */
const KNOWN_DIRS: string[] = [
  "~/.local/bin",
  "~/.claude/local",
  "~/.codex/bin",
  "~/bin",
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/opt/node22/bin",
];

/** How long `--version` gets before we stop waiting for it. */
const VERSION_TIMEOUT_MS = 2_000;

// ---------------------------------------------------------------- PATH repair

let pathFixed = false;

/**
 * A GUI app on macOS inherits launchd's minimal `PATH`, not the one the user's
 * shell builds — so a CLI installed by Homebrew or nvm is invisible until this
 * runs. Called once, at startup, before the first detection.
 *
 * `fix-path` spawns a login shell; if that fails (locked-down environment, no
 * shell) we keep the `PATH` we have rather than crashing the boot.
 */
export async function ensurePathFixed(): Promise<void> {
  if (pathFixed) return;
  pathFixed = true;
  if (process.platform === "win32") return;
  try {
    const { default: fixPath } = await import("fix-path");
    fixPath();
  } catch {
    // Keep the inherited PATH; detection simply has fewer places to look.
  }
}

// ------------------------------------------------------------------- locating

function expandHome(input: string, homeDir: string): string {
  if (input === "~") return homeDir;
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(homeDir, input.slice(2));
  }
  return input;
}

/** Executable file suffixes to try on Windows, in `PATHEXT` order. */
function windowsExtensions(env: NodeJS.ProcessEnv): string[] {
  const raw = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  return ["", ...raw.split(";").filter(Boolean).map((e) => e.toLowerCase())];
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!fs.statSync(candidate).isFile()) return false;
  } catch {
    return false;
  }
  if (process.platform === "win32") return true;
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * `which` without spawning anything: walk `PATH` (then the known install
 * directories) and return the first executable named `bin`. Spawning a shell
 * to answer this would cost more than the lookup itself, and on Windows
 * `where` is not always present in a packaged app's environment.
 */
export function findExecutable(
  bin: string,
  options: { env?: NodeJS.ProcessEnv; homeDir?: string; extraDirs?: string[] } = {},
): { path: string; source: CliSource } | null {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const suffixes = process.platform === "win32" ? windowsExtensions(env) : [""];

  const pathDirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const knownDirs = (options.extraDirs ?? KNOWN_DIRS).map((dir) => expandHome(dir, homeDir));

  for (const [dirs, source] of [
    [pathDirs, "path"],
    [knownDirs, "known-location"],
  ] as [string[], CliSource][]) {
    for (const dir of dirs) {
      for (const suffix of suffixes) {
        const candidate = path.join(dir, bin + suffix);
        if (isExecutableFile(candidate)) {
          return { path: realOrSelf(candidate), source };
        }
      }
    }
  }
  return null;
}

function realOrSelf(candidate: string): string {
  try {
    return fs.realpathSync(candidate);
  } catch {
    return candidate;
  }
}

// -------------------------------------------------------------------- version

/**
 * Ask the binary what it is. Bounded by a short timeout because a CLI that
 * hangs on `--version` must not hang the settings page: an unanswered probe is
 * reported as a note, not as "not installed".
 */
export async function probeVersion(binary: string): Promise<{ version: string | null; note: string | null }> {
  return await new Promise((resolve) => {
    execFile(
      binary,
      ["--version"],
      { timeout: VERSION_TIMEOUT_MS, windowsHide: true, maxBuffer: 1_000_000 },
      (error, stdout, stderr) => {
        const text = `${stdout ?? ""}${stderr ?? ""}`.trim();
        const first = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? null;
        if (error) {
          resolve({
            version: first,
            note: first ? null : `--version failed: ${error.message}`,
          });
          return;
        }
        resolve({ version: first, note: first ? null : "--version printed nothing" });
      },
    );
  });
}

// ----------------------------------------------------------------------- auth

/**
 * Vendors that failed authentication during a real turn. Claude has no file to
 * inspect — the CLI keeps its credentials in a keychain or an opaque store —
 * so "logged in" is a lazy conclusion: assume yes while it works, flip on the
 * first auth error the SDK reports.
 */
const authFailures = new Set<CliVendor>();

export function markAuthFailure(vendor: CliVendor): void {
  authFailures.add(vendor);
}

export function markAuthSuccess(vendor: CliVendor): void {
  authFailures.delete(vendor);
}

export function clearAuthFailures(): void {
  authFailures.clear();
}

/** Codex writes its tokens to `~/.codex/auth.json`; Claude has no such file. */
function authStateFor(vendor: CliVendor, installed: boolean, homeDir: string): CliAuth {
  if (!installed) return "unknown";
  if (authFailures.has(vendor)) return "unauthenticated";
  if (vendor === "codex") {
    return fs.existsSync(path.join(homeDir, ".codex", "auth.json")) ? "ready" : "unauthenticated";
  }
  return "ready";
}

// ------------------------------------------------------------------ detection

export type DetectOptions = {
  /** Manual binary paths from the settings table. */
  overrides?: Partial<Record<CliVendor, string | null>>;
  echoEnabled?: boolean;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  /** Overridden in tests so a probe never spawns a real process. */
  probe?: (binary: string) => Promise<{ version: string | null; note: string | null }>;
};

async function detectOne(vendor: CliVendor, options: DetectOptions): Promise<CliStatus> {
  const homeDir = options.homeDir ?? os.homedir();
  const probe = options.probe ?? probeVersion;
  const override = options.overrides?.[vendor]?.trim();

  let found: { path: string; source: CliSource } | null = null;
  let note: string | null = null;

  if (override) {
    const expanded = expandHome(override, homeDir);
    if (isExecutableFile(expanded)) {
      found = { path: realOrSelf(expanded), source: "override" };
    } else {
      note = `The path set in Settings is not an executable file: ${expanded}`;
    }
  }
  if (!found && !override) {
    found = findExecutable(vendor, { env: options.env, homeDir });
  }

  if (!found) {
    return {
      vendor,
      installed: false,
      path: null,
      source: null,
      version: null,
      auth: "unknown",
      note,
    };
  }

  const probed = await probe(found.path);
  return {
    vendor,
    installed: true,
    path: found.path,
    source: found.source,
    version: probed.version,
    auth: authStateFor(vendor, true, homeDir),
    note: note ?? probed.note,
  };
}

let cached: CliDetection | null = null;

/** Probe both CLIs. Cheap enough to run on every settings visit. */
export async function detectClis(options: DetectOptions = {}): Promise<CliDetection> {
  await ensurePathFixed();
  const statuses = await Promise.all(CLI_VENDORS.map((vendor) => detectOne(vendor, options)));
  const detection: CliDetection = {
    checkedAt: new Date().toISOString(),
    clis: {
      claude: statuses[0]!,
      codex: statuses[1]!,
    },
    echoEnabled: options.echoEnabled ?? false,
  };
  cached = detection;
  return detection;
}

/** The last detection, for callers that must not re-probe (a chat send). */
export function cachedDetection(): CliDetection | null {
  return cached;
}

/** `true` when two detections differ in anything the UI shows. */
export function detectionChanged(a: CliDetection | null, b: CliDetection): boolean {
  if (!a) return true;
  if (a.echoEnabled !== b.echoEnabled) return true;
  return CLI_VENDORS.some((vendor) => {
    const x = a.clis[vendor];
    const y = b.clis[vendor];
    return (
      x.installed !== y.installed ||
      x.path !== y.path ||
      x.version !== y.version ||
      x.auth !== y.auth ||
      x.note !== y.note
    );
  });
}
