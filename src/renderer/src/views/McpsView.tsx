import { useMemo, useState } from "react";
import {
  Plug,
  Plus,
  Pencil,
  Copy,
  Trash2,
  FlaskConical,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Wrench,
  ChevronDown,
  ChevronRight,
  Search,
  X,
  ListChecks,
  ListX,
} from "lucide-react";
import { api, mcpToInput, type MCP, type MCPInput, type ToolPreview } from "@/lib/api";
import { useMcpMutations, useMcps } from "@/lib/queries";
import { McpModal, MCP_TYPE_ICON } from "@/components/McpModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function McpsView() {
  const t = useT();
  const { data: mcps = [] } = useMcps();
  const mutations = useMcpMutations();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MCP | null>(null);

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (m: MCP) => {
    setEditing(m);
    setOpen(true);
  };

  const remove = async (m: MCP) => {
    const ok = await confirm({
      title: t("mcps.deleteTitle"),
      description: t("mcps.deleteDescription", { name: m.name }),
      confirmText: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    await mutations.remove.mutateAsync(m.id);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 px-6 pt-8 pb-4">
        <div>
          <h1 className="text-3xl font-display">{t("nav.mcps")}</h1>
          <p className="mt-1 text-sm text-muted-foreground/70">
            {t("mcps.subtitle")}
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="size-4" /> {t("mcps.newMcp")}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {mcps.length === 0 ? (
          <EmptyState onNew={openNew} />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {mcps.map((m) => (
              <McpCard key={m.id} mcp={m} onEdit={openEdit} onRemove={remove} />
            ))}
          </div>
        )}
      </div>

      <McpModal open={open} onClose={() => setOpen(false)} mcp={editing} />
    </div>
  );
}

function McpCard({
  mcp: m,
  onEdit,
  onRemove,
}: {
  mcp: MCP;
  onEdit: (m: MCP) => void;
  onRemove: (m: MCP) => void;
}) {
  const t = useT();
  const mutations = useMcpMutations();
  const [showTools, setShowTools] = useState(false);
  const [query, setQuery] = useState("");
  const Icon = MCP_TYPE_ICON[m.type];

  // full-document PUT: preserve everything, override only what changed.
  const patch = (body: Partial<MCPInput>) =>
    mutations.update.mutate({ id: m.id, body: mcpToInput(m, body) });

  // Clone every field into a brand-new MCP, tacking a localized copy suffix
  // onto the name so the duplicate is easy to spot.
  const duplicate = () =>
    mutations.create.mutate(
      mcpToInput(m, { name: `${m.name} ${t("mcps.copySuffix")}` }),
    );

  const toggleTool = (name: string) =>
    patch({
      disabled_tools: m.disabled_tools.includes(name)
        ? m.disabled_tools.filter((x) => x !== name)
        : [...m.disabled_tools, name],
    });

  // Filter by tool name OR description (case-insensitive).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return m.tools;
    return m.tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(q) ||
        tool.description?.toLowerCase().includes(q),
    );
  }, [m.tools, query]);

  // Bulk actions operate on the currently filtered set, so a search term
  // scopes "enable/disable all" to the matching tools.
  const enableAll = (names: string[]) => {
    const drop = new Set(names);
    patch({ disabled_tools: m.disabled_tools.filter((x) => !drop.has(x)) });
  };
  const disableAll = (names: string[]) =>
    patch({ disabled_tools: [...new Set([...m.disabled_tools, ...names])] });

  return (
    <div className="group flex flex-col rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-primary" />
          <h3 className="font-display text-base">{m.name}</h3>
        </div>
        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={duplicate}
                disabled={mutations.create.isPending}
              >
                <Copy className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("mcps.duplicate")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" onClick={() => onEdit(m)}>
                <Pencil className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("mcps.edit")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" onClick={() => onRemove(m)}>
                <Trash2 className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("common.delete")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      {m.description && (
        <p className="mt-1.5 line-clamp-2 text-[13px] text-muted-foreground">{m.description}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{t(`mcps.type.${m.type}.label`)}</Badge>
        {m.project_ids.length > 0 && (
          <Badge variant="primary">
            {m.project_ids.length}{" "}
            {t(m.project_ids.length > 1 ? "mcps.projects" : "mcps.project")}
          </Badge>
        )}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Switch checked={m.enabled} onCheckedChange={() => patch({ enabled: !m.enabled })} />
          {m.enabled ? t("mcps.enabled") : t("mcps.disabled")}
        </label>
        <TestButton mcp={m} />
      </div>

      {/* per-tool switches — turn individual tools off without disabling the MCP */}
      {m.enabled && m.tools.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setShowTools((v) => !v)}
            className="flex w-full items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Wrench className="size-3.5 text-primary" />
            <span className="flex-1 text-left">{t("mcps.toolsTitle")}</span>
            <span className="text-[11px] text-muted-foreground">
              {t("mcps.toolsActiveOfTotal", { active: m.tool_count, total: m.tools.length })}
            </span>
            {showTools ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
          {showTools && (
            <div className="mt-2 flex flex-col gap-2">
              {/* search + bulk enable/disable of the filtered tools */}
              <div className="flex items-center gap-1.5">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("mcps.searchTools")}
                    className="h-8 w-full rounded-md border border-input bg-card pl-7 pr-7 text-[12px] text-foreground placeholder:text-muted-foreground outline-none transition-shadow focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="shrink-0"
                      disabled={filtered.length === 0}
                      onClick={() => enableAll(filtered.map((tool) => tool.name))}
                    >
                      <ListChecks className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("mcps.enableAll")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="shrink-0"
                      disabled={filtered.length === 0}
                      onClick={() => disableAll(filtered.map((tool) => tool.name))}
                    >
                      <ListX className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("mcps.disableAll")}</TooltipContent>
                </Tooltip>
              </div>

              {filtered.length === 0 ? (
                <p className="px-1 py-2 text-[12px] text-muted-foreground">
                  {t("mcps.noToolsMatch", { query: query.trim() })}
                </p>
              ) : (
                <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
                  {filtered.map((tool) => (
                    <li key={tool.name} className="flex items-start gap-2">
                      <Switch
                        className="mt-0.5"
                        checked={!m.disabled_tools.includes(tool.name)}
                        onCheckedChange={() => toggleTool(tool.name)}
                      />
                      <div className="flex min-w-0 flex-col">
                        <code className="truncate font-mono text-[12px] text-foreground">
                          {tool.name}
                        </code>
                        {tool.description && (
                          <span className="line-clamp-1 text-[11px] text-muted-foreground">
                            {tool.description}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TestButton({ mcp }: { mcp: MCP }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [tools, setTools] = useState<ToolPreview[]>([]);
  const [msg, setMsg] = useState("");

  const run = async () => {
    setState("loading");
    try {
      const res = await api.testMcp(mcp.id);
      if (res.ok) {
        setTools(res.tools);
        setState("ok");
      } else {
        setMsg(res.error ?? "failed");
        setState("err");
      }
    } catch (e: any) {
      setMsg(String(e.message ?? e));
      setState("err");
    }
  };

  const button = (
    <button
      onClick={run}
      title={state === "err" ? msg : state === "ok" ? undefined : t("mcps.testConnection")}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors hover:bg-accent",
        state === "ok" && "text-primary",
        state === "err" && "text-destructive",
        state === "idle" && "text-muted-foreground",
      )}
    >
      {state === "loading" ? (
        <FlaskConical className="size-3.5 animate-pulse" />
      ) : state === "ok" ? (
        <CheckCircle2 className="size-3.5" />
      ) : state === "err" ? (
        <XCircle className="size-3.5" />
      ) : (
        <FlaskConical className="size-3.5" />
      )}
      {state === "ok"
        ? `${tools.length} ${t(tools.length === 1 ? "mcps.tool" : "mcps.tools")}`
        : state === "err"
          ? t("mcps.error")
          : t("mcps.checkTools")}
    </button>
  );

  if (state !== "ok") return button;

  return (
    <HoverCard>
      <HoverCardTrigger asChild>{button}</HoverCardTrigger>
      <HoverCardContent align="end" className="w-80 max-w-[20rem]">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-medium text-muted-foreground">
              {tools.length} {t(tools.length === 1 ? "mcps.tool" : "mcps.tools")}
            </p>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={run}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <RefreshCw className="size-3" /> {t("mcps.refresh")}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("mcps.refreshTools")}</TooltipContent>
            </Tooltip>
          </div>
          {tools.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{t("mcps.noToolsExposed")}</p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
              {tools.map((tool) => (
                <li key={tool.name} className="flex flex-col gap-0.5">
                  <code className="font-mono text-[12px] font-medium text-foreground">
                    {tool.name}
                  </code>
                  {tool.description && (
                    <span className="line-clamp-2 text-[12px] text-muted-foreground">
                      {tool.description}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
        <Plug className="size-6" />
      </div>
      <h2 className="text-xl font-display">{t("mcps.emptyTitle")}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {t("mcps.emptyBody")}
      </p>
      <Button onClick={onNew} className="mt-1">
        <Plus className="size-4" /> {t("mcps.newMcp")}
      </Button>
    </div>
  );
}
