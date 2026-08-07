import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLAUDE_BINARY_REQUIRED, createClaudeDriver } from "../../src/main/chat/claudeDriver.js";
import { createDriverFactory, createDriverKey } from "../../src/main/chat/manager.js";
import type { ChatEvent, CliDetection } from "../../src/shared/chat.js";

/**
 * AMOS does not ship a `claude` binary — it drives the one the user installed.
 * Two things have to hold for that to stay true, and both are cheap to assert:
 * the packaging config drops the SDK's vendored platform binary, and no code
 * path can reach the SDK without an explicit executable path (which is the only
 * thing standing between "no binary" and the SDK looking for the vendored one).
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The `files:` list out of electron-builder.yml. Read by hand rather than with
 * a YAML parser: the only YAML dependency in the tree is transitive, and this
 * block is a flat list of scalars — the shape is asserted below, so a config
 * that stopped looking like this would fail the test rather than parse to
 * something empty and pass vacuously.
 */
function packagedFilePatterns(): string[] {
  const raw = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => line === "files:");
  expect(start, "electron-builder.yml has no top-level `files:` block").toBeGreaterThanOrEqual(0);

  const patterns: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // next top-level key ends the block
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const item = /^-\s+(.*)$/.exec(trimmed);
    expect(item, `unexpected line inside files:: ${line}`).not.toBeNull();
    patterns.push(item![1]!.replace(/^"(.*)"$/, "$1"));
  }
  expect(patterns.length).toBeGreaterThan(4);
  return patterns;
}

/** The scope directory the SDK and its platform packages live in. */
const SCOPE = path.join(root, "node_modules", "@anthropic-ai");
const PLATFORM_PREFIX = "claude-agent-sdk-";

describe("packaging: the vendored claude binary", () => {
  it("excludes every @anthropic-ai/claude-agent-sdk-<platform> package", () => {
    const files = packagedFilePatterns();
    expect(files).toContain("!**/node_modules/@anthropic-ai/claude-agent-sdk-*${/*}");
  });

  it("keeps the SDK proper, which the chat driver imports", () => {
    const files = packagedFilePatterns();
    // The glob is anchored on the trailing hyphen; nothing may exclude the
    // hyphen-less package, or `import { query } from "…/claude-agent-sdk"` dies
    // in the packaged app only.
    const kills = files.filter(
      (pattern) =>
        pattern.startsWith("!") &&
        pattern.includes("@anthropic-ai/claude-agent-sdk") &&
        !pattern.includes("claude-agent-sdk-") &&
        !pattern.includes("claude-agent-sdk/"),
    );
    expect(kills).toEqual([]);
  });

  it("names platform packages that actually exist on this machine", () => {
    // Guards against upstream renaming the optional packages: if they are here
    // (npm only installs the host's), the pattern's prefix must still match.
    if (!fs.existsSync(SCOPE)) return;
    const platform = fs
      .readdirSync(SCOPE)
      .filter((name) => name.startsWith(PLATFORM_PREFIX));
    for (const name of platform) {
      expect(`@anthropic-ai/${name}`.startsWith("@anthropic-ai/claude-agent-sdk-")).toBe(true);
    }
  });

  it("only ever negates paths anchored inside node_modules", () => {
    // The P5 lesson recorded in electron-builder.yml: a bare `!**/build` also
    // matches `node_modules/better-sqlite3/build/`, and the app then ships
    // without its database engine. Every negation stays anchored.
    for (const pattern of packagedFilePatterns()) {
      if (!pattern.startsWith("!")) continue;
      const anchored =
        pattern.startsWith("!**/node_modules/") || /^!\*\*\/\*\.\{[^}]+\}$/.test(pattern);
      expect(anchored, `unanchored negation: ${pattern}`).toBe(true);
    }
  });
});

describe("packaging: platform targets and mac entitlements", () => {
  const builderYml = () => fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
  const macPlist = () =>
    fs.readFileSync(path.join(root, "build", "entitlements.mac.plist"), "utf8");

  it("builds Windows for x64 only, with the arch in the artifact name", () => {
    // arm64 would need the MSVC ARM64 cross-toolchain on the CI runner, which
    // is not guaranteed; and an artifact name without ${arch} makes any second
    // arch overwrite the first installer.
    const win = /win:[\s\S]*?(?=\n\S)/.exec(builderYml())?.[0] ?? "";
    expect(win).toContain("arch: [x64]");
    expect(win).not.toContain("arm64");
    expect(win).toContain("${arch}");
  });

  it("applies the project entitlements to the app binary AND its helpers", () => {
    // `entitlementsInherit` alone only covers helper processes; without
    // `entitlements` the signed main executable gets electron-builder's
    // default template instead of this project's plist.
    const mac = /mac:[\s\S]*?(?=\n\S)/.exec(builderYml())?.[0] ?? "";
    expect(mac).toContain("entitlements: build/entitlements.mac.plist");
    expect(mac).toContain("entitlementsInherit: build/entitlements.mac.plist");
  });

  it("keeps the plist free of sandbox-only keys", () => {
    // com.apple.security.inherit is only valid for children of an
    // app-sandboxed process; AMOS never enables the app sandbox. The plist
    // may *mention* the key in a comment explaining its absence — what must
    // not exist is the actual <key> element.
    expect(macPlist()).not.toContain("<key>com.apple.security.inherit</key>");
    expect(macPlist()).toContain("<key>com.apple.security.cs.disable-library-validation</key>");
  });
});

describe("chat: no claude binary, no SDK call", () => {
  async function sendWith(binaryPath: string | null): Promise<ChatEvent[]> {
    const driver = createClaudeDriver({ binaryPath });
    const events: ChatEvent[] = [];
    const result = await driver.send({
      cwd: root,
      prompt: "hello",
      resumeToken: null,
      onEvent: (event) => events.push(event),
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ resumeToken: null, aborted: false });
    return events;
  }

  it("refuses the turn when the path is null", async () => {
    // If this ever calls `query()` instead, the SDK looks for the vendored
    // binary the packaging config removed — so the test would hang or spawn.
    expect(await sendWith(null)).toEqual([
      { type: "error", error: CLAUDE_BINARY_REQUIRED, code: "cli_missing" },
    ]);
  });

  it("refuses the turn when the path is blank", async () => {
    expect(await sendWith("   ")).toEqual([
      { type: "error", error: CLAUDE_BINARY_REQUIRED, code: "cli_missing" },
    ]);
  });

  it("tells the user to install the CLI, not to reinstall the SDK", () => {
    expect(CLAUDE_BINARY_REQUIRED).toMatch(/Claude Code CLI/);
    expect(CLAUDE_BINARY_REQUIRED).not.toMatch(/omit=optional|claude-agent-sdk/);
  });
});

describe("chat: the driver factory refuses an undetected CLI", () => {
  function detection(overrides: Partial<CliDetection["clis"]["claude"]>): CliDetection {
    const base = {
      installed: false,
      path: null,
      source: null,
      version: null,
      auth: "unknown",
      note: null,
    } as const;
    return {
      checkedAt: new Date().toISOString(),
      echoEnabled: false,
      clis: {
        claude: { vendor: "claude", ...base, ...overrides },
        codex: { vendor: "codex", ...base },
      },
    };
  }

  it("throws rather than building a driver with no path", async () => {
    const factory = createDriverFactory({ detection: async () => detection({}) });
    await expect(factory("claude")).rejects.toThrow(/claude CLI was not found/);
  });

  it("throws when detection claims installed but has no path", async () => {
    // A shape the type system allows and a stale detection could produce.
    const factory = createDriverFactory({
      detection: async () => detection({ installed: true, path: null }),
    });
    await expect(factory("claude")).rejects.toThrow(/claude CLI was not found/);
  });

  it("refuses echo unless it is switched on", async () => {
    const factory = createDriverFactory({ detection: async () => detection({}) });
    await expect(factory("echo")).rejects.toThrow(/switched off/);
  });

  it("keys a driver on exactly what the factory bakes into it", async () => {
    // The manager compares this key per turn: a Settings path change flows
    // into the detection, changes the key, and the stale driver is rebuilt.
    const withPath = createDriverKey({
      detection: async () => detection({ installed: true, path: "/usr/local/bin/claude" }),
    });
    const without = createDriverKey({ detection: async () => detection({}) });
    expect(await withPath("claude")).toBe("claude:/usr/local/bin/claude");
    expect(await without("claude")).toBe("claude:missing");
    expect(await without("echo")).toBe("echo:off");
  });
});
