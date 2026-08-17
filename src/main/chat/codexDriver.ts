import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ChatEvent, ReasoningEffort } from "../../shared/chat.js";
import {
  classifyCodexMessage,
  createCodexMapper,
  decodeCodexResume,
  encodeCodexResume,
  extractCodexEvent,
  type CodexResume,
} from "./codexProtocol.js";
import type { ChatDriver, ChatDriverResult, ChatDriverSendInput } from "./types.js";

/**
 * The Codex backend: one long-lived `codex app-server` child speaking
 * newline-delimited JSON-RPC over stdio, shared by every turn of the app run.
 *
 * As with Claude, nothing here touches credentials: `codex` reads its own
 * `~/.codex/auth.json`, and the child inherits the environment unchanged.
 */

const REQUEST_TIMEOUT_MS = 30_000;
/** Anything the transport says goes through here, never to the transcript. */
type LogFn = (message: string) => void;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams;

/** A JSON-RPC error the server answered with, kept distinguishable. */
export class CodexRpcError extends Error {
  constructor(
    message: string,
    readonly code: number | undefined,
  ) {
    super(message);
    this.name = "CodexRpcError";
  }
}

/**
 * The transport half: framing, request/response correlation and process
 * lifetime. It knows nothing about what the messages mean.
 */
export class CodexAppServer {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private starting: Promise<void> | null = null;
  private exitReason: string | null = null;

  onNotification: (method: string, params: unknown) => void = () => {};
  /** Return a result to answer, or throw to answer with a JSON-RPC error. */
  onRequest: (method: string, params: unknown) => unknown = () => {
    throw new Error("unsupported");
  };

  constructor(
    private readonly options: {
      binaryPath: string;
      spawnFn?: SpawnFn;
      log?: LogFn;
    },
  ) {}

  private get log(): LogFn {
    return this.options.log ?? (() => {});
  }

  /** Spawn and initialise once; concurrent callers await the same promise. */
  async start(): Promise<void> {
    if (this.child && !this.child.killed) return;
    if (this.starting) return await this.starting;
    this.starting = this.doStart().finally(() => {
      this.starting = null;
    });
    return await this.starting;
  }

  private async doStart(): Promise<void> {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const spawnFn = this.options.spawnFn ?? defaultSpawn;

    const child = spawnFn(this.options.binaryPath, ["app-server"], { env });
    this.child = child;
    this.exitReason = null;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consume(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => this.log(`codex stderr: ${chunk.trimEnd()}`));
    child.on("error", (error: Error) => this.fail(`codex could not start: ${error.message}`));
    child.on("exit", (code, signal) =>
      this.fail(`codex app-server exited (code ${code ?? "null"}, signal ${signal ?? "null"})`),
    );

    await this.request("initialize", {
      clientInfo: { name: "amos", title: "AMOS", version: "0.1.0" },
    });
    this.notify("initialized", {});
  }

  /** Reject everything in flight and forget the child. */
  private fail(reason: string): void {
    this.exitReason = reason;
    this.log(reason);
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
    this.child = null;
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.handleLine(line);
      index = this.buffer.indexOf("\n");
    }
    // A single unterminated line must not grow without bound if the peer
    // starts emitting something that is not ndjson.
    if (this.buffer.length > 8_000_000) this.buffer = "";
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.log(`codex: ignoring non-JSON line (${line.slice(0, 120)})`);
      return;
    }

    const message = classifyCodexMessage(parsed);
    switch (message.kind) {
      case "response": {
        const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
        if (!pending) return;
        this.pending.delete(message.id as number);
        clearTimeout(pending.timer);
        if (message.error) {
          pending.reject(
            new CodexRpcError(message.error.message ?? "codex rpc error", message.error.code),
          );
        } else {
          pending.resolve(message.result);
        }
        return;
      }
      case "request": {
        let result: unknown;
        try {
          result = this.onRequest(message.method, message.params);
        } catch (error) {
          this.write({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: error instanceof Error ? error.message : "unsupported" },
          });
          return;
        }
        this.write({ jsonrpc: "2.0", id: message.id, result });
        return;
      }
      case "notification":
        try {
          this.onNotification(message.method, message.params);
        } catch (error) {
          // A mapping bug must never take the transport down with it.
          this.log(`codex: notification handler threw: ${String(error)}`);
        }
        return;
      default:
        this.log(`codex: unrecognised frame ${line.slice(0, 120)}`);
    }
  }

  private write(payload: unknown): void {
    const child = this.child;
    if (!child || child.killed) return;
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  async request<T = unknown>(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    if (!this.child && this.exitReason) throw new Error(this.exitReason);
    const id = this.nextId++;
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`codex did not answer ${method} within ${timeoutMs} ms`));
      }, timeoutMs);
      // `unref` keeps a pending timer from holding the process open on quit.
      timer.unref?.();
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  async dispose(): Promise<void> {
    const child = this.child;
    this.child = null;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("codex app-server stopped"));
    }
    this.pending.clear();
    if (!child || child.killed) return;
    child.stdin.end();
    child.kill();
  }
}

function defaultSpawn(
  command: string,
  args: string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv },
): ChildProcessWithoutNullStreams {
  return spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

// ------------------------------------------------------------------- driver

export type CodexDriverOptions = {
  binaryPath: string;
  spawnFn?: SpawnFn;
  log?: LogFn;
  model?: string | null;
};

export function createCodexDriver(options: CodexDriverOptions): ChatDriver {
  const server = new CodexAppServer({
    binaryPath: options.binaryPath,
    spawnFn: options.spawnFn,
    log: options.log,
  });
  /** Conversations this app-server instance created, so they can be reused. */
  const live = new Set<string>();
  const listening = new Set<string>();
  let active: {
    conversationId: string;
    onEvent: (event: ChatEvent) => void;
    finish: (outcome: "complete" | "aborted") => void;
    mapper: ReturnType<typeof createCodexMapper>;
  } | null = null;

  server.onNotification = (method, params) => {
    const event = extractCodexEvent(method, params);
    if (!event) {
      options.log?.(`codex: unhandled notification ${method}`);
      return;
    }
    const turn = active;
    if (!turn) return;
    if (event.conversationId && event.conversationId !== turn.conversationId) return;
    const result = turn.mapper.map(event);
    for (const chatEvent of result.events) turn.onEvent(chatEvent);
    if (result.finished) turn.finish(result.finished);
  };

  // Approvals arrive as server→client requests. AMOS has no approval UI yet,
  // so it answers "no" rather than silently granting a sandbox escape; Codex
  // then finds another way or reports that it could not.
  server.onRequest = (method, params) => {
    if (/approval/i.test(method)) {
      options.log?.(`codex: denied approval request ${method} ${JSON.stringify(params ?? {})}`);
      return { decision: "denied" };
    }
    throw new Error(`unsupported request ${method}`);
  };

  async function openConversation(cwd: string, resume: CodexResume): Promise<CodexResume> {
    if (resume.conversationId && live.has(resume.conversationId)) return resume;

    if (resume.rolloutPath) {
      try {
        const result = (await server.request("resumeConversation", {
          path: resume.rolloutPath,
          overrides: { cwd },
        })) as Record<string, unknown>;
        const conversationId = readConversationId(result);
        if (conversationId) {
          live.add(conversationId);
          return { conversationId, rolloutPath: resume.rolloutPath };
        }
      } catch (error) {
        options.log?.(`codex: could not resume, starting a new conversation (${String(error)})`);
      }
    }

    const created = (await server.request("newConversation", { cwd })) as Record<string, unknown>;
    const conversationId = readConversationId(created);
    if (!conversationId) throw new Error("codex newConversation returned no conversation id");
    live.add(conversationId);
    return {
      conversationId,
      rolloutPath:
        typeof created.rolloutPath === "string"
          ? created.rolloutPath
          : typeof created.rollout_path === "string"
            ? (created.rollout_path as string)
            : null,
    };
  }

  async function startTurn(
    conversationId: string,
    cwd: string,
    prompt: string,
    turn: { model?: string | null; effort?: ReasoningEffort | null } = {},
  ): Promise<void> {
    const model = turn.model || options.model;
    const params: Record<string, unknown> = {
      conversationId,
      items: [{ type: "text", text: prompt }],
      cwd,
      approvalPolicy: "on-request",
      sandboxPolicy: { mode: "workspace-write" },
      summary: "auto",
      ...(model ? { model } : {}),
      ...(turn.effort ? { effort: turn.effort } : {}),
    };
    try {
      await server.request("sendUserTurn", params);
    } catch (error) {
      if (!(error instanceof CodexRpcError)) throw error;
      // Older app-servers only know `sendUserMessage`, which takes no policy.
      options.log?.(`codex: sendUserTurn refused (${error.message}), falling back`);
      await server.request("sendUserMessage", {
        conversationId,
        items: [{ type: "text", text: prompt }],
      });
    }
  }

  return {
    backend: "codex",

    async send(input: ChatDriverSendInput): Promise<ChatDriverResult> {
      let resume = decodeCodexResume(input.resumeToken);
      const mapper = createCodexMapper();

      try {
        await server.start();
        resume = await openConversation(input.cwd, resume);
      } catch (error) {
        input.onEvent(toErrorEvent(error));
        return { resumeToken: input.resumeToken, aborted: false };
      }

      const conversationId = resume.conversationId!;
      if (!listening.has(conversationId)) {
        try {
          await server.request("addConversationListener", { conversationId });
          listening.add(conversationId);
        } catch (error) {
          // Some builds stream events without an explicit subscription.
          options.log?.(`codex: addConversationListener failed (${String(error)})`);
        }
      }

      const outcome = await new Promise<"complete" | "aborted">((resolve) => {
        let settled = false;
        const finish = (value: "complete" | "aborted") => {
          if (settled) return;
          settled = true;
          input.signal.removeEventListener("abort", onAbort);
          active = null;
          resolve(value);
        };
        const onAbort = () => {
          server.notify("interruptConversation", { conversationId });
          // Codex answers with `turn_aborted`; if it does not, do not hang.
          setTimeout(() => finish("aborted"), 1_500).unref?.();
        };

        active = { conversationId, onEvent: input.onEvent, finish, mapper };
        input.signal.addEventListener("abort", onAbort, { once: true });
        if (input.signal.aborted) {
          onAbort();
          return;
        }

        void startTurn(conversationId, input.cwd, input.prompt, {
          model: input.model,
          effort: input.effort,
        }).catch((error) => {
          input.onEvent(toErrorEvent(error));
          finish("complete");
        });
      });

      return { resumeToken: encodeCodexResume(resume), aborted: outcome === "aborted" };
    },

    async dispose(): Promise<void> {
      active = null;
      await server.dispose();
    },
  };
}

function readConversationId(result: Record<string, unknown> | null | undefined): string | null {
  if (!result) return null;
  const value = result.conversationId ?? result.conversation_id;
  return typeof value === "string" && value ? value : null;
}

function toErrorEvent(error: unknown): ChatEvent {
  const message = error instanceof Error ? error.message : String(error);
  const missing = /ENOENT|could not start|not found/i.test(message);
  const auth = /auth|login|unauthor/i.test(message);
  return {
    type: "error",
    error: message,
    code: missing ? "cli_missing" : auth ? "auth" : "protocol",
  };
}
