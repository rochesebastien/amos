import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FileCode2,
  FileText,
  FilePlus2,
  FolderPlus,
  Upload,
  FolderUp,
  Trash2,
  Pencil,
  Save,
  X,
  Star,
  Code2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type CodeFiles = Record<string, string>;

// ---- file-tree helpers -----------------------------------------------------

type TreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: TreeNode[];
};

function buildTree(filePaths: string[], folderPaths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", type: "folder", children: [] };
  const ensureFolder = (parts: string[]): TreeNode => {
    let cur = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      let next = cur.children!.find((c) => c.type === "folder" && c.name === part);
      if (!next) {
        next = { name: part, path, type: "folder", children: [] };
        cur.children!.push(next);
      }
      cur = next;
    });
    return cur;
  };
  for (const folder of folderPaths) {
    const parts = folder.split("/").filter(Boolean);
    if (parts.length) ensureFolder(parts);
  }
  for (const p of filePaths) {
    const parts = p.split("/").filter(Boolean);
    if (!parts.length) continue;
    const fileName = parts[parts.length - 1];
    const parent = ensureFolder(parts.slice(0, -1));
    if (!parent.children!.some((c) => c.type === "file" && c.name === fileName)) {
      parent.children!.push({ name: fileName, path: p, type: "file" });
    }
  }
  const sortRec = (n: TreeNode) => {
    if (!n.children) return;
    n.children.sort((a, b) =>
      a.type !== b.type ? (a.type === "folder" ? -1 : 1) : a.name.localeCompare(b.name),
    );
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root.children!;
}

const TEXT_LIKE = /\.(py|txt|md|json|ya?ml|toml|ini|cfg|csv|tsv|env|sh|bash|js|ts|tsx|jsx|html|css|sql|xml|rst|gitignore|dockerfile)$/i;
const BINARY_LIKE = /\.(png|jpe?g|gif|webp|ico|bmp|svgz|pdf|zip|gz|tar|7z|rar|woff2?|ttf|otf|eot|exe|dll|so|dylib|bin|wasm|mp[34]|wav|ogg|mov|avi|class|pyc|pdb)$/i;
const SKIP_DIR = /(^|\/)(node_modules|\.git|__pycache__|\.venv|venv|env|dist|build|\.next|\.cache|\.idea|\.vscode)\//i;

function isImportable(path: string): boolean {
  if (SKIP_DIR.test("/" + path)) return false;
  if (BINARY_LIKE.test(path)) return false;
  // accept known text extensions and extension-less files (Makefile, LICENSE…)
  return TEXT_LIKE.test(path) || !/\.[^/]+$/.test(path);
}

function pickEntry(files: CodeFiles, preferred?: string): string {
  if (preferred && files[preferred]) return preferred;
  if (files["main.py"]) return "main.py";
  const py = Object.keys(files).find((p) => p.endsWith(".py"));
  return py ?? Object.keys(files)[0] ?? "main.py";
}

function fileIcon(name: string) {
  return name.endsWith(".py") ? FileCode2 : FileText;
}

// ---- small in-overlay dialog (prompt / confirm) ----------------------------

type DialogState = {
  kind: "prompt" | "confirm";
  title: string;
  description?: string;
  value: string;
  confirmText: string;
  destructive?: boolean;
  resolve: (v: string | null) => void;
};

// ---- the editor ------------------------------------------------------------

export function CodeEditor({
  open,
  files: initialFiles,
  entry: initialEntry,
  title,
  onSave,
  onClose,
}: {
  open: boolean;
  files: CodeFiles;
  entry: string;
  title?: string;
  onSave: (files: CodeFiles, entry: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [files, setFiles] = useState<CodeFiles>(initialFiles);
  const [folders, setFolders] = useState<string[]>([]); // extra (possibly empty) folders
  const [entry, setEntry] = useState(initialEntry);
  const [active, setActive] = useState<string>(initialEntry);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  // re-seed whenever the editor is (re)opened
  useEffect(() => {
    if (!open) return;
    const seed = Object.keys(initialFiles).length ? initialFiles : { "main.py": "" };
    setFiles(seed);
    setFolders([]);
    const e = pickEntry(seed, initialEntry);
    setEntry(e);
    setActive(e);
    setCollapsed(new Set());
    setDialog(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const tree = useMemo(() => buildTree(Object.keys(files), folders), [files, folders]);
  const activeContent = active in files ? files[active] : "";
  const lineCount = useMemo(() => (activeContent.match(/\n/g)?.length ?? 0) + 1, [activeContent]);

  if (!open) return null;

  // ---- dialog helpers ----
  const askPrompt = (opts: { title: string; description?: string; initial?: string; confirmText: string }) =>
    new Promise<string | null>((resolve) =>
      setDialog({ kind: "prompt", value: opts.initial ?? "", resolve, ...opts }),
    );
  const askConfirm = (opts: { title: string; description?: string; confirmText: string }) =>
    new Promise<string | null>((resolve) =>
      setDialog({ kind: "confirm", value: "", resolve, destructive: true, ...opts }),
    );
  const closeDialog = (result: string | null) =>
    setDialog((d) => {
      d?.resolve(result);
      return null;
    });

  // ---- file ops ----
  const normalize = (p: string) => p.trim().replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");

  const openFile = (path: string) => setActive(path);

  const setActiveContent = (content: string) => setFiles((f) => ({ ...f, [active]: content }));

  const newFile = async (prefix = "") => {
    const raw = await askPrompt({
      title: t("editor.newFile"),
      description: t("editor.pathHint"),
      initial: prefix ? `${prefix}/` : "",
      confirmText: t("common.create"),
    });
    if (raw == null) return;
    const path = normalize(raw);
    if (!path || files[path]) return;
    setFiles((f) => ({ ...f, [path]: "" }));
    setActive(path);
  };

  const newFolder = async (prefix = "") => {
    const raw = await askPrompt({
      title: t("editor.newFolder"),
      description: t("editor.folderHint"),
      initial: prefix ? `${prefix}/` : "",
      confirmText: t("common.create"),
    });
    if (raw == null) return;
    const path = normalize(raw);
    if (!path) return;
    setFolders((fs) => (fs.includes(path) ? fs : [...fs, path]));
    setCollapsed((c) => {
      const next = new Set(c);
      next.delete(path);
      return next;
    });
  };

  const renameFile = async (path: string) => {
    const raw = await askPrompt({
      title: t("editor.rename"),
      initial: path,
      confirmText: t("common.rename"),
    });
    if (raw == null) return;
    const dest = normalize(raw);
    if (!dest || dest === path || files[dest]) return;
    setFiles((f) => {
      const next: CodeFiles = {};
      for (const [k, v] of Object.entries(f)) next[k === path ? dest : k] = v;
      return next;
    });
    setEntry((e) => (e === path ? dest : e));
    setActive((a) => (a === path ? dest : a));
  };

  const deleteFile = async (path: string) => {
    const ok = await askConfirm({
      title: t("editor.deleteFile"),
      description: t("editor.deleteFileDesc", { path }),
      confirmText: t("common.delete"),
    });
    if (ok == null) return;
    setFiles((f) => {
      const next = { ...f };
      delete next[path];
      return next;
    });
    setActive((a) => {
      if (a !== path) return a;
      const rest = Object.keys(files).filter((p) => p !== path);
      return rest[0] ?? "";
    });
  };

  const makeEntry = (path: string) => {
    if (path.endsWith(".py")) setEntry(path);
  };

  // ---- import ----
  const importFiles = async (list: FileList | null, stripTop: boolean) => {
    if (!list || !list.length) return;
    const next: CodeFiles = { ...files };
    let firstAdded = "";
    for (const file of Array.from(list)) {
      let rel: string = (file as any).webkitRelativePath || file.name;
      if (stripTop && rel.includes("/")) rel = rel.split("/").slice(1).join("/");
      rel = normalize(rel);
      if (!rel || !isImportable(rel)) continue;
      if (file.size > 1024 * 1024) continue; // skip files > 1 MB
      try {
        next[rel] = await file.text();
        if (!firstAdded) firstAdded = rel;
      } catch {
        /* unreadable — skip */
      }
    }
    setFiles(next);
    const e = pickEntry(next, entry);
    setEntry(e);
    setActive((a) => (a && next[a] ? a : firstAdded || e));
  };

  const onPickFolder = () => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute("webkitdirectory", "");
      folderInputRef.current.setAttribute("directory", "");
      folderInputRef.current.value = "";
      folderInputRef.current.click();
    }
  };
  const onPickFiles = () => {
    if (filesInputRef.current) {
      filesInputRef.current.value = "";
      filesInputRef.current.click();
    }
  };

  // ---- save & exit ----
  const save = () => {
    const clean = Object.keys(files).length ? files : { "main.py": "" };
    onSave(clean, pickEntry(clean, entry));
  };

  // ---- editor scroll sync ----
  const syncScroll = () => {
    if (gutterRef.current && textRef.current) {
      gutterRef.current.scrollTop = textRef.current.scrollTop;
    }
  };
  const onKeyDownEditor = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const value = el.value.slice(0, start) + "    " + el.value.slice(end);
      setActiveContent(value);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 4;
      });
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  };

  const iconBtn =
    "rounded p-0.5 text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground";

  // ---- tree rendering ----
  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const pad = { paddingLeft: `${depth * 12 + 8}px` };
    if (node.type === "folder") {
      const isCollapsed = collapsed.has(node.path);
      return (
        <div key={`d:${node.path}`}>
          <div
            className="group/row flex items-center gap-1 rounded px-1 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
            style={pad}
          >
            <button
              className="flex min-w-0 flex-1 items-center gap-1 text-left"
              onClick={() =>
                setCollapsed((c) => {
                  const next = new Set(c);
                  next.has(node.path) ? next.delete(node.path) : next.add(node.path);
                  return next;
                })
              }
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
            <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/row:opacity-100">
              <button onClick={() => newFile(node.path)} className={iconBtn} title={t("editor.newFile")}>
                <FilePlus2 className="size-3.5" />
              </button>
              <button onClick={() => newFolder(node.path)} className={iconBtn} title={t("editor.newFolder")}>
                <FolderPlus className="size-3.5" />
              </button>
            </div>
          </div>
          {!isCollapsed && node.children?.map((c) => renderNode(c, depth + 1))}
        </div>
      );
    }
    const Icon = fileIcon(node.name);
    const isActive = node.path === active;
    const isEntry = node.path === entry;
    return (
      <div
        key={`f:${node.path}`}
        onClick={() => openFile(node.path)}
        className={cn(
          "group/row flex cursor-pointer items-center gap-1.5 rounded px-1 py-1 text-[13px] transition-colors",
          isActive
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/60",
        )}
        style={pad}
      >
        <Icon className={cn("size-3.5 shrink-0", isEntry && "text-primary")} />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {isEntry && (
          <span title={t("editor.entry")} className="flex shrink-0 items-center">
            <Star className="size-3 fill-primary text-primary" />
          </span>
        )}
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/row:opacity-100">
          {!isEntry && node.name.endsWith(".py") && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                makeEntry(node.path);
              }}
              className={iconBtn}
              title={t("editor.setEntry")}
            >
              <Star className="size-3.5" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              renameFile(node.path);
            }}
            className={iconBtn}
            title={t("editor.rename")}
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              deleteFile(node.path);
            }}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-destructive"
            title={t("common.delete")}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background text-foreground animate-fade-in">
      {/* top bar */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Code2 className="size-4 shrink-0 text-primary" />
          <span className="truncate text-sm font-semibold">{title || t("editor.title")}</span>
          <span className="hidden text-[12px] text-muted-foreground sm:inline">· {t("editor.title")}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-[12px] text-muted-foreground md:inline">
            {Object.keys(files).length}{" "}
            {t(Object.keys(files).length === 1 ? "editor.fileOne" : "editor.fileOther")}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={onClose} title={t("editor.exitNoSave")}>
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* sidebar: file explorer */}
        <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              {t("editor.explorer")}
            </span>
            <div className="flex items-center gap-0.5">
              <button onClick={() => newFile()} className={iconBtn} title={t("editor.newFile")}>
                <FilePlus2 className="size-3.5" />
              </button>
              <button onClick={() => newFolder()} className={iconBtn} title={t("editor.newFolder")}>
                <FolderPlus className="size-3.5" />
              </button>
              <button onClick={onPickFolder} className={iconBtn} title={t("editor.importFolder")}>
                <FolderUp className="size-3.5" />
              </button>
              <button onClick={onPickFiles} className={iconBtn} title={t("editor.importFiles")}>
                <Upload className="size-3.5" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
            {tree.length === 0 ? (
              <p className="px-2 py-4 text-[12px] text-muted-foreground/70">{t("editor.noFiles")}</p>
            ) : (
              tree.map((n) => renderNode(n, 0))
            )}
          </div>
        </aside>

        {/* editor pane */}
        <section className="flex min-w-0 flex-1 flex-col bg-background">
          {active && active in files ? (
            <>
              <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card/60 px-3 text-[12px]">
                {(() => {
                  const Icon = fileIcon(active);
                  return <Icon className="size-3.5 text-muted-foreground" />;
                })()}
                <span className="truncate font-mono text-foreground">{active}</span>
                {active === entry && (
                  <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    {t("editor.entry")}
                  </span>
                )}
              </div>
              <div className="flex min-h-0 flex-1">
                <div
                  ref={gutterRef}
                  className="select-none overflow-hidden border-r border-border bg-muted/30 py-3 pl-2 pr-2 text-right font-mono text-[12.5px] leading-[1.6] text-muted-foreground/50"
                  aria-hidden
                >
                  {Array.from({ length: lineCount }, (_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>
                <textarea
                  ref={textRef}
                  value={activeContent}
                  onChange={(e) => setActiveContent(e.target.value)}
                  onScroll={syncScroll}
                  onKeyDown={onKeyDownEditor}
                  spellCheck={false}
                  wrap="off"
                  className="min-h-0 flex-1 resize-none overflow-auto whitespace-pre bg-transparent px-3 py-3 font-mono text-[12.5px] leading-[1.6] text-foreground outline-none"
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Code2 className="size-6" />
              </div>
              <p className="text-sm font-semibold">{t("editor.emptyTitle")}</p>
              <p className="max-w-xs text-[13px] text-muted-foreground">{t("editor.emptyHint")}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => newFile()}>
                  <FilePlus2 className="size-4" /> {t("editor.newFile")}
                </Button>
                <Button variant="outline" size="sm" onClick={onPickFolder}>
                  <FolderUp className="size-4" /> {t("editor.importFolder")}
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* floating save & exit */}
      <div className="absolute bottom-6 right-6 flex items-center gap-2">
        <Button variant="ghost" onClick={onClose} className="bg-card/80 shadow-sm backdrop-blur hover:bg-accent">
          {t("editor.exitNoSave")}
        </Button>
        <Button onClick={save} size="lg" className="shadow-lg">
          <Save className="size-4" /> {t("editor.saveExit")}
        </Button>
      </div>

      {/* hidden import inputs */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => importFiles(e.target.files, true)}
      />
      <input
        ref={filesInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => importFiles(e.target.files, false)}
      />

      {/* in-overlay dialog */}
      {dialog && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-foreground/40 p-4 animate-fade-in"
          onClick={() => closeDialog(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-display">{dialog.title}</h3>
            {dialog.description && (
              <p className="mt-1 break-words text-[13px] text-muted-foreground">{dialog.description}</p>
            )}
            {dialog.kind === "prompt" && (
              <Input
                autoFocus
                value={dialog.value}
                onChange={(e) => setDialog((d) => (d ? { ...d, value: e.target.value } : d))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") closeDialog(dialog.value);
                  if (e.key === "Escape") closeDialog(null);
                }}
                className="mt-3 font-mono text-[13px]"
                placeholder="path/to/file.py"
              />
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => closeDialog(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant={dialog.destructive ? "destructive" : "primary"}
                onClick={() => closeDialog(dialog.kind === "prompt" ? dialog.value : "ok")}
              >
                {dialog.confirmText}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
