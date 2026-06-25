import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, Wrench, Sparkles, AlertCircle } from "lucide-react";
import {
  api,
  streamChat,
  type Project,
  type Message,
  type ChatEvent,
} from "@/lib/api";
import { useApp } from "@/lib/store";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

type ToolActivity = { id: string; name: string; args: any; result?: any };
type UIMsg = {
  role: "user" | "assistant";
  content: string;
  tools?: ToolActivity[];
  error?: string;
};

function historyToUI(messages: Message[]): UIMsg[] {
  const out: UIMsg[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      const tools: ToolActivity[] = (m.extra?.tool_calls || []).map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name ?? "tool",
        args: tc.function?.arguments,
      }));
      if (m.content || tools.length)
        out.push({ role: "assistant", content: m.content, tools });
    } else if (m.role === "tool") {
      // attach result to the most recent assistant tool by id
      const last = out[out.length - 1];
      if (last?.role === "assistant" && last.tools) {
        const t = last.tools.find((x) => x.id === m.extra?.tool_call_id);
        if (t) t.result = m.content;
      }
    }
  }
  return out;
}

export function ChatView() {
  const { activeConversationId, setActiveConversation, draftProjectId, refresh } = useApp();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(draftProjectId);
  const [messages, setMessages] = useState<UIMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [title, setTitle] = useState("New chat");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => {});
  }, []);

  // load conversation when selected; reset for a new chat
  useEffect(() => {
    if (activeConversationId == null) {
      setMessages([]);
      setTitle("New chat");
      setProjectId(draftProjectId);
      return;
    }
    api
      .getConversation(activeConversationId)
      .then((c) => {
        setMessages(historyToUI(c.messages));
        setTitle(c.title);
        setProjectId(c.project_id);
      })
      .catch(() => {});
  }, [activeConversationId, draftProjectId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;
    let convId = activeConversationId;
    const toolIndex: Record<string, number> = {};

    const update = (fn: (a: UIMsg) => void) =>
      setMessages((m) => {
        const copy = [...m];
        const last = { ...copy[copy.length - 1] };
        fn(last);
        copy[copy.length - 1] = last;
        return copy;
      });

    const onEvent = (ev: ChatEvent) => {
      switch (ev.type) {
        case "start":
          convId = ev.conversation_id;
          break;
        case "token":
          update((a) => (a.content += ev.text));
          break;
        case "tool_call":
          update((a) => {
            a.tools = a.tools || [];
            toolIndex[ev.id] = a.tools.length;
            a.tools.push({ id: ev.id, name: ev.name, args: ev.arguments });
          });
          break;
        case "tool_result":
          update((a) => {
            const idx = toolIndex[ev.id];
            if (a.tools && idx != null) a.tools[idx] = { ...a.tools[idx], result: ev.result };
          });
          break;
        case "error":
          update((a) => (a.error = ev.error));
          break;
        case "done":
          break;
      }
    };

    try {
      await streamChat({ conversation_id: convId, project_id: projectId, message: text }, onEvent, ac.signal);
    } catch (e: any) {
      if (e.name !== "AbortError") update((a) => (a.error = String(e.message ?? e)));
    } finally {
      setStreaming(false);
      abortRef.current = null;
      if (convId && convId !== activeConversationId) {
        setActiveConversation(convId);
      }
      refresh();
    }
  };

  const stop = () => abortRef.current?.abort();

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const activeProject = projects.find((p) => p.id === projectId);
  const empty = messages.length === 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* header */}
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <h1 className="truncate text-base font-display">{title}</h1>
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-muted-foreground">Project</span>
          <Select
            value={projectId ?? ""}
            disabled={activeConversationId != null}
            onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
            className="h-8 w-44 text-[13px]"
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </header>

      {/* messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          {empty ? (
            <div className="flex flex-col items-center justify-center gap-3 pt-[14vh] text-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Sparkles className="size-6" />
              </div>
              <h2 className="text-2xl font-display">What can I help with?</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                {activeProject
                  ? `Chatting in “${activeProject.name}”. Its pre-prompt and attached MCP tools are active.`
                  : "Pick a project to use its pre-prompt and MCP tools, or just start typing."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {messages.map((m, i) => (
                <MessageBubble key={i} msg={m} streaming={streaming && i === messages.length - 1} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* composer */}
      <div className="border-t border-border px-6 py-4">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-xl border border-input bg-card p-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Send a message…"
            className="max-h-48 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          {streaming ? (
            <Button size="icon" variant="secondary" onClick={stop} title="Stop">
              <Square className="size-4" />
            </Button>
          ) : (
            <Button size="icon" onClick={send} disabled={!input.trim()} title="Send">
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted-foreground/60">
          CheveluAI runs on your configured model. Verify important information.
        </p>
      </div>
    </div>
  );
}

function MessageBubble({ msg, streaming }: { msg: UIMsg; streaming: boolean }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary/15 px-4 py-2.5 text-sm">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {msg.tools?.map((t) => <ToolChip key={t.id} tool={t} />)}
      {msg.content && <Markdown content={msg.content} />}
      {streaming && !msg.content && !msg.tools?.length && (
        <span className="inline-block size-2 animate-pulse rounded-full bg-primary" />
      )}
      {msg.error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{msg.error}</span>
        </div>
      )}
    </div>
  );
}

function ToolChip({ tool }: { tool: ToolActivity }) {
  const [open, setOpen] = useState(false);
  const resultStr =
    typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result, null, 2);
  return (
    <div className="rounded-lg border border-border bg-muted/40 text-[13px]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Wrench className="size-3.5 text-primary" />
        <span className="font-medium">{tool.name}</span>
        <span className="text-muted-foreground">
          {tool.result === undefined ? "running…" : "done"}
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[12px] text-muted-foreground">
            {`args: ${typeof tool.args === "string" ? tool.args : JSON.stringify(tool.args)}\n${
              tool.result !== undefined ? `result: ${resultStr}` : ""
            }`}
          </pre>
        </div>
      )}
    </div>
  );
}
