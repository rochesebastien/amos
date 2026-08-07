import { randomUUID } from "node:crypto";
import type {
  ChatBackend,
  ChatMessage,
  ChatRole,
  ChatSession,
  ChatSessionDetail,
  ChatToolCall,
} from "../../shared/chat.js";
import { getDatabase, type Db } from "../db/index.js";

/**
 * Chat sessions and their transcripts. Unlike capabilities — which are read
 * from the filesystem every time, because the filesystem owns them — a
 * conversation exists nowhere else, so this is the only copy.
 *
 * The `extra` column holds the per-message JSON that has no column of its own:
 * the tool calls of a turn and the error it ended with.
 */

type SessionRow = {
  id: string;
  project_id: string;
  backend: string;
  title: string;
  resume_token: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  extra: string;
  created_at: string;
};

type MessageExtra = {
  toolCalls?: ChatToolCall[];
  error?: string | null;
};

function toSession(row: SessionRow): ChatSession {
  return {
    id: row.id,
    projectId: row.project_id,
    backend: row.backend as ChatBackend,
    title: row.title,
    resumeToken: row.resume_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow): ChatMessage {
  let extra: MessageExtra = {};
  try {
    extra = JSON.parse(row.extra) as MessageExtra;
  } catch {
    // A corrupt blob costs the tool rows of one message, not the transcript.
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as ChatRole,
    content: row.content,
    toolCalls: Array.isArray(extra.toolCalls) ? extra.toolCalls : [],
    error: typeof extra.error === "string" ? extra.error : null,
    createdAt: row.created_at,
  };
}

const SESSION_COLUMNS = `id, project_id, backend, title, resume_token, created_at, updated_at`;
const MESSAGE_COLUMNS = `id, session_id, role, content, extra, created_at`;

/** Sessions of one project, most recently used first. */
export function listSessions(projectId: string, db: Db = getDatabase()): ChatSession[] {
  return db
    .prepare<[string], SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM chat_sessions
        WHERE project_id = ? ORDER BY updated_at DESC`,
    )
    .all(projectId)
    .map(toSession);
}

export function getSession(id: string, db: Db = getDatabase()): ChatSession | null {
  const row = db
    .prepare<[string], SessionRow>(`SELECT ${SESSION_COLUMNS} FROM chat_sessions WHERE id = ?`)
    .get(id);
  return row ? toSession(row) : null;
}

export function listMessages(sessionId: string, db: Db = getDatabase()): ChatMessage[] {
  return db
    .prepare<[string], MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM chat_messages
        WHERE session_id = ? ORDER BY created_at, rowid`,
    )
    .all(sessionId)
    .map(toMessage);
}

export function getSessionDetail(id: string, db: Db = getDatabase()): ChatSessionDetail | null {
  const session = getSession(id, db);
  if (!session) return null;
  return { session, messages: listMessages(id, db) };
}

export function createSession(
  input: { projectId: string; backend: ChatBackend; title?: string },
  db: Db = getDatabase(),
): ChatSession {
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: randomUUID(),
    projectId: input.projectId,
    backend: input.backend,
    title: input.title ?? "",
    resumeToken: null,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO chat_sessions (id, project_id, backend, title, resume_token, created_at, updated_at)
     VALUES (@id, @projectId, @backend, @title, @resumeToken, @createdAt, @updatedAt)`,
  ).run(session);
  return session;
}

export function deleteSession(id: string, db: Db = getDatabase()): { ok: true } {
  // `chat_messages` cascades: the database has `foreign_keys = ON`.
  db.prepare(`DELETE FROM chat_sessions WHERE id = ?`).run(id);
  return { ok: true };
}

/** Store the driver's continuation token and bump the session's timestamp. */
export function setResumeToken(id: string, token: string | null, db: Db = getDatabase()): void {
  db.prepare(`UPDATE chat_sessions SET resume_token = ?, updated_at = ? WHERE id = ?`).run(
    token,
    new Date().toISOString(),
    id,
  );
}

/**
 * Move a session to another backend. The resume token goes with it: a Codex
 * conversation id means nothing to Claude, and the other way round.
 */
export function setBackend(id: string, backend: ChatBackend, db: Db = getDatabase()): void {
  db.prepare(
    `UPDATE chat_sessions SET backend = ?, resume_token = NULL, updated_at = ? WHERE id = ?`,
  ).run(backend, new Date().toISOString(), id);
}

export function setTitle(id: string, title: string, db: Db = getDatabase()): void {
  db.prepare(`UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?`).run(
    title,
    new Date().toISOString(),
    id,
  );
}

export function touchSession(id: string, db: Db = getDatabase()): void {
  db.prepare(`UPDATE chat_sessions SET updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    id,
  );
}

/** A session's title is the first thing the user said, trimmed to fit a row. */
export function titleFromPrompt(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 60) return oneLine;
  return `${oneLine.slice(0, 59)}…`;
}

export function appendMessage(
  input: {
    sessionId: string;
    role: ChatRole;
    content?: string;
    toolCalls?: ChatToolCall[];
    error?: string | null;
  },
  db: Db = getDatabase(),
): ChatMessage {
  const now = new Date().toISOString();
  const row: MessageRow = {
    id: randomUUID(),
    session_id: input.sessionId,
    role: input.role,
    content: input.content ?? "",
    extra: JSON.stringify({ toolCalls: input.toolCalls ?? [], error: input.error ?? null }),
    created_at: now,
  };
  db.prepare(
    `INSERT INTO chat_messages (id, session_id, role, content, extra, created_at)
     VALUES (@id, @session_id, @role, @content, @extra, @created_at)`,
  ).run(row);
  touchSession(input.sessionId, db);
  return toMessage(row);
}

/**
 * Rewrite a message that is still being streamed. The manager calls this once
 * at the end of a turn rather than once per token: a token is worth nothing on
 * its own, and a write per token would fsync the database hundreds of times.
 */
export function updateMessage(
  id: string,
  patch: { content?: string; toolCalls?: ChatToolCall[]; error?: string | null },
  db: Db = getDatabase(),
): ChatMessage | null {
  const row = db
    .prepare<[string], MessageRow>(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE id = ?`)
    .get(id);
  if (!row) return null;
  const current = toMessage(row);
  const next = {
    content: patch.content ?? current.content,
    toolCalls: patch.toolCalls ?? current.toolCalls,
    error: patch.error === undefined ? current.error : patch.error,
  };
  db.prepare(`UPDATE chat_messages SET content = ?, extra = ? WHERE id = ?`).run(
    next.content,
    JSON.stringify({ toolCalls: next.toolCalls, error: next.error }),
    id,
  );
  touchSession(current.sessionId, db);
  return { ...current, ...next };
}
