import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAuthFailures,
  detectClis,
  detectionChanged,
  findExecutable,
  markAuthFailure,
} from "../../src/main/chat/detect.js";
import {
  isBackendReady,
  readyBackends,
  type CliDetection,
} from "../../src/shared/chat.js";

/**
 * Detection runs against a fake home and a fake PATH: no real CLI is needed,
 * and none of these tests spawn anything (`--version` is stubbed out).
 */

let dir: string;

/** Create an executable stub file and return its path. */
function bin(dirPath: string, name: string): string {
  fs.mkdirSync(dirPath, { recursive: true });
  const file = path.join(dirPath, name);
  fs.writeFileSync(file, "#!/bin/sh\necho stub\n");
  fs.chmodSync(file, 0o755);
  return file;
}

const probe = async (binary: string) => ({ version: `stub 1.0 (${path.basename(binary)})`, note: null });

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amos-detect-")));
  clearAuthFailures();
});

afterEach(() => {
  clearAuthFailures();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("findExecutable", () => {
  it("finds a binary on PATH before anywhere else", () => {
    const onPath = bin(path.join(dir, "path-dir"), "claude");
    bin(path.join(dir, "home", ".local", "bin"), "claude");
    const found = findExecutable("claude", {
      env: { PATH: path.join(dir, "path-dir") },
      homeDir: path.join(dir, "home"),
    });
    expect(found).toEqual({ path: onPath, source: "path" });
  });

  it("falls back to the known install directories", () => {
    const local = bin(path.join(dir, "home", ".local", "bin"), "codex");
    const found = findExecutable("codex", {
      env: { PATH: path.join(dir, "empty") },
      homeDir: path.join(dir, "home"),
    });
    expect(found).toEqual({ path: local, source: "known-location" });
  });

  it("ignores a file that is not executable", () => {
    const dirPath = path.join(dir, "path-dir");
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, "claude"), "not executable");
    fs.chmodSync(path.join(dirPath, "claude"), 0o644);
    // `extraDirs: []` so a `claude` really installed on this machine — in
    // /usr/local/bin, say — cannot make the assertion pass or fail by luck.
    expect(
      findExecutable("claude", {
        env: { PATH: dirPath },
        homeDir: path.join(dir, "home"),
        extraDirs: [],
      }),
    ).toBeNull();
  });

  it("returns null when nothing is there", () => {
    expect(findExecutable("nowhere-cli", { env: { PATH: "" }, homeDir: dir })).toBeNull();
  });
});

describe("detectClis", () => {
  it("reports a CLI it found, with its version", async () => {
    const claude = bin(path.join(dir, "path-dir"), "claude");
    const detection = await detectClis({
      env: { PATH: path.join(dir, "path-dir") },
      homeDir: path.join(dir, "home"),
      probe,
    });

    expect(detection.clis.claude).toMatchObject({
      vendor: "claude",
      installed: true,
      path: claude,
      source: "path",
      version: "stub 1.0 (claude)",
      // Claude has no credential file to inspect: assume yes until a turn says no.
      auth: "ready",
    });
    expect(detection.clis.codex.installed).toBe(false);
    expect(detection.clis.codex.auth).toBe("unknown");
    expect(detection.echoEnabled).toBe(false);
  });

  it("calls codex unauthenticated until ~/.codex/auth.json exists", async () => {
    bin(path.join(dir, "path-dir"), "codex");
    const home = path.join(dir, "home");
    const env = { PATH: path.join(dir, "path-dir") };

    const before = await detectClis({ env, homeDir: home, probe });
    expect(before.clis.codex).toMatchObject({ installed: true, auth: "unauthenticated" });

    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(home, ".codex", "auth.json"), "{}");
    const after = await detectClis({ env, homeDir: home, probe });
    expect(after.clis.codex.auth).toBe("ready");
  });

  it("flips claude to unauthenticated once a turn has failed", async () => {
    bin(path.join(dir, "path-dir"), "claude");
    const options = {
      env: { PATH: path.join(dir, "path-dir") },
      homeDir: path.join(dir, "home"),
      probe,
    };
    expect((await detectClis(options)).clis.claude.auth).toBe("ready");
    markAuthFailure("claude");
    expect((await detectClis(options)).clis.claude.auth).toBe("unauthenticated");
    clearAuthFailures();
    expect((await detectClis(options)).clis.claude.auth).toBe("ready");
  });

  it("uses a manual override and reports one that is not executable", async () => {
    const custom = bin(path.join(dir, "custom"), "my-claude");
    const good = await detectClis({
      env: { PATH: "" },
      homeDir: path.join(dir, "home"),
      overrides: { claude: custom },
      probe,
    });
    expect(good.clis.claude).toMatchObject({ path: custom, source: "override" });

    const bad = await detectClis({
      env: { PATH: "" },
      homeDir: path.join(dir, "home"),
      overrides: { claude: path.join(dir, "ghost") },
      probe,
    });
    expect(bad.clis.claude.installed).toBe(false);
    expect(bad.clis.claude.note).toMatch(/not an executable file/);
  });

  it("passes the echo flag through", async () => {
    const detection = await detectClis({
      env: { PATH: "" },
      homeDir: path.join(dir, "home"),
      echoEnabled: true,
      probe,
    });
    expect(detection.echoEnabled).toBe(true);
  });
});

describe("which backends the chat may offer", () => {
  const base: CliDetection = {
    checkedAt: "2026-01-01T00:00:00.000Z",
    echoEnabled: false,
    clis: {
      claude: {
        vendor: "claude",
        installed: true,
        path: "/bin/claude",
        source: "path",
        version: "1.0",
        auth: "ready",
        note: null,
      },
      codex: {
        vendor: "codex",
        installed: true,
        path: "/bin/codex",
        source: "path",
        version: "1.0",
        auth: "unauthenticated",
        note: null,
      },
    },
  };

  it("offers an installed, logged-in CLI and nothing else", () => {
    expect(readyBackends(base)).toEqual(["claude"]);
    expect(isBackendReady(base, "codex")).toBe(false);
    expect(isBackendReady(base, "echo")).toBe(false);
  });

  it("offers the echo driver only when it is switched on", () => {
    expect(readyBackends({ ...base, echoEnabled: true })).toEqual(["claude", "echo"]);
  });

  it("offers nothing before detection has run — which is the setup screen", () => {
    expect(readyBackends(undefined)).toEqual([]);
    expect(isBackendReady(undefined, "claude")).toBe(false);
  });
});

describe("detectionChanged", () => {
  const base: CliDetection = {
    checkedAt: "2026-01-01T00:00:00.000Z",
    echoEnabled: false,
    clis: {
      claude: {
        vendor: "claude",
        installed: true,
        path: "/bin/claude",
        source: "path",
        version: "1.0",
        auth: "ready",
        note: null,
      },
      codex: {
        vendor: "codex",
        installed: false,
        path: null,
        source: null,
        version: null,
        auth: "unknown",
        note: null,
      },
    },
  };

  it("ignores the timestamp but notices anything the UI shows", () => {
    expect(detectionChanged(null, base)).toBe(true);
    expect(detectionChanged(base, { ...base, checkedAt: "2026-02-02T00:00:00.000Z" })).toBe(false);
    expect(detectionChanged(base, { ...base, echoEnabled: true })).toBe(true);
    expect(
      detectionChanged(base, {
        ...base,
        clis: { ...base.clis, claude: { ...base.clis.claude, auth: "unauthenticated" } },
      }),
    ).toBe(true);
  });
});
