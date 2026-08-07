import { mapped, NOT_FINISHED, type MapResult } from "./types.js";

/**
 * Everything AMOS knows about the `codex app-server` wire format lives here
 * and in `codexDriver.ts`. The protocol carries no version guarantee, so the
 * rule is: recognise what we understand, ignore the rest, never throw. A
 * Codex release that renames a notification costs the user a missing tool row
 * in the transcript — never a crashed turn.
 *
 * This module is pure so recorded notification sequences can be replayed in a
 * plain vitest run, with no `codex` binary anywhere.
 */

// ------------------------------------------------------------------- framing

export type JsonRpcResponse = {
  kind: "response";
  id: number | string;
  result?: unknown;
  error?: { code?: number; message?: string };
};

export type JsonRpcRequest = {
  kind: "request";
  id: number | string;
  method: string;
  params: unknown;
};

export type JsonRpcNotification = {
  kind: "notification";
  method: string;
  params: unknown;
};

export type CodexIncoming =
  | JsonRpcResponse
  | JsonRpcRequest
  | JsonRpcNotification
  | { kind: "unknown"; raw: unknown };

/** Sort one parsed ndjson line into response / request / notification. */
export function classifyCodexMessage(raw: unknown): CodexIncoming {
  if (!raw || typeof raw !== "object") return { kind: "unknown", raw };
  const message = raw as Record<string, unknown>;
  const hasId = "id" in message && (typeof message.id === "number" || typeof message.id === "string");
  const method = typeof message.method === "string" ? message.method : null;

  if (hasId && method) {
    return { kind: "request", id: message.id as number | string, method, params: message.params };
  }
  if (hasId) {
    return {
      kind: "response",
      id: message.id as number | string,
      result: message.result,
      error: message.error as JsonRpcResponse["error"],
    };
  }
  if (method) return { kind: "notification", method, params: message.params };
  return { kind: "unknown", raw };
}

// -------------------------------------------------------------------- events

export type CodexEvent = {
  /** The `msg.type` discriminator, e.g. `agent_message_delta`. */
  type: string;
  payload: Record<string, unknown>;
  /** Present when the notification named the conversation it belongs to. */
  conversationId: string | null;
};

/**
 * Two notification shapes exist in the wild and both are accepted:
 * `codex/event` with the event nested under `params.msg`, and the newer
 * per-type `codex/event/<type>` with the payload flat in `params`.
 */
export function extractCodexEvent(method: string, params: unknown): CodexEvent | null {
  const record = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
  const conversationId =
    typeof record.conversationId === "string"
      ? record.conversationId
      : typeof record.conversation_id === "string"
        ? (record.conversation_id as string)
        : null;

  if (method === "codex/event") {
    const msg = record.msg;
    if (!msg || typeof msg !== "object") return null;
    const payload = msg as Record<string, unknown>;
    const type = typeof payload.type === "string" ? payload.type : null;
    if (!type) return null;
    return { type, payload, conversationId };
  }

  if (method.startsWith("codex/event/")) {
    const type = method.slice("codex/event/".length);
    if (!type) return null;
    return { type, payload: record, conversationId };
  }

  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The identifier a begin/end pair shares. Codex has spelt it both ways. */
function callId(payload: Record<string, unknown>): string {
  return str(payload.call_id) ?? str(payload.callId) ?? str(payload.id) ?? "codex-call";
}

/** Render a command that arrives as argv, a string, or not at all. */
function commandText(value: unknown): string {
  if (Array.isArray(value)) return value.map((part) => String(part)).join(" ");
  if (typeof value === "string") return value;
  return "";
}

export type CodexMapper = {
  map(event: CodexEvent): MapResult;
  /** The text of the final assistant message, when Codex sent one. */
  readonly finalMessage: string | null;
};

export function createCodexMapper(): CodexMapper {
  /** `true` once the assistant's answer has reached the transcript. */
  let emittedText = false;
  let finalMessage: string | null = null;

  return {
    get finalMessage() {
      return finalMessage;
    },

    map(event: CodexEvent): MapResult {
      const p = event.payload;

      switch (event.type) {
        // ----- assistant text ------------------------------------------------
        case "agent_message_delta": {
          const delta = str(p.delta) ?? str(p.text);
          if (!delta) return NOT_FINISHED;
          emittedText = true;
          return mapped([{ type: "token", text: delta }]);
        }

        case "agent_message": {
          const message = str(p.message) ?? str(p.text) ?? str(p.last_agent_message);
          if (!message) return NOT_FINISHED;
          finalMessage = message;
          // Deltas already carried the same text; emitting it again would
          // double the answer in the transcript.
          if (emittedText) return NOT_FINISHED;
          emittedText = true;
          return mapped([{ type: "token", text: message }]);
        }

        // ----- shell commands ------------------------------------------------
        case "exec_command_begin":
          return mapped([
            {
              type: "tool_call",
              id: callId(p),
              name: "shell",
              arguments: { command: commandText(p.command), cwd: str(p.cwd) ?? undefined },
            },
          ]);

        case "exec_command_end": {
          const exitCode = typeof p.exit_code === "number" ? p.exit_code : null;
          return mapped([
            {
              type: "tool_result",
              id: callId(p),
              result: {
                exitCode,
                stdout: str(p.stdout) ?? "",
                stderr: str(p.stderr) ?? "",
              },
              isError: exitCode !== null && exitCode !== 0,
            },
          ]);
        }

        // ----- MCP tools -----------------------------------------------------
        case "mcp_tool_call_begin": {
          const invocation =
            p.invocation && typeof p.invocation === "object"
              ? (p.invocation as Record<string, unknown>)
              : p;
          const server = str(invocation.server) ?? "mcp";
          const tool = str(invocation.tool) ?? "tool";
          return mapped([
            {
              type: "tool_call",
              id: callId(p),
              name: `${server}.${tool}`,
              arguments: invocation.arguments,
            },
          ]);
        }

        case "mcp_tool_call_end": {
          const result = p.result;
          const isError =
            (result &&
              typeof result === "object" &&
              ((result as Record<string, unknown>).is_error === true ||
                "Err" in (result as Record<string, unknown>))) === true;
          return mapped([{ type: "tool_result", id: callId(p), result, isError }]);
        }

        // ----- patches -------------------------------------------------------
        case "patch_apply_begin":
          return mapped([
            {
              type: "tool_call",
              id: callId(p),
              name: "apply_patch",
              arguments: { changes: p.changes, autoApproved: p.auto_approved },
            },
          ]);

        case "patch_apply_end":
          return mapped([
            {
              type: "tool_result",
              id: callId(p),
              result: { stdout: str(p.stdout) ?? "", stderr: str(p.stderr) ?? "" },
              isError: p.success === false,
            },
          ]);

        // ----- web search ----------------------------------------------------
        case "web_search_begin":
          return mapped([
            {
              type: "tool_call",
              id: callId(p),
              name: "web_search",
              arguments: { query: str(p.query) ?? "" },
            },
          ]);

        case "web_search_end":
          return mapped([{ type: "tool_result", id: callId(p), result: p.results ?? p.result }]);

        // ----- failures ------------------------------------------------------
        case "error":
        case "stream_error": {
          const text = str(p.message) ?? str(p.error) ?? "Codex reported an error.";
          const code = /auth|login|token|unauthor/i.test(text) ? "auth" : "unknown";
          return mapped([{ type: "error", error: text, code }]);
        }

        // ----- end of turn ---------------------------------------------------
        case "task_complete": {
          const last = str(p.last_agent_message);
          if (last) finalMessage = last;
          if (last && !emittedText) {
            emittedText = true;
            return mapped([{ type: "token", text: last }], "complete");
          }
          return mapped([], "complete");
        }

        case "turn_aborted":
          return mapped([], "aborted");

        // Bookkeeping notifications: token counts, plan updates, reasoning,
        // raw command output. Recognised and deliberately not shown.
        default:
          return NOT_FINISHED;
      }
    },
  };
}

// ------------------------------------------------------------- resume tokens

/**
 * A Codex conversation only exists inside a running app-server, so the id
 * alone survives nothing. The rollout file it writes does, which is what makes
 * a session resumable after AMOS restarts — so the token carries both.
 */
export type CodexResume = { conversationId: string | null; rolloutPath: string | null };

export function encodeCodexResume(resume: CodexResume): string {
  return JSON.stringify(resume);
}

export function decodeCodexResume(token: string | null): CodexResume {
  if (!token) return { conversationId: null, rolloutPath: null };
  try {
    const parsed = JSON.parse(token) as Partial<CodexResume>;
    return {
      conversationId: typeof parsed.conversationId === "string" ? parsed.conversationId : null,
      rolloutPath: typeof parsed.rolloutPath === "string" ? parsed.rolloutPath : null,
    };
  } catch {
    // Older tokens were the bare conversation id.
    return { conversationId: token, rolloutPath: null };
  }
}
