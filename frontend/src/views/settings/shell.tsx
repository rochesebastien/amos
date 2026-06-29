import type { ReactNode } from "react";

/** Shared header + scroll container for a settings section. */
export function SettingsPage({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="px-8 pt-8 pb-4">
        <h1 className="text-3xl font-display">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground/70">{subtitle}</p>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10">
        <div className="mx-auto flex max-w-2xl flex-col gap-8">{children}</div>
      </div>
    </div>
  );
}
