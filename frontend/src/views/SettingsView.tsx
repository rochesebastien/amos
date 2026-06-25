import { useEffect, useState } from "react";
import { Plug, RefreshCw, CheckCircle2, XCircle, Monitor, Moon, Sun } from "lucide-react";
import { api, type Settings } from "@/lib/api";
import { useApp, type ThemeMode } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function SettingsView() {
  const { theme, setTheme } = useApp();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [maxIters, setMaxIters] = useState(6);
  const [models, setModels] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoverErr, setDiscoverErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setBaseUrl(s.llm_base_url);
      setModel(s.llm_model);
      setMaxIters(s.max_tool_iterations);
    });
  }, []);

  const discover = async () => {
    setDiscovering(true);
    setDiscoverErr("");
    try {
      // persist base url + key first so the backend can reach the gateway
      await api.updateSettings({
        llm_base_url: baseUrl,
        ...(apiKey ? { llm_api_key: apiKey } : {}),
      });
      const res = await api.discoverModels();
      setModels(res.models);
      if (!model && res.models[0]) setModel(res.models[0]);
    } catch (e: any) {
      setDiscoverErr(String(e.message ?? e));
    } finally {
      setDiscovering(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const body: any = {
        llm_base_url: baseUrl,
        llm_model: model,
        max_tool_iterations: maxIters,
      };
      if (apiKey) body.llm_api_key = apiKey;
      const s = await api.updateSettings(body);
      setSettings(s);
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const connected = !!settings?.llm_base_url && !!settings?.llm_model;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="px-6 pt-8 pb-4">
        <h1 className="text-3xl font-display">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground/70">
          Connect CheveluAI to your model and tune its behaviour.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        <div className="mx-auto flex max-w-2xl flex-col gap-8">
          {/* connection */}
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plug className="size-4 text-primary" />
                <h2 className="text-base font-display">Model connection</h2>
              </div>
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold",
                  connected ? "bg-primary/15 text-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {connected ? (
                  <>
                    <CheckCircle2 className="size-3.5 text-primary" /> Connected
                  </>
                ) : (
                  <>
                    <XCircle className="size-3.5" /> Not connected
                  </>
                )}
              </span>
            </div>

            <div className="flex flex-col gap-4">
              <Field
                label="Base URL"
                hint="Your OpenAI-compatible endpoint, e.g. an external LiteLLM gateway. /v1 is added if missing."
              >
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://litellm.example.com"
                />
              </Field>

              <Field
                label="API key"
                hint={
                  settings?.has_api_key
                    ? "A key is stored. Leave blank to keep it, or type a new one to replace it."
                    : "Sent as a Bearer token. Stored locally in the backend database."
                }
              >
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={settings?.has_api_key ? "••••••••  (unchanged)" : "sk-…"}
                />
              </Field>

              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] text-muted-foreground">Model</span>
                <div className="flex gap-2">
                  {models.length > 0 ? (
                    <Select value={model} onChange={(e) => setModel(e.target.value)} className="flex-1">
                      {!models.includes(model) && model && <option value={model}>{model}</option>}
                      {models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="gpt-4o-mini, claude-…, etc."
                      className="flex-1"
                    />
                  )}
                  <Button variant="outline" onClick={discover} disabled={discovering || !baseUrl}>
                    <RefreshCw className={cn("size-4", discovering && "animate-spin")} />
                    Discover
                  </Button>
                </div>
                {discoverErr && (
                  <span className="text-[12px] text-destructive">{discoverErr}</span>
                )}
                {models.length > 0 && (
                  <span className="text-[12px] text-muted-foreground/70">
                    {models.length} models available from the gateway.
                  </span>
                )}
              </div>

              <Field label="Max tool iterations" hint="How many tool-calling rounds the model may take per reply.">
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={maxIters}
                  onChange={(e) => setMaxIters(Number(e.target.value))}
                  className="w-28"
                />
              </Field>

              <div className="flex items-center gap-3 pt-1">
                <Button onClick={save} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
                {saved && (
                  <span className="flex items-center gap-1.5 text-[13px] text-primary">
                    <CheckCircle2 className="size-4" /> Saved
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* appearance */}
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 text-base font-display">Appearance</h2>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { mode: "light", label: "Light", icon: Sun },
                  { mode: "dark", label: "Dark", icon: Moon },
                  { mode: "system", label: "System", icon: Monitor },
                ] as { mode: ThemeMode; label: string; icon: React.ElementType }[]
              ).map(({ mode, label, icon: Icon }) => (
                <button
                  key={mode}
                  onClick={() => setTheme(mode)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                    theme === mode ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
                  )}
                >
                  <Icon className={cn("size-5", theme === mode && "text-primary")} />
                  <span className="text-sm font-medium">{label}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
