"use client";
import { useState } from "react";
import { useFinanceDialog } from "./finance-form-hooks";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";
import { financeRequest } from "@/lib/finance/client";

export function LifecycleConfirmation({ operation, body, title, onClose }: {
  operation: "catalog-archive" | "catalog-delete"; body: { catalog: string; id: string }; title: string; onClose: () => void;
}) {
  const dialog = useFinanceDialog(onClose);
  const { pending, begin, finish } = useMutationPending();
  const { refresh, notify } = useFinanceFeedback();
  const [error, setError] = useState("");
  const deleting = operation === "catalog-delete";
  async function confirm() {
    if (!begin()) return; setError("");
    try {
      await financeRequest(operation, body); refresh();
      notify(deleting ? "Pilihan dihapus permanen." : "Pilihan diarsipkan. Anda dapat memulihkannya nanti."); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Perubahan belum dapat disimpan."); }
    finally { finish(); }
  }
  return <dialog ref={dialog} className="security-confirm" aria-labelledby="catalog-confirm-title" aria-describedby="catalog-confirm-copy" onCancel={(event) => { if (pending) event.preventDefault(); }}>
    <h2 id="catalog-confirm-title">{title}</h2>
    <p id="catalog-confirm-copy">{deleting ? "Penghapusan ini permanen dan hanya diizinkan bila pilihan belum pernah dipakai. Server akan memeriksa kembali referensinya." : "Pilihan tidak tersedia untuk catatan baru. Riwayat tetap utuh dan pilihan dapat dipulihkan nanti."}</p>
    {error && <p className="finance-error" role="alert">{error}</p>}
    <div className="security-confirm-actions"><button autoFocus type="button" className="finance-secondary" disabled={pending} onClick={() => dialog.current?.close()}>Batal</button>
      <button type="button" className="finance-danger" disabled={pending} aria-busy={pending} onClick={() => void confirm()}>{pending ? <LoadingIndicator>{deleting ? "Menghapus..." : "Mengarsipkan..."}</LoadingIndicator> : deleting ? "Hapus permanen" : "Arsipkan"}</button></div>
  </dialog>;
}
