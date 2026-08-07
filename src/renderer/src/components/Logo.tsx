import { cn } from "@/lib/utils";

// AMOS brand marks. Placeholder identity: an orchestration glyph — one hub
// node wired to three satellites, i.e. the app driving a project's agents,
// skills and MCP servers.
//
// Drawn inline rather than imported as an image so both marks follow the
// theme: the satellites and wires take the surrounding text colour, the hub
// takes the primary token. `src/renderer/src/assets/logo.svg` is the same
// geometry with fixed colours, for the favicon and the packaged app icon.

const SATELLITES = [
  { cx: 32, cy: 12 },
  { cx: 14.68, cy: 42 },
  { cx: 49.32, cy: 42 },
] as const;

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="presentation"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <g stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" opacity={0.45}>
        {SATELLITES.map((s) => (
          <line key={`${s.cx}`} x1={32} y1={32} x2={s.cx} y2={s.cy} />
        ))}
      </g>
      <g fill="currentColor">
        {SATELLITES.map((s) => (
          <circle key={`${s.cx}`} cx={s.cx} cy={s.cy} r={4.6} />
        ))}
      </g>
      <circle cx={32} cy={32} r={7} className="fill-primary" />
    </svg>
  );
}

/** The mark next to the product name, for sidebar headers and empty states. */
export function LogoWordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark className="size-8" />
      <span className="font-display text-2xl leading-none tracking-tight">AMOS</span>
    </div>
  );
}
