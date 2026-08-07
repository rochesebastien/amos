import type { ChatErrorCode, ChatEvent } from "../../shared/chat.js";
import { mapped, NOT_FINISHED, type MapResult } from "./types.js";

/**
 * Turning the claude-agent-sdk's message stream into AMOS chat events.
 *
 * Kept apart from the driver on purpose: this half is pure, so a recorded
 * transcript can be replayed through it in a plain vitest run with no CLI, no
 * subprocess and no SDK import. The driver hands its `SDKMessage`s straight in.
 */

/**
 * A structural view of the SDK's message union. Deliberately looser than
 * `SDKMessage`: the SDK adds fields every release, and everything AMOS reads
 * is checked at runtime anyway. That also keeps test fixtures readable — a
 * fixture states the fields the mapping depends on, and nothing else.
 */
export type ClaudeStreamMessage = {
  type: string;
  subtype?: string;
  session_id?: string;
  uuid?: string;
  message?: {
    role?: string;
    content?: unknown;
    stop_reason?: string | null;
  };
  event?: {
    type?: string;
    delta?: { type?: string; text?: string; thinking?: string };
  };
  /** `SDKAssistantMessage.error` / `SDKAPIRetryMessage.error`. */
  error?: string;
  is_error?: boolean;
  result?: string;
  errors?: string[];
};

type ContentBlock = {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};

/** Error names the SDK reports that mean "the CLI is not logged in". */
const AUTH_ERRORS = new Set(["authentication_failed", "oauth_org_not_allowed"]);

/** Free-text shapes of the same problem, for errors that arrive as strings. */
const AUTH_TEXT = /invalid api key|not authenticated|authentication|unauthorized|please run \/login|oauth/i;

/** Classify an SDK error name or message so the UI can react to auth failures. */
export function classifyClaudeError(name: string | undefined, text: string): ChatErrorCode {
  if (name && AUTH_ERRORS.has(name)) return "auth";
  if (AUTH_TEXT.test(text)) return "auth";
  return "unknown";
}

function asArray(value: unknown): ContentBlock[] {
  return Array.isArray(value) ? (value as ContentBlock[]) : [];
}

/**
 * Tool results arrive as a string or as a list of content blocks. Flatten the
 * block form to text so the transcript can show it without knowing the shape.
 */
function normaliseToolResult(content: unknown): unknown {
  if (typeof content === "string") return content;
  const blocks = asArray(content);
  if (blocks.length === 0) return content;
  const text = blocks
    .map((block) => (block.type === "text" ? (block.text ?? "") : JSON.stringify(block)))
    .join("\n");
  return text;
}

export type ClaudeMapper = {
  /** Feed one SDK message; returns the events it produced. */
  map(message: ClaudeStreamMessage): MapResult;
  /** The session id to resume with, once the CLI has announced one. */
  readonly resumeToken: string | null;
};

export function createClaudeMapper(): ClaudeMapper {
  let resumeToken: string | null = null;
  /**
   * With `includePartialMessages` the text of an assistant turn arrives twice:
   * as deltas, then again whole in the `assistant` message. Streaming wins;
   * the flag resets per assistant message so a turn that never streamed (a
   * resumed replay, a CLI too old for partials) still shows its text.
   */
  let streamedText = false;
  const seenToolCalls = new Set<string>();

  function remember(message: ClaudeStreamMessage): void {
    if (typeof message.session_id === "string" && message.session_id) {
      resumeToken = message.session_id;
    }
  }

  return {
    get resumeToken() {
      return resumeToken;
    },

    map(message: ClaudeStreamMessage): MapResult {
      remember(message);

      switch (message.type) {
        // `system/init` only carries metadata; the session id it brings is
        // already captured above and is what a later turn resumes from.
        case "system":
          return NOT_FINISHED;

        case "stream_event": {
          const event = message.event;
          if (event?.type !== "content_block_delta") return NOT_FINISHED;
          const delta = event.delta;
          if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text) {
            streamedText = true;
            return mapped([{ type: "token", text: delta.text }]);
          }
          // Thinking deltas are not shown in the transcript for now.
          return NOT_FINISHED;
        }

        case "assistant": {
          const events: ChatEvent[] = [];
          for (const block of asArray(message.message?.content)) {
            if (block.type === "text" && typeof block.text === "string" && block.text) {
              if (!streamedText) events.push({ type: "token", text: block.text });
            } else if (block.type === "tool_use" && typeof block.id === "string") {
              if (seenToolCalls.has(block.id)) continue;
              seenToolCalls.add(block.id);
              events.push({
                type: "tool_call",
                id: block.id,
                name: block.name ?? "tool",
                arguments: block.input,
              });
            }
          }
          if (message.error) {
            events.push({
              type: "error",
              error: message.error,
              code: classifyClaudeError(message.error, message.error),
            });
          }
          streamedText = false;
          return mapped(events);
        }

        case "user": {
          const events: ChatEvent[] = [];
          for (const block of asArray(message.message?.content)) {
            if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
            events.push({
              type: "tool_result",
              id: block.tool_use_id,
              result: normaliseToolResult(block.content),
              isError: block.is_error === true,
            });
          }
          return mapped(events);
        }

        case "result": {
          const failed = message.subtype !== "success" || message.is_error === true;
          if (!failed) return mapped([], "complete");
          const text =
            (message.errors ?? []).join("\n") ||
            message.result ||
            `Claude ended the turn with ${message.subtype ?? "an error"}.`;
          return mapped(
            [{ type: "error", error: text, code: classifyClaudeError(undefined, text) }],
            "complete",
          );
        }

        // Everything else (status, retries, hooks, task updates, …) is part of
        // the CLI's own bookkeeping and has no place in the transcript.
        default:
          return NOT_FINISHED;
      }
    },
  };
}
