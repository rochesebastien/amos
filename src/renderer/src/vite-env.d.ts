/// <reference types="vite/client" />

import type { AmosApi } from "../../shared/ipc";

declare global {
  interface Window {
    /** Bridge exposed by src/preload/index.ts (contextIsolation on). */
    amos: AmosApi;
  }
}

export {};
