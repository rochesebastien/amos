import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  FileCode2,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import type { FsEntry } from "@shared/ipc";
import { isSafeName, joinPath, type SkillItem } from "@shared/capabilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useT } from "@/lib/i18n";
import { ipc } from "@/lib/ipc";
import { useDirListing, useFileContent, useWriteFile } from "@/lib/queries";
import { cn, formatBytes } from "@/lib/utils";
import { ConflictDialog, errorText, isConflict, Notice, SaveBar } from "./shell";

/**
 * Editing a skill — that is, editing the folder a skill *is*.
 *
 * A skill has no single shape: a `SKILL.md` plus whatever scripts, templates
 * and references it needs. So this is the file tree and text editor AMOS used
 * to run over an in-memory project, re-pointed at the real folder through
 * `fs:listDir` / `fs:readFile` / `fs:writeFile`. Each file carries its own
 * mtime, so two files of the same skill can be saved independently and a
 * conflict is scoped to the one file that moved.
 */

// ---------------------------------------------------------------- file tree

type TreeNode = {
  name: string;
  /** Path relative to the skill folder, POSIX separators. */
  relativePath: string;
  absolutePath: string;
  kind: "file" | "directory";
  bytes: number;
  children: TreeNode[];
};

/** Rebuild the folder hierarchy from the flat listing the main process sends. */
function buildTree(entries: FsEntry[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const entry of entries) {
    const node: TreeNode = {
      name: entry.name,
      relativePath: entry.relativePath,
      absolutePath: entry.path,
      kind: entry.kind,
      bytes: entry.bytes,
      children: [],
    };
    nodes.set(entry.relativePath, node);
    const slash = entry.relativePath.lastIndexOf("/");
    const parent = slash === -1 ? undefined : nodes.get(entry.relativePath.slice(0, slash));
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sort = (list: TreeNode[]) => {
    list.sort(
      (a, b) =>
        Number(a.kind === "file") - Number(b.kind === "file") ||
        // `SKILL.md` is the entry point of a skill, so it leads its folder.
        Number(a.name !== "SKILL.md") - Number(b.name !== "SKILL.md") ||
        a.name.localeCompare(b.name),
    );
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
}

/** Extensions the text editor refuses: opening them would corrupt them. */
const BINARY_LIKE =
  /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tar|7z|rar|woff2?|ttf|otf|eot|exe|dll|so|dylib|bin|wasm|mp[34]|wav|ogg|mov|avi|pyc)$/i;

function fileIcon(name: string) {
  return /\.(py|js|ts|tsx|sh|rb|go|rs|json|ya?ml|toml)$/i.test(name) ? FileCode2 : FileText;
}

// ------------------------------------------------------------------ editor

export function SkillEditor({ projectId, item }: { projectId: string; item: SkillItem }) {
  const t = useT();
  const directory = item.path;
  const listing = useDirListing(directory);
  const write = useWriteFile(projectId);

  const [selected, setSelected] = useState<string | null>(item.sourceFile);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const tree = useMemo(() => buildTree(listing.data?.entries ?? []), [listing.data]);

  // A skill whose folder was re-listed may have lost the open file.
  useEffect(() => {
    if (!listing.data) return;
    if (selected && listing.data.entries.some((e) => e.path === selected)) return;
    setSelected(item.sourceFile);
  }, [listing.data, selected, item.sourceFile]);

  const createFile = async () => {
    setCreateError(null);
    const relative = newPath.trim().replace(/^[/\\]+/, "");
    const parts = relative.split("/").filter(Boolean);
    if (parts.length === 0 || parts.length > 4 || !parts.every(isSafeName)) {
      setCreateError(t("skill.newFileInvalid"));
      return;
    }
    const target = joinPath(directory, ...parts);
    try {
      await write.mutateAsync({ path: target, content: "", expectedMtimeMs: null });
      setCreating(false);
      setNewPath("");
      setSelected(target);
    } catch (err) {
      setCreateError(errorText(err));
    }
  };

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const pad = { paddingLeft: `${depth * 12 + 8}px` };
    if (node.kind === "directory") {
      const isCollapsed = collapsed.has(node.relativePath);
      return (
        <div key={node.relativePath}>
          <button
            style={pad}
            onClick={() =>
              setCollapsed((c) => {
                const next = new Set(c);
                if (next.has(node.relativePath)) next.delete(node.relativePath);
                else next.add(node.relativePath);
                return next;
              })
            }
            className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
          >
            <ChevronRight
              className={cn("size-3.5 shrink-0 transition-transform", !isCollapsed && "rotate-90")}
            />
            {isCollapsed ? (
              <Folder className="size-3.5 shrink-0" />
            ) : (
              <FolderOpen className="size-3.5 shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
          </button>
          {!isCollapsed && node.children.map((c) => renderNode(c, depth + 1))}
        </div>
      );
    }

    const Icon = fileIcon(node.name);
    const active = node.absolutePath === selected;
    return (
      <button
        key={node.relativePath}
        style={pad}
        onClick={() => setSelected(node.absolutePath)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[13px] transition-colors",
          active
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/60",
        )}
      >
        <Icon className={cn("size-3.5 shrink-0", node.name === "SKILL.md" && "text-primary")} />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground/50">
          {formatBytes(node.bytes)}
        </span>
      </button>
    );
  };

  return (
    <div>
      <p className="mb-3 truncate font-mono text-[13px] text-muted-foreground/70" title={directory}>
        {directory}
      </p>

      <div className="flex min-h-[28rem] gap-4">
        <aside className="flex w-64 shrink-0 flex-col rounded-xl border border-border bg-sidebar">
          <div className="flex items-center justify-between gap-1 border-b border-sidebar-border px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              {t("skill.files")}
            </span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => {
                  setCreating(true);
                  setCreateError(null);
                }}
                title={t("skill.newFile")}
                className="rounded p-1 text-muted-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                <FilePlus2 className="size-3.5" />
              </button>
              <button
                onClick={() => void listing.refetch()}
                title={t("skill.refresh")}
                className="rounded p-1 text-muted-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                <RefreshCw className={cn("size-3.5", listing.isFetching && "animate-spin")} />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {listing.isError && (
              <p className="px-2 py-2 text-[12px] text-destructive">
                {errorText(listing.error)}
              </p>
            )}
            {tree.length === 0 && !listing.isPending && (
              <p className="px-2 py-2 text-[12px] text-muted-foreground/60">{t("skill.noFiles")}</p>
            )}
            {tree.map((node) => renderNode(node, 0))}
            {listing.data?.truncated && (
              <p className="px-2 py-2 text-[12px] text-muted-foreground/60">
                {t("skill.tooManyFiles")}
              </p>
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <FilePane key={selected} projectId={projectId} path={selected} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/70">
              {t("skill.pickFile")}
            </div>
          )}
        </section>
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={t("skill.newFile")}
        description={t("skill.newFileHint")}
        className="max-w-sm"
      >
        <Input
          autoFocus
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void createFile();
          }}
          placeholder="scripts/run.py"
          className="font-mono text-[13px]"
        />
        {createError && <p className="mt-2 text-[13px] text-destructive">{createError}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setCreating(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void createFile()} disabled={write.isPending}>
            {t("common.create")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// -------------------------------------------------------------- single file

/**
 * One file of the skill folder. Mounted with `key={path}`, so switching files
 * starts from a clean slate rather than carrying another file's buffer — and,
 * more importantly, another file's mtime.
 */
function FilePane({ projectId, path }: { projectId: string; path: string }) {
  const t = useT();
  const file = useFileContent(path);
  const write = useWriteFile(projectId);

  const [draft, setDraft] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<string>("");
  const [expectedMtimeMs, setExpectedMtimeMs] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);

  const gutterRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!file.data) return;
    setDraft(file.data.content);
    setBaseline(file.data.content);
    setExpectedMtimeMs(file.data.mtimeMs);
  }, [file.data]);

  const binary = BINARY_LIKE.test(path);
  const content = draft ?? "";
  const dirty = draft !== null && draft !== baseline;
  const lineCount = useMemo(() => (content.match(/\n/g)?.length ?? 0) + 1, [content]);

  const runSave = async (force: boolean) => {
    if (draft === null) return;
    setError(null);
    try {
      const result = await write.mutateAsync({
        path,
        content: draft,
        expectedMtimeMs: force ? undefined : expectedMtimeMs,
      });
      setBaseline(draft);
      setExpectedMtimeMs(result.mtimeMs);
      setSavedAt(Date.now());
      setConflict(false);
    } catch (err) {
      if (isConflict(err)) setConflict(true);
      else setError(err);
    }
  };

  const reload = async () => {
    const fresh = await ipc.readFile(path).catch(() => null);
    if (!fresh) return;
    setDraft(fresh.content);
    setBaseline(fresh.content);
    setExpectedMtimeMs(fresh.mtimeMs);
    setConflict(false);
  };

  if (binary) {
    return <Notice tone="info">{t("skill.binaryFile")}</Notice>;
  }
  if (file.isError) {
    return <Notice tone="error">{errorText(file.error)}</Notice>;
  }
  if (draft === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/70">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 rounded-t-xl border border-border bg-card px-3 text-[12px]">
        <span className="min-w-0 flex-1 truncate font-mono">{path.split(/[/\\]/).pop()}</span>
        {dirty && <span className="shrink-0 text-muted-foreground/70">{t("cap.unsaved")}</span>}
      </div>
      <div className="flex min-h-0 flex-1 rounded-b-xl border border-t-0 border-border">
        <div
          ref={gutterRef}
          aria-hidden
          className="select-none overflow-hidden border-r border-border bg-muted/30 px-2 py-3 text-right font-mono text-[12.5px] leading-[1.6] text-muted-foreground/50"
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          ref={textRef}
          value={content}
          onChange={(e) => setDraft(e.target.value)}
          onScroll={() => {
            if (gutterRef.current && textRef.current) {
              gutterRef.current.scrollTop = textRef.current.scrollTop;
            }
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              void runSave(false);
            }
          }}
          spellCheck={false}
          wrap="off"
          className="min-h-[24rem] flex-1 resize-none overflow-auto whitespace-pre bg-transparent px-3 py-3 font-mono text-[12.5px] leading-[1.6] text-foreground outline-none"
        />
      </div>

      <SaveBar
        dirty={dirty}
        saving={write.isPending}
        savedAt={savedAt}
        error={error}
        onSave={() => void runSave(false)}
        onRevert={() => setDraft(baseline)}
      />

      <ConflictDialog
        open={conflict}
        path={path}
        busy={write.isPending}
        onReload={() => void reload()}
        onOverwrite={() => void runSave(true)}
        onCancel={() => setConflict(false)}
      />
    </div>
  );
}
