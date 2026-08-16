import type { ReactNode } from "react";
import { ViewHeader } from "@/components/ViewHeader";

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
      <ViewHeader title={title} />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-8">
          {subtitle && <p className="-mb-4 text-sm text-muted-foreground/70">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
