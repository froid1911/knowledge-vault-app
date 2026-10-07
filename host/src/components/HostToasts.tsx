import { useEffect, useState, type ReactNode } from "react";
import type { PHToastFn } from "@powerhousedao/reactor-browser";

type Toast = { id: number; content: ReactNode; error: boolean };

/** The toast service apps reach through `usePHToast()` — Connect provides one; here the host does. */
export function createToastStore() {
  let toasts: Toast[] = [];
  let next = 1;
  const listeners = new Set<(t: Toast[]) => void>();
  const emit = () => listeners.forEach((l) => l(toasts));
  const dismiss = (id: number) => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  };
  const toast: PHToastFn = (content, options) => {
    const type = options?.type;
    toasts = [...toasts, { id: next++, content, error: type === "error" || type === "connect-warning" }].slice(-4);
    emit();
  };
  return {
    toast,
    dismiss,
    subscribe(listener: (t: Toast[]) => void) {
      listeners.add(listener);
      listener(toasts);
      return () => void listeners.delete(listener);
    },
  };
}
export type ToastStore = ReturnType<typeof createToastStore>;

/** The app's single toast store, installed as `window.ph.toast` at boot. */
export const hostToasts = createToastStore();

const LIFETIME_MS = 6_000;

function Item({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, LIFETIME_MS);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div className="kv-toast" data-error={toast.error} role={toast.error ? "alert" : "status"}>
      <span>{toast.content}</span>
      <button type="button" className="kv-toast-close" aria-label="Dismiss" onClick={onDismiss}>×</button>
    </div>
  );
}

export function HostToasts({ store = hostToasts }: { store?: ToastStore }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => store.subscribe(setToasts), [store]);
  if (toasts.length === 0) return null;
  return (
    <div className="kv-toasts">
      {toasts.map((t) => (
        <Item key={t.id} toast={t} onDismiss={() => store.dismiss(t.id)} />
      ))}
    </div>
  );
}
