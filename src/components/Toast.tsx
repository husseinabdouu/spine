"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle, XCircle, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "info";
type ToastItem = { id: number; message: string; type: ToastType };
type ToastContextValue = { toast: (message: string, type?: ToastType) => void };

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

const ICONS = {
  success: <CheckCircle className="w-4 h-4 shrink-0 text-[var(--safe)]" />,
  error: <XCircle className="w-4 h-4 shrink-0 text-[var(--danger)]" />,
  info: <Info className="w-4 h-4 shrink-0 text-[var(--gold)]" />,
};

const BORDER = {
  success: "border-l-[var(--safe)]",
  error: "border-l-[var(--danger)]",
  info: "border-l-[var(--gold)]",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-start gap-3 px-4 py-3 rounded-xl border border-[var(--glass-border)] border-l-2 ${BORDER[t.type]} bg-[#0e0f11]/95 backdrop-blur-xl shadow-2xl max-w-xs pointer-events-auto`}
            style={{ animation: "toastIn 0.2s ease-out" }}
          >
            {ICONS[t.type]}
            <p className="text-sm text-[var(--text)] flex-1 leading-snug">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              className="text-[var(--text-muted)] hover:text-[var(--text-dim)] transition-colors mt-0.5 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
