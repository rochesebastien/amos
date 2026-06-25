import { useEffect, useState } from "react";
import {
  MessageSquarePlus,
  MessagesSquare,
  FolderKanban,
  Plug,
  Settings as SettingsIcon,
  Moon,
  Sun,
  Trash2,
} from "lucide-react";
import { api, type Conversation } from "@/lib/api";
import { useApp, type View } from "@/lib/store";
import { cn } from "@/lib/utils";

const NAV: { view: View; label: string; icon: React.ElementType }[] = [
  { view: "chat", label: "Chat", icon: MessagesSquare },
  { view: "projects", label: "Projects", icon: FolderKanban },
  { view: "mcps", label: "MCPs", icon: Plug },
];

export function Sidebar() {
  const {
    view,
    setView,
    activeConversationId,
    setActiveConversation,
    startNewChat,
    theme,
    setTheme,
    dataVersion,
    refresh,
  } = useApp();
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    api.listConversations().then(setConversations).catch(() => setConversations([]));
  }, [dataVersion]);

  const removeConversation = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    await api.deleteConversation(id);
    if (activeConversationId === id) startNewChat();
    refresh();
  };

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* brand */}
      <div className="flex items-center gap-2 px-4 pt-5 pb-3">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-display text-sm">
          C
        </div>
        <span className="font-display text-lg">CheveluAI</span>
      </div>

      {/* new chat */}
      <div className="px-3 pb-2">
        <button
          onClick={() => startNewChat()}
          className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-card px-3 py-2 text-sm font-semibold transition-colors hover:bg-sidebar-accent"
        >
          <MessageSquarePlus className="size-4 text-primary" />
          New chat
        </button>
      </div>

      {/* nav */}
      <nav className="flex flex-col gap-0.5 px-3 py-2">
        {NAV.map(({ view: v, label, icon: Icon }) => {
          const active = view === v;
          return (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60",
              )}
            >
              <Icon className={cn("size-4", active && "text-primary")} />
              {label}
            </button>
          );
        })}
      </nav>

      {/* conversation history */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2">
        <div className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Recent
        </div>
        <div className="flex flex-col gap-0.5">
          {conversations.length === 0 && (
            <p className="px-1 py-2 text-[13px] text-muted-foreground/70">
              No conversations yet.
            </p>
          )}
          {conversations.map((c) => {
            const active = view === "chat" && activeConversationId === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setActiveConversation(c.id)}
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/60",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <Trash2
                  onClick={(e) => removeConversation(e, c.id)}
                  className="size-3.5 shrink-0 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-60"
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* foot */}
      <div className="flex items-center gap-1 border-t border-sidebar-border px-3 py-3">
        <button
          onClick={() => setView("settings")}
          className={cn(
            "flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
            view === "settings"
              ? "bg-sidebar-accent font-semibold"
              : "text-muted-foreground hover:bg-sidebar-accent/60",
          )}
        >
          <SettingsIcon className={cn("size-4", view === "settings" && "text-primary")} />
          Settings
        </button>
        <button
          title="Toggle theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </aside>
  );
}
