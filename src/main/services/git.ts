import fs from "node:fs/promises";
import path from "node:path";
import type { GitHead } from "../../shared/ipc.js";

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
