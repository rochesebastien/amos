import { useEffect, useMemo, useRef, useState } from "react";
import { Columns2, Eye, Pencil } from "lucide-react";
import type { InstructionFile } from "@shared/capabilities";
import { Markdown } from "@/components/Markdown";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n";
import { ipc } from "@/lib/ipc";
import { useFileContent, useWriteFile } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ConflictDialog, errorText, isConflict, Notice, SaveBar } from "./shell";

/**
 * Editing a `CLAUDE.md` / `AGENTS.md`.
 *
 * An instruction file is plain markdown with no frontmatter contract, so this
 * is the simplest editor AMOS has: the bytes on disk in a textarea, the same
 * markdown renderer the chat uses for the preview, and the save pipeline every
 * other editor goes through — mtime check, `.bak`, atomic rename.
 *
 * The conflict token comes from the read, and the scan's own `mtimeMs` is what
 * tells the editor the file moved: a change the watcher picks up triggers a
 * rescan, the scanned mtime stops matching, and the editor either reloads (no
 * unsaved edits) or says so and leaves the choice to the save dialog.
 */

const MTIME_TOLERANCE_MS = 1;

type Mode = "edit" | "split" | "preview";

const MODES: { mode: Mode; icon: typeof Pencil; labelKey: string }[] = [
  { mode: "edit", icon: Pencil, labelKey: "instructions.modeEdit" },
  { mode: "split", icon: Columns2, labelKey: "instructions.modeSplit" },
  { mode: "preview", icon: Eye, labelKey: "instructions.modePreview" },
];

export function InstructionEditor({
  projectId,
  file,
}: {
  projectId: string;
  file: InstructionFile;
}) {
  const t = useT();
  const content = useFileContent(file.path);
  const write = useWriteFile(projectId);

  const [mode, setMode] = useState<Mode>("edit");
  const [draft, setDraft] = useState<string | null>(null);
  const [baseline, setBaseline] = useState("");
  const [expectedMtimeMs, setExpectedMtimeMs] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);

  const dirty = draft !== null && draft !== baseline;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Seed from whatever the read returned — first mount, and again after every
  // refetch (a save invalidates the cached bytes, so does an external change).
  useEffect(() => {
    if (!content.data) return;
    setDraft(content.data.content);
    setBaseline(content.data.content);
    setExpectedMtimeMs(content.data.mtimeMs);
    setConflict(false);
  }, [content.data]);

  // The scan says the file has a different mtime than the bytes in the buffer:
  // somebody else wrote it. With nothing at risk, take the new content; with
  // unsaved edits, only say so — overwriting somebody's typing is never right.
  const stale =
    expectedMtimeMs !== null &&
    file.mtimeMs !== 0 &&
    Math.abs(file.mtimeMs - expectedMtimeMs) > MTIME_TOLERANCE_MS;

  const refetch = content.refetch;
  useEffect(() => {
    if (!stale || dirtyRef.current) return;
    void refetch();
  }, [stale, refetch]);

  const runSave = async (force: boolean) => {
    if (draft === null) return;
    setError(null);
    try {
      const result = await write.mutateAsync({
        path: file.path,
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
    const fresh = await ipc.readFile(file.path).catch(() => null);
    if (!fresh) return;
    setDraft(fresh.content);
    setBaseline(fresh.content);
    setExpectedMtimeMs(fresh.mtimeMs);
    setConflict(false);
  };

  const text = draft ?? "";
  const lineCount = useMemo(() => (text.match(/\n/g)?.length ?? 0) + 1, [text]);

  if (content.isError) {
    return (
      <div className="max-w-4xl">
        <Notice tone="error">{errorText(content.error)}</Notice>
      </div>
    );
  }
  if (draft === null) {
    return (
      <p className="max-w-4xl text-sm text-muted-foreground/70">{t("common.loading")}</p>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
          {MODES.map(({ mode: value, icon: Icon, labelKey }) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] transition-colors",
                mode === value
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {t(labelKey)}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-muted-foreground/60">
          {t("instructions.lines", { n: lineCount })}
        </span>
      </div>

      {stale && dirty && <Notice tone="warning">{t("instructions.changedOnDisk")}</Notice>}

      <div className={cn("mt-3 grid gap-4", mode === "split" && "lg:grid-cols-2")}>
        {mode !== "preview" && (
          <Textarea
            value={text}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                void runSave(false);
              }
            }}
            spellCheck={false}
            aria-label={t("instructions.editorLabel", { name: file.name })}
            placeholder={t("instructions.placeholder")}
            className="min-h-[28rem] font-mono text-[13px] leading-relaxed"
          />
        )}
        {mode !== "edit" && (
          <div className="min-h-[28rem] overflow-x-auto rounded-xl border border-border bg-card px-4 py-3">
            {text.trim() === "" ? (
              <p className="text-sm text-muted-foreground/60">{t("instructions.emptyPreview")}</p>
            ) : (
              <Markdown content={text} />
            )}
          </div>
        )}
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
        path={file.path}
        busy={write.isPending}
        onReload={() => void reload()}
        onOverwrite={() => void runSave(true)}
        onCancel={() => setConflict(false)}
      />
    </div>
  );
}
