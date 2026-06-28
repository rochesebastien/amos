import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Square,
  Wrench,
  AlertCircle,
  Copy,
  Check,
  Paperclip,
  FileText,
  X,
  Folder,
  Plug,
  ChevronDown,
  Cpu,
} from "lucide-react";
import { streamChat, type Message, type ChatEvent } from "@/lib/api";
import { qk, useConversation, useProjects, useMcps, useSettings } from "@/lib/queries";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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
import { useT } from "@/lib/i18n";
import logoIcon from "@/assets/logo.png";
import logoWaitingPrompt from "@/assets/logo_waiting_prompt.png";

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
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const params = useParams({ strict: false }) as { conversationId?: string };
  const search = useSearch({ strict: false }) as { project?: number };
  const conversationId = params.conversationId ? Number(params.conversationId) : null;

  const { data: projects = [] } = useProjects();
  const { data: mcps = [] } = useMcps();
  const { data: settings } = useSettings();
  const { data: conversation } = useConversation(conversationId);

  const [projectId, setProjectId] = useState<number | null>(search.project ?? null);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [messages, setMessages] = useState<UIMsg[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<StagedFile[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const title = conversation?.title ?? t("chat.newChat");

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
        {
          conversation_id: convId,
          project_id: projectId,
          message: composed,
          model: effectiveModel || undefined,
        },
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
  const activeMcps = activeProject
    ? mcps.filter((m) => m.enabled && activeProject.mcp_ids.includes(m.id))
    : [];

  // model selection for the composer: explicit pick > project override > default
  const defaultModel = settings?.llm_model ?? "";
  const effectiveModel = selectedModel || activeProject?.model || defaultModel;
  const modelOptions = Array.from(
    new Set(
      [
        ...(settings?.enabled_models ?? []).map((m) => m.id),
        defaultModel,
        activeProject?.model ?? "",
      ].filter(Boolean),
    ),
  );
  const empty = messages.length === 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* header */}
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <h1 className="truncate text-base font-display">{title}</h1>
        <div className="flex items-center gap-2">
          {/* MCP indicator — active MCPs for this chat */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-8 items-center gap-1.5 rounded-lg border border-input bg-card px-3 text-[13px] transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
              >
                <Plug className="size-3.5 text-primary" />
                <span>
                  {t(activeMcps.length === 1 ? "chat.mcpCountOne" : "chat.mcpCountOther", {
                    n: activeMcps.length,
                  })}
                </span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>{t("chat.activeMcps")}</DropdownMenuLabel>
              {activeMcps.length === 0 ? (
                <div className="px-2 py-1.5 text-[13px] text-muted-foreground">
                  {activeProject ? t("chat.noMcpsAttached") : t("chat.pickProjectMcps")}
                </div>
              ) : (
                activeMcps.map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    className="cursor-default"
                    onSelect={(e) => e.preventDefault()}
                  >
                    <Plug className="size-3.5 shrink-0 text-primary" />
                    <span className="flex-1 truncate">{m.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {t(m.tool_count === 1 ? "chat.toolCountOne" : "chat.toolCountOther", {
                        n: m.tool_count,
                      })}
                    </span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Project indicator / selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={conversationId != null}>
              <button
                type="button"
                disabled={conversationId != null}
                className="flex h-8 w-48 items-center gap-1.5 rounded-lg border border-input bg-card px-3 text-[13px] transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
              >
                <Folder className="size-3.5 shrink-0 text-primary" />
                <span className="flex-1 truncate text-left">
                  {activeProject ? activeProject.name : t("threads.noProject")}
                </span>
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => setProjectId(null)}>
                <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1">{t("threads.noProject")}</span>
                {projectId == null && <Check className="size-3.5 shrink-0 text-primary" />}
              </DropdownMenuItem>
              {projects.length > 0 && <DropdownMenuSeparator />}
              {projects.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => setProjectId(p.id)}>
                  <Folder className="size-3.5 shrink-0 text-primary" />
                  <span className="flex-1 truncate">{p.name}</span>
                  {projectId === p.id && <Check className="size-3.5 shrink-0 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* messages */}
      {empty ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-6 py-6">
            <div className="flex flex-col items-center justify-center gap-3 pt-[14vh] text-center">
              <img src={logoWaitingPrompt} alt="CheveluAI" className="size-16 object-contain" />
              <h2 className="text-2xl font-display">{t("chat.emptyTitle")}</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                {activeProject
                  ? t("chat.emptyProjectActive", { name: activeProject.name })
                  : t("chat.emptyNoProject")}
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
                        ? t("chat.fileReadError")
                        : `${formatBytes(a.file.size)}${
                            a.text != null ? ` · ${t("chat.inlined")}` : ""
                          }`}
                    </AttachmentDescription>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AttachmentAction
                      aria-label={t("chat.removeFile", { name: a.file.name })}
                      onClick={() => removeAttachment(a.id)}
                    >
                      <X />
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              ))}
            </AttachmentGroup>
          )}

          <div className="flex flex-col gap-1.5 rounded-xl border border-input bg-card p-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
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
            <div className="flex items-end gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => fileRef.current?.click()}
                  >
                    <Paperclip className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("chat.attachFiles")}</TooltipContent>
              </Tooltip>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder={t("chat.sendPlaceholder")}
                className="max-h-48 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
              />
              {streaming ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="secondary" onClick={stop}>
                      <Square className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("chat.stop")}</TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      onClick={send}
                      disabled={!input.trim() && attachments.length === 0}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("chat.send")}</TooltipContent>
                </Tooltip>
              )}
            </div>

            {/* composer toolbar — model selector */}
            <div className="flex items-center gap-2 pl-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-7 max-w-[240px] items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent"
                  >
                    <Cpu className="size-3.5 text-primary" />
                    <span className="truncate">{effectiveModel || t("chat.noModel")}</span>
                    <ChevronDown className="size-3.5 shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel>{t("chat.model")}</DropdownMenuLabel>
                  {modelOptions.length === 0 ? (
                    <div className="px-2 py-1.5 text-[13px] text-muted-foreground">
                      {t("chat.noModelHint")}
                    </div>
                  ) : (
                    modelOptions.map((id) => (
                      <DropdownMenuItem key={id} onSelect={() => setSelectedModel(id)}>
                        <Check
                          className={cn(
                            "size-3.5 shrink-0 text-primary",
                            effectiveModel === id ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="flex-1 truncate">{id}</span>
                        {id === defaultModel && (
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {t("settings.default")}
                          </span>
                        )}
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground/60">
            {t("chat.disclaimer")}
          </p>
        </div>
      </div>
    </div>
  );
}

function ChatMessage({ msg, streaming }: { msg: UIMsg; streaming: boolean }) {
  const t = useT();
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
        <img src={logoIcon} alt="CheveluAI" className="size-7 object-contain" />
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>CheveluAI</MessageHeader>

        {msg.tools?.map((t) => <ToolMarker key={t.id} tool={t} />)}

        {thinking && (
          <Marker role="status">
            <MarkerIcon>
              <Spinner />
            </MarkerIcon>
            <MarkerContent className="shimmer">{t("chat.thinking")}</MarkerContent>
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
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t("chat.copyMessage")}
          onClick={() => {
            navigator.clipboard?.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? t("chat.copied") : t("chat.copy")}</TooltipContent>
    </Tooltip>
  );
}

function ToolMarker({ tool }: { tool: ToolActivity }) {
  const t = useT();
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
            {running ? t("chat.running") : open ? t("chat.hide") : t("chat.details")}
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
