import type { ChatDriver, ChatDriverResult, ChatDriverSendInput } from "./types.js";

/**
 * A hidden development driver: it streams the prompt back, word by word, with
 * no CLI, no network and no credentials. It exists so the whole streaming path
 * — manager, persistence, IPC push, the renderer's reducer — can be exercised
 * on a machine where neither vendor CLI is installed, and so the integration
 * test of that path needs nothing but Node.
 *
 * Enabled from Settings → Backends, or with `AMOS_ECHO_DRIVER=1`.
 */

/** Milliseconds between chunks — small enough to feel live, cheap in tests. */
const DEFAULT_DELAY_MS = 12;

export type EchoDriverOptions = {
  delayMs?: number;
};

export function createEchoDriver(options: EchoDriverOptions = {}): ChatDriver {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  let turn = 0;

  return {
    backend: "echo",

    async send(input: ChatDriverSendInput): Promise<ChatDriverResult> {
      turn += 1;
      const resumeToken = input.resumeToken ?? `echo-${Date.now().toString(36)}`;

      if (input.signal.aborted) return { resumeToken, aborted: true };

      // A prompt starting with `/tool` exercises the tool rows of the
      // transcript without a real tool anywhere.
      if (input.prompt.startsWith("/tool")) {
        const id = `echo-tool-${turn}`;
        input.onEvent({
          type: "tool_call",
          id,
          name: "echo",
          arguments: { prompt: input.prompt, cwd: input.cwd },
        });
        await sleep(delayMs);
        input.onEvent({ type: "tool_result", id, result: { ok: true, cwd: input.cwd } });
      }

      // A prompt starting with `/error` proves the error path end to end.
      if (input.prompt.startsWith("/error")) {
        input.onEvent({
          type: "error",
          error: input.prompt.slice("/error".length).trim() || "Echo driver error.",
          code: "unknown",
        });
        return { resumeToken, aborted: false };
      }

      // `split` with a capturing group keeps the whitespace, so the echoed
      // text is byte-identical to the prompt once the chunks are joined.
      const chunks = input.prompt.split(/(\s+)/).filter((chunk) => chunk.length > 0);
      for (const chunk of chunks) {
        if (input.signal.aborted) return { resumeToken, aborted: true };
        input.onEvent({ type: "token", text: chunk });
        if (delayMs > 0) await sleep(delayMs);
      }

      return { resumeToken, aborted: input.signal.aborted };
    },

    async dispose(): Promise<void> {},
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
