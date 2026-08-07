import { useEffect, useState } from "react";
import { CheckCircle2, CircleSlash, RefreshCw, TriangleAlert } from "lucide-react";
import {
  CLI_PATH_SETTING,
  CLI_VENDORS,
  ECHO_DRIVER_SETTING,
  type CliStatus,
  type CliVendor,
} from "@shared/chat";
import { relativeTime, useT, type TFunc } from "@/lib/i18n";
import { useCliDetection, useRecheckClis, useSetting, useSettingMutation } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { SettingsPage } from "./shell";

/**
 * Settings → Backends: what AMOS found, where it found it, and the two levers
 * that matter when it found nothing — a manual binary path (the macOS GUI
 * `PATH` problem), and the hidden echo driver for development.
 */
export function BackendSettings() {
  const t = useT();
  const { data: detection, isPending } = useCliDetection();
  const recheck = useRecheckClis();
  const echo = useSetting(ECHO_DRIVER_SETTING);
  const saveSetting = useSettingMutation();

  return (
    <SettingsPage title={t("settings.backends.title")} subtitle={t("settings.backends.subtitle")}>
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-base font-display">{t("backends.detected")}</h2>
          <span className="text-[12px] text-muted-foreground/60">
            {detection ? t("backends.checkedAt", { when: relativeTime(t, detection.checkedAt) }) : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => recheck.mutate()}
            disabled={recheck.isPending}
          >
            <RefreshCw className={cn("size-3.5", recheck.isPending && "animate-spin")} />
            {t("backends.recheck")}
          </Button>
        </div>
        {isPending && <p className="text-sm text-muted-foreground/70">{t("common.loading")}</p>}
        <div className="flex flex-col gap-3">
          {CLI_VENDORS.map((vendor) => (
            <VendorRow key={vendor} t={t} vendor={vendor} status={detection?.clis[vendor]} />
          ))}
        </div>
        <p className="mt-3 text-[12px] text-muted-foreground/60">{t("backends.inheritHint")}</p>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-1 text-base font-display">{t("backends.paths")}</h2>
        <p className="mb-4 text-sm text-muted-foreground/70">{t("backends.pathsHint")}</p>
        <div className="flex flex-col gap-4">
          {CLI_VENDORS.map((vendor) => (
            <PathOverride key={vendor} t={t} vendor={vendor} />
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-1 text-base font-display">{t("backends.echo")}</h2>
        <p className="mb-4 text-sm text-muted-foreground/70">{t("backends.echoHint")}</p>
        <label className="flex items-center gap-3 text-sm">
          <Switch
            checked={echo.data?.value === "1"}
            onCheckedChange={(checked) =>
              saveSetting.mutate({ key: ECHO_DRIVER_SETTING, value: checked ? "1" : "0" })
            }
          />
          {t("backends.echoToggle")}
        </label>
      </section>
    </SettingsPage>
  );
}

function VendorRow({
  t,
  vendor,
  status,
}: {
  t: TFunc;
  vendor: CliVendor;
  status: CliStatus | undefined;
}) {
  const state = !status?.installed
    ? "missing"
    : status.auth === "unauthenticated"
      ? "unauth"
      : "ready";
  const Icon = state === "ready" ? CheckCircle2 : state === "unauth" ? TriangleAlert : CircleSlash;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          state === "ready" ? "text-primary" : state === "unauth" ? "text-destructive" : "text-muted-foreground/50",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          {t(`cap.eco.${vendor}`)}
          <span className="text-[12px] font-normal text-muted-foreground/70">
            {state === "ready"
              ? t("backends.ready")
              : state === "unauth"
                ? t("backends.notLoggedIn")
                : t("backends.notInstalled")}
          </span>
        </p>
        {status?.path && (
          <p className="truncate font-mono text-[12px] text-muted-foreground/70" title={status.path}>
            {status.path}
          </p>
        )}
        {status?.version && (
          <p className="truncate text-[12px] text-muted-foreground/60">{status.version}</p>
        )}
        {status?.source && (
          <p className="text-[11px] text-muted-foreground/50">
            {t(`backends.source.${status.source}`)}
          </p>
        )}
        {status?.note && <p className="mt-1 text-[12px] text-destructive">{status.note}</p>}
      </div>
    </div>
  );
}

/** A manual path for one CLI, saved on blur so every keystroke is not a probe. */
function PathOverride({ t, vendor }: { t: TFunc; vendor: CliVendor }) {
  const key = CLI_PATH_SETTING[vendor];
  const stored = useSetting(key);
  const saveSetting = useSettingMutation();
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Adopt the persisted value once, then leave the field to the user.
  useEffect(() => {
    if (loaded || stored.data === undefined) return;
    setValue(stored.data.value ?? "");
    setLoaded(true);
  }, [loaded, stored.data]);

  const commit = () => {
    if ((stored.data?.value ?? "") === value) return;
    saveSetting.mutate({ key, value });
  };

  return (
    <Field label={t("backends.pathFor", { name: t(`cap.eco.${vendor}`) })} hint={t("backends.pathHint")}>
      <Input
        value={value}
        placeholder={vendor === "claude" ? "/usr/local/bin/claude" : "/usr/local/bin/codex"}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
    </Field>
  );
}
