import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
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
  Pencil,
} from "lucide-react";
import { api, type Conversation, type Project } from "@/lib/api";
import { useApp } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { qk, useConversations, useProjects } from "@/lib/queries";
import { useSidebar, type ProjectSort, SIDEBAR_RAIL } from "@/lib/sidebar";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm";
import { ProjectModal } from "@/components/ProjectModal";
import { cn } from "@/lib/utils";
import logoIcon from "@/assets/logo.png";
import logoTitleBlack from "@/assets/logo_title_black.png";
import logoTitleLight from "@/assets/logo_title_light.png";

const NAV: { to: string; labelKey: string; icon: React.ElementType }[] = [
  { to: "/", labelKey: "nav.chat", icon: MessagesSquare },
  { to: "/projects", labelKey: "nav.projects", icon: FolderKanban },
  { to: "/mcps", labelKey: "nav.mcps", icon: Plug },
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
  const t = useT();
  const { theme, setTheme } = useApp();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const isChat = pathname === "/" || pathname.startsWith("/c/");
  const activeConversationId = pathname.startsWith("/c/")
    ? Number(pathname.split("/")[2])
    : null;

  const { width, collapsed, sort, folded, setWidth, setCollapsed, toggle, setSort, toggleFold } =
    useSidebar();

  const { data: conversations = [] } = useConversations();
  const { data: projects = [] } = useProjects();
  const confirm = useConfirm();
  const [sortOpen, setSortOpen] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);

  // inline editing
  const [editConvId, setEditConvId] = useState<number | null>(null);
  const [editConvValue, setEditConvValue] = useState("");
  const [editProjId, setEditProjId] = useState<number | null>(null);
  const [editProjValue, setEditProjValue] = useState("");

  // drag & drop
  const draggedConv = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  const startNewChat = (projectId?: number | null) =>
    navigate({ to: "/", search: projectId ? { project: projectId } : {} });
  const openConversation = (id: number) =>
    navigate({ to: "/c/$conversationId", params: { conversationId: String(id) } });
  const refreshConversations = () => qc.invalidateQueries({ queryKey: qk.conversations });

  const isNavActive = (to: string) => (to === "/" ? isChat : pathname === to);

  // ----- drag to resize -----
  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
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
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const removeConversation = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    e.preventDefault();
    const conv = conversations.find((c) => c.id === id);
    const ok = await confirm({
      title: t("confirm.deleteConv.title"),
      description: t("confirm.deleteConv.desc", { title: conv?.title ?? "" }),
      confirmText: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    await api.deleteConversation(id);
    if (activeConversationId === id) startNewChat();
    refreshConversations();
  };

  // ----- conversation rename -----
  const startConvRename = (e: React.MouseEvent, c: Conversation) => {
    e.stopPropagation();
    e.preventDefault();
    setEditConvId(c.id);
    setEditConvValue(c.title);
  };
  const commitConvRename = async () => {
    if (editConvId == null) return;
    const id = editConvId;
    const value = editConvValue.trim();
    setEditConvId(null);
    const current = conversations.find((c) => c.id === id);
    if (value && current && value !== current.title) {
      const ok = await confirm({
        title: t("confirm.renameConv.title"),
        description: t("confirm.renameConv.desc", { from: current.title, to: value }),
        confirmText: t("common.rename"),
      });
      if (!ok) return;
      await api.renameConversation(id, value);
      refreshConversations();
    }
  };

  // ----- project rename -----
  const startProjRename = (e: React.MouseEvent, id: number, name: string) => {
    e.stopPropagation();
    setEditProjId(id);
    setEditProjValue(name);
  };
  const commitProjRename = async () => {
    if (editProjId == null) return;
    const id = editProjId;
    const value = editProjValue.trim();
    setEditProjId(null);
    const p = projects.find((x) => x.id === id);
    if (value && p && value !== p.name) {
      const ok = await confirm({
        title: t("confirm.renameProj.title"),
        description: t("confirm.renameProj.desc", { from: p.name, to: value }),
        confirmText: t("common.rename"),
      });
      if (!ok) return;
      await api.updateProject(id, {
        name: value,
        description: p.description,
        system_prompt: p.system_prompt,
        model: p.model,
        mcp_ids: p.mcp_ids,
      });
      qc.invalidateQueries({ queryKey: qk.projects });
    }
  };

  // ----- drag & drop move -----
  const onDropToGroup = async (groupId: number) => {
    const convId = draggedConv.current;
    draggedConv.current = null;
    setDropTarget(null);
    if (convId == null) return;
    const conv = conversations.find((c) => c.id === convId);
    const target = groupId === NO_PROJECT ? null : groupId;
    if (!conv || conv.project_id === target) return;
    const targetName =
      target == null
        ? t("threads.noProject")
        : (projects.find((p) => p.id === target)?.name ?? t("threads.noProject"));
    const ok = await confirm({
      title: t("confirm.moveConv.title"),
      description: t("confirm.moveConv.desc", { title: conv.title, target: targetName }),
      confirmText: t("common.move"),
    });
    if (!ok) return;
    // optimistic
    qc.setQueryData<Conversation[]>(qk.conversations, (cs) =>
      (cs ?? []).map((c) => (c.id === convId ? { ...c, project_id: target } : c)),
    );
    await api.updateConversation(convId, { project_id: target });
    refreshConversations();
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
      out.push({ id: NO_PROJECT, name: "", convs: byProject.get(NO_PROJECT)! });
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
        <img src={logoIcon} alt="CheveluAI" className="mb-1 size-8" />
        <div className="my-1 h-px w-6 bg-sidebar-border" />
        {NAV.map(({ to, labelKey, icon: Icon }) => (
          <Tooltip key={to}>
            <TooltipTrigger asChild>
              <Link
                to={to}
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg transition-colors",
                  isNavActive(to)
                    ? "bg-sidebar-accent text-primary"
                    : "text-muted-foreground hover:bg-sidebar-accent/60",
                )}
              >
                <Icon className="size-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{t(labelKey)}</TooltipContent>
          </Tooltip>
        ))}
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/settings"
              className={cn(
                "flex size-9 items-center justify-center rounded-lg transition-colors",
                pathname === "/settings"
                  ? "bg-sidebar-accent text-primary"
                  : "text-muted-foreground hover:bg-sidebar-accent/60",
              )}
            >
              <SettingsIcon className="size-4" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">{t("nav.settings")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t("nav.toggleTheme")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => toggle()}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
            >
              <PanelLeftOpen className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t("nav.expandSidebar")}</TooltipContent>
        </Tooltip>
      </aside>
    );
  }

  // ------------------------------------------------------------- expanded view
  return (
    <aside
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      {/* brand */}
      <div className="px-3 pt-4 pb-3">
        <img src={logoTitleBlack} alt="CheveluAI" className="h-12 w-full object-contain px-4 dark:hidden" />
        <img src={logoTitleLight} alt="CheveluAI" className="hidden h-12 w-full object-contain px-4 dark:block" />
      </div>

      {/* nav */}
      <nav className="flex flex-col gap-0.5 px-3 py-1.5">
        {NAV.map(({ to, labelKey, icon: Icon }) => {
          const active = isNavActive(to);
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60",
              )}
            >
              <Icon className={cn("size-4", active && "text-primary")} />
              {t(labelKey)}
            </Link>
          );
        })}
      </nav>

      {/* threads */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-2">
        <div className="flex items-center justify-between px-2 pb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            {t("threads.title")}
          </span>
          <div className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setSortOpen((o) => !o)}
                  className="flex size-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
                >
                  <ArrowDownUp className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("threads.sortProjects")}</TooltipContent>
            </Tooltip>
            {sortOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-sm">
                  {(
                    [
                      { key: "recent", label: t("threads.mostRecent") },
                      { key: "name", label: t("threads.nameAsc") },
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
          <p className="px-2 py-2 text-[13px] text-muted-foreground/70">{t("threads.none")}</p>
        )}

        <div className="flex flex-col gap-0.5">
          {groups.map((g) => {
            const isFolded = folded.includes(g.id);
            const isOrphan = g.id === NO_PROJECT;
            const isDropTarget = dropTarget === g.id;
            return (
              <div
                key={g.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dropTarget !== g.id) setDropTarget(g.id);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null);
                }}
                onDrop={() => onDropToGroup(g.id)}
                className={cn(
                  "flex flex-col rounded-md",
                  isDropTarget && "bg-primary/10 ring-1 ring-primary/40",
                )}
              >
                <div className="group/folder flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent/50">
                  <button
                    onClick={() => toggleFold(g.id)}
                    className="flex shrink-0 items-center"
                    title={isFolded ? "Expand" : "Collapse"}
                  >
                    <ChevronRight className={cn("size-3.5 transition-transform", !isFolded && "rotate-90")} />
                  </button>
                  {isOrphan ? (
                    <Inbox className="size-3.5 shrink-0" />
                  ) : isFolded ? (
                    <Folder className="size-3.5 shrink-0" />
                  ) : (
                    <FolderOpen className="size-3.5 shrink-0" />
                  )}
                  {editProjId === g.id ? (
                    <input
                      autoFocus
                      value={editProjValue}
                      onChange={(e) => setEditProjValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={commitProjRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitProjRename();
                        if (e.key === "Escape") setEditProjId(null);
                      }}
                      className="min-w-0 flex-1 rounded border border-input bg-card px-1 py-0.5 text-[13px] font-medium outline-none focus-visible:border-ring"
                    />
                  ) : (
                    <button
                      onClick={() => toggleFold(g.id)}
                      onDoubleClick={(e) => !isOrphan && startProjRename(e, g.id, g.name)}
                      className="min-w-0 flex-1 truncate text-left font-medium"
                      title={isOrphan ? undefined : t("threads.doubleClickRename")}
                    >
                      {isOrphan ? t("threads.noProject") : g.name}
                    </button>
                  )}
                  {!isOrphan && (
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => {
                              const p = projects.find((x) => x.id === g.id);
                              if (p) setEditProject(p);
                            }}
                            className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:text-foreground group-hover/folder:opacity-100"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">{t("threads.edit", { name: g.name })}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => startNewChat(g.id)}
                            className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:text-foreground group-hover/folder:opacity-100"
                          >
                            <Plus className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">{t("threads.newChatIn", { name: g.name })}</TooltipContent>
                      </Tooltip>
                    </>
                  )}
                </div>

                {!isFolded && (
                  <div className="flex flex-col gap-0.5 pb-1">
                    {g.convs.length === 0 ? (
                      <p className="py-1 pl-7 text-[12px] text-muted-foreground/50">
                        {isDropTarget ? t("threads.dropHere") : t("threads.noConversations")}
                      </p>
                    ) : (
                      g.convs.map((c) => {
                        const active = isChat && activeConversationId === c.id;
                        const editing = editConvId === c.id;
                        return (
                          <div
                            key={c.id}
                            draggable={!editing}
                            onDragStart={() => (draggedConv.current = c.id)}
                            onDragEnd={() => {
                              draggedConv.current = null;
                              setDropTarget(null);
                            }}
                            onClick={() => !editing && openConversation(c.id)}
                            onDoubleClick={(e) => startConvRename(e, c)}
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
                                value={editConvValue}
                                onChange={(e) => setEditConvValue(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={commitConvRename}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitConvRename();
                                  if (e.key === "Escape") setEditConvId(null);
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
        <Link
          to="/settings"
          className={cn(
            "flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
            pathname === "/settings"
              ? "bg-sidebar-accent font-semibold"
              : "text-muted-foreground hover:bg-sidebar-accent/60",
          )}
        >
          <SettingsIcon className={cn("size-4", pathname === "/settings" && "text-primary")} />
          {t("nav.settings")}
        </Link>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>Toggle theme</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => toggle()}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("nav.collapseSidebar")}</TooltipContent>
        </Tooltip>
      </div>

      {/* drag handle */}
      <div
        onMouseDown={onDragStart}
        onDoubleClick={() => toggle()}
        title="Drag to resize · double-click to collapse"
        className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-primary/40"
      />

      <ProjectModal
        open={editProject !== null}
        onClose={() => setEditProject(null)}
        project={editProject}
      />
    </aside>
  );
}
