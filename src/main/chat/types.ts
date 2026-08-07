import type { ChatBackend, ChatEvent } from "../../shared/chat.js";

/**
 * The one shape every backend has to fit into. A driver knows how to talk to
 * exactly one vendor and nothing else: it never touches the database, never
 * knows what a project is, and never decides when a turn starts or ends — the
 * manager owns all of that.
 */

export type ChatDriverSendInput = {
  /** Working directory of the turn — always the project folder. */
  cwd: string;
  prompt: string;
  /** Continues a previous conversation when the driver understands the token. */
  resumeToken: string | null;
  /**
   * Called for every `token` / `tool_call` / `tool_result` / `error` the turn
   * produces. Drivers never emit `start` or `done`.
   */
  onEvent: (event: ChatEvent) => void;
  /** Aborted when the user hits stop, or when the window goes away. */
  signal: AbortSignal;
};

export type ChatDriverResult = {
  /** The token to hand back on the next turn, or `null` when there is none. */
  resumeToken: string | null;
  /** `true` when the turn stopped because the signal fired. */
  aborted: boolean;
};

export interface ChatDriver {
  readonly backend: ChatBackend;
  /**
   * Run one turn. Protocol-level failures are reported as `error` events and
   * resolve normally; only a driver that could not start at all rejects.
   */
  send(input: ChatDriverSendInput): Promise<ChatDriverResult>;
  /** Release long-lived resources (Codex keeps a child process around). */
  dispose(): Promise<void>;
}

/**
 * What a wire mapper hands back for one incoming protocol message: the events
 * to forward, and whether that message ended the turn.
 */
export type MapResult = {
  events: ChatEvent[];
  /** `"complete"` for a normal end, `"aborted"` when the vendor cancelled. */
  finished: "complete" | "aborted" | null;
};

export const NOT_FINISHED: MapResult = { events: [], finished: null };

/** Small helper so mappers can return a single event without ceremony. */
export function mapped(events: ChatEvent[], finished: MapResult["finished"] = null): MapResult {
  return { events, finished };
}
