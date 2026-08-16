import markUrl from "@/assets/logo-mark.png";
import wordmarkUrl from "@/assets/logo-wordmark.png";
import { cn } from "@/lib/utils";

// AMOS brand marks: a five-bladed pinwheel, and the wordmark that sets it as
// the "o" of the product name.
//
// Both ship as white-on-transparent PNGs, and neither is drawn — they are used
// as CSS masks over `currentColor`. That is what keeps a raster asset inside
// the monochrome system: the alpha channel is the shape, the surrounding text
// colour is the ink, so one file is black on the light theme and white on the
// dark one with nothing to swap. `assets/logo-mark.png` is also the source
// `scripts/gen-icons.mjs` rasterises into the packaged app icons.

/** Shared mask plumbing: paint `currentColor` through a PNG's alpha. */
function maskStyle(url: string): React.CSSProperties {
  return {
    WebkitMaskImage: `url(${url})`,
    maskImage: `url(${url})`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  };
}

/** Intrinsic ratio of the trimmed wordmark, so height alone sizes it. */
const WORDMARK_RATIO = 1274 / 302;

/**
 * The glyph alone — the collapsed sidebar rail, message avatars, empty states.
 * Size it with a square utility (`size-8`).
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      role="presentation"
      aria-hidden="true"
      className={cn("block shrink-0 bg-current", className)}
      style={maskStyle(markUrl)}
    />
  );
}

/**
 * The full wordmark — the expanded sidebar and the welcome screen. Give it a
 * height (`h-5`); the width follows from the artwork's ratio.
 */
export function LogoWordmark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="AMOS"
      className={cn("block shrink-0 bg-current", className)}
      style={{ ...maskStyle(wordmarkUrl), aspectRatio: WORDMARK_RATIO }}
    />
  );
}
