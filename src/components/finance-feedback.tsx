"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle } from "@phosphor-icons/react";
import { LoadingIndicator } from "./loading-indicator";

const FeedbackContext = createContext<{ notify: (text: string) => void; refresh: () => void; refreshing: boolean; loading: boolean; reportNavigation: (id: string, pending: boolean) => void } | null>(null);

export function FinanceFeedbackProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ text: string } | null>(null);
  const [navigation, setNavigation] = useState<Set<string>>(() => new Set());
  const reportNavigation = useCallback((id: string, pending: boolean) => {
    setNavigation((previous) => {
      if (previous.has(id) === pending) return previous;
      const next = new Set(previous);
      if (pending) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  return <FeedbackContext.Provider value={{ notify: (text) => setNotice({ text }), refresh: () => startTransition(() => router.refresh()), refreshing, loading: navigation.size > 0 || refreshing, reportNavigation }}>
    {(navigation.size > 0 || refreshing) && <div className="navigation-progress" role="status"><span className="navigation-progress-track" aria-hidden="true" /><span className="navigation-progress-label"><LoadingIndicator>{refreshing ? "Memperbarui data…" : "Membuka halaman…"}</LoadingIndicator></span></div>}
    {children}
    {notice && <div className="security-notice" data-success="true" role="status"><CheckCircle size={20} weight="fill" aria-hidden="true" /><span>{notice.text}</span></div>}
  </FeedbackContext.Provider>;
}

export function useFinanceFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error("FinanceFeedbackProvider is required");
  return context;
}

/** A synchronous guard covers repeated events before React commits disabled. */
export function useMutationPending() {
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  return {
    pending,
    begin: () => { if (running.current) return false; running.current = true; setPending(true); return true; },
    finish: () => { running.current = false; setPending(false); },
  };
}
