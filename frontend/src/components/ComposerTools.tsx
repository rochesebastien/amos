import { useState } from "react";
import {
  Plus,
  Paperclip,
  Folder,
  Pencil,
  Plug,
  Wrench,
  Check,
  X,
  Settings,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { mcpToInput, type MCP, type MCPInput, type Project } from "@/lib/api";
import { useMcps, useProjects, useProjectMutations, useMcpMutations } from "@/lib/queries";
import { McpModal, MCP_TYPE_ICON } from "@/components/McpModal";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/lib/i18n";

/**
 * The composer "+" menu — a single entry point to attach files, pick the
 * project the chat runs in, and add / edit / attach MCP tools. Owns the
 * project and MCP editor modals it can launch.
 */
export function ComposerAddMenu({
  projectId,
  onSelectProject,
  locked,
  onAttachFiles,
}: {
  projectId: number | null;
  onSelectProject: (id: number | null) => void;
  /** True once the conversation exists — the project can no longer change. */
  locked: boolean;
  onAttachFiles: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { data: projects = [] } = useProjects();
  const { data: mcps = [] } = useMcps();
  const projectMutations = useProjectMutations();
  const mcpMutations = useMcpMutations();

  const [menuOpen, setMenuOpen] = useState(false);
  const [mcpModal, setMcpModal] = useState<{ open: boolean; editing: MCP | null }>({
    open: false,
    editing: null,
  });

  const activeProject = projects.find((p) => p.id === projectId) ?? null;

  // attach / detach an MCP from the active project (the chat inherits the
  // project's MCP tools), persisting the whole project record.
  const toggleMcpAttach = (m: MCP) => {
    if (!activeProject) return;
    const next = activeProject.mcp_ids.includes(m.id)
      ? activeProject.mcp_ids.filter((x) => x !== m.id)
      : [...activeProject.mcp_ids, m.id];
    projectMutations.update.mutate({
      id: activeProject.id,
      body: {
        name: activeProject.name,
        description: activeProject.description,
        system_prompt: activeProject.system_prompt,
        model: activeProject.model,
        mcp_ids: next,
      },
    });
  };

  // global (all chats) MCP controls — a full-document PUT overriding one field.
  const patchMcp = (m: MCP, body: Partial<MCPInput>) =>
    mcpMutations.update.mutate({ id: m.id, body: mcpToInput(m, body) });

  const toggleMcpEnabled = (m: MCP) => patchMcp(m, { enabled: !m.enabled });

  const toggleTool = (m: MCP, name: string) =>
    patchMcp(m, {
      disabled_tools: m.disabled_tools.includes(name)
        ? m.disabled_tools.filter((x) => x !== name)
        : [...m.disabled_tools, name],
    });

  const launch = (fn: () => void) => {
    setMenuOpen(false);
    fn();
  };

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label={t("composer.add")}>
                <Plus className="size-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("composer.add")}</TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="start" side="top" className="w-64">
          <DropdownMenuItem onSelect={() => launch(onAttachFiles)}>
            <Paperclip className="size-4 text-muted-foreground" />
            <span className="flex-1">{t("composer.attachFiles")}</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Project picker */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Folder className="size-4 text-primary" />
              <span className="flex-1 truncate">
                {activeProject ? activeProject.name : t("composer.addToProject")}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-60">
              <DropdownMenuItem
                disabled={locked}
                onSelect={() => onSelectProject(null)}
              >
                <Folder className="size-4 text-muted-foreground" />
                <span className="flex-1">{t("threads.noProject")}</span>
                {projectId == null && <Check className="size-3.5 shrink-0 text-primary" />}
              </DropdownMenuItem>
              {projects.length > 0 && <DropdownMenuSeparator />}
              {projects.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  disabled={locked}
                  onSelect={() => onSelectProject(p.id)}
                >
                  <Folder className="size-4 text-primary" />
                  <span className="flex-1 truncate">{p.name}</span>
                  {projectId === p.id && <Check className="size-3.5 shrink-0 text-primary" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => launch(() => navigate({ to: "/projects" }))}>
                <Settings className="size-4 text-muted-foreground" />
                <span className="flex-1">{t("composer.manageProjects")}</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* MCP tools */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Plug className="size-4 text-primary" />
              <span className="flex-1">{t("composer.mcpTools")}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-72">
              <DropdownMenuLabel>{t("composer.mcpToolsLabel")}</DropdownMenuLabel>
              {!activeProject ? (
                <div className="px-2 py-1.5 text-[13px] text-muted-foreground">
                  {t("composer.mcpPickProject")}
                </div>
              ) : mcps.length === 0 ? (
                <div className="px-2 py-1.5 text-[13px] text-muted-foreground">
                  {t("composer.noMcpsYet")}
                </div>
              ) : (
                mcps.map((m) => {
                  const Icon = MCP_TYPE_ICON[m.type];
                  const attached = activeProject.mcp_ids.includes(m.id);
                  return (
                    <DropdownMenuSub key={m.id}>
                      <DropdownMenuSubTrigger>
                        <span className="flex size-3.5 shrink-0 items-center justify-center">
                          {attached && <Check className="size-3.5 text-primary" />}
                        </span>
                        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{m.name}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {m.enabled
                            ? t(m.tool_count === 1 ? "chat.toolCountOne" : "chat.toolCountOther", {
                                n: m.tool_count,
                              })
                            : t("mcps.disabled")}
                        </span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-[60vh] w-72 overflow-y-auto">
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            toggleMcpAttach(m);
                          }}
                        >
                          <span className="flex size-3.5 shrink-0 items-center justify-center">
                            {attached && <Check className="size-3.5 text-primary" />}
                          </span>
                          <span className="flex-1">{t("composer.attachToProject")}</span>
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>{t("composer.availability")}</DropdownMenuLabel>

                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            toggleMcpEnabled(m);
                          }}
                        >
                          <Switch
                            checked={m.enabled}
                            onCheckedChange={() => {}}
                            className="pointer-events-none"
                          />
                          <span className="flex-1">
                            {m.enabled ? t("composer.mcpEnabled") : t("composer.mcpDisabled")}
                          </span>
                        </DropdownMenuItem>

                        {m.enabled && m.tools.length > 0 && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>{t("mcps.toolsTitle")}</DropdownMenuLabel>
                            {m.tools.map((tool) => {
                              const on = !m.disabled_tools.includes(tool.name);
                              return (
                                <DropdownMenuItem
                                  key={tool.name}
                                  onSelect={(e) => {
                                    e.preventDefault();
                                    toggleTool(m, tool.name);
                                  }}
                                >
                                  <Switch
                                    checked={on}
                                    onCheckedChange={() => {}}
                                    className="pointer-events-none"
                                  />
                                  <span className="flex-1 truncate font-mono text-[12px]">
                                    {tool.name}
                                  </span>
                                </DropdownMenuItem>
                              );
                            })}
                          </>
                        )}

                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => launch(() => setMcpModal({ open: true, editing: m }))}
                        >
                          <Pencil className="size-3.5 text-muted-foreground" />
                          <span className="flex-1">{t("mcps.edit")}</span>
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  );
                })
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => launch(() => navigate({ to: "/mcps" }))}>
                <Settings className="size-4 text-muted-foreground" />
                <span className="flex-1">{t("composer.manageMcps")}</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      <McpModal
        open={mcpModal.open}
        mcp={mcpModal.editing}
        attachProjectId={projectId}
        onClose={() => setMcpModal({ open: false, editing: null })}
      />
    </>
  );
}

/** Chip showing the project the chat runs in, with a quick detach action. */
export function ProjectChip({
  project,
  onClear,
  locked,
}: {
  project: Project;
  onClear: () => void;
  locked: boolean;
}) {
  const t = useT();
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 pl-2 pr-1 text-[12px] font-medium">
      <Folder className="size-3.5 text-primary" />
      <span className="max-w-[160px] truncate">{project.name}</span>
      {!locked && (
        <button
          type="button"
          aria-label={t("composer.clearProject")}
          onClick={onClear}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

/**
 * Chip showing the total number of tools active for the chat, with a hover
 * card breaking the count down by MCP connector.
 */
export function ToolsChip({ activeMcps }: { activeMcps: MCP[] }) {
  const t = useT();
  const total = activeMcps.reduce((n, m) => n + m.tool_count, 0);
  if (total === 0) return null;

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <span className="inline-flex h-7 cursor-default items-center gap-1.5 rounded-md border border-border bg-card px-2 text-[12px] font-medium">
          <Wrench className="size-3.5 text-primary" />
          {t(total === 1 ? "chat.toolCountOne" : "chat.toolCountOther", { n: total })}
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72">
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {t("chat.activeMcps")}
          </p>
          <ul className="flex flex-col gap-1.5">
            {activeMcps.map((m) => {
              const Icon = MCP_TYPE_ICON[m.type];
              return (
                <li key={m.id} className="flex items-center gap-2 text-[13px]">
                  <Icon className="size-3.5 shrink-0 text-primary" />
                  <span className="flex-1 truncate">{m.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {t(m.tool_count === 1 ? "chat.toolCountOne" : "chat.toolCountOther", {
                      n: m.tool_count,
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
