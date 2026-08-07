import { AlertTriangle, Bot, Plug, Sparkles } from "lucide-react";
import type { CapabilityItem, CapabilityKind, Ecosystem, Scope } from "@shared/capabilities";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The small visual vocabulary of a capability: which ecosystem declares it,
 * whether it comes from the project or from the user's home folder, and
 * whether its file parsed at all. Reused by the sidebar, the project overview
 * and the detail views so the three always read the same.
 */

/** The lucide icon standing for a kind, used next to names and section titles. */
export const KIND_ICONS: Record<CapabilityKind, typeof Bot> = {
  agent: Bot,
  skill: Sparkles,
  mcp: Plug,
};

const SIZES = {
  sm: "px-1.5 py-0 text-[10px] font-medium",
  md: "px-2 py-0.5 text-[11px]",
} as const;

type Size = keyof typeof SIZES;

export function EcosystemBadge({ ecosystem, size = "md" }: { ecosystem: Ecosystem; size?: Size }) {
  const t = useT();
  return (
    <Badge
      variant={ecosystem === "claude" ? "primary" : "secondary"}
      className={cn("shrink-0", SIZES[size])}
    >
      {t(`cap.eco.${ecosystem}`)}
    </Badge>
  );
}

export function ScopeBadge({ scope, size = "md" }: { scope: Scope; size?: Size }) {
  const t = useT();
  const badge = (
    <Badge variant="outline" className={cn("shrink-0", SIZES[size])}>
      {t(`cap.scope.${scope}`)}
    </Badge>
  );
  if (scope !== "global") return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent>{t("cap.scope.globalHint")}</TooltipContent>
    </Tooltip>
  );
}

export function BrokenBadge({ size = "md" }: { size?: Size }) {
  const t = useT();
  return (
    <Badge
      className={cn(
        "shrink-0 border border-destructive/30 bg-destructive/15 text-destructive",
        SIZES[size],
      )}
    >
      <AlertTriangle className="size-3" />
      {t("cap.broken")}
    </Badge>
  );
}

/** Ecosystem + scope (+ broken) in one row, the way every list shows them. */
export function CapabilityBadges({
  item,
  size = "md",
  className,
}: {
  item: CapabilityItem;
  size?: Size;
  className?: string;
}) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1", className)}>
      <EcosystemBadge ecosystem={item.ecosystem} size={size} />
      <ScopeBadge scope={item.scope} size={size} />
      {item.parseError && <BrokenBadge size={size} />}
    </span>
  );
}
