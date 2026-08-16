// `readGitHead` reads `.git` by hand rather than shelling out, so the shapes
// git actually writes there are the contract — a branch ref, a detached sha,
// and the `gitdir:` pointer a worktree or submodule leaves behind. Each of
// those is a real layout the function has to survive, and "not a repository"
// has to come back as null rather than as an exception.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readGitHead } from "../../src/main/services/git.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "amos-git-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** Write a plain `.git/` directory holding `HEAD`. */
async function writeRepo(dir: string, head: string) {
  await fs.mkdir(path.join(dir, ".git"), { recursive: true });
  await fs.writeFile(path.join(dir, ".git", "HEAD"), head, "utf8");
}

describe("readGitHead", () => {
  it("reads the branch a repository is on", async () => {
    await writeRepo(root, "ref: refs/heads/main\n");

    expect(await readGitHead(root)).toEqual({ branch: "main", detachedAt: null });
  });

  it("keeps the slashes of a namespaced branch", async () => {
    await writeRepo(root, "ref: refs/heads/claude/sidebar-tabs\n");

    expect(await readGitHead(root)).toEqual({
      branch: "claude/sidebar-tabs",
      detachedAt: null,
    });
  });

  it("reports a short sha when HEAD is detached", async () => {
    await writeRepo(root, "3c04ae7f1b2c3d4e5f60718293a4b5c6d7e8f901\n");

    expect(await readGitHead(root)).toEqual({ branch: null, detachedAt: "3c04ae7" });
  });

  it("follows the gitdir pointer of a worktree", async () => {
    // A linked worktree has a `.git` *file*; its HEAD lives where that points.
    const real = path.join(root, "store", "worktrees", "feature");
    const tree = path.join(root, "tree");
    await fs.mkdir(real, { recursive: true });
    await fs.mkdir(tree, { recursive: true });
    await fs.writeFile(path.join(real, "HEAD"), "ref: refs/heads/feature\n", "utf8");
    await fs.writeFile(path.join(tree, ".git"), `gitdir: ${real}\n`, "utf8");

    expect(await readGitHead(tree)).toEqual({ branch: "feature", detachedAt: null });
  });

  it("resolves a relative gitdir pointer against the project", async () => {
    const real = path.join(root, "modules", "lib");
    const tree = path.join(root, "lib");
    await fs.mkdir(real, { recursive: true });
    await fs.mkdir(tree, { recursive: true });
    await fs.writeFile(path.join(real, "HEAD"), "ref: refs/heads/dev\n", "utf8");
    await fs.writeFile(path.join(tree, ".git"), "gitdir: ../modules/lib\n", "utf8");

    expect(await readGitHead(tree)).toEqual({ branch: "dev", detachedAt: null });
  });

  it("returns null for a folder that is not a repository", async () => {
    expect(await readGitHead(root)).toBeNull();
  });

  it("returns null for a path that does not exist", async () => {
    expect(await readGitHead(path.join(root, "nope"))).toBeNull();
  });

  it("returns null rather than throwing on an unreadable HEAD", async () => {
    await fs.mkdir(path.join(root, ".git"), { recursive: true });
    // `.git` exists but holds no HEAD at all.
    expect(await readGitHead(root)).toBeNull();
  });

  it("returns null on a HEAD it cannot make sense of", async () => {
    await writeRepo(root, "something git would never write\n");

    expect(await readGitHead(root)).toBeNull();
  });
});
