import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Home,
  Search,
  Settings as SettingsIcon,
  Moon,
  Sun,
  FolderOpen,
  Folder,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowDownUp,
  Check,
  ChevronRight,
  MessageSquare,
  Plus,
} from "lucide-react";
import { itemsOfKind, type CapabilityKind } from "@shared/capabilities";
import { useApp } from "@/lib/store";
import { useT, type TFunc } from "@/lib/i18n";
import { useProjectMutations, useProjects, useProjectScan } from "@/lib/queries";
import { ipc, type Project } from "@/lib/ipc";
import { useSidebar, type ProjectSort, SIDEBAR_RAIL } from "@/lib/sidebar";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm";
import { BrokenBadge, EcosystemBadge, KIND_ICONS, ScopeIcon } from "@/components/CapabilityBadges";
import { SearchPalette } from "@/components/SearchPalette";
import { cn } from "@/lib/utils";
import { LogoMark, LogoWordmark } from "@/components/Logo";

/**
 * The app rail. In this phase it holds a flat list of known projects; the
 * per-project Agents / Skills / MCPs sections hang off it in the next one, so
 * the rail, resize and collapse mechanics are kept intact.
 */
export function Sidebar() {
  const t = useT();
  const { theme, setTheme } = useApp();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const confirm = useConfirm();

  const { width, collapsed, sort, setWidth, setCollapsed, toggle, setSort } = useSidebar();
  const { data: projects = [] } = useProjects();
  const { add, remove, touch } = useProjectMutations();
  const [sortOpen, setSortOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // ⌘K / Ctrl+K opens the search palette from anywhere in the app frame.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeProjectId = pathname.startsWith("/p/") ? (pathname.split("/")[2] ?? null) : null;
  const onHome = pathname === "/";
  const onSettings = pathname.startsWith("/settings");

  const sorted = useMemo(() => {
    const list = [...projects];
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [projects, sort]);

  const openProject = async (p: Project) => {
    await touch.mutateAsync(p.id).catch(() => undefined);
    navigate({ to: "/p/$projectId", params: { projectId: p.id } });
  };

  const openFolder = async () => {
    const picked = await ipc.pickFolder();
    if (!picked.path) return;
    const project = await add.mutateAsync(picked.path);
    navigate({ to: "/p/$projectId", params: { projectId: project.id } });
  };

  const removeProject = async (e: React.MouseEvent, p: Project) => {
    e.stopPropagation();
    e.preventDefault();
    const ok = await confirm({
      title: t("projects.removeTitle"),
      description: t("projects.removeDesc", { name: p.name }),
      confirmText: t("common.remove"),
      destructive: true,
    });
    if (!ok) return;
    await remove.mutateAsync(p.id);
    if (activeProjectId === p.id) navigate({ to: "/" });
  };

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

  // ---------------------------------------------------------------- rail view
  if (collapsed) {
    return (
      <aside
        aria-label={t("sidebar.label")}
        style={{ width: SIDEBAR_RAIL }}
        className="flex h-full shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-4 text-sidebar-foreground"
      >
        <LogoMark className="mb-1 size-7" />
        <div className="my-1 h-px w-6 bg-sidebar-border" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/"
              aria-label={t("nav.home")}
              className={cn(
                "flex size-9 items-center justify-center rounded-lg transition-colors",
                onHome
                  ? "bg-sidebar-accent text-primary"
                  : "text-muted-foreground hover:bg-sidebar-accent/60",
              )}
            >
              <Home className="size-4" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">{t("nav.home")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label={t("nav.search")}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
            >
              <Search className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t("nav.search")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={openFolder}
              aria-label={t("sidebar.openFolder")}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
            >
              <Plus className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t("sidebar.openFolder")}</TooltipContent>
        </Tooltip>

        <div className="my-1 h-px w-6 bg-sidebar-border" />
        <nav
          aria-label={t("sidebar.projects")}
          className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto"
        >
          {sorted.map((p) => (
            <Tooltip key={p.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => void openProject(p)}
                  aria-label={t("sidebar.openProject", { name: p.name })}
                  aria-current={activeProjectId === p.id ? "page" : undefined}
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                    activeProjectId === p.id
                      ? "bg-sidebar-accent text-primary"
                      : "text-muted-foreground hover:bg-sidebar-accent/60",
                  )}
                >
                  {activeProjectId === p.id ? (
                    <FolderOpen className="size-4" />
                  ) : (
                    <Folder className="size-4" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{p.name}</TooltipContent>
            </Tooltip>
          ))}
        </nav>

        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/settings/general"
              aria-label={t("nav.settings")}
              className={cn(
                "flex size-9 items-center justify-center rounded-lg transition-colors",
                onSettings
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
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={t("nav.toggleTheme")}
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
              type="button"
              onClick={() => toggle()}
              aria-label={t("nav.expandSidebar")}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
            >
              <PanelLeftOpen className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t("nav.expandSidebar")}</TooltipContent>
        </Tooltip>
        <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      </aside>
    );
  }

  // ------------------------------------------------------------- expanded view
  return (
    <aside
      aria-label={t("sidebar.label")}
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      {/* brand */}
      <div className="px-7 pt-5 pb-4">
        <LogoWordmark className="h-5" />
      </div>

      {/* nav */}
      <nav aria-label={t("nav.main")} className="flex flex-col gap-0.5 px-3 py-1.5">
        <Link
          to="/"
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
            onHome
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/60",
          )}
        >
          <Home className={cn("size-4", onHome && "text-primary")} />
          {t("nav.home")}
        </Link>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
        >
          <Search className="size-4" />
          {t("nav.search")}
          <kbd className="ml-auto rounded border border-border bg-muted px-1 py-px font-sans text-[10px] text-muted-foreground/70">
            {navigator.platform.includes("Mac") ? "\u2318K" : "Ctrl K"}
          </kbd>
        </button>
      </nav>

      {/* projects */}
      <nav aria-label={t("sidebar.projects")} className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-2">
        <div className="flex items-center justify-between px-2 pb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            {t("sidebar.projects")}
          </span>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={openFolder}
                  aria-label={t("sidebar.openFolder")}
                  className="flex size-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("sidebar.openFolder")}</TooltipContent>
            </Tooltip>
            <div className="relative">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setSortOpen((o) => !o)}
                    aria-label={t("sidebar.sort")}
                    aria-haspopup="menu"
                    aria-expanded={sortOpen}
                    className="flex size-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
                  >
                    <ArrowDownUp className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("sidebar.sort")}</TooltipContent>
              </Tooltip>
              {sortOpen && (
                <>
                  <div
                    aria-hidden
                    className="fixed inset-0 z-10"
                    onClick={() => setSortOpen(false)}
                  />
                  <div
                    role="menu"
                    aria-label={t("sidebar.sort")}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setSortOpen(false);
                    }}
                    className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-sm"
                  >
                    {(
                      [
                        { key: "recent", label: t("sidebar.sortRecent") },
                        { key: "name", label: t("sidebar.sortName") },
                      ] as { key: ProjectSort; label: string }[]
                    ).map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        role="menuitemradio"
                        aria-checked={sort === opt.key}
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
        </div>

        {sorted.length === 0 && (
          <p className="px-2 py-2 text-[13px] text-muted-foreground/70">{t("sidebar.none")}</p>
        )}

        <div className="flex flex-col gap-0.5">
          {sorted.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              active={activeProjectId === p.id}
              onOpen={() => void openProject(p)}
              onRemove={(e) => void removeProject(e, p)}
            />
          ))}
        </div>
      </nav>

      {/* foot */}
      <div className="flex items-center gap-1 border-t border-sidebar-border px-3 py-3">
        <Link
          to="/settings/general"
          className={cn(
            "flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
            onSettings
              ? "bg-sidebar-accent"
              : "text-muted-foreground hover:bg-sidebar-accent/60",
          )}
        >
          <SettingsIcon className={cn("size-4", onSettings && "text-primary")} />
          {t("nav.settings")}
        </Link>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={t("nav.toggleTheme")}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("nav.toggleTheme")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => toggle()}
              aria-label={t("nav.collapseSidebar")}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("nav.collapseSidebar")}</TooltipContent>
        </Tooltip>
      </div>

      {/* Drag handle. Mouse-only on purpose: collapsing and expanding the
          sidebar is a labelled button above, so nothing here is keyboard-only
          functionality — the handle is a pointer shortcut for the same thing. */}
      <div
        aria-hidden
        onMouseDown={onDragStart}
        onDoubleClick={() => toggle()}
        title={t("nav.resizeHint")}
        className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-primary/40"
      />
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </aside>
  );
}

/** The three capability sections, in the order the sidebar shows them. */
const SECTIONS: { kind: CapabilityKind; labelKey: string }[] = [
  { kind: "agent", labelKey: "project.agents" },
  { kind: "mcp", labelKey: "project.mcps" },
  { kind: "skill", labelKey: "project.skills" },
];

/**
 * One project in the sidebar: a clickable name leading to the overview, and —
 * at its right — a chevron unfolding the Agents / MCPs / Skills the scanner
 * found. The scan only runs once a project is actually unfolded.
 */
function ProjectRow({
  project,
  active,
  onOpen,
  onRemove,
}: {
  project: Project;
  active: boolean;
  onOpen: () => void;
  onRemove: (e: React.MouseEvent) => void;
}) {
  const t = useT();
  const expandedIds = useSidebar((s) => s.expanded);
  const toggleExpanded = useSidebar((s) => s.toggleExpanded);
  const open = expandedIds.includes(project.id);
  const { data: scan, isPending, isError, error } = useProjectScan(project.id, open);

  return (
    <div>
      {/* The row is a container, not a control: the name is a real <button> so
          it is reachable by keyboard, and the chevron and the delete action sit
          next to it rather than nested inside another clickable element. */}
      <div
        className={cn(
          "group flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-colors",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/60",
        )}
      >
        <button
          type="button"
          onClick={onOpen}
          title={project.path}
          aria-label={t("sidebar.openProject", { name: project.name })}
          aria-current={active ? "page" : undefined}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {active ? (
            <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <Folder className="size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{project.name}</span>
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-expanded={open}
              aria-label={t(open ? "sidebar.collapseProject" : "sidebar.expandProject")}
              onClick={() => toggleExpanded(project.id)}
              className="shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-foreground"
            >
              <ChevronRight
                className={cn("size-3.5 transition-transform", open && "rotate-90")}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {t(open ? "sidebar.collapseProject" : "sidebar.expandProject")}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onRemove}
              aria-label={t("projects.remove")}
              className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-60"
            >
              <Trash2 className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t("projects.remove")}</TooltipContent>
        </Tooltip>
      </div>

      {open && (
        <div className="my-0.5 ml-5 border-l border-sidebar-border pl-1.5">
          <Link
            to="/p/$projectId/chat"
            params={{ projectId: project.id }}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
            activeProps={{
              className: "bg-sidebar-accent text-sidebar-accent-foreground",
            }}
          >
            <MessageSquare className="size-3" />
            <span className="min-w-0 flex-1 truncate">{t("chat.title")}</span>
          </Link>
          {isPending && (
            <p className="px-2 py-1 text-[12px] text-muted-foreground/60">
              {t("sidebar.scanning")}
            </p>
          )}
          {isError && (
            <p className="px-2 py-1 text-[12px] text-destructive">
              {t("project.scanFailed", { error: (error as Error).message })}
            </p>
          )}
          {scan &&
            SECTIONS.map((section) => (
              <CapabilitySection
                key={section.kind}
                t={t}
                projectId={project.id}
                kind={section.kind}
                label={t(section.labelKey)}
                items={itemsOfKind(scan.items, section.kind)}
              />
            ))}
        </div>
      )}
    </div>
  );
}

/** One `Agents` / `MCPs` / `Skills` group under an unfolded project. */
function CapabilitySection({
  t,
  projectId,
  kind,
  label,
  items,
}: {
  t: TFunc;
  projectId: string;
  kind: CapabilityKind;
  label: string;
  items: ReturnType<typeof itemsOfKind>;
}) {
  const Icon = KIND_ICONS[kind];
  return (
    <div className="group/section py-0.5">
      <div className="flex items-center gap-2 px-2 py-1 text-[13px] text-muted-foreground">
        <Icon className="size-3.5" />
        <span className="truncate">{label}</span>
        <span className="text-[11px] text-muted-foreground/50">{items.length}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/p/$projectId/new/$kind"
              params={{ projectId, kind }}
              aria-label={t(`new.title.${kind}`)}
              className="ml-auto rounded p-0.5 opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100 group-hover/section:opacity-100"
            >
              <Plus className="size-3.5" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">{t(`new.title.${kind}`)}</TooltipContent>
        </Tooltip>
      </div>
      {items.length === 0 ? (
        <p className="px-2 pb-0.5 pl-4 text-[12px] text-muted-foreground/50">
          {t("sidebar.sectionEmpty")}
        </p>
      ) : (
        items.map((item) => (
          <Link
            key={item.id}
            to="/p/$projectId/item/$itemId"
            params={{ projectId, itemId: item.id }}
            title={item.sourceFile}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
            activeProps={{
              className: "bg-sidebar-accent text-sidebar-accent-foreground",
            }}
          >
            <ScopeIcon scope={item.scope} />
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            {item.parseError != null && <BrokenBadge size="sm" />}
            <EcosystemBadge ecosystem={item.ecosystem} size="sm" />
          </Link>
        ))
      )}
    </div>
  );
}
