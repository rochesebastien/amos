import { AlertTriangle, Bot, Plug, Sparkles } from "lucide-react";
import type { CapabilityItem, CapabilityKind, Ecosystem, Scope } from "@shared/capabilities";
import { Badge } from "@/components/ui/badge";
import { EcosystemGlyph } from "@/components/BrandIcons";
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

/** Glyph size matching each badge size, so a row of both lines up. */
const GLYPH_SIZES = {
  sm: "size-3",
  md: "size-3.5",
} as const;

type Size = keyof typeof SIZES;

/**
 * The ecosystem is shown as its mark, not as the word: in a list of thirty
 * capabilities the glyph is read at a glance where the two labels have to be
 * read one by one. The name stays reachable — as the accessible name of the
 * icon and as the tooltip.
 */
export function EcosystemBadge({ ecosystem, size = "md" }: { ecosystem: Ecosystem; size?: Size }) {
  const t = useT();
  const name = t(`cap.eco.${ecosystem}`);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0 items-center text-foreground/75">
          <EcosystemGlyph ecosystem={ecosystem} className={GLYPH_SIZES[size]} title={name} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
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
