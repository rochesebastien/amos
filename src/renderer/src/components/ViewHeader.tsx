import type * as React from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The one header every main view wears: a single compact bar, the same as the
 * chat's. One line carries the whole identity of the view — an optional
 * back arrow (icon-only, left of the name), the view's icon, its name, then
 * quiet metadata; actions keep to the right edge. Anything that needs a
 * paragraph belongs to the view's content, not up here.
 */
export function ViewHeader({
  backTo,
  backParams,
  backLabel,
  icon,
  title,
  meta,
  actions,
  className,
}: {
  /** Route of the back arrow; rendered only when present. */
  backTo?: string;
  backParams?: Record<string, string>;
  /** Accessible name (and tooltip) of the back arrow. */
  backLabel?: string;
  /** The view's icon, sized by the caller (`size-4` reads best here). */
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** Quiet inline metadata after the name: badges, sizes, a mono path. */
  meta?: React.ReactNode;
  /** Right-aligned controls. */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex min-h-12 shrink-0 items-center gap-2.5 border-b border-border px-4 py-2",
        className,
      )}
    >
      {backTo && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              {...({ to: backTo, params: backParams } as React.ComponentProps<typeof Link>)}
              aria-label={backLabel}
              className="-ml-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </Link>
          </TooltipTrigger>
          <TooltipContent>{backLabel}</TooltipContent>
        </Tooltip>
      )}
      {icon && <span className="flex shrink-0 items-center text-muted-foreground">{icon}</span>}
      <h1 className="min-w-0 shrink truncate text-base font-display">{title}</h1>
      {meta && <div className="flex min-w-0 shrink items-center gap-2">{meta}</div>}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
  );
}
