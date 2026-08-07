// Live state of the turn each session is streaming right now.
//
// The transcript itself lives in SQLite and is read through `chat:getSession`.
// This store holds only what has arrived since the last write — one entry per
// session, replaced at every `start`. It is filled by a single subscription
// mounted in the app shell, so events keep landing while the user is on
// another route and nothing is lost between "send" and "navigate".
import { create } from "zustand";
import type { ChatBackend, ChatEventMessage } from "@shared/chat";

export type StreamTool = {
  id: string;
  name: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
};

export type StreamState = {
  /** `true` between `start` and `done`. */
  streaming: boolean;
  backend: ChatBackend;
  /** Id of the assistant message this turn is filling in. */
  messageId: string;
  content: string;
  tools: StreamTool[];
  error: string | null;
  aborted: boolean;
};

type ChatStreamStore = {
  streams: Record<string, StreamState>;
  apply: (message: ChatEventMessage) => void;
  /** Forget a session's stream — on delete, not on done. */
  clear: (sessionId: string) => void;
};

export const useChatStreams = create<ChatStreamStore>((set) => ({
  streams: {},

  apply: ({ sessionId, event }) =>
    set((state) => {
      if (event.type === "start") {
        return {
          streams: {
            ...state.streams,
            [sessionId]: {
              streaming: true,
              backend: event.backend,
              messageId: event.messageId,
              content: "",
              tools: [],
              error: null,
              aborted: false,
            },
          },
        };
      }

      const current = state.streams[sessionId];
      // Events for a turn this window never saw start (another window, or a
      // reload mid-turn) have nothing to attach to.
      if (!current) return state;

      let next: StreamState;
      switch (event.type) {
        case "token":
          next = { ...current, content: current.content + event.text };
          break;
        case "tool_call":
          next = {
            ...current,
            tools: [...current.tools, { id: event.id, name: event.name, args: event.arguments }],
          };
          break;
        case "tool_result": {
          const index = current.tools.findIndex((tool) => tool.id === event.id);
          const tools = [...current.tools];
          if (index === -1) {
            tools.push({ id: event.id, name: "tool", result: event.result, isError: event.isError });
          } else {
            tools[index] = { ...tools[index]!, result: event.result, isError: event.isError };
          }
          next = { ...current, tools };
          break;
        }
        case "error":
          next = {
            ...current,
            error: current.error ? `${current.error}\n${event.error}` : event.error,
          };
          break;
        case "done":
          next = { ...current, streaming: false, aborted: event.aborted };
          break;
        default:
          return state;
      }
      return { streams: { ...state.streams, [sessionId]: next } };
    }),

  clear: (sessionId) =>
    set((state) => {
      if (!(sessionId in state.streams)) return state;
      const streams = { ...state.streams };
      delete streams[sessionId];
      return { streams };
    }),
}));

/** The live turn of one session, or `undefined` when it is idle. */
export function useChatStream(sessionId: string | null | undefined): StreamState | undefined {
  return useChatStreams((state) => (sessionId ? state.streams[sessionId] : undefined));
}
