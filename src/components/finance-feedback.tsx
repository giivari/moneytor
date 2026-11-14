"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle } from "@phosphor-icons/react";
import { invalidateFinanceOptions } from "./finance-form-hooks";

const FeedbackContext = createContext<{
  notify: (text: string) => void;
  refresh: () => void;
  refreshing: boolean;
  navigating: boolean;
  routeSkeleton: boolean;
  loading: boolean;
  reportNavigation: (id: string, pending: boolean) => void;
  reportRouteSkeleton: (id: string, active: boolean) => void;
  reportMutation: (id: string, active: boolean) => void;
  navigate: (href: string, mode?: "push" | "replace") => void;
} | null>(null);

export function FinanceFeedbackProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [routerNavigating, startNavTransition] = useTransition();
  const [notice, setNotice] = useState<{ text: string } | null>(null);
  const [navigation, setNavigation] = useState<Set<string>>(() => new Set());
  const [skeletons, setSkeletons] = useState<Set<string>>(() => new Set());
  const [mutations, setMutations] = useState<Set<string>>(() => new Set());

  const reportNavigation = useCallback((id: string, pending: boolean) => {
    setNavigation((previous) => {
      if (previous.has(id) === pending) return previous;
      const next = new Set(previous);
      if (pending) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const reportRouteSkeleton = useCallback((id: string, active: boolean) => {
    setSkeletons((previous) => {
      if (previous.has(id) === active) return previous;
      const next = new Set(previous);
      if (active) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const reportMutation = useCallback((id: string, active: boolean) => {
    setMutations((previous) => {
      if (previous.has(id) === active) return previous;
      const next = new Set(previous);
      if (active) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const navigate = useCallback((href: string, mode: "push" | "replace" = "push") => {
    startNavTransition(() => {
      if (mode === "replace") router.replace(href);
      else router.push(href);
    });
  }, [router]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const navigating = navigation.size > 0 || routerNavigating;
  const routeSkeleton = skeletons.size > 0;
  const mutating = mutations.size > 0;
  const loading = navigating || refreshing || mutating;

  const notify = useCallback((text: string) => setNotice({ text }), []);
  const refresh = useCallback(() => { invalidateFinanceOptions(); startTransition(() => router.refresh()); }, [router]);
  // Stable identities: consumers re-render only when the feedback state itself changes.
  const value = useMemo(() => ({
    notify, refresh, refreshing, navigating, routeSkeleton, loading,
    reportNavigation, reportRouteSkeleton, reportMutation, navigate,
  }), [notify, refresh, refreshing, navigating, routeSkeleton, loading, reportNavigation, reportRouteSkeleton, reportMutation, navigate]);

  return <FeedbackContext.Provider value={value}>
    {loading && (
      <div className="navigation-progress" role="status" aria-label={refreshing || mutating ? "Memproses data" : "Menyiapkan halaman"}>
        <span className="navigation-progress-track" aria-hidden="true" />
      </div>
    )}
    {children}
    {notice && <div className="security-notice" data-success="true" role="status"><CheckCircle size={20} weight="fill" aria-hidden="true" /><span>{notice.text}</span></div>}
  </FeedbackContext.Provider>;
}

const fallbackFeedback = {
  notify: () => {},
  refresh: () => {},
  refreshing: false,
  navigating: false,
  routeSkeleton: false,
  loading: false,
  reportNavigation: () => {},
  reportRouteSkeleton: () => {},
  reportMutation: () => {},
  navigate: () => {},
};

export function useFinanceFeedback() {
  return useContext(FeedbackContext) ?? fallbackFeedback;
}

/** A synchronous guard covers repeated events before React commits disabled. */
export function useMutationPending() {
  const id = useId();
  const { reportMutation } = useFinanceFeedback();
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  useEffect(() => () => reportMutation(id, false), [id, reportMutation]);
  return {
    pending,
    begin: () => {
      if (running.current) return false;
      running.current = true;
      setPending(true);
      reportMutation(id, true);
      return true;
    },
    finish: () => {
      running.current = false;
      setPending(false);
      reportMutation(id, false);
    },
  };
}
