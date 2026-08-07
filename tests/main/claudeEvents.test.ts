import { describe, expect, it } from "vitest";
import {
  classifyClaudeError,
  createClaudeMapper,
  type ClaudeStreamMessage,
} from "../../src/main/chat/claudeEvents.js";
import type { ChatEvent } from "../../src/shared/chat.js";

/**
 * Recorded-transcript tests. Each fixture is a representative `SDKMessage`
 * sequence as the claude-agent-sdk emits it; the assertion is the exact list
 * of chat events AMOS turns it into. No CLI, no subprocess, no SDK import.
 */

/** Replay a whole transcript and collect everything it produced. */
function replay(messages: ClaudeStreamMessage[]): {
  events: ChatEvent[];
  resumeToken: string | null;
  finished: string | null;
} {
  const mapper = createClaudeMapper();
  const events: ChatEvent[] = [];
  let finished: string | null = null;
  for (const message of messages) {
    const result = mapper.map(message);
    events.push(...result.events);
    if (result.finished) {
      finished = result.finished;
      break;
    }
  }
  return { events, resumeToken: mapper.resumeToken, finished };
}

const INIT: ClaudeStreamMessage = {
  type: "system",
  subtype: "init",
  session_id: "sess-1",
  uuid: "u-init",
};

/** The `stream_event` frame the SDK sends for one chunk of assistant text. */
function textDelta(text: string): ClaudeStreamMessage {
  return {
    type: "stream_event",
    session_id: "sess-1",
    event: { type: "content_block_delta", delta: { type: "text_delta", text } },
  };
}

function assistant(content: unknown[], extra: Partial<ClaudeStreamMessage> = {}): ClaudeStreamMessage {
  return {
    type: "assistant",
    session_id: "sess-1",
    message: { role: "assistant", content, stop_reason: null },
    ...extra,
  };
}

const SUCCESS: ClaudeStreamMessage = {
  type: "result",
  subtype: "success",
  session_id: "sess-1",
  is_error: false,
  result: "done",
};

describe("claude transcript → chat events", () => {
  it("streams a plain answer once, not twice", () => {
    const { events, resumeToken, finished } = replay([
      INIT,
      textDelta("Hel"),
      textDelta("lo"),
      // The same text arrives again, whole, in the assistant message.
      assistant([{ type: "text", text: "Hello" }]),
      SUCCESS,
    ]);

    expect(events).toEqual([
      { type: "token", text: "Hel" },
      { type: "token", text: "lo" },
    ]);
    expect(resumeToken).toBe("sess-1");
    expect(finished).toBe("complete");
  });

  it("falls back to the whole assistant message when nothing streamed", () => {
    const { events } = replay([INIT, assistant([{ type: "text", text: "Hello" }]), SUCCESS]);
    expect(events).toEqual([{ type: "token", text: "Hello" }]);
  });

  it("pairs a tool_use block with the tool_result that follows it", () => {
    const { events } = replay([
      INIT,
      textDelta("Let me look."),
      assistant([
        { type: "text", text: "Let me look." },
        { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/x/README.md" } },
      ]),
      {
        type: "user",
        session_id: "sess-1",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: [{ type: "text", text: "# Title" }],
            },
          ],
        },
      },
      textDelta("It is a readme."),
      assistant([{ type: "text", text: "It is a readme." }]),
      SUCCESS,
    ]);

    expect(events).toEqual([
      { type: "token", text: "Let me look." },
      {
        type: "tool_call",
        id: "toolu_1",
        name: "Read",
        arguments: { file_path: "/x/README.md" },
      },
      { type: "tool_result", id: "toolu_1", result: "# Title", isError: false },
      { type: "token", text: "It is a readme." },
    ]);
  });

  it("keeps a tool_result string as it came, and flags failures", () => {
    const { events } = replay([
      INIT,
      assistant([{ type: "tool_use", id: "toolu_2", name: "Bash", input: { command: "false" } }]),
      {
        type: "user",
        session_id: "sess-1",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_2", content: "boom", is_error: true },
          ],
        },
      },
      SUCCESS,
    ]);

    expect(events[1]).toEqual({
      type: "tool_result",
      id: "toolu_2",
      result: "boom",
      isError: true,
    });
  });

  it("never emits the same tool call twice when a message is replayed", () => {
    const block = { type: "tool_use", id: "toolu_3", name: "Grep", input: { pattern: "x" } };
    const { events } = replay([INIT, assistant([block]), assistant([block]), SUCCESS]);
    expect(events.filter((e) => e.type === "tool_call")).toHaveLength(1);
  });

  it("reports an auth failure with the code the setup screen keys off", () => {
    const { events, finished } = replay([
      INIT,
      assistant([], { error: "authentication_failed" }),
      SUCCESS,
    ]);
    expect(events).toEqual([
      { type: "error", error: "authentication_failed", code: "auth" },
    ]);
    expect(finished).toBe("complete");
  });

  it("turns an error result into one error event", () => {
    const { events, finished } = replay([
      INIT,
      {
        type: "result",
        subtype: "error_during_execution",
        session_id: "sess-1",
        is_error: true,
        errors: ["the CLI crashed"],
      },
    ]);
    expect(events).toEqual([
      { type: "error", error: "the CLI crashed", code: "unknown" },
    ]);
    expect(finished).toBe("complete");
  });

  it("ignores the CLI's own bookkeeping frames", () => {
    const { events } = replay([
      INIT,
      { type: "status", session_id: "sess-1" },
      { type: "api_retry", session_id: "sess-1", error: "overloaded" },
      { type: "stream_event", session_id: "sess-1", event: { type: "message_start" } },
      {
        type: "stream_event",
        session_id: "sess-1",
        event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hm" } },
      },
      SUCCESS,
    ]);
    expect(events).toEqual([]);
  });

  it("keeps the last session id it saw as the resume token", () => {
    const { resumeToken } = replay([
      INIT,
      // A compaction or a fork restarts the CLI under a new session id.
      { type: "system", subtype: "init", session_id: "sess-2" },
      { type: "result", subtype: "success", session_id: "sess-2", is_error: false },
    ]);
    expect(resumeToken).toBe("sess-2");
  });
});

describe("classifyClaudeError", () => {
  it("recognises the SDK's auth error names", () => {
    expect(classifyClaudeError("authentication_failed", "")).toBe("auth");
    expect(classifyClaudeError("oauth_org_not_allowed", "")).toBe("auth");
    expect(classifyClaudeError("rate_limit", "slow down")).toBe("unknown");
  });

  it("recognises auth failures that only arrive as text", () => {
    expect(classifyClaudeError(undefined, "Invalid API key · Please run /login")).toBe("auth");
    expect(classifyClaudeError(undefined, "ENOENT: no such file")).toBe("unknown");
  });
});
