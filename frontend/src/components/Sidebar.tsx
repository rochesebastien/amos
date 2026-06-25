import { useEffect, useMemo, useRef, useState } from "react";
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
  PanelLeftClose,
  PanelLeftOpen,
  ArrowDownUp,
  Check,
} from "lucide-react";
import { api, type Conversation, type Project } from "@/lib/api";
import { useApp, type View } from "@/lib/store";
import {
  useSidebar,
  type ProjectSort,
  SIDEBAR_RAIL,
} from "@/lib/sidebar";
import { cn } from "@/lib/utils";

const NAV: { view: View; label: string; icon: React.ElementType }[] = [
  { view: "chat", label: "Chat", icon: MessagesSquare },
  { view: "projects", label: "Projects", icon: FolderKanban },
  { view: "mcps", label: "MCPs", icon: Plug },
];

const NO_PROJECT = -1;

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
  return `${Math.floor(d / 7)}sem`;
}

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
  const { width, collapsed, sort, setWidth, setCollapsed, toggle, setSort } = useSidebar();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [folded, setFolded] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [sortOpen, setSortOpen] = useState(false);

  useEffect(() => {
    api.listConversations().then(setConversations).catch(() => setConversations([]));
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, [dataVersion]);

  // ----- drag to resize -----
  const dragging = useRef(false);
  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startW = width;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const onMove = (ev: MouseEvent) => {
      const w = startW + (ev.clientX - startX);
      if (w < 180) {
        setCollapsed(true);
        onUp();
        return;
      }
      setWidth(w);
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const toggleFold = (id: number) =>
    setFolded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const removeConversation = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    await api.deleteConversation(id);
    if (activeConversationId === id) startNewChat();
    refresh();
  };

  const startRename = (e: React.MouseEvent, c: Conversation) => {
    e.stopPropagation();
    setEditingId(c.id);
    setEditValue(c.title);
  };
  const commitRename = async () => {
    if (editingId == null) return;
    const id = editingId;
    const value = editValue.trim();
    setEditingId(null);
    const current = conversations.find((c) => c.id === id);
    if (value && current && value !== current.title) {
      await api.renameConversation(id, value);
      refresh();
    }
  };

  // ----- group + sort -----
  const groups = useMemo(() => {
    const byProject = new Map<number, Conversation[]>();
    for (const c of conversations) {
      const key = c.project_id ?? NO_PROJECT;
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(c);
    }
    const sorted = [...projects].sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
    const out: { id: number; name: string; convs: Conversation[] }[] = sorted.map((p) => ({
      id: p.id,
      name: p.name,
      convs: byProject.get(p.id) ?? [],
    }));
    if (byProject.has(NO_PROJECT)) {
      out.push({ id: NO_PROJECT, name: "Sans projet", convs: byProject.get(NO_PROJECT)! });
    }
    return out;
  }, [conversations, projects, sort]);

  const hasAnything = groups.some((g) => g.convs.length > 0);

  // ---------------------------------------------------------------- rail view
  if (collapsed) {
    return (
      <aside
        style={{ width: SIDEBAR_RAIL }}
        className="flex h-full shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-4 text-sidebar-foreground"
      >
        <button
          onClick={() => toggle()}
          title="Expand sidebar"
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
        >
          <PanelLeftOpen className="size-4" />
        </button>
        <button
          onClick={() => startNewChat()}
          title="New chat"
          className="flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent/60"
        >
          <MessageSquarePlus className="size-4 text-primary" />
        </button>
        <div className="my-1 h-px w-6 bg-sidebar-border" />
        {NAV.map(({ view: v, label, icon: Icon }) => (
          <button
            key={v}
            onClick={() => setView(v)}
            title={label}
            className={cn(
              "flex size-9 items-center justify-center rounded-lg transition-colors",
              view === v ? "bg-sidebar-accent text-primary" : "text-muted-foreground hover:bg-sidebar-accent/60",
            )}
          >
            <Icon className="size-4" />
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => setView("settings")}
          title="Settings"
          className={cn(
            "flex size-9 items-center justify-center rounded-lg transition-colors",
            view === "settings" ? "bg-sidebar-accent text-primary" : "text-muted-foreground hover:bg-sidebar-accent/60",
          )}
        >
          <SettingsIcon className="size-4" />
        </button>
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title="Toggle theme"
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </aside>
    );
  }

  // ------------------------------------------------------------- expanded view
  return (
    <aside
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      {/* brand + collapse */}
      <div className="flex items-center gap-2 px-4 pt-5 pb-3">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-display text-sm">
          C
        </div>
        <span className="min-w-0 flex-1 truncate font-display text-lg">CheveluAI</span>
        <button
          onClick={() => toggle()}
          title="Collapse sidebar"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
        >
          <PanelLeftClose className="size-4" />
        </button>
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

      {/* threads */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-2">
        <div className="flex items-center justify-between px-2 pb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Threads
          </span>
          <div className="relative">
            <button
              onClick={() => setSortOpen((o) => !o)}
              title="Sort projects"
              className="flex size-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
            >
              <ArrowDownUp className="size-3.5" />
            </button>
            {sortOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-sm">
                  {(
                    [
                      { key: "recent", label: "Most recent" },
                      { key: "name", label: "Name (A–Z)" },
                    ] as { key: ProjectSort; label: string }[]
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => {
                        setSort(opt.key);
                        setSortOpen(false);
                      }}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
                    >
                      {opt.label}
                      {sort === opt.key && <Check className="size-3.5 text-primary" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {!hasAnything && projects.length === 0 && (
          <p className="px-2 py-2 text-[13px] text-muted-foreground/70">No conversations yet.</p>
        )}

        <div className="flex flex-col gap-0.5">
          {groups.map((g) => {
            const isFolded = folded.has(g.id);
            const isOrphan = g.id === NO_PROJECT;
            return (
              <div key={g.id} className="flex flex-col">
                <div className="group/folder flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent/50">
                  <button onClick={() => toggleFold(g.id)} className="flex min-w-0 flex-1 items-center gap-1.5">
                    <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", !isFolded && "rotate-90")} />
                    {isOrphan ? (
                      <Inbox className="size-3.5 shrink-0" />
                    ) : isFolded ? (
                      <Folder className="size-3.5 shrink-0" />
                    ) : (
                      <FolderOpen className="size-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-left font-medium">{g.name}</span>
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

                {!isFolded && (
                  <div className="flex flex-col gap-0.5 pb-1">
                    {g.convs.length === 0 ? (
                      <p className="py-1 pl-7 text-[12px] text-muted-foreground/50">No conversations</p>
                    ) : (
                      g.convs.map((c) => {
                        const active = view === "chat" && activeConversationId === c.id;
                        const editing = editingId === c.id;
                        return (
                          <div
                            key={c.id}
                            onClick={() => !editing && setActiveConversation(c.id)}
                            onDoubleClick={(e) => startRename(e, c)}
                            className={cn(
                              "group flex cursor-pointer items-center gap-2 rounded-md py-1.5 pl-7 pr-2 text-left text-[13px] transition-colors",
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
                            {editing ? (
                              <input
                                autoFocus
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={commitRename}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitRename();
                                  if (e.key === "Escape") setEditingId(null);
                                }}
                                className="min-w-0 flex-1 rounded border border-input bg-card px-1 py-0.5 text-[13px] outline-none focus-visible:border-ring"
                              />
                            ) : (
                              <>
                                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                                <Trash2
                                  onClick={(e) => removeConversation(e, c.id)}
                                  className="size-3.5 shrink-0 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-60"
                                />
                                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60 group-hover:hidden">
                                  {relativeTime(c.updated_at)}
                                </span>
                              </>
                            )}
                          </div>
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
            view === "settings" ? "bg-sidebar-accent font-semibold" : "text-muted-foreground hover:bg-sidebar-accent/60",
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

      {/* drag handle */}
      <div
        onMouseDown={onDragStart}
        onDoubleClick={() => toggle()}
        title="Drag to resize · double-click to collapse"
        className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-primary/40"
      />
    </aside>
  );
}
