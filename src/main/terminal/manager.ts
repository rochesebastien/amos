import { spawn as spawnChild, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type {
  TerminalCreateRequest,
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalKind,
} from "../../shared/terminal.js";

/**
 * The main-process side of the terminals panel.
 *
 * Each terminal is one long-lived child running in a project's folder. The
 * preferred backend is a real PTY (`node-pty`), which gives the CLIs a TTY and
 * lets their full-screen UIs render. `node-pty` is a native module, so when it
 * did not compile for this Electron build the manager falls back to a piped
 * `child_process`: still a live process the panel can talk to, but without a
 * TTY, so full-screen TUIs run in their non-interactive mode. Either way the
 * renderer sees the same events.
 *
 * `node-pty` is required lazily and inside a try/catch: importing this file
 * must never crash the app just because the native binary is missing.
 */

type PtyModule = {
  spawn: (
    file: string,
    args: string[],
    opts: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv },
  ) => PtyProcess;
};
type PtyProcess = {
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (e: { exitCode: number }) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
};

let ptyModule: PtyModule | null | undefined;
/**
 * Load `node-pty` once; remember `null` so a missing binary is not retried.
 * The main bundle is ESM, so a `createRequire` is what reaches a CommonJS
 * native addon; wrapping it in try/catch is what keeps a missing or
 * wrong-ABI binary from taking the whole app down — the manager just falls
 * back to piped children.
 */
const requireCjs = createRequire(import.meta.url);
function loadPty(): PtyModule | null {
  if (ptyModule !== undefined) return ptyModule;
  try {
    ptyModule = requireCjs("node-pty") as PtyModule;
  } catch {
    ptyModule = null;
  }
  return ptyModule;
}

type Session = {
  id: string;
  kill: () => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
};

/** `ELECTRON_RUN_AS_NODE` leaks into children and confuses Node-based CLIs. */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // Encourage colour even down the piped fallback.
  env.TERM = env.TERM ?? "xterm-256color";
  env.FORCE_COLOR = env.FORCE_COLOR ?? "1";
  return env;
}

export type TerminalManagerOptions = {
  emitData: (event: TerminalDataEvent) => void;
  emitExit: (event: TerminalExitEvent) => void;
  /** Absolute folder a terminal for this project should run in, or `null`. */
  resolveProjectPath: (projectId: string) => string | null;
  /** Absolute path of a vendor CLI binary, or `null` when not detected. */
  resolveBinary: (kind: "claude" | "codex") => string | null;
};

export class TerminalManager {
  private sessions = new Map<string, Session>();

  constructor(private readonly options: TerminalManagerOptions) {}

  create(request: TerminalCreateRequest): TerminalCreateResult {
    const cwd = this.options.resolveProjectPath(request.projectId);
    if (!cwd) throw new Error(`Unknown project: ${request.projectId}`);

    const { file, args } = this.commandFor(request.kind);
    const id = randomUUID();
    const cols = clampDim(request.cols, 80);
    const rows = clampDim(request.rows, 24);
    const command = [file, ...args].join(" ");

    const pty = loadPty();
    if (pty) {
      const child = pty.spawn(file, args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: childEnv(),
      });
      child.onData((data) => this.options.emitData({ id, data }));
      child.onExit(({ exitCode }) => this.finish(id, exitCode));
      this.sessions.set(id, {
        id,
        kill: () => child.kill(),
        write: (data) => child.write(data),
        resize: (c, r) => child.resize(c, r),
      });
      return { id, command, pty: true };
    }

    // Fallback: a piped child. No TTY, but the panel still works.
    const child: ChildProcessWithoutNullStreams = spawnChild(file, args, {
      cwd,
      env: childEnv(),
    });
    child.stdout.on("data", (chunk: Buffer) => this.options.emitData({ id, data: chunk.toString() }));
    child.stderr.on("data", (chunk: Buffer) => this.options.emitData({ id, data: chunk.toString() }));
    child.on("exit", (code) => this.finish(id, code ?? 0));
    child.on("error", (err) => {
      this.options.emitData({ id, data: `\r\n[amos] ${err.message}\r\n` });
      this.finish(id, 1);
    });
    this.sessions.set(id, {
      id,
      kill: () => child.kill(),
      // A real terminal's line discipline turns the Enter key (CR) into a
      // newline; the piped child has no TTY to do that, so translate here or
      // the shell never sees a completed line.
      write: (data) => child.stdin.write(data.replace(/\r/g, "\n")),
      resize: () => undefined,
    });
    return { id, command, pty: false };
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.resize(clampDim(cols, 80), clampDim(rows, 24));
  }

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    try {
      session.kill();
    } catch {
      // Already gone — nothing to do.
    }
  }

  /** Kill every terminal, e.g. on window close. */
  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }

  private finish(id: string, code: number | null): void {
    if (!this.sessions.has(id)) return;
    this.sessions.delete(id);
    this.options.emitExit({ id, code });
  }

  private commandFor(kind: TerminalKind): { file: string; args: string[] } {
    if (kind === "shell") {
      const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "bash");
      return { file: shell, args: [] };
    }
    const binary = this.options.resolveBinary(kind);
    if (!binary) {
      throw new Error(
        `No ${kind} binary detected. Install the CLI and sign in, then set its path in ` +
          `Settings → Backends.`,
      );
    }
    return { file: binary, args: [] };
  }
}

/** Terminals size is renderer-supplied, so clamp it before it reaches a child. */
function clampDim(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(1000, Math.max(1, Math.floor(value)));
}
