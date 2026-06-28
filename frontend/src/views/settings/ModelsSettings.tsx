import { useEffect, useMemo, useState } from "react";
import {
  Plug,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Star,
  Plus,
  Check,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useSettings, useSettingsMutation } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SettingsPage } from "./shell";

// local editing shape for an enabled model
type Row = { id: string; base_url: string; api_key: string; has_api_key: boolean };

const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)));

export function ModelsSettings() {
  const t = useT();
  const { data: settings } = useSettings();
  const mutation = useSettingsMutation();

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [maxIters, setMaxIters] = useState(6);
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<Row[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [manual, setManual] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [discovering, setDiscovering] = useState(false);
  const [discoverErr, setDiscoverErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setBaseUrl(settings.llm_base_url);
    setMaxIters(settings.max_tool_iterations);
    setDefaultModel(settings.llm_model);
    setEnabled(
      settings.enabled_models.map((m) => ({
        id: m.id,
        base_url: m.base_url,
        api_key: "",
        has_api_key: m.has_api_key,
      })),
    );
  }, [settings]);

  const allModels = useMemo(
    () => uniq([...enabled.map((e) => e.id), ...discovered, defaultModel]).sort((a, b) => a.localeCompare(b)),
    [enabled, discovered, defaultModel],
  );

  const connected = !!settings?.llm_base_url && !!settings?.llm_model;
  const rowOf = (id: string) => enabled.find((e) => e.id === id);

  const discover = async () => {
    setDiscovering(true);
    setDiscoverErr("");
    try {
      await mutation.mutateAsync({
        llm_base_url: baseUrl,
        ...(apiKey ? { llm_api_key: apiKey } : {}),
      });
      const res = await api.discoverModels();
      setDiscovered(res.models);
    } catch (e: any) {
      setDiscoverErr(String(e.message ?? e));
    } finally {
      setDiscovering(false);
    }
  };

  const toggleEnabled = (id: string) => {
    setEnabled((prev) => {
      if (prev.some((e) => e.id === id)) {
        if (defaultModel === id) setDefaultModel("");
        return prev.filter((e) => e.id !== id);
      }
      return [...prev, { id, base_url: "", api_key: "", has_api_key: false }];
    });
  };

  const setAsDefault = (id: string) => {
    setDefaultModel(id);
    setEnabled((prev) => (prev.some((e) => e.id === id) ? prev : [...prev, { id, base_url: "", api_key: "", has_api_key: false }]));
  };

  const patchRow = (id: string, patch: Partial<Row>) =>
    setEnabled((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const addManual = () => {
    const id = manual.trim();
    if (!id) return;
    setEnabled((prev) => (prev.some((e) => e.id === id) ? prev : [...prev, { id, base_url: "", api_key: "", has_api_key: false }]));
    setManual("");
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const body: any = {
        llm_base_url: baseUrl,
        max_tool_iterations: maxIters,
        llm_model: defaultModel,
        enabled_models: enabled.map((e) => ({
          id: e.id,
          base_url: e.base_url,
          ...(e.api_key ? { api_key: e.api_key } : {}),
        })),
      };
      if (apiKey) body.llm_api_key = apiKey;
      await mutation.mutateAsync(body);
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPage title={t("settings.models.title")} subtitle={t("settings.models.subtitle")}>
      <section className="rounded-xl border border-border bg-card p-5">
        {/* header + connection status */}
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Plug className="size-4 text-primary" />
            <h2 className="text-base font-display">{t("settings.connection")}</h2>
          </div>
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold",
              connected ? "bg-primary/15 text-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            {connected ? (
              <>
                <CheckCircle2 className="size-3.5 text-primary" /> {t("settings.connected")}
              </>
            ) : (
              <>
                <XCircle className="size-3.5" /> {t("settings.notConnected")}
              </>
            )}
          </span>
        </div>
        <p className="mb-4 text-[13px] text-muted-foreground/70">{t("settings.connection.hint")}</p>

        {/* global connection fields */}
        <div className="flex flex-col gap-4">
          <Field label={t("settings.baseUrl")} hint={t("settings.baseUrl.hint")}>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://litellm.example.com"
            />
          </Field>

          <Field
            label={t("settings.apiKey")}
            hint={settings?.has_api_key ? t("settings.apiKey.hintStored") : t("settings.apiKey.hint")}
          >
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings?.has_api_key ? "••••••••" : "sk-…"}
            />
          </Field>

          <Field label={t("settings.maxIters")} hint={t("settings.maxIters.hint")}>
            <Input
              type="number"
              min={1}
              max={20}
              value={maxIters}
              onChange={(e) => setMaxIters(Number(e.target.value))}
              className="w-28"
            />
          </Field>
        </div>

        {/* divider */}
        <div className="my-5 border-t border-border" />

        {/* models picker */}
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("settings.available.title")}</h3>
          <Button variant="outline" size="sm" onClick={discover} disabled={discovering || !baseUrl}>
            <RefreshCw className={cn("size-4", discovering && "animate-spin")} />
            {t("settings.discover")}
          </Button>
        </div>
        <p className="mb-4 text-[13px] text-muted-foreground/70">{t("settings.available.subtitle")}</p>

        {discoverErr && <p className="mb-3 text-[12px] text-destructive">{discoverErr}</p>}

        {allModels.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground/70">
            {t("settings.discoverFirst")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {allModels.map((id) => {
              const row = rowOf(id);
              const isOn = !!row;
              const isDefault = defaultModel === id;
              const hasOverride = !!row && (!!row.base_url || row.has_api_key || !!row.api_key);
              const isOpen = expanded.has(id);
              return (
                <li key={id} className="rounded-lg border border-border">
                  <div className="flex items-center gap-3 px-3 py-2">
                    <button
                      onClick={() => toggleEnabled(id)}
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded border transition-colors",
                        isOn
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input hover:border-ring",
                      )}
                      aria-pressed={isOn}
                    >
                      {isOn && <Check className="size-3.5" />}
                    </button>
                    <span className="min-w-0 flex-1 truncate text-sm">{id}</span>

                    {hasOverride && (
                      <span className="hidden items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:flex">
                        <SlidersHorizontal className="size-3" /> {t("settings.override.badge")}
                      </span>
                    )}

                    {isDefault ? (
                      <span className="flex items-center gap-1 rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-foreground">
                        <Star className="size-3 fill-primary text-primary" /> {t("settings.default")}
                      </span>
                    ) : (
                      <button
                        onClick={() => setAsDefault(id)}
                        className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Star className="size-3" /> {t("settings.setDefault")}
                      </button>
                    )}

                    {isOn && (
                      <button
                        onClick={() => toggleExpand(id)}
                        title={t("settings.override")}
                        className={cn(
                          "flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                          isOpen && "bg-accent text-foreground",
                        )}
                      >
                        <ChevronDown className={cn("size-4 transition-transform", isOpen && "rotate-180")} />
                      </button>
                    )}
                  </div>

                  {/* per-model override editor */}
                  {isOn && isOpen && row && (
                    <div className="flex flex-col gap-3 border-t border-border bg-muted/30 px-3 py-3">
                      <p className="text-[12px] text-muted-foreground/80">{t("settings.override.hint")}</p>
                      <Field label={t("settings.baseUrl")}>
                        <Input
                          value={row.base_url}
                          onChange={(e) => patchRow(id, { base_url: e.target.value })}
                          placeholder={t("settings.override.baseUrlPlaceholder")}
                        />
                      </Field>
                      <Field label={t("settings.apiKey")}>
                        <Input
                          type="password"
                          value={row.api_key}
                          onChange={(e) => patchRow(id, { api_key: e.target.value })}
                          placeholder={
                            row.has_api_key ? "••••••••" : t("settings.override.apiKeyPlaceholder")
                          }
                        />
                      </Field>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {discovered.length > 0 && (
          <p className="mt-2 text-[12px] text-muted-foreground/70">
            {t("settings.modelsCount", { count: discovered.length })}
          </p>
        )}

        {/* manual add */}
        <div className="mt-4 flex gap-2">
          <Input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addManual()}
            placeholder={t("settings.addManual")}
            className="flex-1"
          />
          <Button variant="outline" onClick={addManual} disabled={!manual.trim()}>
            <Plus className="size-4" />
            {t("settings.add")}
          </Button>
        </div>

        {/* single save */}
        <div className="flex items-center gap-3 pt-5">
          <Button onClick={save} disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
          {saved && (
            <span className="flex items-center gap-1.5 text-[13px] text-primary">
              <CheckCircle2 className="size-4" /> {t("common.saved")}
            </span>
          )}
        </div>
      </section>
    </SettingsPage>
  );
}
