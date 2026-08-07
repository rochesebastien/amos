import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, openDatabase, type Db } from "../../src/main/db/index.js";
import { addProject } from "../../src/main/services/projects.js";
import {
  createSession,
  deleteSession,
  getSessionDetail,
  listSessions,
  titleFromPrompt,
} from "../../src/main/services/sessions.js";
import { ChatManager } from "../../src/main/chat/manager.js";
import { createEchoDriver } from "../../src/main/chat/echoDriver.js";
import type { ChatDriver } from "../../src/main/chat/types.js";
import type { ChatEventMessage } from "../../src/shared/chat.js";
import type { Project } from "../../src/shared/ipc.js";

/**
 * The full streaming path — manager, drivers, persistence, event fan-out —
 * exercised through the echo driver, which needs no CLI and no Electron.
 */

let dir: string;
let db: Db;
let project: Project;
let events: ChatEventMessage[];

function makeManager(driver: ChatDriver = createEchoDriver({ delayMs: 0 })) {
  return new ChatManager({
    db,
    emit: (message) => events.push(message),
    resolveProjectPath: (id) => (id === project.id ? project.path : null),
    createDriver: async () => driver,
  });
}

/** Wait until the turn of a session has emitted its `done`. */
async function settled(sessionId: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (events.some((e) => e.sessionId === sessionId && e.event.type === "done")) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("the turn never finished");
}

function textOf(sessionId: string): string {
  return events
    .filter((e) => e.sessionId === sessionId && e.event.type === "token")
    .map((e) => (e.event.type === "token" ? e.event.text : ""))
    .join("");
}

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amos-chat-")));
  db = openDatabase(path.join(dir, "amos.db"));
  fs.mkdirSync(path.join(dir, "project"));
  project = addProject({ path: path.join(dir, "project") }, db);
  events = [];
});

afterEach(() => {
  db.close();
  closeDatabase();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("chat manager · echo driver", () => {
  it("brackets a turn with start and done and streams the prompt back", async () => {
    const manager = makeManager();
    const { sessionId } = await manager.send({
      projectId: project.id,
      backend: "echo",
      prompt: "hello brave new world",
    });
    await settled(sessionId);

    const kinds = events.map((e) => e.event.type);
    expect(kinds[0]).toBe("start");
    expect(kinds[kinds.length - 1]).toBe("done");
    expect(textOf(sessionId)).toBe("hello brave new world");
    expect(events.every((e) => e.projectId === project.id)).toBe(true);
    await manager.dispose();
  });

  it("persists both messages, the title and the resume token", async () => {
    const manager = makeManager();
    const { sessionId } = await manager.send({
      projectId: project.id,
      backend: "echo",
      prompt: "remember me",
    });
    await settled(sessionId);

    const detail = getSessionDetail(sessionId, db)!;
    expect(detail.session.title).toBe("remember me");
    expect(detail.session.backend).toBe("echo");
    expect(detail.session.resumeToken).toMatch(/^echo-/);
    expect(detail.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "remember me"],
      ["assistant", "remember me"],
    ]);
    await manager.dispose();
  });

  it("continues an existing session instead of opening a new one", async () => {
    const manager = makeManager();
    const first = await manager.send({ projectId: project.id, backend: "echo", prompt: "one" });
    await settled(first.sessionId);
    const second = await manager.send({
      projectId: project.id,
      sessionId: first.sessionId,
      backend: "echo",
      prompt: "two",
    });
    expect(second.sessionId).toBe(first.sessionId);
    await settled(second.sessionId);

    const detail = getSessionDetail(first.sessionId, db)!;
    expect(detail.messages).toHaveLength(4);
    // The title still comes from the first prompt.
    expect(detail.session.title).toBe("one");
    expect(listSessions(project.id, db)).toHaveLength(1);
    await manager.dispose();
  });

  it("records tool calls with their results", async () => {
    const manager = makeManager();
    const { sessionId } = await manager.send({
      projectId: project.id,
      backend: "echo",
      prompt: "/tool please",
    });
    await settled(sessionId);

    const detail = getSessionDetail(sessionId, db)!;
    const assistant = detail.messages[1]!;
    expect(assistant.toolCalls).toHaveLength(1);
    expect(assistant.toolCalls[0]).toMatchObject({ name: "echo" });
    expect(assistant.toolCalls[0]!.result).toEqual({ ok: true, cwd: project.path });
    await manager.dispose();
  });

  it("stores an error on the assistant message and still emits done", async () => {
    const manager = makeManager();
    const { sessionId } = await manager.send({
      projectId: project.id,
      backend: "echo",
      prompt: "/error nope",
    });
    await settled(sessionId);

    expect(events.some((e) => e.event.type === "error")).toBe(true);
    expect(getSessionDetail(sessionId, db)!.messages[1]!.error).toBe("nope");
    await manager.dispose();
  });

  it("turns a driver that cannot start into one error event, not a crash", async () => {
    const manager = new ChatManager({
      db,
      emit: (message) => events.push(message),
      resolveProjectPath: () => project.path,
      createDriver: async () => {
        throw new Error("The codex CLI was not found.");
      },
    });
    const { sessionId } = await manager.send({
      projectId: project.id,
      backend: "codex",
      prompt: "hi",
    });
    await settled(sessionId);

    const errors = events.filter((e) => e.event.type === "error");
    expect(errors).toHaveLength(1);
    expect(getSessionDetail(sessionId, db)!.messages[1]!.error).toMatch(/was not found/);
    await manager.dispose();
  });

  it("stops a turn when it is aborted", async () => {
    const manager = makeManager(createEchoDriver({ delayMs: 8 }));
    const { sessionId } = await manager.send({
      projectId: project.id,
      backend: "echo",
      prompt: "one two three four five six seven eight nine ten",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    manager.abort(sessionId);
    await settled(sessionId);

    const done = events.find((e) => e.event.type === "done")!;
    expect(done.event).toEqual({ type: "done", aborted: true });
    expect(textOf(sessionId).length).toBeLessThan("one two three four five six seven eight nine ten".length);
    await manager.dispose();
  });

  it("refuses a second turn while one is running", async () => {
    const manager = makeManager(createEchoDriver({ delayMs: 5 }));
    const { sessionId } = await manager.send({
      projectId: project.id,
      backend: "echo",
      prompt: "a b c d e f",
    });
    await expect(
      manager.send({ projectId: project.id, sessionId, backend: "echo", prompt: "again" }),
    ).rejects.toThrow(/already answering/);
    await settled(sessionId);
    await manager.dispose();
  });

  it("refuses an unknown project, an unknown session and an empty prompt", async () => {
    const manager = makeManager();
    await expect(manager.send({ projectId: "ghost", backend: "echo", prompt: "x" })).rejects.toThrow(
      /Unknown project/,
    );
    await expect(
      manager.send({ projectId: project.id, sessionId: "ghost", backend: "echo", prompt: "x" }),
    ).rejects.toThrow(/Unknown chat session/);
    await expect(
      manager.send({ projectId: project.id, backend: "echo", prompt: "   " }),
    ).rejects.toThrow(/prompt is required/);
    await manager.dispose();
  });

  it("drops the resume token when the session changes backend", async () => {
    const manager = makeManager();
    const { sessionId } = await manager.send({
      projectId: project.id,
      backend: "echo",
      prompt: "one",
    });
    await settled(sessionId);
    expect(getSessionDetail(sessionId, db)!.session.resumeToken).not.toBeNull();

    // The second driver records the token it was handed.
    let handed: string | null | undefined;
    const spy: ChatDriver = {
      backend: "claude",
      async send(input) {
        handed = input.resumeToken;
        input.onEvent({ type: "token", text: "ok" });
        return { resumeToken: "claude-1", aborted: false };
      },
      async dispose() {},
    };
    const second = new ChatManager({
      db,
      emit: (message) => events.push(message),
      resolveProjectPath: () => project.path,
      createDriver: async () => spy,
    });
    await second.send({ projectId: project.id, sessionId, backend: "claude", prompt: "two" });
    await settled(sessionId);

    expect(handed).toBeNull();
    expect(getSessionDetail(sessionId, db)!.session.backend).toBe("claude");
    await manager.dispose();
    await second.dispose();
  });

  it("concludes that a CLI is logged in from a turn that produced text", async () => {
    const failures: string[] = [];
    const successes: string[] = [];
    const driver: ChatDriver = {
      backend: "claude",
      async send(input) {
        input.onEvent({ type: "token", text: "hi" });
        return { resumeToken: "s1", aborted: false };
      },
      async dispose() {},
    };
    const manager = new ChatManager({
      db,
      emit: (message) => events.push(message),
      resolveProjectPath: () => project.path,
      createDriver: async () => driver,
      onAuthFailure: (vendor) => failures.push(vendor),
      onAuthSuccess: (vendor) => successes.push(vendor),
    });
    const { sessionId } = await manager.send({
      projectId: project.id,
      backend: "claude",
      prompt: "hi",
    });
    await settled(sessionId);
    expect(successes).toEqual(["claude"]);
    expect(failures).toEqual([]);
    await manager.dispose();
  });

  it("concludes that a CLI is not logged in from an auth error", async () => {
    const failures: string[] = [];
    const driver: ChatDriver = {
      backend: "claude",
      async send(input) {
        input.onEvent({ type: "error", error: "Please run /login", code: "auth" });
        return { resumeToken: null, aborted: false };
      },
      async dispose() {},
    };
    const manager = new ChatManager({
      db,
      emit: (message) => events.push(message),
      resolveProjectPath: () => project.path,
      createDriver: async () => driver,
      onAuthFailure: (vendor) => failures.push(vendor),
    });
    const { sessionId } = await manager.send({
      projectId: project.id,
      backend: "claude",
      prompt: "hi",
    });
    await settled(sessionId);
    expect(failures).toEqual(["claude"]);
    await manager.dispose();
  });
});

describe("sessions service", () => {
  it("lists a project's sessions, most recently used first", async () => {
    const first = createSession({ projectId: project.id, backend: "echo", title: "a" }, db);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = createSession({ projectId: project.id, backend: "claude", title: "b" }, db);
    expect(listSessions(project.id, db).map((s) => s.id)).toEqual([second.id, first.id]);
  });

  it("deletes a session together with its messages", async () => {
    const manager = makeManager();
    const { sessionId } = await manager.send({
      projectId: project.id,
      backend: "echo",
      prompt: "bye",
    });
    await settled(sessionId);
    expect(deleteSession(sessionId, db)).toEqual({ ok: true });
    expect(getSessionDetail(sessionId, db)).toBeNull();
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM chat_messages").get() as { n: number },
    ).toEqual({ n: 0 });
    await manager.dispose();
  });

  it("derives a one-line title that fits a sidebar row", () => {
    expect(titleFromPrompt("  a\n b  ")).toBe("a b");
    expect(titleFromPrompt("x".repeat(80))).toHaveLength(60);
    expect(titleFromPrompt("x".repeat(80)).endsWith("…")).toBe(true);
  });
});
