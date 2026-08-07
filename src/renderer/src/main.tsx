import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { router } from "./router";
import { queryClient, useSetting } from "./lib/queries";
import { adoptStoredLanguage, LANG_SETTING } from "./lib/i18n";
import { TooltipProvider } from "./components/ui/tooltip";
import { ConfirmProvider } from "./components/ui/confirm";
import "./index.css";

// Seed the UI language from the main-process database when the user has no
// local choice yet (fresh renderer profile).
function LanguageSync() {
  const { data } = useSetting(LANG_SETTING);
  useEffect(() => {
    adoptStoredLanguage(data?.value);
  }, [data?.value]);
  return null;
}

// This module has no component export, so vite-plugin-react cannot Fast Refresh
// it and invalidates it instead — every HMR update that reaches a shared module
// (lib/dictionaries.ts, lib/queries.ts, …) propagates up here and re-executes
// this file. A second `createRoot` on the same container tears the first root
// down and leaves the window blank until a manual reload, so the root is kept in
// `import.meta.hot.data`, which survives hot updates of this module. In a
// production build `import.meta.hot` is undefined and this is a plain
// `createRoot` + `render`.
const container = document.getElementById("root")!;
const root = import.meta.hot?.data.root ?? ReactDOM.createRoot(container);
if (import.meta.hot) import.meta.hot.data.root = root;

root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ConfirmProvider>
          <LanguageSync />
          <RouterProvider router={router} />
        </ConfirmProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
