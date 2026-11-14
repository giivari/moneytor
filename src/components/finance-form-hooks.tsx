"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadFinanceOptions, type FinanceOptions } from "@/lib/finance/client";
import { connectFinanceDialog } from "@/lib/finance/dialog-lifecycle";

let cachedOptions: FinanceOptions | null = null;
let inflightOptionsPromise: Promise<FinanceOptions> | null = null;
const subscribers = new Set<(value: FinanceOptions) => void>();

function fetchSharedFinanceOptions(force = false): Promise<FinanceOptions> {
  if (!force && cachedOptions) {
    return Promise.resolve(cachedOptions);
  }
  if (!force && inflightOptionsPromise) {
    return inflightOptionsPromise;
  }
  const promise = loadFinanceOptions()
    .then((fresh) => {
      cachedOptions = fresh;
      inflightOptionsPromise = null;
      subscribers.forEach((listener) => listener(fresh));
      return fresh;
    })
    .catch((err) => {
      inflightOptionsPromise = null;
      throw err;
    });
  inflightOptionsPromise = promise;
  return promise;
}

/**
 * Drops the shared options cache after any mutation (asset, credit facility, catalog, receivable). Mounted forms receive the fresh
 * options through their subscription; forms mounted later fetch on demand, so `+ Catat` never shows a stale list.
 */
export function invalidateFinanceOptions() {
  cachedOptions = null;
  inflightOptionsPromise = null;
  if (subscribers.size > 0) void fetchSharedFinanceOptions(true).catch(() => undefined);
}

export function useFinanceDialog(onClose: () => void) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!dialog.current) return;
    return connectFinanceDialog(dialog.current, onClose);
  }, [onClose]);
  return dialog;
}

export function useFinanceOptions() {
  const [options, setOptions] = useState<FinanceOptions | null>(() => cachedOptions);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const onUpdate = (fresh: FinanceOptions) => {
      if (active) setOptions(fresh);
    };
    subscribers.add(onUpdate);
    fetchSharedFinanceOptions(attempt > 0)
      .then((value) => {
        if (active) setOptions(value);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Pilihan belum dapat dimuat.");
      });
    return () => {
      active = false;
      subscribers.delete(onUpdate);
    };
  }, [attempt]);

  const reload = useCallback(async () => {
    const fresh = await fetchSharedFinanceOptions(true);
    setOptions(fresh);
    return fresh;
  }, []);

  return {
    options,
    optionsError: error,
    retry: () => {
      setError("");
      setAttempt((value) => value + 1);
    },
    reload,
  };
}

export function FinanceOptionsStatus({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div className="finance-options-status" aria-busy={!error}>
      {error ? (
        <>
          <p className="finance-error" role="alert">{error}</p>
          <button type="button" className="finance-secondary" onClick={retry}>Coba lagi</button>
        </>
      ) : (
        <p className="finance-hint" role="status" aria-live="polite">Memuat pilihan data…</p>
      )}
    </div>
  );
}
