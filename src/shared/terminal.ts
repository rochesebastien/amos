/**
 * Terminal contract, shared by the main process, the preload bridge and the
 * renderer. Node-free by construction — it only names the shapes that cross
 * the wire.
 *
 * A terminal is one long-lived child process (a PTY when the native backend
 * compiled, a piped subprocess otherwise) running in a project's folder. The
 * renderer owns the emulator (xterm.js); the main process owns the process.
 */

/** What a new terminal runs. */
export type TerminalKind = "claude" | "codex" | "shell";

export type TerminalCreateRequest = {
  /** Which project's folder to run in. */
  projectId: string;
  kind: TerminalKind;
  /** Initial emulator geometry, so the child starts at the right size. */
  cols: number;
  rows: number;
};

export type TerminalCreateResult = {
  /** Opaque id used by every later call and by the push channels. */
  id: string;
  /** The command that was launched, for the tab's tooltip. */
  command: string;
  /** `true` when a real PTY backs this terminal; `false` for the piped
   *  fallback (no TTY — full-screen TUIs run in their non-interactive mode). */
  pty: boolean;
};

/** One chunk of output, pushed as the child produces it. */
export type TerminalDataEvent = { id: string; data: string };

/** The child exited; the tab shows the code and stops accepting input. */
export type TerminalExitEvent = { id: string; code: number | null };
