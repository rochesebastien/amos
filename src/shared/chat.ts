/**
 * The chat contract shared by the main process, the preload bridge and the
 * renderer: the event union the drivers speak, the persisted session shapes,
 * and what CLI detection reports.
 *
 * Like the rest of `src/shared`, this module must stay free of Node and
 * Electron imports — it is bundled into the sandboxed renderer too.
 */

// ------------------------------------------------------------------ backends

/**
 * Which driver runs a turn. `claude` and `codex` pilot the vendor CLIs the
 * user already installed and logged into — AMOS never holds a key or a token.
 * `echo` is a hidden development driver that streams the prompt back.
 */
export const CHAT_BACKENDS = ["claude", "codex", "echo"] as const;
export type ChatBackend = (typeof CHAT_BACKENDS)[number];

/** The two CLIs AMOS knows how to detect. `echo` needs no binary. */
export const CLI_VENDORS = ["claude", "codex"] as const;
export type CliVendor = (typeof CLI_VENDORS)[number];

export function isCliVendor(backend: ChatBackend): backend is CliVendor {
  return backend === "claude" || backend === "codex";
}

// -------------------------------------------------------------------- events

/** Why a turn failed. The renderer picks its wording from this, not the text. */
export type ChatErrorCode =
  | "auth"
  | "cli_missing"
  | "aborted"
  | "protocol"
  | "unknown";

/**
 * Everything a turn can emit. Drivers only ever produce `token`, `tool_call`,
 * `tool_result` and `error`; `start` and `done` are the manager's bookends, so
 * that every backend brackets a turn the same way.
 */
export type ChatEvent =
  | { type: "start"; sessionId: string; backend: ChatBackend; messageId: string }
  | { type: "token"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments?: unknown }
  | { type: "tool_result"; id: string; result?: unknown; isError?: boolean }
  | { type: "error"; error: string; code: ChatErrorCode }
  | { type: "done"; aborted: boolean };

/** What actually crosses the `chat:event` push channel. */
export type ChatEventMessage = {
  sessionId: string;
  projectId: string;
  event: ChatEvent;
};

// ---------------------------------------------------------------- persistence

export type ChatRole = "user" | "assistant";

/** One tool the assistant ran during a turn, with its result once it lands. */
export type ChatToolCall = {
  id: string;
  name: string;
  arguments?: unknown;
  result?: unknown;
  isError?: boolean;
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  toolCalls: ChatToolCall[];
  /** Set when the turn ended badly; the text is shown in the transcript. */
  error: string | null;
  createdAt: string;
};

export type ChatSession = {
  id: string;
  projectId: string;
  backend: ChatBackend;
  /** Derived from the first prompt; empty until one is sent. */
  title: string;
  /**
   * Opaque token handed back to the driver to continue the conversation.
   * Claude stores its session uuid here; Codex stores a small JSON document.
   */
  resumeToken: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChatSessionDetail = {
  session: ChatSession;
  messages: ChatMessage[];
};

// ----------------------------------------------------------------- detection

/**
 * How sure AMOS is that the CLI can talk to the vendor.
 * - `ready` — Codex has an `auth.json`, or Claude has not failed yet.
 * - `unauthenticated` — a turn came back with an auth error.
 * - `unknown` — nothing installed, so nothing to say.
 */
export type CliAuth = "unknown" | "ready" | "unauthenticated";

/** Where the binary was found. `override` is a path the user typed in. */
export type CliSource = "override" | "path" | "known-location";

export type CliStatus = {
  vendor: CliVendor;
  installed: boolean;
  /** Absolute path of the binary, or `null` when nothing was found. */
  path: string | null;
  source: CliSource | null;
  /** First line of `--version`, or `null` when it did not answer in time. */
  version: string | null;
  auth: CliAuth;
  /** A non-fatal detection note: a missing override, a version timeout, … */
  note: string | null;
};

export type CliDetection = {
  /** ISO-8601 timestamp of the probe. */
  checkedAt: string;
  clis: Record<CliVendor, CliStatus>;
  /** `true` when the hidden echo driver is switched on. */
  echoEnabled: boolean;
};

/** Settings keys that hold a manual binary path, per vendor. */
export const CLI_PATH_SETTING: Record<CliVendor, string> = {
  claude: "cli.claude.path",
  codex: "cli.codex.path",
};

/** Setting holding `"1"` when the hidden echo driver is enabled. */
export const ECHO_DRIVER_SETTING = "chat.echoDriver";

/** Setting holding the backend the composer should preselect. */
export const CHAT_BACKEND_SETTING = "chat.backend";

/** Environment variable that force-enables the echo driver for a dev run. */
export const ECHO_DRIVER_ENV = "AMOS_ECHO_DRIVER";

/** `true` when this backend could actually run a turn right now. */
export function isBackendReady(detection: CliDetection | undefined, backend: ChatBackend): boolean {
  if (!detection) return false;
  if (backend === "echo") return detection.echoEnabled;
  const status = detection.clis[backend];
  return status.installed && status.auth !== "unauthenticated";
}

/** The backends the composer may offer, in display order. */
export function readyBackends(detection: CliDetection | undefined): ChatBackend[] {
  return CHAT_BACKENDS.filter((backend) => isBackendReady(detection, backend));
}
