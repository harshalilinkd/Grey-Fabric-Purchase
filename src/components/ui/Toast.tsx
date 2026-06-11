"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

type ToastTone = "success" | "error" | "info" | "warning";
type ToastAction = { label: string; onClick: () => void };
type ToastOptions = { action?: ToastAction; duration?: number };
type Toast = { id: number; tone: ToastTone; message: string; action?: ToastAction };

type ToastContextValue = {
  toast: (message: string, tone?: ToastTone, opts?: ToastOptions) => void;
  success: (message: string, opts?: ToastOptions) => void;
  error: (message: string, opts?: ToastOptions) => void;
  warning: (message: string, opts?: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = "info", opts?: ToastOptions) => {
      const id = nextId++;
      setToasts((cur) => [...cur, { id, tone, message, action: opts?.action }]);
      // actionable toasts (e.g. Undo) linger a little longer
      const duration = opts?.duration ?? (opts?.action ? 6000 : 4000);
      setTimeout(() => remove(id), duration);
    },
    [remove],
  );

  const value: ToastContextValue = {
    toast,
    success: useCallback((m: string, o?: ToastOptions) => toast(m, "success", o), [toast]),
    error: useCallback((m: string, o?: ToastOptions) => toast(m, "error", o), [toast]),
    warning: useCallback((m: string, o?: ToastOptions) => toast(m, "warning", o), [toast]),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} onClick={() => remove(t.id)}>
            <Icon
              name={
                t.tone === "success" ? "checkCircle" : t.tone === "error" ? "xCircle" : t.tone === "warning" ? "alert" : "info"
              }
              size={16}
            />
            <span className="toast-msg">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={(e) => {
                  e.stopPropagation();
                  t.action!.onClick();
                  remove(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
