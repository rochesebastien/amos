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
--background          #171717   near-black page
--foreground          #fafafa
--card / --popover    #1e1e1e / #232323   a step up from the page
--primary             #fafafa   ink inverts with the theme
--primary-foreground  #171717
--secondary/--muted   #262626 / #222222
--muted-foreground    #a1a1a1
--accent              #2a2a2a
--border / --input    #2e2e2e / #333333
--ring                #555555
--sidebar             #282828   a lighter panel beside the page
--destructive         #f87171   lightened so it reads on black
```

The dark sidebar is deliberately **lighter** than the page (`#282828` on
`#171717`), the editor-panel convention (Codex, VS Code): the rail reads as a
surface laid over the canvas, not a hole in it. The light theme does the
opposite — a hair off white — because there the page is already the bright
plane.

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
`src/renderer/src/assets/fonts`), set in its **Wide** cut — `font-stretch:
125%`, the top of the font's width axis, inherited from `body` by everything.
Wide letterforms already fill their space, so tracking stays neutral instead
of tight. Two weights, no display cut:

- **Body / UI** — 400, base **14px**, `letter-spacing: 0`.
- **Titles** — `.font-display`, `h1`–`h3`: **600**, `letter-spacing: -0.01em`.
  View titles are `font-display text-2xl`; section headings `text-base`.

Hierarchy comes from the size ladder and from space, not from weight jumps.

Section labels: `text-[11px] font-semibold uppercase tracking-wider
text-muted-foreground/60`. Field labels: `text-[13px] text-muted-foreground`.
Paths, file names and config values are `font-mono text-[12px]/[13px]` — they
are data, and the monospace is what marks them as quotable.

## Marks

### The product mark

A **five-bladed pinwheel**, and the wordmark that sets it as the "o" of the
product name — `am⊗s`. Both live in `src/renderer/src/assets/` as
white-on-transparent PNGs, trimmed to their artwork (388×388 and 1274×302).

**They are never drawn as images.** `components/Logo.tsx` uses each file as a
**CSS mask** over `bg-current`: the alpha channel is the shape, the surrounding
text colour is the ink. That is what keeps a raster asset inside a monochrome
system — one file reads black on the light theme and white on the dark one,
with nothing to swap and no second copy to keep in step.

- `LogoMark` — the glyph alone. Square, sized with `size-*`: the collapsed
  sidebar rail, chat message avatars, the Settings header, empty states.
- `LogoWordmark` — the full mark. Sized by **height** (`h-5`, `h-11`); the
  width follows from the artwork's ratio, held in the component. It is the
  brand block of the expanded sidebar and of the welcome screen, and it carries
  the accessible name "AMOS" (the mark alone is decorative).

`node scripts/gen-icons.mjs` rasterises `logo-mark.png` into the packaged app
icons — `build/icon.png` (1024²) and `build/icons/*.png` — as the white glyph
on a near-black rounded tile, and emits `assets/favicon.png` (the same tile,
because a white-on-transparent mark would vanish on a light browser tab). The
artwork is the single source: replacing the PNG and re-running the script is
the whole update.

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
│ Sidebar    │ ← icon  Title  ·meta        actions │  ← ViewHeader (h≈48px)
│  ~280px    │ ┌─────────────────────────────────┐ │
│            │ │ view content / scroll area      │ │
│            │ └─────────────────────────────────┘ │
└────────────┴─────────────────────────────────────┘
```

### The view header

Every main view wears the same compact bar — **`components/ViewHeader.tsx`**,
the chat header generalised. One `border-b` line, `text-base font-display`
title, and a fixed grammar left to right:

1. **Back arrow** — only when the view has a parent (an editor goes back to
   its project overview). Icon-only, left of the name; the label lives in the
   tooltip and the accessible name.
2. **View icon** (`size-4`, muted) — the kind: folder, agent, skill, file…
3. **Name** — project name on the overview, item name in an editor, session
   title in the chat, section name in Settings.
4. **Quiet meta** — small badges, a mono path (hidden below `md`/`lg`).
5. **Actions** — right-aligned, compact (`size="sm"` / icon buttons).

Anything that needs a sentence — descriptions, timestamps, hints — belongs to
the top of the view's content, not to the bar. The header names the place;
the content explains it.

- **Sidebar** (`bg-sidebar`): wordmark → nav (Home, Search) → the project
  list → foot (Settings, theme). Collapses to a 56px rail that keeps the glyph
  and icon-only nav.

  The hierarchy inside the project list is Codex-style — one visual grammar,
  three levels:

  - **Project rows** are set exactly like the nav buttons above them
    (`px-3 py-1.5 text-sm`, `size-4` icon): a project is a place you go, the
    same class of thing as Home. The chevron unfolds it.
  - **Section rows** (Agents / MCP servers / Skills, and Conversations) hang
    under the project inside a left border, indented so the whole group reads
    as the project's children. They sit one notch under the project's register
    (13px, sentence case, a muted count); Skills wears a **sword**, the CLI
    kinds their own icons, Conversations a message glyph over the project's
    saved chats.
  - **Capability rows** under each section read as `[scope icon] name …
    [ecosystem mark]`. The scope is an icon on the left — a folder for "this
    project", an **`@`** for "your home folder" (`ScopeIcon`, tooltip +
    accessible name carry the word); the CLI that reads the item stays as its
    mark on the right. No text badges at this level: two icons and a name keep
    thirty rows scannable.
  - A **broken** item drops every badge and turns **red** — its scope icon and
    its name both. Failure is the one state that reaches for colour instead of
    an extra label.
- **Main** (`flex min-w-0 flex-1 flex-col`): one view; header is a `ViewHeader`
  bar over the content.

## Terminals

`components/TerminalPanel.tsx` — a right-docked column of tabbed terminals,
opened from a project header's terminal button (Claude / Codex / Shell) and
mounted once in the root shell so its children keep running as the user moves
between views. Each tab owns one xterm.js emulator and one backend terminal;
all tabs stay mounted (hidden when inactive) so scrollback and the child
process survive a tab switch. Its state lives in `lib/terminals.ts`.

The backend (`main/terminal/manager.ts`) prefers a real PTY (`node-pty`), which
gives the CLIs a TTY. `node-pty` is native, so it is required lazily inside a
try/catch: when it did not compile for this Electron build the manager falls
back to a piped `child_process` — still a live process the panel talks to, but
without a TTY, so full-screen TUIs run in their non-interactive mode and the
tab shows a one-line notice. `scripts/native-deps.mjs` treats a node-pty
rebuild failure as a warning, never a fatal build error.

## The project overview

`ProjectView` renders what the scan found as **stacked tables**, one per
category (Agents, MCP servers, Skills), then instruction files, then any
unreadable paths. A table is a titled header row (`icon · name · count · add`)
over `[scope icon] name`, a description, and the ecosystem mark — the same
row grammar as the sidebar, given room to breathe. Broken rows are red, in
place, rather than exiled to a separate section.

## Search

`components/SearchPalette.tsx` — a command palette — opened from the
sidebar's Search entry or **⌘K / Ctrl+K** anywhere in the app frame. One input
over everything AMOS knows: projects, agents, skills, MCP servers, instruction
files and past conversations, grouped in that order, each group capped so a
noisy kind cannot push the others off screen. Raycast grammar: input on top,
grouped list, `↑↓ ↵ esc` footer; rows are `[kind icon] name … project +
ecosystem mark`.

The index is not a service. On open the palette pulls each project's scan and
sessions through the same TanStack Query keys the sidebar uses — cached data is
free, missing data is fetched once and shared. Matching is a case-insensitive
substring over names, descriptions and paths; with an empty query the palette
lists the projects, as a launcher.

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
