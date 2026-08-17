import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Copy,
  MessageSquarePlus,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  CHAT_BACKEND_SETTING,
  chatEffortSetting,
  chatModelSetting,
  readyBackends,
  type ChatBackend,
  type ChatMessage,
  type ReasoningEffort,
} from "@shared/chat";
import {
  useChatSession,
  useChatSessions,
  useCliDetection,
  useDeleteChatSession,
  useGitHead,
  useProjects,
  useSetting,
  useSettingMutation,
} from "@/lib/queries";
import { ipc } from "@/lib/ipc";
import { useChatStream, useChatStreams, type StreamTool } from "@/lib/chatStream";
import { relativeTime, useT, type TFunc } from "@/lib/i18n";
import { Markdown } from "@/components/Markdown";
import { BackendGlyph } from "@/components/BrandIcons";
import { TranscriptMinimap } from "@/components/TranscriptMinimap";
import { ChatComposer } from "@/components/ChatComposer";
import { ChatSetupScreen } from "./ChatSetupScreen";
import { ViewHeader } from "@/components/ViewHeader";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
import { useConfirm } from "@/components/ui/confirm";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/Logo";

/**
 * Chat with the project, through the CLI the user already pays for.
 *
 * The transcript comes from SQLite; the turn in flight comes from the stream
 * store the app shell fills from `chat:event`. The two are stitched together
 * by message id: the assistant row exists in the database from the moment the
 * turn starts, empty, and the live text is painted over it until the turn ends
 * and the persisted version takes back over.
 */

type UIMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: StreamTool[];
  error: string | null;
};

function toUI(message: ChatMessage): UIMsg {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    tools: message.toolCalls.map((tool) => ({
      id: tool.id,
      name: tool.name,
      args: tool.arguments,
      result: tool.result,
      isError: tool.isError,
    })),
    error: message.error,
  };
}

export function ChatView() {
  const t = useT();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const { sessionId = null } = useParams({ strict: false }) as { sessionId?: string };

  const { data: projects = [] } = useProjects();
  const project = projects.find((p) => p.id === projectId);
  const { data: detection } = useCliDetection();
  const { data: sessions = [] } = useChatSessions(projectId);
  const { data: detail } = useChatSession(sessionId);
  const stream = useChatStream(sessionId);
  const clearStream = useChatStreams((state) => state.clear);
  const deleteSession = useDeleteChatSession(projectId);

  const { data: git } = useGitHead(projectId);
  const { data: storedBackend } = useSetting(CHAT_BACKEND_SETTING);
  const saveSetting = useSettingMutation();
  const [pickedBackend, setPickedBackend] = useState<ChatBackend | null>(null);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const available = useMemo(() => readyBackends(detection), [detection]);
  // A session is pinned to the backend it was opened with; a new chat follows
  // the picker, which falls back to the stored preference then to whatever is
  // ready.
  const preferred = (pickedBackend ??
    (storedBackend?.value as ChatBackend | undefined) ??
    available[0] ??
    "claude") as ChatBackend;
  const backend: ChatBackend = detail?.session.backend ?? preferred;
  const streaming = stream?.streaming === true;

  // The composer owns these two; the view only carries them into the turn.
  const { data: storedModel } = useSetting(chatModelSetting(backend));
  const { data: storedEffort } = useSetting(chatEffortSetting(backend));

  // A brand new chat starts with an empty composer.
  useEffect(() => {
    setInput("");
    setSendError(null);
  }, [sessionId]);

  const messages = useMemo(() => {
    const persisted = (detail?.messages ?? []).map(toUI);
    if (!stream) return persisted;
    const index = persisted.findIndex((m) => m.id === stream.messageId);
    const live: UIMsg = {
      id: stream.messageId,
      role: "assistant",
      content: stream.content,
      tools: stream.tools,
      error: stream.error,
    };
    // While the turn runs, the live text wins over the (still empty) row on
    // disk; once it is over, both say the same thing.
    if (index === -1) return streaming ? [...persisted, live] : persisted;
    const merged = [...persisted];
    merged[index] = stream.streaming || stream.content || stream.error ? live : merged[index]!;
    return merged;
  }, [detail, stream, streaming]);

  if (!project) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-xl font-display">{t("project.notFound")}</h1>
        <p className="max-w-sm text-sm text-muted-foreground/70">{t("project.notFoundDesc")}</p>
        <Button variant="outline" onClick={() => navigate({ to: "/" })}>
          {t("project.backHome")}
        </Button>
      </div>
    );
  }

  // Nothing to drive: the setup screen replaces the whole view, per the plan's
  // "chat disabled until a CLI is connected".
  if (detection && available.length === 0) {
    return <ChatSetupScreen detection={detection} />;
  }

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || streaming) return;
    setInput("");
    setSendError(null);
    try {
      const result = await ipc.sendChat({
        projectId,
        sessionId,
        backend,
        prompt,
        model: storedModel?.value || null,
        effort: (storedEffort?.value as ReasoningEffort | undefined) ?? null,
      });
      if (backend !== storedBackend?.value) {
        saveSetting.mutate({ key: CHAT_BACKEND_SETTING, value: backend });
      }
      if (result.sessionId !== sessionId) {
        void navigate({
          to: "/p/$projectId/chat/$sessionId",
          params: { projectId, sessionId: result.sessionId },
        });
      }
    } catch (error) {
      setInput(prompt);
      setSendError(error instanceof Error ? error.message : String(error));
    }
  };

  const stop = () => {
    if (sessionId) void ipc.abortChat(sessionId).catch(() => undefined);
  };

  const removeSession = async (id: string, title: string) => {
    const ok = await confirm({
      title: t("chat.deleteTitle"),
      description: t("chat.deleteDesc", { name: title || t("chat.untitled") }),
      confirmText: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    await deleteSession.mutateAsync(id);
    clearStream(id);
    if (id === sessionId) void navigate({ to: "/p/$projectId/chat", params: { projectId } });
  };

  const empty = messages.length === 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ViewHeader
        backTo="/p/$projectId"
        backParams={{ projectId }}
        backLabel={t("cap.backToProject")}
        title={detail?.session.title || t("chat.newChat")}
        actions={
          <>
            <SessionMenu
              t={t}
              sessions={sessions}
              activeId={sessionId}
              onOpen={(id) =>
                void navigate({
                  to: "/p/$projectId/chat/$sessionId",
                  params: { projectId, sessionId: id },
                })
              }
              onDelete={(id, title) => void removeSession(id, title)}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("chat.newChat")}
                  onClick={() => void navigate({ to: "/p/$projectId/chat", params: { projectId } })}
                >
                  <MessageSquarePlus className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("chat.newChat")}</TooltipContent>
            </Tooltip>
          </>
        }
      />

      {empty ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-6 py-6">
            <div className="flex flex-col items-center justify-center gap-3 pt-[12vh] text-center">
              <LogoMark className="size-16" />
              <h2 className="text-2xl font-display">{t("chat.emptyTitle")}</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                {t("chat.emptyInProject", { name: project.name })}
              </p>
              <p className="max-w-md font-mono text-[12px] text-muted-foreground/60">
                {project.path}
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
            <TranscriptMinimap
              prompts={messages
                .filter((m) => m.role === "user")
                .map((m) => ({ id: m.id, content: m.content }))}
            />
            <MessageScrollerViewport>
              <MessageScrollerContent className="gap-6 px-6 py-6" aria-busy={streaming}>
                {messages.map((message, index) => (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    scrollAnchor={message.role === "user"}
                  >
                    <ChatMessageRow
                      msg={message}
                      backend={backend}
                      streaming={streaming && index === messages.length - 1}
                    />
                  </MessageScrollerItem>
                ))}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton aria-label={t("chat.scrollToLatest")} />
          </MessageScroller>
        </MessageScrollerProvider>
      )}

      <div className="px-6 py-4">
        {stream?.aborted && !streaming && (
          <p className="mx-auto mb-2 w-full max-w-3xl text-[12px] text-muted-foreground/70">
            {t("chat.stopped")}
          </p>
        )}
        <ChatComposer
          project={project}
          projects={projects}
          head={git?.head ?? null}
          backend={backend}
          available={available}
          backendLocked={Boolean(detail)}
          onBackendChange={setPickedBackend}
          value={input}
          onChange={setInput}
          onSubmit={() => void send()}
          onStop={stop}
          streaming={streaming}
          error={sendError}
          textareaRef={textareaRef}
        />
      </div>
    </div>
  );
}

/** The project's past conversations. */
function SessionMenu({
  t,
  sessions,
  activeId,
  onOpen,
  onDelete,
}: {
  t: TFunc;
  sessions: { id: string; title: string; backend: ChatBackend; updatedAt: string }[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string, title: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {t("chat.sessions", { n: sessions.length })}
          <ChevronDown className="size-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>{t("chat.sessionsLabel")}</DropdownMenuLabel>
        {sessions.length === 0 ? (
          <div className="px-2 py-1.5 text-[13px] text-muted-foreground">{t("chat.noSessions")}</div>
        ) : (
          sessions.map((session) => (
            <DropdownMenuItem key={session.id} onSelect={() => onOpen(session.id)}>
              <Check
                className={cn(
                  "size-3.5 shrink-0 text-primary",
                  session.id === activeId ? "opacity-100" : "opacity-0",
                )}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{session.title || t("chat.untitled")}</span>
                <span className="truncate text-[11px] text-muted-foreground/60">
                  {t(`chat.backend.${session.backend}`)} · {relativeTime(t, session.updatedAt)}
                </span>
              </span>
              <button
                type="button"
                aria-label={t("chat.deleteTitle")}
                className="shrink-0 rounded p-1 text-muted-foreground/60 transition-colors hover:text-destructive"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete(session.id, session.title);
                }}
              >
                <Trash2 className="size-3.5" />
              </button>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChatMessageRow({
  msg,
  backend,
  streaming,
}: {
  msg: UIMsg;
  backend: ChatBackend;
  streaming: boolean;
}) {
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

  const thinking = streaming && !msg.content && msg.tools.length === 0 && !msg.error;

  return (
    <MessageRow align="start">
      <MessageAvatar>
        <LogoMark className="size-7" />
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>
          <BackendGlyph backend={backend} className="size-3.5 text-foreground/70" />
          {t(`chat.backend.${backend}`)}
        </MessageHeader>

        {msg.tools.map((tool) => (
          <ToolMarker key={tool.id} tool={tool} />
        ))}

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

function ToolMarker({ tool }: { tool: StreamTool }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const running = tool.result === undefined;
  const resultStr =
    typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result, null, 2);
  return (
    <div className="w-full">
      <Marker asChild variant="border" role={running ? "status" : undefined} className="w-full">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <MarkerIcon>{running ? <Spinner /> : <Wrench />}</MarkerIcon>
          <MarkerContent
            className={cn(
              "font-medium text-foreground",
              running && "shimmer",
              tool.isError && "text-destructive",
            )}
          >
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
