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

  // Same story for the palette keeping its active row in view.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }

  // Radix opens its menus on pointerdown and captures the pointer while they
  // are open. jsdom implements neither, so without these a menu trigger looks
  // clickable and simply never opens.
  if (!("PointerEvent" in window)) {
    class PointerEventStub extends MouseEvent {
      readonly pointerId: number;
      readonly pointerType: string;
      constructor(type: string, params: MouseEventInit & Record<string, unknown> = {}) {
        super(type, params);
        this.pointerId = (params.pointerId as number) ?? 1;
        this.pointerType = (params.pointerType as string) ?? "mouse";
      }
    }
    (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventStub;
    (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventStub;
  }
  for (const method of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"] as const) {
    if (!(method in Element.prototype)) {
      Object.defineProperty(Element.prototype, method, {
        configurable: true,
        value: method === "hasPointerCapture" ? () => false : () => {},
      });
    }
  }

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
