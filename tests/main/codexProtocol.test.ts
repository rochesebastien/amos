import { describe, expect, it } from "vitest";
import {
  classifyCodexMessage,
  createCodexMapper,
  decodeCodexResume,
  encodeCodexResume,
  extractCodexEvent,
} from "../../src/main/chat/codexProtocol.js";
import type { ChatEvent } from "../../src/shared/chat.js";

/**
 * Replay tests for the `codex app-server` wire format. The fixtures are
 * notification sequences as the app-server sends them; the assertions are the
 * chat events AMOS makes of them. No `codex` binary is involved — which is
 * also the only way this suite can run at all, since the CLI is not installed
 * in CI.
 */

/** Feed a list of raw JSON-RPC notifications through the mapper. */
function replay(frames: { method: string; params: unknown }[]): {
  events: ChatEvent[];
  finished: string | null;
  finalMessage: string | null;
} {
  const mapper = createCodexMapper();
  const events: ChatEvent[] = [];
  let finished: string | null = null;
  for (const frame of frames) {
    const event = extractCodexEvent(frame.method, frame.params);
    if (!event) continue;
    const result = mapper.map(event);
    events.push(...result.events);
    if (result.finished) {
      finished = result.finished;
      break;
    }
  }
  return { events, finished, finalMessage: mapper.finalMessage };
}

/** The nested shape: `codex/event` with the payload under `params.msg`. */
function nested(type: string, payload: Record<string, unknown> = {}) {
  return { method: "codex/event", params: { conversationId: "conv-1", msg: { type, ...payload } } };
}

/** The flat shape: `codex/event/<type>` with the payload in `params`. */
function flat(type: string, payload: Record<string, unknown> = {}) {
  return { method: `codex/event/${type}`, params: { conversationId: "conv-1", ...payload } };
}

describe("JSON-RPC framing", () => {
  it("tells responses, requests and notifications apart", () => {
    expect(classifyCodexMessage({ id: 1, result: { ok: true } })).toEqual({
      kind: "response",
      id: 1,
      result: { ok: true },
      error: undefined,
    });
    expect(classifyCodexMessage({ id: 2, method: "execCommandApproval", params: {} })).toMatchObject(
      { kind: "request", method: "execCommandApproval" },
    );
    expect(classifyCodexMessage({ method: "codex/event", params: {} })).toMatchObject({
      kind: "notification",
      method: "codex/event",
    });
    expect(classifyCodexMessage("nonsense")).toEqual({ kind: "unknown", raw: "nonsense" });
    expect(classifyCodexMessage(null)).toEqual({ kind: "unknown", raw: null });
  });
});

describe("event extraction", () => {
  it("accepts both notification shapes", () => {
    expect(extractCodexEvent("codex/event", { msg: { type: "task_started" } })).toMatchObject({
      type: "task_started",
    });
    expect(extractCodexEvent("codex/event/task_started", { conversationId: "c" })).toMatchObject({
      type: "task_started",
      conversationId: "c",
    });
  });

  it("returns null for anything else, so the driver can log and move on", () => {
    expect(extractCodexEvent("sessionConfigured", {})).toBeNull();
    expect(extractCodexEvent("codex/event", {})).toBeNull();
    expect(extractCodexEvent("codex/event", { msg: {} })).toBeNull();
  });
});

describe("codex transcript → chat events", () => {
  it("streams deltas and does not repeat them in the final message", () => {
    const { events, finished, finalMessage } = replay([
      nested("task_started"),
      nested("agent_message_delta", { delta: "Hel" }),
      nested("agent_message_delta", { delta: "lo" }),
      nested("agent_message", { message: "Hello" }),
      nested("token_count", { input_tokens: 12 }),
      nested("task_complete", { last_agent_message: "Hello" }),
    ]);

    expect(events).toEqual([
      { type: "token", text: "Hel" },
      { type: "token", text: "lo" },
    ]);
    expect(finished).toBe("complete");
    expect(finalMessage).toBe("Hello");
  });

  it("emits the whole message when the build sends no deltas", () => {
    const { events } = replay([
      nested("agent_message", { message: "Hello" }),
      nested("task_complete", { last_agent_message: "Hello" }),
    ]);
    expect(events).toEqual([{ type: "token", text: "Hello" }]);
  });

  it("emits the final message from task_complete alone", () => {
    const { events, finished } = replay([nested("task_complete", { last_agent_message: "ok" })]);
    expect(events).toEqual([{ type: "token", text: "ok" }]);
    expect(finished).toBe("complete");
  });

  it("maps an exec command to a tool call and its result", () => {
    const { events } = replay([
      flat("exec_command_begin", { call_id: "c1", command: ["ls", "-la"], cwd: "/repo" }),
      flat("exec_command_output_delta", { call_id: "c1", chunk: "…" }),
      flat("exec_command_end", { call_id: "c1", exit_code: 0, stdout: "a\nb", stderr: "" }),
      flat("task_complete", {}),
    ]);

    expect(events).toEqual([
      {
        type: "tool_call",
        id: "c1",
        name: "shell",
        arguments: { command: "ls -la", cwd: "/repo" },
      },
      {
        type: "tool_result",
        id: "c1",
        result: { exitCode: 0, stdout: "a\nb", stderr: "" },
        isError: false,
      },
    ]);
  });

  it("flags a non-zero exit as a failed tool result", () => {
    const { events } = replay([
      flat("exec_command_begin", { call_id: "c2", command: "false" }),
      flat("exec_command_end", { call_id: "c2", exit_code: 1, stderr: "nope" }),
      flat("task_complete", {}),
    ]);
    expect(events[1]).toMatchObject({ type: "tool_result", id: "c2", isError: true });
  });

  it("names an MCP tool call server.tool", () => {
    const { events } = replay([
      nested("mcp_tool_call_begin", {
        call_id: "m1",
        invocation: { server: "github", tool: "list_issues", arguments: { repo: "amos" } },
      }),
      nested("mcp_tool_call_end", { call_id: "m1", result: { content: [] } }),
      nested("task_complete", {}),
    ]);

    expect(events).toEqual([
      {
        type: "tool_call",
        id: "m1",
        name: "github.list_issues",
        arguments: { repo: "amos" },
      },
      { type: "tool_result", id: "m1", result: { content: [] }, isError: false },
    ]);
  });

  it("maps a patch application", () => {
    const { events } = replay([
      nested("patch_apply_begin", { call_id: "p1", changes: { "a.txt": "add" }, auto_approved: true }),
      nested("patch_apply_end", { call_id: "p1", success: false, stderr: "conflict" }),
      nested("task_complete", {}),
    ]);
    expect(events[0]).toMatchObject({ type: "tool_call", name: "apply_patch" });
    expect(events[1]).toMatchObject({ type: "tool_result", isError: true });
  });

  it("turns an error notification into an error event", () => {
    const { events } = replay([
      nested("error", { message: "not logged in — run codex login" }),
      nested("task_complete", {}),
    ]);
    expect(events[0]).toEqual({
      type: "error",
      error: "not logged in — run codex login",
      code: "auth",
    });
  });

  it("reports an interrupted turn as aborted", () => {
    const { events, finished } = replay([
      nested("agent_message_delta", { delta: "par" }),
      nested("turn_aborted", { reason: "interrupted" }),
    ]);
    expect(events).toEqual([{ type: "token", text: "par" }]);
    expect(finished).toBe("aborted");
  });

  it("ignores notifications it has never heard of", () => {
    const { events, finished } = replay([
      nested("some_future_event", { whatever: true }),
      flat("another_one", {}),
      nested("task_complete", {}),
    ]);
    expect(events).toEqual([]);
    expect(finished).toBe("complete");
  });
});

describe("resume tokens", () => {
  it("round-trips a conversation id and its rollout path", () => {
    const token = encodeCodexResume({ conversationId: "conv-1", rolloutPath: "/r/1.jsonl" });
    expect(decodeCodexResume(token)).toEqual({
      conversationId: "conv-1",
      rolloutPath: "/r/1.jsonl",
    });
  });

  it("reads an empty token, and an older bare-id token", () => {
    expect(decodeCodexResume(null)).toEqual({ conversationId: null, rolloutPath: null });
    expect(decodeCodexResume("conv-legacy")).toEqual({
      conversationId: "conv-legacy",
      rolloutPath: null,
    });
  });
});
