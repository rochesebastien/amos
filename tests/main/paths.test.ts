import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PATH_DENIED_CODE } from "../../src/shared/ipc.js";
import {
  buildAllowedRoots,
  PathAccessError,
  realpathDeep,
  resolveAllowedPath,
} from "../../src/main/services/paths.js";

/**
 * The renderer is sandboxed but not trusted. These tests are the contract of
 * `resolveAllowedPath`: a path is reachable only if the *real* file it names
 * sits inside a registered project, `~/.claude` or `~/.codex`.
 */

let tmp: string;
let project: string;
let home: string;
let outside: string;

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "amos-paths-")));
  project = path.join(tmp, "project");
  home = path.join(tmp, "home");
  outside = path.join(tmp, "outside");
  await fs.mkdir(path.join(project, ".claude", "agents"), { recursive: true });
  await fs.mkdir(path.join(home, ".claude"), { recursive: true });
  await fs.mkdir(path.join(home, ".codex"), { recursive: true });
  await fs.mkdir(path.join(outside, "secrets"), { recursive: true });
  await fs.writeFile(path.join(outside, "secrets", "id_rsa"), "PRIVATE\n");
  await fs.writeFile(path.join(home, ".claude.json"), "{}\n");
  await fs.writeFile(path.join(home, ".bashrc"), "export SECRET=1\n");
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function roots() {
  return buildAllowedRoots([project], home);
}

describe("resolveAllowedPath", () => {
  it("allows a file inside a registered project", async () => {
    const target = path.join(project, ".claude", "agents", "reviewer.md");
    await expect(resolveAllowedPath(target, roots())).resolves.toBe(target);
  });

  it("allows a file that does not exist yet inside a project", async () => {
    const target = path.join(project, ".claude", "skills", "brand-new", "SKILL.md");
    await expect(resolveAllowedPath(target, roots())).resolves.toBe(target);
  });

  it("allows the two global capability folders", async () => {
    await expect(resolveAllowedPath(path.join(home, ".claude"), roots())).resolves.toBeTruthy();
    await expect(
      resolveAllowedPath(path.join(home, ".codex", "config.toml"), roots()),
    ).resolves.toBeTruthy();
  });

  it("allows ~/.claude.json even though the home folder itself is not reachable", async () => {
    await expect(resolveAllowedPath(path.join(home, ".claude.json"), roots())).resolves.toBe(
      path.join(home, ".claude.json"),
    );
    await expect(resolveAllowedPath(path.join(home, ".bashrc"), roots())).rejects.toBeInstanceOf(
      PathAccessError,
    );
  });

  it("refuses a path outside every root", async () => {
    await expect(
      resolveAllowedPath(path.join(outside, "secrets", "id_rsa"), roots()),
    ).rejects.toBeInstanceOf(PathAccessError);
  });

  it("refuses traversal out of a project", async () => {
    const target = path.join(project, "..", "outside", "secrets", "id_rsa");
    await expect(resolveAllowedPath(target, roots())).rejects.toBeInstanceOf(PathAccessError);
  });

  it("refuses a symlink inside the project that points out of it", async () => {
    await fs.symlink(outside, path.join(project, "escape"), "dir");
    await expect(
      resolveAllowedPath(path.join(project, "escape", "secrets", "id_rsa"), roots()),
    ).rejects.toBeInstanceOf(PathAccessError);
  });

  it("refuses a symlinked *file* inside the project that points out of it", async () => {
    await fs.symlink(path.join(outside, "secrets", "id_rsa"), path.join(project, "key.md"), "file");
    await expect(resolveAllowedPath(path.join(project, "key.md"), roots())).rejects.toBeInstanceOf(
      PathAccessError,
    );
  });

  it("refuses a *new* file placed under a symlink that escapes the project", async () => {
    await fs.symlink(outside, path.join(project, "escape"), "dir");
    await expect(
      resolveAllowedPath(path.join(project, "escape", "planted.md"), roots()),
    ).rejects.toBeInstanceOf(PathAccessError);
  });

  it("still allows a project reached through a symlink of its own", async () => {
    const link = path.join(tmp, "link-to-project");
    await fs.symlink(project, link, "dir");
    const allowed = buildAllowedRoots([link], home);
    await expect(
      resolveAllowedPath(path.join(link, ".claude", "agents", "a.md"), allowed),
    ).resolves.toBe(path.join(project, ".claude", "agents", "a.md"));
  });

  it("refuses empty paths and paths carrying a NUL byte", async () => {
    await expect(resolveAllowedPath("", roots())).rejects.toBeInstanceOf(PathAccessError);
    await expect(
      resolveAllowedPath(`${project}/a\0/../../etc/passwd`, roots()),
    ).rejects.toBeInstanceOf(PathAccessError);
  });

  it("marks the refusal so the renderer can tell it from a read error", async () => {
    const error = await resolveAllowedPath("/etc/passwd", roots()).catch((e) => e);
    expect(error.message).toContain(PATH_DENIED_CODE);
  });
});

describe("realpathDeep", () => {
  it("resolves the existing part and keeps the missing tail", async () => {
    const target = path.join(project, "a", "b", "c.md");
    expect(await realpathDeep(target)).toBe(target);
  });

  it("resolves symlinks in the existing part", async () => {
    await fs.symlink(project, path.join(tmp, "alias"), "dir");
    expect(await realpathDeep(path.join(tmp, "alias", "new", "file.md"))).toBe(
      path.join(project, "new", "file.md"),
    );
  });
});
