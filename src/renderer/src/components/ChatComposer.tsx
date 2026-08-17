import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Folder,
  GitBranch,
  Laptop,
  MessageSquarePlus,
  Plus,
  Square,
  TerminalSquare,
} from "lucide-react";
import {
  chatEffortSetting,
  chatModelSetting,
  modelsFor,
  REASONING_EFFORTS,
  supportsEffort,
  type ChatBackend,
  type ReasoningEffort,
} from "@shared/chat";
import type { GitHead, Project } from "@shared/ipc";
import {
  useGitBranches,
  useGitCheckout,
  useSetting,
  useSettingMutation,
} from "@/lib/queries";
import { useTerminals } from "@/lib/terminals";
import { useT, type TFunc } from "@/lib/i18n";
import { BackendGlyph } from "@/components/BrandIcons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * The composer: everything that decides what the next turn *is*, in one place.
 *
 * A prompt is never just its text — it runs in a folder, on a branch, through
 * one CLI, at one model and one effort. Those five were spread between the
 * project view, the settings and a lone dropdown, which meant the answer to
 * "what am I about to run, and where" lived nowhere. They are all here now, in
 * reading order: the context strip above says *where*, the row below the input
 * says *how*.
 *
 * Nothing here is decorative. Controls that would have to lie about what AMOS
 * can do — a Codex-style approval switch it does not implement, an effort
 * level for a CLI with no such knob — are absent rather than inert.
 */

export type ComposerProps = {
  project: Project;
  projects: Project[];
  head: GitHead | null;
  backend: ChatBackend;
  /** Backends that could run a turn right now. */
  available: ChatBackend[];
  /** A session is pinned to the CLI it opened with. */
  backendLocked: boolean;
  onBackendChange: (backend: ChatBackend) => void;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  streaming: boolean;
  /** Set by the parent when a send failed; shown above the card. */
  error: string | null;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
};

export function ChatComposer({
  project,
  projects,
  head,
  backend,
  available,
  backendLocked,
  onBackendChange,
  value,
  onChange,
  onSubmit,
  onStop,
  streaming,
  error,
  textareaRef,
}: ComposerProps) {
  const t = useT();
  const [branchError, setBranchError] = React.useState<string | null>(null);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      {(error || branchError) && (
        <p className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          {error ?? branchError}
        </p>
      )}

      {/* Context strip: where this prompt lands. Tucked behind the card's top
          edge so the two read as one control, the way the folder tab of a
          file does. */}
      <div className="mx-2.5 flex items-center gap-0.5 rounded-t-xl border border-b-0 border-border bg-muted/40 px-2 pb-3.5 pt-1.5">
        <ProjectChip t={t} project={project} projects={projects} />
        <Chip
          icon={<Laptop className="size-3.5" />}
          label={t("composer.local")}
          static
        />
        <BranchChip
          t={t}
          projectId={project.id}
          head={head}
          onError={setBranchError}
        />
      </div>

      <div className="relative z-10 -mt-2 flex flex-col rounded-2xl border border-input bg-card shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          aria-label={t("chat.messageLabel")}
          placeholder={t("chat.sendPlaceholder")}
          className="max-h-56 min-h-[52px] w-full resize-none bg-transparent px-4 pt-3 text-sm outline-none placeholder:text-muted-foreground/60"
        />

        <div className="flex items-center gap-1 px-2 pb-2">
          <AddMenu t={t} project={project} />

          <div className="ml-auto flex items-center gap-1">
            <ModelPicker t={t} backend={backend} />
            <ProviderPicker
              t={t}
              backend={backend}
              available={available}
              locked={backendLocked}
              onChange={onBackendChange}
            />
            <SendButton
              t={t}
              streaming={streaming}
              disabled={!value.trim()}
              onSubmit={onSubmit}
              onStop={onStop}
            />
          </div>
        </div>
      </div>

      <p className="mt-2 text-center text-[11px] text-muted-foreground/60">
        {t("chat.disclaimer", { backend: t(`chat.backend.${backend}`) })}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------- chips

const CHIP =
  "flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors";

function Chip({
  icon,
  label,
  static: isStatic,
}: {
  icon: React.ReactNode;
  label: string;
  static?: boolean;
}) {
  return (
    <span className={cn(CHIP, isStatic && "cursor-default")}>
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Which folder the CLI runs in — and a way to go work in another one. */
function ProjectChip({
  t,
  project,
  projects,
}: {
  t: TFunc;
  project: Project;
  projects: Project[];
}) {
  const navigate = useNavigate();
  const others = projects.filter((p) => p.id !== project.id);

  if (others.length === 0) {
    return (
      <Chip
        icon={<Folder className="size-3.5" />}
        label={project.name}
        static
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={project.path}
          className={cn(CHIP, "hover:bg-accent hover:text-foreground")}
        >
          <Folder className="size-3.5 shrink-0" />
          <span className="truncate">{project.name}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{t("composer.switchProject")}</DropdownMenuLabel>
        {projects.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={() =>
              void navigate({
                to: "/p/$projectId/chat",
                params: { projectId: p.id },
              })
            }
          >
            <Folder className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {p.id === project.id && <Check className="size-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The branch, and a way to move to another one.
 *
 * Switching rewrites the working tree, so the failure that matters is the one
 * git raises on an unclean checkout — it is surfaced verbatim rather than
 * swallowed, because git's wording ("your local changes would be overwritten")
 * is the actionable part.
 */
function BranchChip({
  t,
  projectId,
  head,
  onError,
}: {
  t: TFunc;
  projectId: string;
  head: GitHead | null;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const { data, isPending } = useGitBranches(projectId, open);
  const checkout = useGitCheckout(projectId);

  // Not a repository: nothing true to show.
  if (!head) return null;

  const current = head.branch ?? head.detachedAt ?? "";
  const branches = data?.branches ?? [];

  const switchTo = (branch: string) => {
    onError(null);
    checkout.mutate(branch, {
      onError: (e) => onError(e instanceof Error ? e.message : String(e)),
    });
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={
            head.branch
              ? t("chat.onBranch", { branch: current })
              : t("chat.detachedHead")
          }
          className={cn(CHIP, "hover:bg-accent hover:text-foreground")}
        >
          {checkout.isPending ? (
            <Spinner className="size-3.5 shrink-0" />
          ) : (
            <GitBranch className="size-3.5 shrink-0" />
          )}
          <span className="max-w-[14rem] truncate">{current}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownMenuLabel>{t("composer.switchBranch")}</DropdownMenuLabel>
        {isPending && (
          <p className="px-2 py-1.5 text-[12px] text-muted-foreground/70">
            {t("common.loading")}
          </p>
        )}
        {!isPending && branches.length === 0 && (
          <p className="px-2 py-1.5 text-[12px] text-muted-foreground/70">
            {t("composer.noBranches")}
          </p>
        )}
        {branches.map((branch) => (
          <DropdownMenuItem key={branch} onSelect={() => switchTo(branch)}>
            <GitBranch className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">{branch}</span>
            {branch === head.branch && (
              <Check className="size-3.5 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------- controls

/** The "+": the two things worth starting from here, and nothing invented. */
function AddMenu({ t, project }: { t: TFunc; project: Project }) {
  const navigate = useNavigate();
  const openTerminal = useTerminals((s) => s.openTab);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("composer.add")}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          onSelect={() =>
            void navigate({
              to: "/p/$projectId/chat",
              params: { projectId: project.id },
            })
          }
        >
          <MessageSquarePlus className="size-3.5" />
          {t("chat.newChat")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            openTerminal({
              projectId: project.id,
              projectName: project.name,
              kind: "shell",
            })
          }
        >
          <TerminalSquare className="size-3.5" />
          {t("terminal.open")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Model, and — where the CLI has the knob — how hard to think.
 *
 * The choice is stored per backend, so moving between Claude and Codex does
 * not silently hand one CLI the other's model id.
 */
function ModelPicker({ t, backend }: { t: TFunc; backend: ChatBackend }) {
  const models = modelsFor(backend);
  const withEffort = supportsEffort(backend);
  const { data: storedModel } = useSetting(chatModelSetting(backend));
  const { data: storedEffort } = useSetting(chatEffortSetting(backend));
  const save = useSettingMutation();

  if (models.length === 0) return null;

  const modelId = storedModel?.value ?? "";
  const model = models.find((m) => m.id === modelId) ?? models[0]!;
  const effort =
    (storedEffort?.value as ReasoningEffort | undefined) ?? "medium";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("composer.modelLabel")}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-foreground transition-colors hover:bg-accent"
        >
          <span className="max-w-[10rem] truncate">{model.label}</span>
          {withEffort && (
            <span className="text-muted-foreground">
              {t(`composer.effort.${effort}`)}
            </span>
          )}
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("composer.modelLabel")}</DropdownMenuLabel>
        {models.map((candidate) => (
          <DropdownMenuItem
            key={candidate.id || "default"}
            onSelect={() =>
              save.mutate({
                key: chatModelSetting(backend),
                value: candidate.id,
              })
            }
          >
            <span className="min-w-0 flex-1 truncate">
              {candidate.id ? candidate.label : t("composer.modelDefault")}
            </span>
            {candidate.id === model.id && (
              <Check className="size-3.5 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
        {withEffort && (
          <>
            <DropdownMenuLabel>{t("composer.effortLabel")}</DropdownMenuLabel>
            {REASONING_EFFORTS.map((level) => (
              <DropdownMenuItem
                key={level}
                onSelect={() =>
                  save.mutate({ key: chatEffortSetting(backend), value: level })
                }
              >
                <span className="min-w-0 flex-1 truncate">
                  {t(`composer.effort.${level}`)}
                </span>
                {level === effort && (
                  <Check className="size-3.5 text-primary" />
                )}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The CLI answering, shown as its mark. Locked once a session exists. */
function ProviderPicker({
  t,
  backend,
  available,
  locked,
  onChange,
}: {
  t: TFunc;
  backend: ChatBackend;
  available: ChatBackend[];
  locked: boolean;
  onChange: (backend: ChatBackend) => void;
}) {
  const candidates = available.length > 0 ? available : [backend];

  if (locked || candidates.length < 2) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex size-8 items-center justify-center rounded-lg text-muted-foreground">
            <BackendGlyph backend={backend} className="size-4" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {locked ? t("chat.backendLocked") : t(`chat.backend.${backend}`)}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("chat.backendLabel")}
          className="flex size-8 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-accent"
        >
          <BackendGlyph backend={backend} className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("chat.backendLabel")}</DropdownMenuLabel>
        {candidates.map((candidate) => (
          <DropdownMenuItem
            key={candidate}
            onSelect={() => onChange(candidate)}
          >
            <BackendGlyph backend={candidate} className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">
              {t(`chat.backend.${candidate}`)}
            </span>
            {candidate === backend && (
              <Check className="size-3.5 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Round, solid, and the only thing in the row that is not quiet. */
function SendButton({
  t,
  streaming,
  disabled,
  onSubmit,
  onStop,
}: {
  t: TFunc;
  streaming: boolean;
  disabled: boolean;
  onSubmit: () => void;
  onStop: () => void;
}) {
  const label = streaming ? t("chat.stop") : t("chat.send");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={streaming ? onStop : onSubmit}
          disabled={!streaming && disabled}
          className={cn(
            "flex size-9 items-center justify-center rounded-full transition-opacity",
            "bg-foreground text-background hover:opacity-90 active:opacity-80",
            "disabled:pointer-events-none disabled:opacity-25",
          )}
        >
          {streaming ? (
            <Square className="size-3.5" />
          ) : (
            <ArrowUp className="size-4" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
