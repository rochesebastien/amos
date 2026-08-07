# DESIGN.md — AMOS

Visual identity & design system for the AMOS renderer
(`src/renderer/src/`). Adapted from a flat, light-first system (Tailwind CSS v4,
CSS-first config in `src/renderer/src/index.css`, shadcn-style primitives) with
the AMOS palette and typeface.

## Direction

Flat, light-first, restrained. Reference points: Notion, Linear, OpenAI Codex —
a **tool**, not a dashboard SaaS or "AI launchpad" template. Character comes from
typography, spacing, and a single confident brand accent — not chrome, gradients,
or animation.

### What we are NOT

- No frosted glass, ambient glow, neumorphism, or skeuomorphic depth.
- No stacked/heavy shadows. Surfaces are flat; elevation is a hairline border.
- No Inter / Roboto / system-font look — AMOS is **Mona Sans** everywhere.
- No scattered micro-interactions.
- No second brand hue. Green is the only accent (disciplined exceptions below).

## Tokens

All tokens live in **`src/renderer/src/index.css`** as CSS custom properties, exposed to
Tailwind via `@theme inline`. Use the utility names (`bg-background`,
`text-muted-foreground`, `border-border`, `bg-primary`…) — **never hardcode a
color** in components.

### Color — the AMOS palette

Three brand literals drive everything:

```
Primary     #00ED64   buttons, accents, focus ring, active nav  (THE accent)
Background  #FFFFEB    warm cream page base
Secondary   #001E2B   near-black teal — text, borders, dark canvas
```

#### Light (`:root`, default)

```
--background          #FFFFEB    warm cream
--foreground          #001E2B    secondary teal — body text
--card / --popover    #FFFEF2    flat surface, a hair off background
--muted               teal @ ~5%
--muted-foreground    teal @ ~60%
--accent              teal @ ~6%  hover/active surface tint
--border / --input    teal @ ~13%  hairline borders
--primary             #00ED64
--primary-foreground  #001E2B    dark text on bright green
--ring                #00ED64
--destructive         red — delete / error only
```

#### Dark (`.dark`) — a faithful inversion

```
--background          #001E2B    secondary teal becomes the canvas
--foreground          #FFFFEB    cream text
--card                lighter teal, raised-but-flat
--border              cream @ ~10%
--primary             #00ED64    same green in both themes
```

**Single-accent rule.** Green `#00ED64` is the only decorative hue. If something
must stand out, reach for contrast, weight, or a border before a second color.
Disciplined exceptions: `--destructive` (red, delete/error) and the chart palette
in data views.

### Radii

`--radius: 0.625rem` (10px) base; cards/columns `rounded-xl`, list rows
`rounded-lg`, inline chips `rounded-md`/`rounded-sm`.

### Shadow

Effectively none — flat surfaces on a `border`. A single subtle `hover:shadow-sm`
on grabbable cards. Elevation = borders and background tint, not depth.

### Spacing rhythm

Tailwind's scale, used consistently. Page padding `px-6 pt-8`. Every scrollable
main area is `min-h-0 flex-1 overflow-y-auto`.

## Typography

One variable typeface: **Mona Sans** (open source, loaded via `@font-face` from
`src/renderer/src/assets/fonts`). Two registers:

- **Display / large text** — Mona Sans **ExtraBold** (`font-weight: 800`),
  `tracking-tight`. View titles: `font-display text-3xl`.
- **Body / UI** — Mona Sans **Medium** (`font-weight: 500`). Base 15px.

Section labels: `text-[11px] font-semibold uppercase tracking-wider
text-muted-foreground/60`. Field labels: `text-[13px] text-muted-foreground`.

## Brand mark

The AMOS identity is deliberately minimal: an **orchestration glyph** — one hub
node wired to three satellites, standing for the app driving a project's agents,
skills and MCP servers.

It exists twice, on purpose:

- **`components/Logo.tsx`** — the in-app marks, drawn as inline SVG so they
  follow the theme. The wires and satellites take `currentColor`, the hub takes
  `fill-primary`. `LogoMark` is the glyph alone (sidebar rail, message avatars,
  empty states); `LogoWordmark` pairs it with the product name in
  `font-display`, and replaces what used to be two baked-in wordmark PNGs.
- **`assets/logo.svg`** — the same geometry with fixed brand colours on a
  rounded navy tile, for the favicon and as the source of the packaged app
  icons. `node scripts/gen-icons.mjs` rasterises it into `build/icon.png`
  (1024²) and `build/icons/*.png`; the geometry is duplicated in that script and
  has to be kept in step by hand.

These are placeholders, in the sense that they are geometric rather than
designed — but they are made of the palette above and should be replaced as a
set, not patched.

## Layout

Full-window app shell — a sidebar + a swappable main view, plus overlays.
Root: `flex h-screen w-screen overflow-hidden bg-background text-foreground`.

```
┌────────────┬─────────────────────────────────────┐
│ Sidebar    │  Main view                          │
│  ~280px    │   ┌─ header (font-display title) ─┐  │
│            │   │ view content / scroll area    │  │
│            │   └───────────────────────────────┘  │
└────────────┴─────────────────────────────────────┘
```

- **Sidebar** (`bg-sidebar`): wordmark → nav (Home) → the project list, each
  project a clickable name plus a chevron unfolding its Agents / Skills / MCP
  servers with ecosystem + scope badges → foot (Settings, theme). Collapses to a
  56px rail that keeps the glyph and icon-only nav.
- **Main** (`flex min-w-0 flex-1 flex-col`): one view; header is
  `h1.font-display.text-3xl` + optional `text-muted-foreground/70` subtitle.

## Components

shadcn-style primitives in `components/ui/` (button, input, textarea, dialog,
select, badge, switch, tabs, dropdown). Active nav item:
`bg-sidebar-accent font-medium`, icon `text-primary`. Focus:
`border-ring ring-1 ring-ring`.

**AI components.** The chat surface uses the shadcn AI-usage components, also in
`components/ui/`, themed to the AMOS palette:

- `message` — row layout (avatar, alignment, header, footer) for a turn.
- `bubble` — the framed message surface (variants incl. `ghost` for assistant
  markdown, `tinted` for the user, `destructive` for errors).
- `marker` — inline status / tool-call rows; pairs with the `shimmer` utility
  and `spinner` for streaming state.
- `attachment` — staged file previews in the composer (icon/media, metadata,
  upload state, remove action), laid out with `AttachmentGroup`.
- `message-scroller` — the chat transcript scroller. The scroll behavior
  (anchored turns, follow-the-live-edge, open-at-last-anchor, jump-to-latest)
  comes from the headless `@shadcn/react` package; the file in `components/ui/`
  is the styled frame themed to the AMOS tokens. Installs with
  `legacy-peer-deps` (see `.npmrc`) since the project is on React 18.

## Animation

Entrance `animate-in`; hover/focus ~120–200ms `ease`. No bouncy easings, no
decorative motion — motion only for genuine feedback.
