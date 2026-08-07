import { shell, type Session, type WebContents } from "electron";

/**
 * Content-Security-Policy for the renderer, plus the navigation guards that
 * keep the app frame from ever becoming a browser.
 *
 * The policy is injected as a real response header (via `onHeadersReceived`)
 * rather than a `<meta>` tag so it is enforced even if `index.html` on disk is
 * tampered with. Electron's `webRequest` hooks do fire for `file://` loads, so
 * the same mechanism covers both the packaged app and the dev server.
 */

/** Directives shared by the packaged and the dev policy. */
const COMMON_DIRECTIVES = [
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
];

/**
 * Packaged policy: everything comes from the bundle next to `index.html`.
 *
 * `style-src` keeps `'unsafe-inline'` because Radix menus pull in
 * `react-remove-scroll` → `react-style-singleton`, which locks scrolling by
 * appending a `<style>` element with a text node. Verified by packaging a build
 * with plain `style-src 'self'` and opening the chat backend menu: Chromium
 * reported two `style-src-elem` violations ("Refused to apply inline style") and
 * the scroll-lock styles never applied. Everything else already comes from the
 * extracted Tailwind stylesheet, and React's `style={{…}}` props go through
 * CSSOM, which CSP does not police.
 */
const PRODUCTION_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  ...COMMON_DIRECTIVES,
];

/**
 * Builds the dev policy for a given electron-vite dev server URL.
 *
 * `'unsafe-inline'` in `script-src` is required by `@vitejs/plugin-react`: it
 * injects the react-refresh preamble as an inline `<script type="module">` in
 * the served HTML; without it the renderer dies on `$RefreshSig$ is not
 * defined`. `connect-src` also carries the `ws://` twin of the dev origin, which
 * is the HMR socket. `'unsafe-eval'` is deliberately *not* granted — Vite's dev
 * transform emits plain ES modules and HMR was confirmed working without it.
 */
export function buildDevDirectives(devServerUrl: string): string[] {
  const origin = safeOrigin(devServerUrl);
  const socket = origin.replace(/^http/, "ws");
  return [
    `default-src 'self' ${origin}`,
    `script-src 'self' ${origin} 'unsafe-inline'`,
    `style-src 'self' ${origin} 'unsafe-inline'`,
    `img-src 'self' ${origin} data: blob:`,
    `font-src 'self' ${origin} data:`,
    `connect-src 'self' ${origin} ${socket}`,
    ...COMMON_DIRECTIVES,
  ];
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "http://localhost:5173";
  }
}

/** The exact header value installed for this run. Exported for tests. */
export function contentSecurityPolicy(devServerUrl: string | undefined): string {
  const directives = devServerUrl ? buildDevDirectives(devServerUrl) : PRODUCTION_DIRECTIVES;
  return directives.join("; ");
}

/**
 * Installs the CSP on every response the session serves. Must run before the
 * window loads its document.
 */
export function applyContentSecurityPolicy(
  targetSession: Session,
  devServerUrl: string | undefined,
): void {
  const policy = contentSecurityPolicy(devServerUrl);
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    // Drop any policy the response already carries so ours is the only one:
    // multiple CSP headers intersect, and a stale one would only tighten or
    // confuse the result.
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "content-security-policy") delete headers[key];
    }
    headers["Content-Security-Policy"] = [policy];
    callback({ responseHeaders: headers });
  });
}

/** `true` when the URL is one the app frame itself is allowed to display. */
export function isInternalUrl(url: string, devServerUrl: string | undefined): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "file:") return true;
  if (!devServerUrl) return false;
  try {
    return parsed.origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Locks navigation down: the window only ever shows the app document, and any
 * `http(s)` link is handed to the OS browser instead. Other schemes
 * (`file:`, `mailto:` from untrusted content, custom handlers) are dropped.
 */
export function hardenNavigation(contents: WebContents, devServerUrl: string | undefined): void {
  contents.on("will-navigate", (event, url) => {
    if (isInternalUrl(url, devServerUrl)) return;
    event.preventDefault();
    openExternally(url);
  });

  contents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });

  // Nothing in AMOS embeds a webview or an iframe; refuse to configure one.
  contents.on("will-attach-webview", (event) => event.preventDefault());
}

function openExternally(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
  void shell.openExternal(url);
}
