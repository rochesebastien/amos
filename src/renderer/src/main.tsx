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

ReactDOM.createRoot(document.getElementById("root")!).render(
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
