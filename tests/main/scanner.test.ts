import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  capabilityId,
  countItems,
  itemsOfKind,
  type CapabilityItem,
  type ProjectScan,
} from "../../src/shared/capabilities.js";
import { scanProject } from "../../src/main/scanner/index.js";

/**
 * The scanner is pure Node — no Electron, no database. Every test runs against
 * a fixture tree in `tests/fixtures/`, and the "global" scope is pointed at
 * `tests/fixtures/home` so nothing here depends on the machine's own
 * `~/.claude` or `~/.codex`.
 */

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
const HOME = path.join(FIXTURES, "home");

function fixture(name: string): string {
  return path.join(FIXTURES, name);
}

/** Scan a fixture, project scope only unless a home is asked for. */
function scan(name: string, options: { global?: boolean } = {}): Promise<ProjectScan> {
  return scanProject(fixture(name), { home: HOME, includeGlobal: options.global === true });
}

/** One readable line per item, for whole-tree assertions. */
function summarize(result: ProjectScan): string[] {
  return result.items.map(
    (i) => `${i.scope}/${i.ecosystem}/${i.kind}/${i.name}${i.parseError ? " [broken]" : ""}`,
  );
}

function byName(items: CapabilityItem[], name: string): CapabilityItem {
  const found = items.find((i) => i.name === name);
  if (!found) throw new Error(`No item named ${name} in [${items.map((i) => i.name).join(", ")}]`);
  return found;
}

// --------------------------------------------------------------- claude-only

describe("scanProject · claude-only fixture", () => {
  it("finds every Claude capability and nothing else", async () => {
    const result = await scan("claude-only");
    expect(summarize(result)).toEqual([
      "project/claude/agent/code-reviewer",
      "project/claude/agent/writer",
      "project/claude/mcp/docs",
      "project/claude/mcp/events",
      "project/claude/mcp/filesystem",
      "project/claude/mcp/socket",
      "project/claude/skill/pdf-export",
    ]);
    expect(result.errors).toEqual([]);
    expect(result.projectPath).toBe(fixture("claude-only"));
  });

  it("parses agent frontmatter, keeps unknown keys and splits the body", async () => {
    const result = await scan("claude-only");
    const agent = byName(itemsOfKind(result.items, "agent"), "code-reviewer");

    expect(agent.kind).toBe("agent");
    expect(agent.parseError).toBeUndefined();
    expect(agent.sourceFile).toBe(
      path.join(fixture("claude-only"), ".claude/agents/reviewer.md"),
    );
    if (agent.kind !== "agent" || !agent.data) throw new Error("expected agent data");
    expect(agent.data.description).toBe("Reviews diffs for correctness and style.");
    expect(agent.data.model).toBe("sonnet");
    // `tools` written as a comma-separated string is normalised to a list…
    expect(agent.data.tools).toEqual(["Read", "Grep", "Bash"]);
    // …and unknown frontmatter keys survive for the writers of the next phase.
    expect(agent.data.frontmatter.color).toBe("blue");
    expect(agent.data.body.startsWith("You are a meticulous code reviewer.")).toBe(true);
  });

  it("names an agent after its file when the frontmatter has no name", async () => {
    const result = await scan("claude-only");
    const agent = byName(itemsOfKind(result.items, "agent"), "writer");
    if (agent.kind !== "agent" || !agent.data) throw new Error("expected agent data");
    expect(agent.data.tools).toEqual(["Read", "Write"]);
    expect(agent.sourceFile.endsWith(path.join("agents", "nested", "writer.md"))).toBe(true);
  });

  it("lists the files of a skill folder", async () => {
    const result = await scan("claude-only");
    const skill = byName(itemsOfKind(result.items, "skill"), "pdf-export");
    if (skill.kind !== "skill" || !skill.data) throw new Error("expected skill data");
    expect(skill.data.files.map((f) => f.relativePath)).toEqual([
      "SKILL.md",
      "reference.md",
      "scripts/run.py",
    ]);
    expect(skill.data.files.every((f) => f.bytes > 0)).toBe(true);
    expect(skill.data.description).toBe("Export a report to PDF.");
    expect(skill.data.frontmatter.license).toBe("MIT");
    expect(skill.path).toBe(path.join(fixture("claude-only"), ".claude/skills/pdf-export"));
  });

  it("resolves every MCP transport, defaulting to stdio", async () => {
    const result = await scan("claude-only");
    const mcps = itemsOfKind(result.items, "mcp");
    const mcpFile = path.join(fixture("claude-only"), ".mcp.json");

    const filesystem = byName(mcps, "filesystem");
    if (filesystem.kind !== "mcp" || !filesystem.data) throw new Error("expected mcp data");
    // No `type` key at all → stdio, the documented `.mcp.json` default.
    expect(filesystem.data.transport).toBe("stdio");
    expect(filesystem.data.command).toBe("npx");
    expect(filesystem.data.args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "."]);
    expect(filesystem.data.env).toEqual({ ROOT: "/srv" });
    expect(filesystem.sourceFile).toBe(mcpFile);
    expect(filesystem.path).toBe(mcpFile);

    const docs = byName(mcps, "docs");
    if (docs.kind !== "mcp" || !docs.data) throw new Error("expected mcp data");
    expect(docs.data.transport).toBe("http");
    expect(docs.data.url).toBe("https://docs.example.com/mcp");
    expect(docs.data.headers).toEqual({ Authorization: "Bearer x" });
    expect(docs.data.command).toBeNull();

    expect((byName(mcps, "events") as { data: { transport: string } }).data.transport).toBe("sse");
    expect((byName(mcps, "socket") as { data: { transport: string } }).data.transport).toBe("ws");
  });

  it("lists CLAUDE.md as an instruction file", async () => {
    const result = await scan("claude-only");
    expect(result.instructions.map((i) => `${i.ecosystem}:${i.relativePath}`)).toEqual([
      "claude:CLAUDE.md",
    ]);
    expect(result.instructions[0]!.bytes).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- codex-only

describe("scanProject · codex-only fixture", () => {
  it("finds Codex skills and MCP servers, and no Claude items", async () => {
    const result = await scan("codex-only");
    expect(summarize(result)).toEqual([
      "project/codex/mcp/filesystem",
      "project/codex/mcp/remote",
      "project/codex/skill/lint-fix",
    ]);
    expect(result.errors).toEqual([]);
  });

  it("reads [mcp_servers.*] out of config.toml", async () => {
    const result = await scan("codex-only");
    const mcps = itemsOfKind(result.items, "mcp");
    const config = path.join(fixture("codex-only"), ".codex/config.toml");

    const fsServer = byName(mcps, "filesystem");
    if (fsServer.kind !== "mcp" || !fsServer.data) throw new Error("expected mcp data");
    expect(fsServer.sourceFile).toBe(config);
    expect(fsServer.data.transport).toBe("stdio");
    expect(fsServer.data.command).toBe("npx");
    expect(fsServer.data.env).toEqual({ ROOT: "/srv" });

    const remote = byName(mcps, "remote");
    if (remote.kind !== "mcp" || !remote.data) throw new Error("expected mcp data");
    // A url and no command can only be a remote server.
    expect(remote.data.transport).toBe("http");
    expect(remote.data.url).toBe("https://remote.example.com/mcp");
    // Codex-specific keys are preserved verbatim.
    expect(remote.data.raw.bearer_token_env_var).toBe("REMOTE_TOKEN");
  });

  it("finds the root AGENTS.md and the nested one", async () => {
    const result = await scan("codex-only");
    expect(result.instructions.map((i) => i.relativePath)).toEqual([
      "AGENTS.md",
      "packages/api/AGENTS.md",
    ]);
    expect(result.instructions.every((i) => i.ecosystem === "codex")).toBe(true);
  });
});

// --------------------------------------------------------------------- mixed

describe("scanProject · mixed fixture", () => {
  it("merges both ecosystems", async () => {
    const result = await scan("mixed");
    expect(summarize(result)).toEqual([
      "project/claude/agent/planner",
      "project/claude/mcp/shared",
      "project/codex/mcp/shared",
      "project/claude/skill/shared-skill",
      "project/codex/skill/shared-skill",
    ]);
    expect(countItems(result.items, { ecosystem: "claude" })).toBe(3);
    expect(countItems(result.items, { ecosystem: "codex" })).toBe(2);
  });

  it("gives same-named capabilities of the two ecosystems distinct ids", async () => {
    const result = await scan("mixed");
    const skills = itemsOfKind(result.items, "skill");
    expect(skills).toHaveLength(2);
    expect(skills[0]!.id).not.toBe(skills[1]!.id);
    const mcps = itemsOfKind(result.items, "mcp");
    expect(mcps[0]!.id).not.toBe(mcps[1]!.id);
  });

  it("lists both instruction files", async () => {
    const result = await scan("mixed");
    expect(result.instructions.map((i) => `${i.ecosystem}:${i.name}`).sort()).toEqual([
      "claude:CLAUDE.md",
      "codex:AGENTS.md",
    ]);
  });
});

// ----------------------------------------------------------------- malformed

describe("scanProject · malformed fixture", () => {
  it("reports broken files instead of dropping them", async () => {
    const result = await scan("malformed");
    expect(summarize(result)).toEqual([
      "project/claude/agent/broken [broken]",
      "project/claude/agent/wrong-types [broken]",
      "project/claude/mcp/.mcp.json [broken]",
      "project/codex/mcp/config.toml [broken]",
      "project/claude/skill/bad-skill [broken]",
    ]);
  });

  it("keeps the raw body of an agent whose YAML does not parse", async () => {
    const result = await scan("malformed");
    const agent = byName(itemsOfKind(result.items, "agent"), "broken");
    expect(agent.data).toBeNull();
    expect(agent.parseError).toBeTruthy();
    // The name falls back to the filename: there is no readable frontmatter.
    expect(agent.name).toBe("broken");
  });

  it("flags a type error on a known key but still exposes the frontmatter", async () => {
    const result = await scan("malformed");
    const agent = byName(itemsOfKind(result.items, "agent"), "wrong-types");
    expect(agent.parseError).toContain("description");
    if (agent.kind !== "agent" || !agent.data) throw new Error("expected best-effort data");
    expect(agent.data.description).toBeNull();
    expect(agent.data.frontmatter.description).toBe(42);
  });

  it("turns an unparseable config file into a single broken item", async () => {
    const result = await scan("malformed");
    const json = byName(itemsOfKind(result.items, "mcp"), ".mcp.json");
    expect(json.data).toBeNull();
    expect(json.parseError).toBeTruthy();
    expect(json.sourceFile).toBe(path.join(fixture("malformed"), ".mcp.json"));

    const toml = byName(itemsOfKind(result.items, "mcp"), "config.toml");
    expect(toml.data).toBeNull();
    expect(toml.parseError).toBeTruthy();
    expect(toml.ecosystem).toBe("codex");
  });

  it("still reports a broken skill by its folder name", async () => {
    const result = await scan("malformed");
    const skill = byName(itemsOfKind(result.items, "skill"), "bad-skill");
    expect(skill.data).toBeNull();
    expect(skill.parseError).toBeTruthy();
  });
});

// ------------------------------------------------------------- nested agents

describe("scanProject · nested AGENTS.md", () => {
  it("walks four levels deep, shallowest first", async () => {
    const result = await scan("nested-agents");
    expect(result.instructions.map((i) => i.relativePath)).toEqual([
      "AGENTS.md",
      "a/AGENTS.md",
      "a/b/AGENTS.md",
      "a/b/c/AGENTS.md",
    ]);
  });

  it("skips dot-directories, node_modules and .git", async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amos-walk-")));
    try {
      for (const sub of ["node_modules/pkg", ".git/hooks", "src"]) {
        fs.mkdirSync(path.join(dir, sub), { recursive: true });
        fs.writeFileSync(path.join(dir, sub, "AGENTS.md"), "x");
      }
      fs.writeFileSync(path.join(dir, "AGENTS.md"), "root");
      const result = await scanProject(dir, { home: HOME, includeGlobal: false });
      expect(result.instructions.map((i) => i.relativePath)).toEqual([
        "AGENTS.md",
        "src/AGENTS.md",
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// -------------------------------------------------------------- global scope

describe("scanProject · global scope", () => {
  it("adds the home capabilities of both ecosystems", async () => {
    const result = await scan("claude-only", { global: true });
    const globals = result.items.filter((i) => i.scope === "global");
    expect(summarize({ ...result, items: globals })).toEqual([
      "global/claude/agent/global-helper",
      "global/claude/mcp/global-http",
      "global/codex/mcp/global-stdio",
      "global/claude/skill/global-skill",
      "global/codex/skill/global-codex-skill",
    ]);
  });

  it("reads only the top-level mcpServers of ~/.claude.json", async () => {
    const result = await scan("claude-only", { global: true });
    expect(result.items.some((i) => i.name === "not-global")).toBe(false);
  });

  it("lists the global instruction files", async () => {
    const result = await scan("claude-only", { global: true });
    const globals = result.instructions.filter((i) => i.scope === "global");
    expect(globals.map((i) => `${i.ecosystem}:${i.name}`)).toEqual([
      "claude:CLAUDE.md",
      "codex:AGENTS.md",
    ]);
    // Global files keep an absolute relativePath — they are outside the project.
    expect(path.isAbsolute(globals[0]!.relativePath)).toBe(true);
  });

  it("is silent about a home directory that has neither CLI installed", async () => {
    const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amos-home-")));
    try {
      const result = await scanProject(fixture("codex-only"), { home: empty });
      expect(result.items.some((i) => i.scope === "global")).toBe(false);
      expect(result.errors).toEqual([]);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

// --------------------------------------------------------------- ids & edges

describe("scanProject · ids and edge cases", () => {
  it("derives ids from kind, source file and name, stably across scans", async () => {
    const first = await scan("claude-only");
    const second = await scan("claude-only");
    expect(first.items.map((i) => i.id)).toEqual(second.items.map((i) => i.id));

    const agent = byName(itemsOfKind(first.items, "agent"), "code-reviewer");
    expect(agent.id).toBe(capabilityId("agent", agent.sourceFile, "code-reviewer"));
    expect(new Set(first.items.map((i) => i.id)).size).toBe(first.items.length);
  });

  it("reports a project folder that no longer exists", async () => {
    const result = await scanProject(path.join(FIXTURES, "does-not-exist"), { home: HOME });
    expect(result.items).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/does not exist/);
  });

  it("returns an empty scan for a folder with no capabilities", async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amos-empty-")));
    try {
      const result = await scanProject(dir, { home: HOME, includeGlobal: false });
      expect(result.items).toEqual([]);
      expect(result.instructions).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(Date.parse(result.scannedAt)).not.toBeNaN();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
