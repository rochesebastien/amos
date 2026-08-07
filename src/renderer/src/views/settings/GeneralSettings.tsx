import { Monitor, Moon, Sun } from "lucide-react";
import { useApp, type ThemeMode } from "@/lib/store";
import { useLang, useT, LANGUAGES, type Lang } from "@/lib/i18n";
import { Field, Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SettingsPage } from "./shell";

export function GeneralSettings() {
  const t = useT();
  const { theme, setTheme } = useApp();
  const { lang, setLang } = useLang();

  const themes: { mode: ThemeMode; labelKey: string; icon: React.ElementType }[] = [
    { mode: "light", labelKey: "settings.theme.light", icon: Sun },
    { mode: "dark", labelKey: "settings.theme.dark", icon: Moon },
    { mode: "system", labelKey: "settings.theme.system", icon: Monitor },
  ];

  return (
    <SettingsPage title={t("settings.general.title")} subtitle={t("settings.general.subtitle")}>
      {/* appearance */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 text-base font-display">{t("settings.appearance")}</h2>
        <div className="grid grid-cols-3 gap-2">
          {themes.map(({ mode, labelKey, icon: Icon }) => (
            <button
              key={mode}
              type="button"
              aria-pressed={theme === mode}
              onClick={() => setTheme(mode)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                theme === mode ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
              )}
            >
              <Icon className={cn("size-5", theme === mode && "text-primary")} />
              <span className="text-sm font-medium">{t(labelKey)}</span>
            </button>
          ))}
        </div>
      </section>

      {/* language */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 text-base font-display">{t("settings.language")}</h2>
        <Field label={t("settings.language")} hint={t("settings.language.hint")}>
          <Select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className="max-w-xs"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
      </section>
    </SettingsPage>
  );
}
