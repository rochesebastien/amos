import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { GitHead } from "../../shared/ipc.js";

const run = promisify(execFile);

/**
 * Which git branch a project folder is on.
 *
 * This reads `.git` directly instead of shelling out to `git`. Spawning a
 * process per project — on every scan, and again whenever the chat header
 * refreshes — is a lot of machinery for one line of text, it needs git on the
 * PATH, and it hands a user-controlled path to a shell. Reading the file
 * answers the same question with two syscalls and no child process.
 *
 * Only the current branch is reported. Anything richer (ahead/behind, dirty
 * state) genuinely needs git, and would belong in its own service.
 */

/**
 * Resolve the `.git` of `projectPath`.
 *
 * A worktree or a submodule has a `.git` *file* holding `gitdir: <path>`
 * rather than a directory, and its `HEAD` lives at that path — so following
 * the pointer is what makes this work outside a plain clone.
 */
async function gitDir(projectPath: string): Promise<string | null> {
  const dotGit = path.join(projectPath, ".git");
  let stat;
  try {
    stat = await fs.stat(dotGit);
  } catch {
    return null;
  }
  if (stat.isDirectory()) return dotGit;
  if (!stat.isFile()) return null;

  const pointer = await fs.readFile(dotGit, "utf8").catch(() => "");
  const match = /^gitdir:\s*(.+)$/m.exec(pointer);
  if (!match?.[1]) return null;
  const target = match[1].trim();
  return path.isAbsolute(target) ? target : path.resolve(projectPath, target);
}

/**
 * Read the branch of a project folder. Never throws: a folder that is not a
 * repository, or a `.git` we cannot read, is simply "no branch to show".
 */
export async function readGitHead(projectPath: string): Promise<GitHead | null> {
  const dir = await gitDir(projectPath);
  if (!dir) return null;

  const head = await fs.readFile(path.join(dir, "HEAD"), "utf8").catch(() => null);
  if (head == null) return null;

  const trimmed = head.trim();
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(trimmed);
  if (ref?.[1]) return { branch: ref[1], detachedAt: null };

  // Detached HEAD: the file holds the raw sha.
  if (/^[0-9a-f]{7,40}$/i.test(trimmed)) {
    return { branch: null, detachedAt: trimmed.slice(0, 7) };
  }
  return null;
}

/**
 * Every local branch of a project, sorted, plus the one HEAD is on.
 *
 * Loose refs live as files under `refs/heads`; branches that have been packed
 * (`git gc`) live only as lines in `packed-refs`. A repository that has been
 * garbage-collected has an almost empty `refs/heads`, so reading just the
 * directory would report a handful of branches on a repo that has fifty.
 */
export async function listBranches(projectPath: string): Promise<string[]> {
  const dir = await gitDir(projectPath);
  if (!dir) return [];

  const names = new Set<string>();

  // Loose refs: refs/heads/<name>, where <name> may itself contain slashes.
  const headsRoot = path.join(dir, "refs", "heads");
  const walk = async (current: string, prefix: string) => {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), name);
      else if (entry.isFile()) names.add(name);
    }
  };
  await walk(headsRoot, "");

  // Packed refs: "<sha> refs/heads/<name>" lines, with comments and peeled
  // tag lines ("^<sha>") mixed in.
  const packed = await fs.readFile(path.join(dir, "packed-refs"), "utf8").catch(() => "");
  for (const line of packed.split("\n")) {
    const match = /^[0-9a-f]{40}\s+refs\/heads\/(.+)$/.exec(line.trim());
    if (match?.[1]) names.add(match[1]);
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Move the working tree to `branch`.
 *
 * This is the one place AMOS shells out to git, because it is the one
 * operation that cannot be done by writing files: git has to update the index
 * and the tree. `execFile` (never a shell) with the branch as its own argument
 * means the name is data, not something a shell could reinterpret.
 *
 * Uncommitted work is git's call, not ours — it refuses a checkout that would
 * clobber local changes, and that refusal is passed back verbatim so the user
 * reads git's own words rather than a paraphrase.
 */
export async function checkoutBranch(projectPath: string, branch: string): Promise<void> {
  // A ref cannot start with "-", so this is only ever an attempt to smuggle a
  // flag into the argument list.
  if (!branch || branch.startsWith("-")) throw new Error(`Invalid branch name: ${branch}`);
  try {
    // The branch goes *before* the `--`, and the `--` closes an empty pathspec.
    // `checkout -- <name>` is the opposite command — it restores the file of
    // that name from the index, throwing away the working copy — so the order
    // here is the difference between switching branch and destroying work.
    await run("git", ["-C", projectPath, "checkout", branch, "--"], { timeout: 15_000 });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || (error instanceof Error ? error.message : String(error)));
  }
}
