import { useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Home,
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
  Plus,
} from "lucide-react";
import { useApp } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { useProjectMutations, useProjects } from "@/lib/queries";
import { ipc, type Project } from "@/lib/ipc";
import { useSidebar, type ProjectSort, SIDEBAR_RAIL } from "@/lib/sidebar";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm";
import { cn } from "@/lib/utils";
import logoIcon from "@/assets/logo.png";
import logoTitleBlack from "@/assets/logo_title_black.png";
import logoTitleLight from "@/assets/logo_title_light.png";

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
        style={{ width: SIDEBAR_RAIL }}
        className="flex h-full shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-4 text-sidebar-foreground"
      >
        <img src={logoIcon} alt="AMOS" className="mb-1 size-8" />
        <div className="my-1 h-px w-6 bg-sidebar-border" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/"
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
              onClick={openFolder}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
            >
              <Plus className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t("sidebar.openFolder")}</TooltipContent>
        </Tooltip>

        <div className="my-1 h-px w-6 bg-sidebar-border" />
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
          {sorted.map((p) => (
            <Tooltip key={p.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => void openProject(p)}
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
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/settings/general"
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
        <img
          src={logoTitleBlack}
          alt="AMOS"
          className="h-12 w-full object-contain px-4 dark:hidden"
        />
        <img
          src={logoTitleLight}
          alt="AMOS"
          className="hidden h-12 w-full object-contain px-4 dark:block"
        />
      </div>

      {/* nav */}
      <nav className="flex flex-col gap-0.5 px-3 py-1.5">
        <Link
          to="/"
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
            onHome
              ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/60",
          )}
        >
          <Home className={cn("size-4", onHome && "text-primary")} />
          {t("nav.home")}
        </Link>
      </nav>

      {/* projects */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-2">
        <div className="flex items-center justify-between px-2 pb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            {t("sidebar.projects")}
          </span>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={openFolder}
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
                    onClick={() => setSortOpen((o) => !o)}
                    className="flex size-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
                  >
                    <ArrowDownUp className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("sidebar.sort")}</TooltipContent>
              </Tooltip>
              {sortOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                  <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-sm">
                    {(
                      [
                        { key: "recent", label: t("sidebar.sortRecent") },
                        { key: "name", label: t("sidebar.sortName") },
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
        </div>

        {sorted.length === 0 && (
          <p className="px-2 py-2 text-[13px] text-muted-foreground/70">{t("sidebar.none")}</p>
        )}

        <div className="flex flex-col gap-0.5">
          {sorted.map((p) => {
            const active = activeProjectId === p.id;
            return (
              <div
                key={p.id}
                onClick={() => void openProject(p)}
                title={p.path}
                className={cn(
                  "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                  active
                    ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60",
                )}
              >
                {active ? (
                  <FolderOpen className="size-3.5 shrink-0 text-primary" />
                ) : (
                  <Folder className="size-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={(e) => void removeProject(e, p)}
                      className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-60"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{t("projects.remove")}</TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </div>
      </div>

      {/* foot */}
      <div className="flex items-center gap-1 border-t border-sidebar-border px-3 py-3">
        <Link
          to="/settings/general"
          className={cn(
            "flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
            onSettings
              ? "bg-sidebar-accent font-semibold"
              : "text-muted-foreground hover:bg-sidebar-accent/60",
          )}
        >
          <SettingsIcon className={cn("size-4", onSettings && "text-primary")} />
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
          <TooltipContent>{t("nav.toggleTheme")}</TooltipContent>
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
        title={t("nav.resizeHint")}
        className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-primary/40"
      />
    </aside>
  );
}
