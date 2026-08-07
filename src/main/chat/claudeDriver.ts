import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ChatEvent } from "../../shared/chat.js";
import { classifyClaudeError, createClaudeMapper, type ClaudeStreamMessage } from "./claudeEvents.js";
import type { ChatDriver, ChatDriverResult, ChatDriverSendInput } from "./types.js";

/**
 * The Claude backend: `query()` from `@anthropic-ai/claude-agent-sdk`, pointed
 * at the `claude` binary the user already installed.
 *
 * Two rules make the subscription inheritance work, and both are load-bearing:
 * AMOS never sets `ANTHROPIC_API_KEY` (that would switch the CLI from the
 * user's Pro/Max plan to metered API billing), and AMOS never rewrites `HOME`
 * (that is where the CLI keeps the credentials it already has). The child
 * therefore inherits `process.env` untouched, minus the one Electron variable
 * that would make a Node-based CLI misbehave.
 */

/** `ELECTRON_RUN_AS_NODE` leaks into children and confuses Node-based CLIs. */
function childEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

export type ClaudeDriverOptions = {
  /** Absolute path of the `claude` binary, from detection or the settings. */
  binaryPath: string | null;
  /** Model id to pass through, or `null` for the CLI's own default. */
  model?: string | null;
};

export function createClaudeDriver(options: ClaudeDriverOptions): ChatDriver {
  return {
    backend: "claude",

    async send(input: ChatDriverSendInput): Promise<ChatDriverResult> {
      const mapper = createClaudeMapper();
      const abortController = new AbortController();
      const forwardAbort = () => abortController.abort();
      if (input.signal.aborted) forwardAbort();
      input.signal.addEventListener("abort", forwardAbort, { once: true });

      const sdkOptions: Options = {
        cwd: input.cwd,
        abortController,
        includePartialMessages: true,
        env: childEnv(),
        // The project's own CLAUDE.md, agents, skills and MCP servers are the
        // whole point of AMOS: load every settings source, like the CLI does.
        settingSources: ["user", "project", "local"],
        ...(options.binaryPath ? { pathToClaudeCodeExecutable: options.binaryPath } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(input.resumeToken ? { resume: input.resumeToken } : {}),
      };

      let aborted = false;
      try {
        const stream = query({ prompt: input.prompt, options: sdkOptions });
        for await (const message of stream as AsyncIterable<SDKMessage>) {
          const result = mapper.map(message as unknown as ClaudeStreamMessage);
          for (const event of result.events) input.onEvent(event);
          if (result.finished) break;
        }
      } catch (error) {
        if (input.signal.aborted || isAbortError(error)) {
          aborted = true;
        } else {
          input.onEvent(toErrorEvent(error));
        }
      } finally {
        input.signal.removeEventListener("abort", forwardAbort);
      }

      return { resumeToken: mapper.resumeToken, aborted };
    },

    async dispose(): Promise<void> {
      // `query()` owns its subprocess and tears it down when the turn ends.
    },
  };
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === "AbortError" || /abort/i.test(error.message))
  );
}

/**
 * A thrown SDK failure — the binary is missing, the CLI died at startup, the
 * user is not logged in — always reaches the transcript as one clean `error`
 * event rather than as an unhandled rejection in the main process.
 */
function toErrorEvent(error: unknown): ChatEvent {
  const message = error instanceof Error ? error.message : String(error);
  const missing = /ENOENT|not found|failed to launch|is options\.pathToClaudeCodeExecutable/i.test(
    message,
  );
  return {
    type: "error",
    error: message,
    code: missing ? "cli_missing" : classifyClaudeError(undefined, message),
  };
}
