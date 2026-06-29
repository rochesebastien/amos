import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Upload, FileJson, AlertTriangle, CheckCircle2 } from "lucide-react";
import { api, type StorageCategory } from "@/lib/api";
import { qk } from "@/lib/queries";
import { useT, useLang, LANGUAGES, type Lang } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { cn } from "@/lib/utils";
import { SettingsPage } from "./shell";

const CATEGORIES: { key: StorageCategory; labelKey: string }[] = [
  { key: "settings", labelKey: "settings.cat.settings" },
  { key: "projects", labelKey: "settings.cat.projects" },
  { key: "mcps", labelKey: "settings.cat.mcps" },
  { key: "conversations", labelKey: "settings.cat.conversations" },
];

const ALL = CATEGORIES.map((c) => c.key);

function Checklist({
  selected,
  onToggle,
  available,
}: {
  selected: Set<StorageCategory>;
  onToggle: (k: StorageCategory) => void;
  available?: Set<StorageCategory>;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1.5">
      {CATEGORIES.map(({ key, labelKey }) => {
        const disabled = available != null && !available.has(key);
        const on = selected.has(key) && !disabled;
        return (
          <label
            key={key}
            className={cn(
              "flex cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm transition-colors",
              disabled ? "cursor-not-allowed opacity-40" : "hover:bg-accent",
            )}
          >
            <input
              type="checkbox"
              checked={on}
              disabled={disabled}
              onChange={() => onToggle(key)}
              className="size-4 accent-primary"
            />
            {t(labelKey)}
          </label>
        );
      })}
    </div>
  );
}

export function StorageSettings() {
  const t = useT();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const setLang = useLang((s) => s.setLang);
  const fileRef = useRef<HTMLInputElement>(null);

  const [exportSel, setExportSel] = useState<Set<StorageCategory>>(new Set(ALL));
  const [exporting, setExporting] = useState(false);

  const [fileData, setFileData] = useState<Record<string, any> | null>(null);
  const [fileName, setFileName] = useState("");
  const [available, setAvailable] = useState<Set<StorageCategory>>(new Set());
  const [importSel, setImportSel] = useState<Set<StorageCategory>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [importErr, setImportErr] = useState("");

  const toggle = (set: Set<StorageCategory>, k: StorageCategory) => {
    const next = new Set(set);
    next.has(k) ? next.delete(k) : next.add(k);
    return next;
  };

  const doExport = async () => {
    setExporting(true);
    try {
      const cats = ALL.filter((c) => exportSel.has(c));
      const doc = await api.exportData(cats);
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `cheveluai-export-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportMsg("");
    setImportErr("");
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const avail = new Set<StorageCategory>(
        ALL.filter((c) => Array.isArray(data[c]) && data[c].length >= 0 && c in data),
      );
      setFileData(data);
      setFileName(file.name);
      setAvailable(avail);
      setImportSel(new Set(avail));
    } catch {
      setImportErr(t("settings.import.empty"));
      setFileData(null);
    }
  };

  const doImport = async () => {
    if (!fileData) return;
    const cats = ALL.filter((c) => importSel.has(c) && available.has(c));
    if (cats.length === 0) {
      setImportErr(t("settings.import.empty"));
      return;
    }
    const ok = await confirm({
      title: t("settings.import"),
      description: t("settings.import.replaceWarn"),
      confirmText: t("settings.import"),
      destructive: true,
    });
    if (!ok) return;

    setImporting(true);
    setImportErr("");
    setImportMsg("");
    try {
      const res = await api.importData(fileData, cats);
      // refresh everything that may have changed
      qc.invalidateQueries({ queryKey: qk.settings });
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.invalidateQueries({ queryKey: qk.mcps });
      qc.invalidateQueries({ queryKey: qk.conversations });
      // adopt an imported UI language without re-persisting it
      if (cats.includes("settings")) {
        const fresh = await api.getSettings();
        if (LANGUAGES.some((l) => l.value === fresh.language)) {
          setLang(fresh.language as Lang, { persist: false });
        }
      }
      const summary = Object.entries(res.imported)
        .map(([k, n]) => `${t(`settings.cat.${k}`)} (${n})`)
        .join(", ");
      setImportMsg(t("settings.import.done", { summary }));
      setFileData(null);
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (e: any) {
      setImportErr(String(e.message ?? e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <SettingsPage title={t("settings.storage.title")} subtitle={t("settings.storage.subtitle")}>
      {/* export */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <Download className="size-4 text-primary" />
          <h2 className="text-base font-display">{t("settings.export")}</h2>
        </div>
        <p className="mb-4 text-[13px] text-muted-foreground/70">{t("settings.export.desc")}</p>
        <Checklist selected={exportSel} onToggle={(k) => setExportSel((s) => toggle(s, k))} />
        <div className="pt-4">
          <Button onClick={doExport} disabled={exporting || exportSel.size === 0}>
            <Download className="size-4" />
            {exporting ? t("common.saving") : t("settings.export.button")}
          </Button>
        </div>
      </section>

      {/* import */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <Upload className="size-4 text-primary" />
          <h2 className="text-base font-display">{t("settings.import")}</h2>
        </div>
        <p className="mb-4 text-[13px] text-muted-foreground/70">{t("settings.import.desc")}</p>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={onPickFile}
          className="hidden"
        />
        <div className="mb-4 flex items-center gap-3">
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <FileJson className="size-4" />
            {t("settings.import.choose")}
          </Button>
          {fileName && <span className="truncate text-[13px] text-muted-foreground">{fileName}</span>}
        </div>

        {fileData && (
          <>
            <Checklist
              selected={importSel}
              available={available}
              onToggle={(k) => setImportSel((s) => toggle(s, k))}
            />
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{t("settings.import.replaceWarn")}</span>
            </div>
            <div className="pt-4">
              <Button variant="destructive" onClick={doImport} disabled={importing}>
                <Upload className="size-4" />
                {importing ? t("common.saving") : t("settings.import.button")}
              </Button>
            </div>
          </>
        )}

        {importMsg && (
          <p className="mt-3 flex items-center gap-1.5 text-[13px] text-primary">
            <CheckCircle2 className="size-4" /> {importMsg}
          </p>
        )}
        {importErr && <p className="mt-3 text-[12px] text-destructive">{importErr}</p>}
      </section>
    </SettingsPage>
  );
}
