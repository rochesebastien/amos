import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { router } from "./router";
import { queryClient, useSettings } from "./lib/queries";
import { adoptBackendLanguage } from "./lib/i18n";
import { TooltipProvider } from "./components/ui/tooltip";
import { ConfirmProvider } from "./components/ui/confirm";
import "./index.css";

// Seed the UI language from the backend when the user has no local choice yet.
function LanguageSync() {
  const { data: settings } = useSettings();
  useEffect(() => {
    adoptBackendLanguage(settings?.language);
  }, [settings?.language]);
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
