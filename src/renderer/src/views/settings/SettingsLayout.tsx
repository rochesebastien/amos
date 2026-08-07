import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, SlidersHorizontal, Boxes, Database } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import logoIcon from "@/assets/logo.png";

const SECTIONS = [
  { to: "/settings/general", labelKey: "settings.general", icon: SlidersHorizontal },
  { to: "/settings/models", labelKey: "settings.models", icon: Boxes },
  { to: "/settings/storage", labelKey: "settings.storage", icon: Database },
] as const;

export function SettingsLayout() {
  const t = useT();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex h-full w-full min-w-0">
      {/* settings sub-sidebar (replaces the main app sidebar) */}
      <aside className="flex h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="px-3 pt-4 pb-2">
          <Link
            to="/"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {t("settings.backToApp")}
          </Link>
        </div>

        <div className="flex items-center gap-2 px-6 pb-3 pt-1">
          <img src={logoIcon} alt="CheveluAI" className="size-7" />
          <h2 className="text-lg font-display">{t("settings.title")}</h2>
        </div>

        <nav className="flex flex-col gap-0.5 px-3 py-1.5">
          {SECTIONS.map(({ to, labelKey, icon: Icon }) => {
            const active = pathname === to;
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60",
                )}
              >
                <Icon className={cn("size-4", active && "text-primary")} />
                {t(labelKey)}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
