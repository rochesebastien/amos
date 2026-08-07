import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openExternal = vi.fn();
vi.mock("electron", () => ({ shell: { openExternal } }));

const {
  applyContentSecurityPolicy,
  buildDevDirectives,
  contentSecurityPolicy,
  hardenNavigation,
  isInternalUrl,
} = await import("../../src/main/security.js");

/**
 * The renderer's Content-Security-Policy and the navigation guards. The
 * directive strings below are the ones actually verified against a packaged
 * build and against `electron-vite dev`, so a change here is a change to what
 * the shipped app allows.
 */

function directivesOf(policy: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of policy.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const space = trimmed.indexOf(" ");
    if (space === -1) map.set(trimmed, "");
    else map.set(trimmed.slice(0, space), trimmed.slice(space + 1));
  }
  return map;
}

beforeEach(() => {
  openExternal.mockReset();
});

describe("production policy", () => {
  const policy = contentSecurityPolicy(undefined);
  const d = directivesOf(policy);

  it("locks every fetch directive to the bundle", () => {
    expect(d.get("default-src")).toBe("'self'");
    expect(d.get("script-src")).toBe("'self'");
    expect(d.get("img-src")).toBe("'self' data:");
    expect(d.get("font-src")).toBe("'self'");
    expect(d.get("connect-src")).toBe("'self'");
    expect(d.get("object-src")).toBe("'none'");
    expect(d.get("base-uri")).toBe("'none'");
    expect(d.get("form-action")).toBe("'none'");
    expect(d.get("frame-ancestors")).toBe("'none'");
  });

  it("never allows inline or eval'd script", () => {
    expect(policy).not.toContain("'unsafe-eval'");
    expect(d.get("script-src")).not.toContain("'unsafe-inline'");
  });

  it("allows inline styles, which Radix' scroll lock needs", () => {
    // `react-style-singleton` appends a <style> element; without this the
    // packaged app logs `style-src-elem` violations when a menu opens.
    expect(d.get("style-src")).toBe("'self' 'unsafe-inline'");
  });

  it("never mentions the dev server", () => {
    expect(policy).not.toContain("localhost");
    expect(policy).not.toContain("ws:");
  });
});

describe("dev policy", () => {
  const d = directivesOf(buildDevDirectives("http://localhost:5173/").join("; "));

  it("allows the dev server origin and its HMR socket", () => {
    expect(d.get("default-src")).toBe("'self' http://localhost:5173");
    expect(d.get("connect-src")).toBe("'self' http://localhost:5173 ws://localhost:5173");
  });

  it("allows the inline react-refresh preamble but not eval", () => {
    expect(d.get("script-src")).toContain("'unsafe-inline'");
    expect(d.get("script-src")).not.toContain("'unsafe-eval'");
  });

  it("keeps the same hard denials as production", () => {
    expect(d.get("object-src")).toBe("'none'");
    expect(d.get("base-uri")).toBe("'none'");
    expect(d.get("form-action")).toBe("'none'");
  });

  it("falls back to the default port when the URL is unusable", () => {
    expect(buildDevDirectives("not a url").join("; ")).toContain("http://localhost:5173");
  });
});

describe("applyContentSecurityPolicy", () => {
  it("replaces any policy the response already carries", () => {
    let handler: ((details: unknown, cb: (r: unknown) => void) => void) | undefined;
    const fakeSession = {
      webRequest: {
        onHeadersReceived: (fn: typeof handler) => {
          handler = fn;
        },
      },
    };
    applyContentSecurityPolicy(fakeSession as never, undefined);
    expect(handler).toBeTypeOf("function");

    let result: { responseHeaders?: Record<string, string[]> } | undefined;
    handler?.(
      {
        responseHeaders: {
          "content-security-policy": ["default-src *"],
          "X-Other": ["keep"],
        },
      },
      (r) => {
        result = r as typeof result;
      },
    );
    const headers = result?.responseHeaders ?? {};
    expect(headers["X-Other"]).toEqual(["keep"]);
    expect(headers["content-security-policy"]).toBeUndefined();
    expect(headers["Content-Security-Policy"]).toEqual([contentSecurityPolicy(undefined)]);
  });
});

describe("isInternalUrl", () => {
  it("accepts the packaged document and the dev server only", () => {
    expect(isInternalUrl("file:///app/out/renderer/index.html", undefined)).toBe(true);
    expect(isInternalUrl("http://localhost:5173/", "http://localhost:5173")).toBe(true);
    expect(isInternalUrl("http://localhost:5173/", undefined)).toBe(false);
    expect(isInternalUrl("http://evil.test/", "http://localhost:5173")).toBe(false);
    expect(isInternalUrl("https://example.com", undefined)).toBe(false);
    expect(isInternalUrl("not a url", undefined)).toBe(false);
  });
});

describe("hardenNavigation", () => {
  class FakeContents extends EventEmitter {
    handler?: (d: { url: string }) => unknown;
    setWindowOpenHandler(fn: (d: { url: string }) => unknown) {
      this.handler = fn;
    }
  }

  function navigate(contents: FakeContents, url: string): boolean {
    let prevented = false;
    contents.emit("will-navigate", { preventDefault: () => (prevented = true) }, url);
    return prevented;
  }

  it("lets the app document navigate but sends the web to the OS browser", () => {
    const contents = new FakeContents();
    hardenNavigation(contents as never, undefined);

    expect(navigate(contents, "file:///app/out/renderer/index.html")).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();

    expect(navigate(contents, "https://example.com/docs")).toBe(true);
    expect(openExternal).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("denies popups and only hands http(s) to the shell", () => {
    const contents = new FakeContents();
    hardenNavigation(contents as never, undefined);

    expect(contents.handler?.({ url: "https://example.com" })).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenCalledWith("https://example.com");

    openExternal.mockReset();
    expect(contents.handler?.({ url: "file:///etc/passwd" })).toEqual({ action: "deny" });
    expect(contents.handler?.({ url: "javascript:alert(1)" })).toEqual({ action: "deny" });
    expect(contents.handler?.({ url: "smb://host/share" })).toEqual({ action: "deny" });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("keeps the dev server navigable while the dev server is the origin", () => {
    const contents = new FakeContents();
    hardenNavigation(contents as never, "http://localhost:5173");
    expect(navigate(contents, "http://localhost:5173/index.html")).toBe(false);
    expect(navigate(contents, "http://localhost:5174/index.html")).toBe(true);
  });

  it("refuses to attach a webview", () => {
    const contents = new FakeContents();
    hardenNavigation(contents as never, undefined);
    let prevented = false;
    contents.emit("will-attach-webview", { preventDefault: () => (prevented = true) }, {}, {});
    expect(prevented).toBe(true);
  });
});
