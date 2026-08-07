import {
  isCliVendor,
  type ChatBackend,
  type ChatErrorCode,
  type ChatEvent,
  type ChatEventMessage,
  type ChatToolCall,
  type CliDetection,
  type CliVendor,
} from "../../shared/chat.js";
import type { Db } from "../db/index.js";
import {
  appendMessage,
  createSession,
  getSession,
  setBackend,
  setResumeToken,
  setTitle,
  titleFromPrompt,
  updateMessage,
} from "../services/sessions.js";
import { createClaudeDriver } from "./claudeDriver.js";
import { createCodexDriver } from "./codexDriver.js";
import { createEchoDriver } from "./echoDriver.js";
import type { ChatDriver } from "./types.js";

/**
 * The chat manager: one turn at a time per session, a driver per backend, and
 * the database kept in step with what the renderer is watching stream past.
 *
 * It owns the two events a driver never emits — `start` and `done` — so every
 * backend brackets a turn identically, and it owns the abort registry, so a
 * window that goes away cannot leave a CLI running.
 */

export type ChatSendInput = {
  projectId: string;
  /** Continue this session, or omit to open a new one. */
  sessionId?: string | null;
  backend: ChatBackend;
  prompt: string;
};

export type ChatManagerOptions = {
  /** Fan a chat event out to the windows. */
  emit: (message: ChatEventMessage) => void;
  /** Absolute path of a known project, or `null` when it is gone. */
  resolveProjectPath: (projectId: string) => string | null;
  /** Build the driver for a backend. Injected so tests need no CLI. */
  createDriver: (backend: ChatBackend) => Promise<ChatDriver>;
  /**
   * What a driver for this backend would be built from — the binary path, in
   * practice. A cached driver whose key no longer matches is disposed and
   * rebuilt, which is how a Settings path change takes effect without a
   * restart. Omitted (in tests), drivers are cached for the manager's life.
   */
  driverKey?: (backend: ChatBackend) => Promise<string>;
  /** Database handle; defaults to the process-wide one at call time. */
  db?: Db;
  onAuthFailure?: (vendor: CliVendor) => void;
  onAuthSuccess?: (vendor: CliVendor) => void;
};

type Run = {
  controller: AbortController;
  messageId: string;
};

/** A driver construction failure that already knows how to classify itself. */
export class ChatDriverError extends Error {
  constructor(
    message: string,
    readonly code: ChatErrorCode,
  ) {
    super(message);
    this.name = "ChatDriverError";
  }
}

function errorCodeOf(failure: unknown): ChatErrorCode {
  return failure instanceof ChatDriverError ? failure.code : "unknown";
}

export class ChatManager {
  private readonly runs = new Map<string, Run>();
  private readonly drivers = new Map<ChatBackend, { driver: ChatDriver; key: string }>();

  constructor(private readonly options: ChatManagerOptions) {}

  /**
   * `undefined` is a legitimate value here: every session service takes the
   * database as an optional last argument and falls back to the process-wide
   * handle, which is what the app uses and what the tests replace.
   */
  private get db(): Db {
    return this.options.db as Db;
  }

  /** `true` while a turn of this session is streaming. */
  isRunning(sessionId: string): boolean {
    return this.runs.has(sessionId);
  }

  /**
   * Start a turn. Resolves as soon as the session exists and the run is under
   * way — everything the user sees arrives on the `chat:event` push, so the
   * renderer never waits on a model.
   */
  async send(input: ChatSendInput): Promise<{ sessionId: string }> {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("A prompt is required.");

    const cwd = this.options.resolveProjectPath(input.projectId);
    if (!cwd) throw new Error(`Unknown project: ${input.projectId}`);

    let session = input.sessionId ? this.session(input.sessionId) : null;
    if (input.sessionId && !session) throw new Error(`Unknown chat session: ${input.sessionId}`);
    if (session && session.projectId !== input.projectId) {
      throw new Error("This chat session belongs to another project.");
    }
    if (!session) {
      session = createSession({ projectId: input.projectId, backend: input.backend }, this.db);
    }
    if (this.runs.has(session.id)) {
      throw new Error("This chat is already answering — stop it before sending again.");
    }

    // Switching backend mid-conversation: the other CLI cannot continue the
    // first one's session, so the resume token goes with it.
    if (session.backend !== input.backend) {
      setBackend(session.id, input.backend, this.db);
      session = { ...session, backend: input.backend, resumeToken: null };
    }
    if (!session.title) {
      const title = titleFromPrompt(prompt);
      setTitle(session.id, title, this.db);
      session = { ...session, title };
    }

    appendMessage({ sessionId: session.id, role: "user", content: prompt }, this.db);
    const assistant = appendMessage({ sessionId: session.id, role: "assistant" }, this.db);

    const controller = new AbortController();
    this.runs.set(session.id, { controller, messageId: assistant.id });

    this.emit(session.id, input.projectId, {
      type: "start",
      sessionId: session.id,
      backend: input.backend,
      messageId: assistant.id,
    });

    void this.run({
      sessionId: session.id,
      projectId: input.projectId,
      backend: input.backend,
      cwd,
      prompt,
      resumeToken: session.resumeToken,
      assistantMessageId: assistant.id,
      controller,
    });

    return { sessionId: session.id };
  }

  /** Stop the turn of a session. Silent when nothing is running. */
  abort(sessionId: string): { ok: true } {
    this.runs.get(sessionId)?.controller.abort();
    return { ok: true };
  }

  /** Stop everything and let the drivers close their child processes. */
  async dispose(): Promise<void> {
    for (const run of this.runs.values()) run.controller.abort();
    this.runs.clear();
    const drivers = [...this.drivers.values()];
    this.drivers.clear();
    await Promise.all(drivers.map(({ driver }) => driver.dispose().catch(() => undefined)));
  }

  // ------------------------------------------------------------------ private

  private session(id: string) {
    return getSession(id, this.db);
  }

  private emit(sessionId: string, projectId: string, event: ChatEvent): void {
    this.options.emit({ sessionId, projectId, event });
  }

  private async driverFor(backend: ChatBackend): Promise<ChatDriver> {
    const key = (await this.options.driverKey?.(backend)) ?? "static";
    const existing = this.drivers.get(backend);
    if (existing?.key === key) return existing.driver;
    // The binary this backend resolves to has changed (or the driver has never
    // been built). Only the codex driver owns a child process, and rebuilding
    // it is safe: the resume token is persisted per session, so a fresh
    // app-server picks the conversation back up.
    if (existing) {
      this.drivers.delete(backend);
      await existing.driver.dispose().catch(() => undefined);
    }
    const driver = await this.options.createDriver(backend);
    this.drivers.set(backend, { driver, key });
    return driver;
  }

  private async run(context: {
    sessionId: string;
    projectId: string;
    backend: ChatBackend;
    cwd: string;
    prompt: string;
    resumeToken: string | null;
    assistantMessageId: string;
    controller: AbortController;
  }): Promise<void> {
    let content = "";
    const toolCalls: ChatToolCall[] = [];
    const toolIndex = new Map<string, number>();
    let error: string | null = null;
    let sawAuthError = false;

    const onEvent = (event: ChatEvent) => {
      switch (event.type) {
        case "token":
          content += event.text;
          break;
        case "tool_call":
          toolIndex.set(event.id, toolCalls.length);
          toolCalls.push({ id: event.id, name: event.name, arguments: event.arguments });
          break;
        case "tool_result": {
          const index = toolIndex.get(event.id);
          if (index === undefined) {
            toolCalls.push({
              id: event.id,
              name: "tool",
              result: event.result,
              isError: event.isError,
            });
          } else {
            toolCalls[index] = {
              ...toolCalls[index]!,
              result: event.result,
              isError: event.isError,
            };
          }
          break;
        }
        case "error":
          error = error ? `${error}\n${event.error}` : event.error;
          if (event.code === "auth") sawAuthError = true;
          break;
        default:
          break;
      }
      this.emit(context.sessionId, context.projectId, event);
    };

    let aborted = false;
    try {
      const driver = await this.driverFor(context.backend);
      const result = await driver.send({
        cwd: context.cwd,
        prompt: context.prompt,
        resumeToken: context.resumeToken,
        onEvent,
        signal: context.controller.signal,
      });
      aborted = result.aborted;
      if (result.resumeToken) setResumeToken(context.sessionId, result.resumeToken, this.db);
    } catch (failure) {
      onEvent({
        type: "error",
        error: failure instanceof Error ? failure.message : String(failure),
        code: errorCodeOf(failure),
      });
    } finally {
      if (context.controller.signal.aborted) aborted = true;

      updateMessage(
        context.assistantMessageId,
        { content, toolCalls, error },
        this.db,
      );
      this.runs.delete(context.sessionId);

      // The Claude CLI has no file to inspect, so "is it logged in" is decided
      // here: a turn that produced anything proves it is, an auth error proves
      // it is not, and the setup screen follows.
      if (isCliVendor(context.backend)) {
        if (sawAuthError) this.options.onAuthFailure?.(context.backend);
        else if (content || toolCalls.length > 0) this.options.onAuthSuccess?.(context.backend);
      }

      this.emit(context.sessionId, context.projectId, { type: "done", aborted });
    }
  }
}

// -------------------------------------------------------------- driver wiring

export type DriverFactoryDeps = {
  /** The detection the app last ran, refreshed if it has never run. */
  detection: () => Promise<CliDetection>;
  log?: (message: string) => void;
};

/**
 * The production factory: pick the binary detection found, and refuse a
 * backend that is not ready with a message the setup screen can show.
 */
export function createDriverFactory(deps: DriverFactoryDeps) {
  return async (backend: ChatBackend): Promise<ChatDriver> => {
    if (backend === "echo") {
      const detection = await deps.detection();
      if (!detection.echoEnabled) {
        throw new ChatDriverError(
          "The echo driver is switched off in Settings → Backends.",
          "cli_missing",
        );
      }
      return createEchoDriver();
    }

    const detection = await deps.detection();
    const status = detection.clis[backend];
    if (!status.installed || !status.path) {
      throw new ChatDriverError(
        `The ${backend} CLI was not found. Install it, or set its path in Settings → Backends.`,
        "cli_missing",
      );
    }
    if (backend === "claude") return createClaudeDriver({ binaryPath: status.path });
    return createCodexDriver({ binaryPath: status.path, log: deps.log });
  };
}

/**
 * The companion key: everything `createDriverFactory` bakes into a driver
 * instance. When the key a driver was cached under stops matching, the manager
 * rebuilds it — so a new binary path set in Settings takes effect on the very
 * next turn instead of the next launch.
 */
export function createDriverKey(deps: DriverFactoryDeps) {
  return async (backend: ChatBackend): Promise<string> => {
    const detection = await deps.detection();
    if (backend === "echo") return `echo:${detection.echoEnabled ? "on" : "off"}`;
    return `${backend}:${detection.clis[backend].path ?? "missing"}`;
  };
}
