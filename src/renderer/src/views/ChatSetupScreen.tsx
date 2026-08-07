import { Link } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2, RefreshCw, Settings as SettingsIcon, Terminal } from "lucide-react";
import { CLI_VENDORS, type CliDetection, type CliVendor } from "@shared/chat";
import { useT, type TFunc } from "@/lib/i18n";
import { EcosystemGlyph } from "@/components/BrandIcons";
import { useRecheckClis } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * What the chat shows when neither CLI can answer.
 *
 * AMOS deliberately has no login of its own: the chat runs on the plan the
 * user already pays for, through the CLI they already installed. So when there
 * is nothing to drive, the honest thing to show is the two commands that fix
 * it — not a sign-in form.
 */

/** The commands that install and authenticate each vendor's CLI. */
const SETUP: Record<CliVendor, { install: string; login: string; docs: string }> = {
  claude: {
    install: "npm install -g @anthropic-ai/claude-code",
    login: "claude   # then /login",
    docs: "https://docs.claude.com/en/docs/claude-code",
  },
  codex: {
    install: "npm install -g @openai/codex",
    login: "codex login",
    docs: "https://developers.openai.com/codex/cli",
  },
};

export function ChatSetupScreen({ detection }: { detection: CliDetection | undefined }) {
  const t = useT();
  const recheck = useRecheckClis();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <header className="mb-6">
          <h1 className="flex items-center gap-3 text-2xl font-display">
            <Terminal className="size-6 shrink-0 text-primary" />
            {t("setup.title")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("setup.subtitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground/70">{t("setup.noKeys")}</p>
        </header>

        <div className="flex flex-col gap-4">
          {CLI_VENDORS.map((vendor) => (
            <VendorCard key={vendor} t={t} vendor={vendor} detection={detection} />
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button onClick={() => recheck.mutate()} disabled={recheck.isPending}>
            <RefreshCw className={cn("size-4", recheck.isPending && "animate-spin")} />
            {recheck.isPending ? t("setup.checking") : t("setup.recheck")}
          </Button>
          <Link
            to="/settings/backends"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-input px-4 text-sm transition-colors hover:bg-accent"
          >
            <SettingsIcon className="size-4" />
            {t("setup.openSettings")}
          </Link>
        </div>

        {detection?.echoEnabled === false && (
          <p className="mt-4 text-[12px] text-muted-foreground/60">{t("setup.echoHint")}</p>
        )}
      </div>
    </div>
  );
}

function VendorCard({
  t,
  vendor,
  detection,
}: {
  t: TFunc;
  vendor: CliVendor;
  detection: CliDetection | undefined;
}) {
  const status = detection?.clis[vendor];
  const ready = status?.installed === true && status.auth !== "unauthenticated";
  const setup = SETUP[vendor];

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-1 flex items-center gap-2 text-base font-display">
        {ready ? (
          <CheckCircle2 className="size-4 text-primary" />
        ) : (
          <AlertCircle className="size-4 text-muted-foreground/60" />
        )}
        <EcosystemGlyph ecosystem={vendor} className="size-4" />
        {t(`cap.eco.${vendor}`)}
        <span className="ml-auto text-[12px] font-normal text-muted-foreground/70">
          {status?.installed
            ? status.auth === "unauthenticated"
              ? t("backends.notLoggedIn")
              : t("backends.ready")
            : t("backends.notInstalled")}
        </span>
      </h2>

      {status?.installed ? (
        <p className="mb-3 truncate font-mono text-[12px] text-muted-foreground/70" title={status.path ?? ""}>
          {status.path}
          {status.version ? ` · ${status.version}` : ""}
        </p>
      ) : null}

      <p className="mb-2 text-sm text-muted-foreground">
        {status?.installed ? t("setup.loginStep") : t("setup.installStep")}
      </p>
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-[12px]">
        {status?.installed ? setup.login : `${setup.install}\n${setup.login}`}
      </pre>
      <p className="mt-2 text-[12px] text-muted-foreground/60">
        {t("setup.docs")}: <span className="font-mono">{setup.docs}</span>
      </p>
      {status?.note && <p className="mt-2 text-[12px] text-destructive">{status.note}</p>}
    </section>
  );
}
