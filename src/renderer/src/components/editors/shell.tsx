import * as React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Info, RotateCcw, Save } from "lucide-react";
import { isWriteConflict } from "@shared/ipc";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT, type TFunc } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The furniture every capability editor shares: the save bar, the notices, and
 * the dialog that opens when the file moved under the editor.
 */

/** Turn whatever came back across the bridge into one readable line. */
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // Electron wraps a main-process throw: "Error invoking remote method 'x': Error: real message".
  const match = /Error invoking remote method '[^']*':\s*(?:Error:\s*)?(.*)$/s.exec(error.message);
  return (match?.[1] ?? error.message).trim();
}

/** A labelled block of form controls. */
export function Fieldset({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-muted-foreground/70">{hint}</span>}
    </label>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning" | "error" | "success";
  children: React.ReactNode;
}) {
  const Icon = tone === "info" ? Info : tone === "success" ? Check : AlertTriangle;
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-lg border p-3 text-[13px]",
        tone === "error" && "border-destructive/30 bg-destructive/10 text-destructive",
        tone === "warning" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        tone === "success" && "border-primary/30 bg-primary/10 text-foreground",
        tone === "info" && "border-border bg-card text-muted-foreground",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
    </p>
  );
}

/**
 * Where an editor's actions are drawn.
 *
 * The buttons belong at the top right of the view, next to the thing they act
 * on, rather than at the far end of a form that can be several screens long —
 * scrolling to the bottom to save is a tax on every edit. But the header is
 * the *view's* furniture and the buttons are the *editor's* state, so the
 * editor keeps owning them and posts them upwards through this slot.
 */
const ActionSlotContext = React.createContext<{
  node: HTMLElement | null;
  setNode: (node: HTMLElement | null) => void;
} | null>(null);

/** Wrap a view whose header hosts `<EditorActionSlot />`. */
export function EditorActionProvider({ children }: { children: React.ReactNode }) {
  const [node, setNode] = React.useState<HTMLElement | null>(null);
  const value = React.useMemo(() => ({ node, setNode }), [node]);
  return <ActionSlotContext.Provider value={value}>{children}</ActionSlotContext.Provider>;
}

/** Drop this in the view's header `actions`; the editor fills it. */
export function EditorActionSlot() {
  const slot = React.useContext(ActionSlotContext);
  return <div ref={slot?.setNode} className="flex items-center gap-1" />;
}

/**
 * Save, revert, and whatever else this editor can do to the file, plus the
 * state of the last attempt. Nothing is written until Save — AMOS never
 * autosaves somebody's config.
 *
 * Rendered into the view's header when there is a slot for it, and in place
 * otherwise, so an editor used outside a view still has its controls.
 */
export function SaveBar({
  dirty,
  saving,
  savedAt,
  error,
  onSave,
  onRevert,
  extra,
}: {
  dirty: boolean;
  saving: boolean;
  /** Timestamp of the last successful save, for the transient confirmation. */
  savedAt: number | null;
  error: unknown;
  onSave: () => void;
  onRevert: () => void;
  extra?: React.ReactNode;
}) {
  const t = useT();
  const slot = React.useContext(ActionSlotContext);

  const status = error ? (
    // The message can be a paragraph of git or filesystem prose; the header
    // shows that something failed and keeps the words a hover away.
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1.5 text-[12px] text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="max-w-[14rem] truncate">{errorText(error)}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">{errorText(error)}</TooltipContent>
    </Tooltip>
  ) : dirty ? (
    <span className="text-[12px] text-muted-foreground/70">{t("cap.unsaved")}</span>
  ) : savedAt ? (
    <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground/70">
      <Check className="size-3.5 text-primary" />
      {t("common.saved")}
    </span>
  ) : null;

  const actions = (
    <>
      {status}
      <Button size="sm" onClick={onSave} disabled={!dirty || saving}>
        <Save className="size-3.5" />
        {saving ? t("common.saving") : t("common.save")}
      </Button>
      <Button size="sm" variant="ghost" onClick={onRevert} disabled={!dirty || saving}>
        <RotateCcw className="size-3.5" />
        {t("cap.revert")}
      </Button>
      {extra}
    </>
  );

  if (slot?.node) return createPortal(actions, slot.node);

  return (
    <div className="sticky bottom-0 -mx-8 mt-8 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-8 py-3 backdrop-blur">
      {actions}
    </div>
  );
}

/**
 * The mtime check refused the save: somebody — another editor, a CLI, a `git
 * checkout` — rewrote the file since it was opened. The user picks whose
 * version wins; AMOS never guesses.
 */
export function ConflictDialog({
  open,
  path,
  busy,
  onReload,
  onOverwrite,
  onCancel,
}: {
  open: boolean;
  path: string;
  busy: boolean;
  onReload: () => void;
  onOverwrite: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={t("conflict.title")}
      description={t("conflict.desc")}
    >
      <p className="mb-4 break-all rounded-lg border border-border bg-muted/40 p-2 font-mono text-[12px]">
        {path}
      </p>
      <p className="text-[13px] text-muted-foreground">{t("conflict.backupHint")}</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button variant="outline" onClick={onReload} disabled={busy}>
          {t("conflict.reload")}
        </Button>
        <Button variant="destructive" onClick={onOverwrite} disabled={busy}>
          {t("conflict.overwrite")}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Classify a failed save: a conflict opens the dialog above, anything else is
 * shown as-is in the save bar.
 */
export function isConflict(error: unknown): boolean {
  return isWriteConflict(error);
}

export type { TFunc };
