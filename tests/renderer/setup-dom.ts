// Browser APIs jsdom does not implement but the renderer modules touch at
// import time (theme store) or at render time (Radix popper machinery).
//
// This file is a global setup file, so it also runs before the Node-environment
// suites; everything below is therefore guarded on a DOM actually being there.

if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }

  // jsdom has no layout, so the router's scroll restoration would print a
  // "Not implemented" stack on every navigation.
  window.scrollTo = (() => {}) as typeof window.scrollTo;

  if (!("ResizeObserver" in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  }
}
