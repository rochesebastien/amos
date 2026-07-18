import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Sparkles,
  Link2,
  Plus,
  RefreshCw,
  Check,
  Trash2,
  AlertTriangle,
  FolderGit2,
} from "lucide-react";
import { type AgentFile, type Project } from "@/lib/api";
import {
  qk,
  useAgentDir,
  useAgentFile,
  useAgentFileMutations,
  useProjectMutations,
  useProjects,
} from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const CLAUDE_MD = "CLAUDE.md";
const AGENTS_MD = "AGENTS.md";

const AGENT_TEMPLATE = (slug: string) =>
  `---\nname: ${slug}\ndescription: \n---\n\n# ${slug}\n\nDescribe what this agent does.\n`;
const SKILL_TEMPLATE = (slug: string) =>
  `---\nname: ${slug}\ndescription: \n---\n\n# ${slug}\n\nDescribe what this skill does.\n`;
const INSTRUCTIONS_TEMPLATE = "# Project instructions\n";

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------- index view

/** /agents — empty state prompting the user to pick a project. */
export function AgentsIndexView() {
  const t = useT();
  const { data: projects = [] } = useProjects();
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="px-6 pt-8 pb-4">
        <h1 className="text-3xl font-display">{t("agents.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground/70">{t("agents.subtitle")}</p>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-16">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Bot className="size-6" />
          </div>
          <h2 className="text-xl font-display">{t("agents.pickProjectTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {projects.length === 0 ? t("agents.noProjects") : t("agents.pickProject")}
          </p>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- project view

export function AgentsProjectView() {
  const t = useT();
  const navigate = useNavigate();
  const { projectId: projectIdStr } = useParams({ from: "/agents/$projectId" });
  const { file } = useSearch({ from: "/agents/$projectId" });
  const projectId = Number(projectIdStr);

  const { data: projects = [] } = useProjects();
  const project = projects.find((p) => p.id === projectId);
  const { data: dir } = useAgentDir(Number.isFinite(projectId) ? projectId : null);

  const openFile = (path: string) =>
    navigate({ to: "/agents/$projectId", params: { projectId: projectIdStr }, search: { file: path } });
  const clearFile = () =>
    navigate({ to: "/agents/$projectId", params: { projectId: projectIdStr }, search: {} });

  if (!project) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center px-6">
        <p className="text-sm text-muted-foreground">{t("agents.pickProject")}</p>
      </div>
    );
  }

  const hasDirectory = !!project.directory;
  const dirExists = hasDirectory && dir?.exists;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="px-6 pt-8 pb-4">
        <h1 className="text-3xl font-display">{project.name}</h1>
        {hasDirectory ? (
          <p className="mt-1 font-mono text-[13px] text-muted-foreground/70">{project.directory}</p>
        ) : (
          <SetupBlock project={project} />
        )}
        {hasDirectory && dir && !dir.exists && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            {t("agents.directoryMissing", { dir: project.directory })}
          </div>
        )}
      </header>

      {dirExists && (
        <div className="flex min-h-0 flex-1 border-t border-border">
          <FileList
            projectId={projectId}
            projectIdStr={projectIdStr}
            files={dir?.files ?? []}
            activeFile={file}
            onOpen={openFile}
          />
          <FileDetail
            projectId={projectId}
            files={dir?.files ?? []}
            path={file ?? null}
            onCleared={clearFile}
          />
        </div>
      )}
    </div>
  );
}

// ---- setup (no linked directory) -------------------------------------------

function SetupBlock({ project }: { project: Project }) {
  const t = useT();
  const qc = useQueryClient();
  const mutations = useProjectMutations();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const directory = value.trim();
    if (!directory) return;
    setSaving(true);
    try {
      await mutations.update.mutateAsync({
        id: project.id,
        body: {
          name: project.name,
          description: project.description,
          system_prompt: project.system_prompt,
          model: project.model,
          directory,
          mcp_ids: project.mcp_ids,
        },
      });
      qc.invalidateQueries({ queryKey: qk.agentDir(project.id) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 max-w-xl rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <FolderGit2 className="size-4 text-primary" />
        <h2 className="font-display text-base">{t("agents.setupTitle")}</h2>
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">{t("agents.setupHint")}</p>
      <div className="mt-3 flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="/home/user/my-repo"
          className="font-mono text-[13px]"
          autoFocus
        />
        <Button onClick={save} disabled={saving || !value.trim()} className="shrink-0">
          {saving ? t("agents.setupSaving") : t("agents.setupSave")}
        </Button>
      </div>
    </div>
  );
}

// ---- left column: sectioned file list --------------------------------------

function providerBadge(provider: string) {
  return (
    <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium lowercase">
      {provider}
    </Badge>
  );
}

function FileList({
  projectId,
  projectIdStr,
  files,
  activeFile,
  onOpen,
}: {
  projectId: number;
  projectIdStr: string;
  files: AgentFile[];
  activeFile?: string;
  onOpen: (path: string) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { save } = useAgentFileMutations(projectId);
  const [newKind, setNewKind] = useState<"agent" | "skill" | null>(null);

  const claudeFile = files.find((f) => f.kind === "instructions" && f.name === CLAUDE_MD);
  const codexFile = files.find((f) => f.kind === "instructions" && f.name === AGENTS_MD);
  const agents = files.filter((f) => f.kind === "agent");
  const skills = files.filter((f) => f.kind === "skill");

  const createFile = async (path: string, content: string) => {
    await save.mutateAsync({ path, content });
    navigate({ to: "/agents/$projectId", params: { projectId: projectIdStr }, search: { file: path } });
  };

  const createNamed = async (name: string) => {
    const slug = slugify(name);
    if (!slug || !newKind) return;
    if (newKind === "agent") {
      await createFile(`.claude/agents/${slug}.md`, AGENT_TEMPLATE(slug));
    } else {
      await createFile(`.claude/skills/${slug}/SKILL.md`, SKILL_TEMPLATE(slug));
    }
    setNewKind(null);
  };

  return (
    <div className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-r border-border py-4">
      {/* Instructions */}
      <Section label={t("agents.instructions")}>
        <InstructionsRow
          name={CLAUDE_MD}
          provider="claude"
          fileEntry={claudeFile}
          active={activeFile === claudeFile?.path}
          onOpen={onOpen}
          onCreate={() => createFile(CLAUDE_MD, INSTRUCTIONS_TEMPLATE)}
        />
        <InstructionsRow
          name={AGENTS_MD}
          provider="codex"
          fileEntry={codexFile}
          active={activeFile === codexFile?.path}
          onOpen={onOpen}
          onCreate={() => createFile(AGENTS_MD, INSTRUCTIONS_TEMPLATE)}
        />
        <SyncControl projectId={projectId} claudeFile={claudeFile} codexFile={codexFile} />
      </Section>

      {/* Agents */}
      <Section
        label={t("agents.agents")}
        action={
          <SectionAddButton title={t("agents.newAgent")} onClick={() => setNewKind("agent")} />
        }
      >
        {agents.length === 0 ? (
          <EmptyRow text={t("agents.emptyAgents")} />
        ) : (
          agents.map((f) => (
            <FileRow
              key={f.path}
              file={f}
              icon={Bot}
              active={activeFile === f.path}
              onOpen={onOpen}
            />
          ))
        )}
      </Section>

      {/* Skills */}
      <Section
        label={t("agents.skills")}
        action={
          <SectionAddButton title={t("agents.newSkill")} onClick={() => setNewKind("skill")} />
        }
      >
        {skills.length === 0 ? (
          <EmptyRow text={t("agents.emptySkills")} />
        ) : (
          skills.map((f) => (
            <FileRow
              key={f.path}
              file={f}
              icon={Sparkles}
              active={activeFile === f.path}
              onOpen={onOpen}
            />
          ))
        )}
      </Section>

      <NewFileModal kind={newKind} onClose={() => setNewKind(null)} onCreate={createNamed} />
    </div>
  );
}

function Section({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 px-3">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {label}
        </span>
        {action}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function SectionAddButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className="flex size-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="px-2 py-1 text-[12px] text-muted-foreground/50">{text}</p>;
}

function rowClass(active: boolean) {
  return cn(
    "group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
    active
      ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
      : "text-muted-foreground hover:bg-sidebar-accent/60",
  );
}

function FileRow({
  file,
  icon: Icon,
  active,
  onOpen,
}: {
  file: AgentFile;
  icon: React.ElementType;
  active: boolean;
  onOpen: (path: string) => void;
}) {
  return (
    <button className={rowClass(active)} onClick={() => onOpen(file.path)}>
      <Icon className={cn("size-3.5 shrink-0", active && "text-primary")} />
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      {file.is_symlink && <Link2 className="size-3 shrink-0 text-muted-foreground/60" />}
      {providerBadge(file.provider)}
    </button>
  );
}

function InstructionsRow({
  name,
  provider,
  fileEntry,
  active,
  onOpen,
  onCreate,
}: {
  name: string;
  provider: string;
  fileEntry?: AgentFile;
  active: boolean;
  onOpen: (path: string) => void;
  onCreate: () => void;
}) {
  const t = useT();
  if (!fileEntry) {
    return (
      <div className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-muted-foreground/50">
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {providerBadge(provider)}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onCreate}
              className="flex size-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("agents.createFile", { name })}</TooltipContent>
        </Tooltip>
      </div>
    );
  }
  return (
    <button className={rowClass(active)} onClick={() => onOpen(fileEntry.path)}>
      <span className="min-w-0 flex-1 truncate">{fileEntry.name}</span>
      {fileEntry.is_symlink && <Link2 className="size-3 shrink-0 text-muted-foreground/60" />}
      {providerBadge(fileEntry.provider)}
    </button>
  );
}

// ---- sync control -----------------------------------------------------------

function SyncControl({
  projectId,
  claudeFile,
  codexFile,
}: {
  projectId: number;
  claudeFile?: AgentFile;
  codexFile?: AgentFile;
}) {
  const t = useT();
  const confirm = useConfirm();
  const { symlink } = useAgentFileMutations(projectId);
  const [chooseOpen, setChooseOpen] = useState(false);

  const both = !!claudeFile && !!codexFile;
  const eitherSymlink = !!claudeFile?.is_symlink || !!codexFile?.is_symlink;

  // already linked → synced state
  if (both && eitherSymlink) {
    return (
      <div className="mt-1 flex items-center gap-1.5 px-2 py-1 text-[12px] font-medium text-primary">
        <Check className="size-3.5" />
        {t("agents.synced")}
      </div>
    );
  }

  const runOneWay = async (linkName: string, targetName: string) => {
    const ok = await confirm({
      title: t("agents.syncTitle"),
      description: t("agents.syncOneDesc", { link: linkName, target: targetName }),
      confirmText: t("agents.sync"),
    });
    if (!ok) return;
    await symlink.mutateAsync({ linkPath: linkName, targetPath: targetName });
  };

  const chooseSource = async (source: "claude" | "codex") => {
    setChooseOpen(false);
    if (source === "claude") {
      await symlink.mutateAsync({ linkPath: AGENTS_MD, targetPath: CLAUDE_MD });
    } else {
      await symlink.mutateAsync({ linkPath: CLAUDE_MD, targetPath: AGENTS_MD });
    }
  };

  // exactly one exists → offer one-way sync
  let onClick: (() => void) | null = null;
  if (both) {
    onClick = () => setChooseOpen(true);
  } else if (claudeFile) {
    onClick = () => runOneWay(AGENTS_MD, CLAUDE_MD);
  } else if (codexFile) {
    onClick = () => runOneWay(CLAUDE_MD, AGENTS_MD);
  }

  if (!onClick) return null;

  return (
    <>
      <button
        onClick={onClick}
        className="mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
      >
        <RefreshCw className="size-3.5" />
        {t("agents.sync")}
      </button>
      <Modal
        open={chooseOpen}
        onClose={() => setChooseOpen(false)}
        title={t("agents.syncChooseTitle")}
        description={t("agents.syncChooseDesc")}
        className="max-w-sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setChooseOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="outline" onClick={() => chooseSource("codex")}>
              {t("agents.syncUse", { name: AGENTS_MD })}
            </Button>
            <Button onClick={() => chooseSource("claude")}>
              {t("agents.syncUse", { name: CLAUDE_MD })}
            </Button>
          </>
        }
      />
    </>
  );
}

// ---- new agent / skill modal -----------------------------------------------

function NewFileModal({
  kind,
  onClose,
  onCreate,
}: {
  kind: "agent" | "skill" | null;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");

  useEffect(() => {
    if (kind) setName("");
  }, [kind]);

  const submit = () => {
    if (slugify(name)) onCreate(name);
  };

  return (
    <Modal
      open={kind !== null}
      onClose={onClose}
      title={kind === "skill" ? t("agents.newSkillTitle") : t("agents.newAgentTitle")}
      className="max-w-sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!slugify(name)}>
            {t("common.create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted-foreground">{t("agents.nameLabel")}</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={
            kind === "skill" ? t("agents.skillNamePlaceholder") : t("agents.agentNamePlaceholder")
          }
          className="font-mono text-[13px]"
          autoFocus
        />
      </div>
    </Modal>
  );
}

// ---- right column: file detail / editor ------------------------------------

function FileDetail({
  projectId,
  files,
  path,
  onCleared,
}: {
  projectId: number;
  files: AgentFile[];
  path: string | null;
  onCleared: () => void;
}) {
  const t = useT();
  const confirm = useConfirm();
  const { data: fileData } = useAgentFile(projectId, path);
  const { save, remove } = useAgentFileMutations(projectId);
  const entry = useMemo(() => files.find((f) => f.path === path), [files, path]);

  const [content, setContent] = useState("");
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (fileData) setContent(fileData.content);
  }, [fileData?.path, fileData?.content]);

  if (!path) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center px-6">
        <div className="flex max-w-xs flex-col items-center gap-2 text-center">
          <p className="text-sm font-semibold">{t("agents.selectFile")}</p>
          <p className="text-[13px] text-muted-foreground">{t("agents.selectFileHint")}</p>
        </div>
      </div>
    );
  }

  const dirty = !!fileData && content !== fileData.content;

  const doSave = async () => {
    if (!dirty) return;
    await save.mutateAsync({ path, content });
    setFlash(true);
    setTimeout(() => setFlash(false), 1500);
  };

  const doDelete = async () => {
    const ok = await confirm({
      title: t("agents.deleteTitle"),
      description: t("agents.deleteDesc", { path }),
      confirmText: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    await remove.mutateAsync(path);
    onCleared();
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground">{path}</span>
        {entry && providerBadge(entry.provider)}
        {fileData?.is_symlink && (
          <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground/70">
            <Link2 className="size-3.5" />→ {fileData.symlink_target}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="min-h-[60vh] w-full resize-none rounded-xl border border-border bg-card px-4 py-3 font-mono text-sm leading-relaxed text-foreground outline-none transition-shadow focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
        <Button variant="ghost" onClick={doDelete} className="text-destructive hover:bg-destructive/10">
          <Trash2 className="size-4" /> {t("common.delete")}
        </Button>
        <Button onClick={doSave} disabled={!dirty || save.isPending}>
          {flash ? (
            <>
              <Check className="size-4" /> {t("agents.saved")}
            </>
          ) : save.isPending ? (
            t("common.saving")
          ) : (
            t("common.save")
          )}
        </Button>
      </div>
    </div>
  );
}
