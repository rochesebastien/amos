// `readGitHead` reads `.git` by hand rather than shelling out, so the shapes
// git actually writes there are the contract — a branch ref, a detached sha,
// and the `gitdir:` pointer a worktree or submodule leaves behind. Each of
// those is a real layout the function has to survive, and "not a repository"
// has to come back as null rather than as an exception.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  checkoutBranch,
  listBranches,
  readGitHead,
} from "../../src/main/services/git.js";

const execFileAsync = promisify(execFile);

/** Run a git command in `dir`. */
function git(dir: string, args: string[]) {
  return execFileAsync("git", ["-C", dir, ...args], {
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
}

/** A real repository with one commit on `main` — checkout needs actual git. */
async function realRepo(dir: string) {
  await git(dir, ["init", "-q", "-b", "main"]);
  await git(dir, ["config", "user.email", "test@example.com"]);
  await git(dir, ["config", "user.name", "Test"]);
  await fs.writeFile(path.join(dir, "README.md"), "hello\n", "utf8");
  await git(dir, ["add", "."]);
  await git(dir, ["commit", "-q", "-m", "first"]);
}

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

describe("listBranches", () => {
  it("finds loose refs, nested names included", async () => {
    await writeRepo(root, "ref: refs/heads/main\n");
    const heads = path.join(root, ".git", "refs", "heads");
    await fs.mkdir(path.join(heads, "claude"), { recursive: true });
    await fs.writeFile(path.join(heads, "main"), "sha\n", "utf8");
    await fs.writeFile(path.join(heads, "claude", "sidebar"), "sha\n", "utf8");

    expect(await listBranches(root)).toEqual(["claude/sidebar", "main"]);
  });

  it("finds branches that only exist in packed-refs", async () => {
    // After `git gc` the loose ref is gone; reading the directory alone would
    // report a repository with almost no branches.
    await writeRepo(root, "ref: refs/heads/main\n");
    await fs.writeFile(
      path.join(root, ".git", "packed-refs"),
      [
        "# pack-refs with: peeled fully-peeled sorted",
        `${"a".repeat(40)} refs/heads/main`,
        `${"b".repeat(40)} refs/heads/release/1.x`,
        `${"c".repeat(40)} refs/tags/v1`,
        `^${"d".repeat(40)}`,
      ].join("\n"),
      "utf8",
    );

    expect(await listBranches(root)).toEqual(["main", "release/1.x"]);
  });

  it("does not report a branch twice when it is both loose and packed", async () => {
    await writeRepo(root, "ref: refs/heads/main\n");
    const heads = path.join(root, ".git", "refs", "heads");
    await fs.mkdir(heads, { recursive: true });
    await fs.writeFile(path.join(heads, "main"), "sha\n", "utf8");
    await fs.writeFile(
      path.join(root, ".git", "packed-refs"),
      `${"a".repeat(40)} refs/heads/main\n`,
      "utf8",
    );

    expect(await listBranches(root)).toEqual(["main"]);
  });

  it("says nothing about a folder that is not a repository", async () => {
    expect(await listBranches(root)).toEqual([]);
  });
});

describe("checkoutBranch", () => {
  it("really moves the working tree", async () => {
    await realRepo(root);
    await git(root, ["checkout", "-b", "feature"]);
    await git(root, ["checkout", "main"]);

    await checkoutBranch(root, "feature");

    expect(await readGitHead(root)).toEqual({ branch: "feature", detachedAt: null });
  });

  it("passes the branch as a ref, never as a path to restore", async () => {
    // `git checkout -- <name>` throws away the working copy of the file called
    // <name>. A branch and a file sharing a name is the case where argument
    // order stops being cosmetic, so it is pinned here.
    await realRepo(root);
    await git(root, ["checkout", "-b", "docs"]);
    await fs.writeFile(path.join(root, "docs"), "committed\n", "utf8");
    await git(root, ["add", "docs"]);
    await git(root, ["commit", "-m", "add docs file"]);
    await fs.writeFile(path.join(root, "docs"), "uncommitted edit\n", "utf8");

    await checkoutBranch(root, "docs").catch(() => undefined);

    // Still the working copy: the edit was not silently restored away.
    expect(await fs.readFile(path.join(root, "docs"), "utf8")).toBe("uncommitted edit\n");
  });

  it("hands back git's own refusal rather than a paraphrase", async () => {
    await realRepo(root);

    await expect(checkoutBranch(root, "no-such-branch")).rejects.toThrow(/no-such-branch/);
  });

  it("refuses a name that would read as a flag", async () => {
    await expect(checkoutBranch(root, "--orphan")).rejects.toThrow(/Invalid branch name/);
  });
});
