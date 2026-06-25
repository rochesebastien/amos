// Typed client for the CheveluAI backend.

export type Settings = {
  llm_base_url: string;
  llm_model: string;
  has_api_key: boolean;
  max_tool_iterations: number;
};

export type SettingsUpdate = {
  llm_base_url?: string;
  llm_model?: string;
  llm_api_key?: string;
  max_tool_iterations?: number;
};

export type Project = {
  id: number;
  name: string;
  description: string;
  system_prompt: string;
  model: string;
  mcp_ids: number[];
  created_at: string;
  updated_at: string;
};

export type ProjectInput = {
  name: string;
  description?: string;
  system_prompt?: string;
  model?: string;
  mcp_ids?: number[];
};

export type MCPType = "remote" | "code" | "openapi";

export type MCP = {
  id: number;
  name: string;
  description: string;
  type: MCPType;
  enabled: boolean;
  config: Record<string, any>;
  project_ids: number[];
  tool_count: number;
  created_at: string;
  updated_at: string;
};

export type MCPInput = {
  name: string;
  description?: string;
  type: MCPType;
  enabled?: boolean;
  config?: Record<string, any>;
  project_ids?: number[];
};

export type ToolPreview = {
  name: string;
  description: string;
  parameters: Record<string, any>;
};

export type MCPTestResult = {
  ok: boolean;
  tools: ToolPreview[];
  error?: string | null;
};

export type Conversation = {
  id: number;
  title: string;
  project_id: number | null;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: number;
  role: "user" | "assistant" | "tool";
  content: string;
  extra: Record<string, any>;
  created_at: string;
};

export type ConversationDetail = Conversation & { messages: Message[] };

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // settings
  getSettings: () => req<Settings>("/api/settings"),
  updateSettings: (body: SettingsUpdate) =>
    req<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  discoverModels: () => req<{ models: string[] }>("/api/settings/models"),

  // projects
  listProjects: () => req<Project[]>("/api/projects"),
  createProject: (body: ProjectInput) =>
    req<Project>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  updateProject: (id: number, body: ProjectInput) =>
    req<Project>(`/api/projects/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteProject: (id: number) => req<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),

  // mcps
  listMcps: () => req<MCP[]>("/api/mcps"),
  createMcp: (body: MCPInput) =>
    req<MCP>("/api/mcps", { method: "POST", body: JSON.stringify(body) }),
  updateMcp: (id: number, body: MCPInput) =>
    req<MCP>(`/api/mcps/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteMcp: (id: number) => req<{ ok: boolean }>(`/api/mcps/${id}`, { method: "DELETE" }),
  testMcp: (id: number) => req<MCPTestResult>(`/api/mcps/${id}/test`, { method: "POST" }),
  previewOpenapi: (body: { spec_url?: string; spec?: any; base_url?: string }) =>
    req<MCPTestResult>("/api/mcps/preview/openapi", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // conversations
  listConversations: () => req<Conversation[]>("/api/conversations"),
  getConversation: (id: number) => req<ConversationDetail>(`/api/conversations/${id}`),
  renameConversation: (id: number, title: string) =>
    req<Conversation>(`/api/conversations/${id}`, {
      method: "PUT",
      body: JSON.stringify({ title }),
    }),
  deleteConversation: (id: number) =>
    req<{ ok: boolean }>(`/api/conversations/${id}`, { method: "DELETE" }),
};

// ---- Streaming chat (SSE over fetch) ---------------------------------------

export type ChatEvent =
  | { type: "start"; conversation_id: number; project_id: number | null }
  | { type: "token"; text: string }
  | { type: "tool_call"; name: string; arguments: any; id: string }
  | { type: "tool_result"; name: string; id: string; result: any }
  | { type: "error"; error: string }
  | { type: "done" };

export async function streamChat(
  body: { conversation_id?: number | null; project_id?: number | null; message: string },
  onEvent: (ev: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Chat request failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        onEvent(JSON.parse(payload) as ChatEvent);
      } catch {
        /* ignore malformed chunk */
      }
    }
  }
}
