"use client";

import { useEffect, useRef, useState } from "react";
import { loadFinanceOptions, type FinanceOptions } from "@/lib/finance/client";
import { connectFinanceDialog } from "@/lib/finance/dialog-lifecycle";
import { LoadingIndicator } from "./loading-indicator";

export function useFinanceDialog(onClose: () => void) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!dialog.current) return;
    return connectFinanceDialog(dialog.current, onClose);
  }, [onClose]);
  return dialog;
}

export function useFinanceOptions() {
  const [options, setOptions] = useState<FinanceOptions | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const request = useRef<{ attempt: number; promise: Promise<FinanceOptions> } | null>(null);
  useEffect(() => {
    let active = true;
    if (request.current?.attempt !== attempt) request.current = { attempt, promise: loadFinanceOptions() };
    request.current.promise.then((value) => { if (active) setOptions(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Pilihan belum dapat dimuat."); });
    return () => { active = false; };
  }, [attempt]);
  return { options, optionsError: error, retry: () => { setError(""); setAttempt((value) => value + 1); } };
}

export function FinanceOptionsStatus({ error, retry }: { error: string; retry: () => void }) {
  return <div className="finance-options-status" aria-busy={!error}>
    {error ? <><p className="finance-error" role="alert">{error}</p><button type="button" className="finance-secondary" onClick={retry}>Coba lagi</button></>
      : <p role="status"><LoadingIndicator>Memuat pilihan…</LoadingIndicator></p>}
  </div>;
}
