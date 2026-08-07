import * as React from "react";
import { Modal } from "./modal";
import { Button } from "./button";

// A promise-based confirmation dialog built on the app's Modal, so confirmations
// use ShadcnUI components instead of the native window.confirm().

type ConfirmOptions = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<{
    opts: ConfirmOptions;
    resolve: (v: boolean) => void;
  } | null>(null);

  const confirm = React.useCallback<ConfirmFn>(
    (opts) => new Promise<boolean>((resolve) => setState({ opts, resolve })),
    [],
  );

  const close = (result: boolean) =>
    setState((s) => {
      s?.resolve(result);
      return null;
    });

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.opts.title ?? "Are you sure?"}
        description={state?.opts.description}
        className="max-w-sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              {state?.opts.cancelText ?? "Cancel"}
            </Button>
            <Button
              variant={state?.opts.destructive ? "destructive" : "primary"}
              onClick={() => close(true)}
            >
              {state?.opts.confirmText ?? "Confirm"}
            </Button>
          </>
        }
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}
