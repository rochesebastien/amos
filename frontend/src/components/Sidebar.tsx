import { useEffect, useMemo, useState } from "react";
import {
  MessageSquarePlus,
  MessagesSquare,
  FolderKanban,
  Plug,
  Settings as SettingsIcon,
  Moon,
  Sun,
  Trash2,
  ChevronRight,
  Folder,
  FolderOpen,
  Plus,
  Circle,
  Inbox,
} from "lucide-react";
import { api, type Conversation, type Project } from "@/lib/api";
import { useApp, type View } from "@/lib/store";
import { cn } from "@/lib/utils";

const NAV: { view: View; label: string; icon: React.ElementType }[] = [
  { view: "chat", label: "Chat", icon: MessagesSquare },
  { view: "projects", label: "Projects", icon: FolderKanban },
  { view: "mcps", label: "MCPs", icon: Plug },
];

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}j`;
  const w = Math.floor(d / 7);
  return `${w}sem`;
}

const NO_PROJECT = -1;

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
  const [projects, setProjects] = useState<Project[]>([]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  useEffect(() => {
    api.listConversations().then(setConversations).catch(() => setConversations([]));
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, [dataVersion]);

  const removeConversation = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    await api.deleteConversation(id);
    if (activeConversationId === id) startNewChat();
    refresh();
  };

  const toggle = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // group conversations by project, preserving project order; orphans last
  const groups = useMemo(() => {
    const byProject = new Map<number, Conversation[]>();
    for (const c of conversations) {
      const key = c.project_id ?? NO_PROJECT;
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(c);
    }
    const out: { id: number; name: string; convs: Conversation[] }[] = [];
    for (const p of projects) {
      out.push({ id: p.id, name: p.name, convs: byProject.get(p.id) ?? [] });
    }
    if (byProject.has(NO_PROJECT)) {
      out.push({ id: NO_PROJECT, name: "Sans projet", convs: byProject.get(NO_PROJECT)! });
    }
    return out;
  }, [conversations, projects]);

  const hasAnything = groups.some((g) => g.convs.length > 0);

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
      <nav className="flex flex-col gap-0.5 px-3 py-1.5">
        {NAV.map(({ view: v, label, icon: Icon }) => {
          const active = view === v;
          return (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
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

      {/* conversations grouped by project */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-2">
        <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Threads
        </div>

        {!hasAnything && projects.length === 0 && (
          <p className="px-2 py-2 text-[13px] text-muted-foreground/70">
            No conversations yet.
          </p>
        )}

        <div className="flex flex-col gap-0.5">
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.id);
            const isOrphan = g.id === NO_PROJECT;
            return (
              <div key={g.id} className="flex flex-col">
                {/* folder header */}
                <div
                  className="group/folder flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent/50"
                >
                  <button
                    onClick={() => toggle(g.id)}
                    className="flex min-w-0 flex-1 items-center gap-1.5"
                  >
                    <ChevronRight
                      className={cn(
                        "size-3.5 shrink-0 transition-transform",
                        !isCollapsed && "rotate-90",
                      )}
                    />
                    {isOrphan ? (
                      <Inbox className="size-3.5 shrink-0" />
                    ) : isCollapsed ? (
                      <Folder className="size-3.5 shrink-0" />
                    ) : (
                      <FolderOpen className="size-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-left font-medium">
                      {g.name}
                    </span>
                  </button>
                  {!isOrphan && (
                    <button
                      title={`New chat in ${g.name}`}
                      onClick={() => startNewChat(g.id)}
                      className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:text-foreground group-hover/folder:opacity-100"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  )}
                </div>

                {/* conversations */}
                {!isCollapsed && (
                  <div className="flex flex-col gap-0.5 pb-1">
                    {g.convs.length === 0 ? (
                      <p className="py-1 pl-7 text-[12px] text-muted-foreground/50">
                        No conversations
                      </p>
                    ) : (
                      g.convs.map((c) => {
                        const active = view === "chat" && activeConversationId === c.id;
                        return (
                          <button
                            key={c.id}
                            onClick={() => setActiveConversation(c.id)}
                            className={cn(
                              "group flex items-center gap-2 rounded-md py-1.5 pl-7 pr-2 text-left text-[13px] transition-colors",
                              active
                                ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                                : "text-muted-foreground hover:bg-sidebar-accent/60",
                            )}
                          >
                            <Circle
                              className={cn(
                                "size-2.5 shrink-0",
                                active ? "fill-primary text-primary" : "text-muted-foreground/50",
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate">{c.title}</span>
                            <Trash2
                              onClick={(e) => removeConversation(e, c.id)}
                              className="size-3.5 shrink-0 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-60"
                            />
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60 group-hover:hidden">
                              {relativeTime(c.updated_at)}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
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
