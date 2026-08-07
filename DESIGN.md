# DESIGN.md — AMOS

Visual identity & design system for the AMOS renderer
(`src/renderer/src/`). Tailwind CSS v4, CSS-first config in
`src/renderer/src/index.css`, shadcn-style primitives.

## Direction

**Monochrome, flat, quiet.** Reference points: shadcn/ui, the Codex and Cursor
editors — developer tools where the interface gets out of the way of the
content. AMOS shows files, paths and configuration; the chrome around them is
one neutral ramp, hairline borders and typography. Nothing is coloured for
decoration.

The rule that follows from it: **if something must stand out, use contrast,
weight, size or space — never a hue.** A black button on white (white on black
in dark mode) is the loudest thing the interface is allowed to do.

### What we are NOT

- No brand hue, no accent colour, no gradient, no tint. The palette is grey.
- No frosted glass, ambient glow, neumorphism, or skeuomorphic depth.
- No stacked/heavy shadows. Surfaces are flat; elevation is a hairline border.
- No display cut or extra-bold headings — titles are semibold, one typeface.
- No scattered micro-interactions.

## Tokens

All tokens live in **`src/renderer/src/index.css`** as CSS custom properties,
exposed to Tailwind via `@theme inline`. Use the utility names
(`bg-background`, `text-muted-foreground`, `border-border`, `bg-primary`…) —
**never hardcode a color** in components.

### Color — one neutral ramp

`--primary` is not a brand colour: it is the *ink* of the theme (near-black on
light, near-white on dark). That is what makes a filled button read as the one
strong element on a page, and it is why filled surfaces dim on hover
(`hover:opacity-90`) instead of brightening — a brightness filter does nothing
to near-black.

#### Light (`:root`, default)

```
--background          #ffffff   white page
--foreground          #0a0a0a   near-black text
--card / --popover    #ffffff   flat surface, told apart by its border
--primary             #171717   ink: filled buttons, switches, selected state
--primary-foreground  #fafafa
--secondary/--muted   #f5f5f5   quiet fills, code blocks, chips
--muted-foreground    #737373   secondary text
--accent              #f2f2f2   hover/active surface
--border / --input    #e5e5e5 / #e0e0e0   hairlines
--ring                #a3a3a3   focus
--sidebar             #fafafa   a hair off the page, border does the rest
--destructive         #d4183d   errors and destructive actions only
```

#### Dark (`.dark`)

```
--background          #0a0a0a
--foreground          #fafafa
--card / --popover    #131313 / #171717
--primary             #fafafa   ink inverts with the theme
--primary-foreground  #0a0a0a
--secondary/--muted   #1f1f1f / #1c1c1c
--muted-foreground    #a1a1a1
--accent              #232323
--border / --input    #262626 / #2e2e2e
--ring                #525252
--sidebar             #0d0d0d
--destructive         #f87171   lightened so it reads on black
```

**The one exception.** `--destructive` is the only chromatic token left, and it
is reserved for genuine failure: the *broken file* list, delete actions, save
errors. It is a signal, not a colour choice — an unreadable `SKILL.md` has to
be distinguishable from a readable one at a glance, and greying it would say
"disabled" rather than "broken". Everything else is grey.

### Radii

`--radius: 0.5rem` (8px) base; cards/columns `rounded-xl`, buttons and list
rows `rounded-md`/`rounded-lg`, inline chips `rounded-md`.

### Shadow

None. Surfaces are flat on a `border`. Elevation is a border and a background
step, never depth.

### Spacing rhythm

Tailwind's scale, used consistently. Page padding `px-8 pt-8`. Every scrollable
main area is `min-h-0 flex-1 overflow-y-auto`.

## Typography

One variable typeface: **Mona Sans** (open source, loaded via `@font-face` from
`src/renderer/src/assets/fonts`), a neutral grotesque in the Inter/Geist
register. Two weights, no display cut:

- **Body / UI** — 400, base **14px**, `letter-spacing: -0.006em`.
- **Titles** — `.font-display`, `h1`–`h3`: **600**, `letter-spacing: -0.018em`.
  View titles are `font-display text-2xl`; section headings `text-base`.

Hierarchy comes from the size ladder and from space, not from weight jumps.

Section labels: `text-[11px] font-semibold uppercase tracking-wider
text-muted-foreground/60`. Field labels: `text-[13px] text-muted-foreground`.
Paths, file names and config values are `font-mono text-[12px]/[13px]` — they
are data, and the monospace is what marks them as quotable.

## Marks

### The product mark

An **orchestration glyph** — one hub node wired to three satellites, standing
for the app driving a project's agents, skills and MCP servers. It exists
twice, on purpose:

- **`components/Logo.tsx`** — the in-app marks, drawn as inline SVG so they
  follow the theme. Everything takes `currentColor`; the wires (35%) and
  satellites (55%) are held back so the hub reads as the centre. `LogoMark` is
  the glyph alone (sidebar rail, message avatars, empty states);
  `LogoWordmark` pairs it with the product name.
- **`assets/logo.svg`** — the same geometry, white on a near-black rounded
  tile, for the favicon and as the source of the packaged app icons.
  `node scripts/gen-icons.mjs` rasterises it into `build/icon.png` (1024²) and
  `build/icons/*.png`; the geometry *and the two colours* are duplicated in
  that script and have to be kept in step by hand.

These are placeholders in the sense that they are geometric rather than
designed — but they are monochrome by construction and should be replaced as a
set, not patched.

### The ecosystem marks

**`components/BrandIcons.tsx`** holds the Claude and Codex glyphs, inline and
filled with `currentColor`.

Every capability AMOS lists belongs to one of two CLIs, and that fact is shown
**as a mark, not as a word**: in a list of thirty agents, skills and MCP
servers, a glyph is read at a glance where "Claude" / "Codex" have to be read
one by one — and two words of near-equal length and identical colour are
exactly the kind of label the eye stops parsing. Because both paths take
`currentColor`, the marks stay inside the monochrome system instead of
importing two brand palettes.

The name is never lost: it is the icon's accessible name (`role="img"` +
`aria-label` + `<title>`) and the tooltip on the badge. And where the
ecosystem is a *choice* rather than a label — the "new capability" form, the
Settings → Backends rows, the chat backend picker — the word stays and the
glyph sits next to it. A form control needs words.

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
  servers with ecosystem mark + scope badge → foot (Settings, theme). Collapses
  to a 56px rail that keeps the glyph and icon-only nav.
- **Main** (`flex min-w-0 flex-1 flex-col`): one view; header is
  `h1.font-display.text-2xl` + optional `text-muted-foreground/70` subtitle.

## Components

shadcn-style primitives in `components/ui/` (button, input, textarea, dialog,
select, badge, switch, tabs, dropdown). Active nav item:
`bg-sidebar-accent text-primary`. Focus: `focus-visible:ring-2 ring-ring`.
Badges are `text-[11px] font-medium`, outline by default — a chip is a label,
not a button.

**AI components.** The chat surface uses the shadcn AI-usage components, also in
`components/ui/`, themed to the AMOS tokens:

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
