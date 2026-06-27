import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Square,
  Wrench,
  Sparkles,
  AlertCircle,
  Copy,
  Check,
  Paperclip,
  FileText,
  X,
} from "lucide-react";
import { streamChat, type Message, type ChatEvent } from "@/lib/api";
import { qk, useConversation, useProjects } from "@/lib/queries";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Message as MessageRow,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { cn } from "@/lib/utils";

type ToolActivity = { id: string; name: string; args: any; result?: any };
type UIMsg = {
  role: "user" | "assistant";
  content: string;
  tools?: ToolActivity[];
  error?: string;
};

type StagedFile = {
  id: string;
  file: File;
  text: string | null; // inlined content for text-like files
  state: "uploading" | "processing" | "error" | "done";
};

const TEXT_LIKE = /^(text\/|application\/(json|xml|x-yaml|yaml|javascript|typescript))/;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

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
  const navigate = useNavigate();
  const qc = useQueryClient();
  const params = useParams({ strict: false }) as { conversationId?: string };
  const search = useSearch({ strict: false }) as { project?: number };
  const conversationId = params.conversationId ? Number(params.conversationId) : null;

  const { data: projects = [] } = useProjects();
  const { data: conversation } = useConversation(conversationId);

  const [projectId, setProjectId] = useState<number | null>(search.project ?? null);
  const [messages, setMessages] = useState<UIMsg[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<StagedFile[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const title = conversation?.title ?? "New chat";

  // reset when navigating to a brand-new chat
  useEffect(() => {
    if (conversationId == null) {
      setMessages([]);
      setProjectId(search.project ?? null);
    }
  }, [conversationId, search.project]);

  // load history once the conversation query resolves
  useEffect(() => {
    if (conversation) {
      setMessages(historyToUI(conversation.messages));
      setProjectId(conversation.project_id);
    }
  }, [conversation]);

  // ----- attachments -----
  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const picked: StagedFile[] = Array.from(files).map((file) => ({
      id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
      file,
      text: null,
      state: "processing",
    }));
    setAttachments((a) => [...a, ...picked]);
    for (const item of picked) {
      const isText = TEXT_LIKE.test(item.file.type) || /\.(md|txt|csv|log)$/i.test(item.file.name);
      try {
        const text = isText ? await item.file.text() : null;
        setAttachments((a) =>
          a.map((x) => (x.id === item.id ? { ...x, text, state: "done" } : x)),
        );
      } catch {
        setAttachments((a) =>
          a.map((x) => (x.id === item.id ? { ...x, state: "error" } : x)),
        );
      }
    }
  };

  const removeAttachment = (id: string) =>
    setAttachments((a) => a.filter((x) => x.id !== id));

  const composeMessage = (text: string): string => {
    const parts = [text.trim()];
    for (const a of attachments) {
      if (a.text != null) {
        parts.push(`\n\n--- ${a.file.name} ---\n${a.text}`);
      } else {
        parts.push(`\n\n[attached: ${a.file.name} (${formatBytes(a.file.size)})]`);
      }
    }
    return parts.join("");
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || streaming) return;
    const composed = composeMessage(text);
    const display = text || attachments.map((a) => a.file.name).join(", ");
    setInput("");
    setAttachments([]);
    setMessages((m) => [
      ...m,
      { role: "user", content: display },
      { role: "assistant", content: "" },
    ]);
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;
    let convId = conversationId;
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
      await streamChat(
        { conversation_id: convId, project_id: projectId, message: composed },
        onEvent,
        ac.signal,
      );
    } catch (e: any) {
      if (e.name !== "AbortError") update((a) => (a.error = String(e.message ?? e)));
    } finally {
      setStreaming(false);
      abortRef.current = null;
      qc.invalidateQueries({ queryKey: qk.conversations });
      if (convId && convId !== conversationId) {
        navigate({ to: "/c/$conversationId", params: { conversationId: String(convId) } });
      } else if (convId) {
        qc.invalidateQueries({ queryKey: qk.conversation(convId) });
      }
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
            disabled={conversationId != null}
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
      {empty ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-6 py-6">
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
          </div>
        </div>
      ) : (
        <MessageScrollerProvider
          autoScroll
          defaultScrollPosition="last-anchor"
          scrollPreviousItemPeek={64}
        >
          <MessageScroller>
            <MessageScrollerViewport>
              <MessageScrollerContent className="gap-6 px-6 py-6" aria-busy={streaming}>
                {messages.map((m, i) => (
                  <MessageScrollerItem
                    key={i}
                    messageId={String(i)}
                    scrollAnchor={m.role === "user"}
                  >
                    <ChatMessage
                      msg={m}
                      streaming={streaming && i === messages.length - 1}
                    />
                  </MessageScrollerItem>
                ))}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
      )}

      {/* composer */}
      <div className="border-t border-border px-6 py-4">
        <div className="mx-auto w-full max-w-3xl">
          {attachments.length > 0 && (
            <AttachmentGroup className="mb-2">
              {attachments.map((a) => (
                <Attachment key={a.id} size="sm" state={a.state} className="w-56">
                  <AttachmentMedia>
                    <FileText />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{a.file.name}</AttachmentTitle>
                    <AttachmentDescription>
                      {a.state === "error"
                        ? "Could not read file"
                        : `${formatBytes(a.file.size)}${a.text != null ? " · inlined" : ""}`}
                    </AttachmentDescription>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AttachmentAction
                      aria-label={`Remove ${a.file.name}`}
                      onClick={() => removeAttachment(a.id)}
                    >
                      <X />
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              ))}
            </AttachmentGroup>
          )}

          <div className="flex items-end gap-2 rounded-xl border border-input bg-card p-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                onPickFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={() => fileRef.current?.click()}
              title="Attach files"
            >
              <Paperclip className="size-4" />
            </Button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Send a message…"
              className="max-h-48 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            {streaming ? (
              <Button size="icon" variant="secondary" onClick={stop} title="Stop">
                <Square className="size-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={send}
                disabled={!input.trim() && attachments.length === 0}
                title="Send"
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground/60">
            CheveluAI runs on your configured model. Verify important information.
          </p>
        </div>
      </div>
    </div>
  );
}

function ChatMessage({ msg, streaming }: { msg: UIMsg; streaming: boolean }) {
  if (msg.role === "user") {
    return (
      <MessageRow align="end">
        <MessageContent>
          <Bubble variant="tinted" align="end">
            <BubbleContent>{msg.content}</BubbleContent>
          </Bubble>
        </MessageContent>
      </MessageRow>
    );
  }

  const thinking = streaming && !msg.content && !msg.tools?.length;

  return (
    <MessageRow align="start">
      <MessageAvatar>
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-display text-xs">
          C
        </div>
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>CheveluAI</MessageHeader>

        {msg.tools?.map((t) => <ToolMarker key={t.id} tool={t} />)}

        {thinking && (
          <Marker role="status">
            <MarkerIcon>
              <Spinner />
            </MarkerIcon>
            <MarkerContent className="shimmer">Thinking…</MarkerContent>
          </Marker>
        )}

        {msg.content && (
          <Bubble variant="ghost">
            <Markdown content={msg.content} />
          </Bubble>
        )}

        {msg.error && (
          <Bubble variant="destructive" className="max-w-none">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{msg.error}</span>
            </div>
          </Bubble>
        )}

        {!streaming && msg.content && (
          <MessageFooter>
            <CopyButton text={msg.content} />
          </MessageFooter>
        )}
      </MessageContent>
    </MessageRow>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label="Copy message"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

function ToolMarker({ tool }: { tool: ToolActivity }) {
  const [open, setOpen] = useState(false);
  const running = tool.result === undefined;
  const resultStr =
    typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result, null, 2);
  return (
    <div className="w-full">
      <Marker
        asChild
        variant="border"
        role={running ? "status" : undefined}
        className="w-full"
      >
        <button type="button" onClick={() => setOpen((o) => !o)}>
          <MarkerIcon>{running ? <Spinner /> : <Wrench />}</MarkerIcon>
          <MarkerContent className={cn("font-medium text-foreground", running && "shimmer")}>
            {tool.name}
          </MarkerContent>
          <span className="ml-auto text-[12px] text-muted-foreground">
            {running ? "running…" : open ? "hide" : "details"}
          </span>
        </button>
      </Marker>
      {open && (
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
          {`args: ${typeof tool.args === "string" ? tool.args : JSON.stringify(tool.args)}\n${
            tool.result !== undefined ? `result: ${resultStr}` : ""
          }`}
        </pre>
      )}
    </div>
  );
}
