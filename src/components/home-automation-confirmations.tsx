"use client";

import { useState } from "react";
import { ArrowRight, Sparkle } from "@phosphor-icons/react";
import { AppLink } from "./app-link";
import { AllocationReview } from "./allocation-review";
import { AutomationConfirmButton } from "./automation-confirm-button";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { useFinanceDialog } from "./finance-form-hooks";
import { LoadingIndicator } from "./loading-indicator";
import { bpsToPercent } from "@/lib/automation/composable-domain";
import { instanceCommand, type WorkspaceInstance } from "@/lib/automation/composable-facade";
import { requestJson } from "@/lib/finance/client";
import { formatMinor, inputToMinor } from "@/lib/finance/format";

function automationMutation(action: string, body: Record<string, unknown> = {}) {
  return requestJson<{ id?: string }>("/api/automation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
    cache: "no-store",
  });
}

/** Beranda shows the first `limit` pending items; the rest stay one click away in Otomatisasi. */
export function HomeAutomationConfirmations({ items, limit = Infinity }: { items: WorkspaceInstance[]; limit?: number }) {
  const { refresh, notify, refreshing } = useFinanceFeedback();
  const { pending, begin, finish } = useMutationPending();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [errorId, setErrorId] = useState("");
  const [allocationReview, setAllocationReview] = useState<WorkspaceInstance | null>(null);
  const [skipping, setSkipping] = useState<{ action: string; id: string; name: string } | null>(null);

  if (!items.length) return null;

  async function run(action: string, id: string, body: Record<string, unknown> = {}) {
    if (refreshing || !begin()) return;
    setBusy(`${action}:${id}`);
    setError("");
    setErrorId(id);
    try {
      await automationMutation(action, { id, ...body });
      setSkipping(null);
      notify(action.endsWith("skip") ? "Aktivitas otomatisasi dilewati." : "Transaksi otomatisasi berhasil dikonfirmasi & dicatat.");
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Tindakan gagal.");
      refresh();
    } finally {
      finish();
      setBusy("");
    }
  }

  function post(item: WorkspaceInstance) {
    try {
      const amountMinor = item.needsAmount ? inputToMinor(amounts[item.key] ?? "", item.exponent) : undefined;
      void run(instanceCommand(item.storage, "post"), item.id, { amountMinor });
    } catch (cause) {
      setErrorId(item.id);
      setError(cause instanceof Error ? cause.message : "Isi nominal yang valid.");
    }
  }

  return (
    <section className="surface home-automation-alert" aria-label="Konfirmasi otomatisasi">
      <div className="home-automation-header">
        <div className="home-automation-header-left">
          <span className="home-automation-sparkle" aria-hidden="true">
            <Sparkle size={18} weight="fill" />
          </span>
          <h3>Konfirmasi transaksi otomatis ({items.length})</h3>
        </div>
        <div className="home-automation-header-right">
          <span className="ui-chip" data-tone="warning">{items.length} Menunggu</span>
          <AppLink href="/transactions/automation" className="text-link">
            Buka Otomatisasi <ArrowRight size={14} aria-hidden="true" />
          </AppLink>
        </div>
      </div>

      <div className="home-automation-list">
        {items.slice(0, limit).map((item) => {
          const rawValue = item.allocation
            ? BigInt(item.allocation.differenceMinor) > 0n
              ? item.allocation.differenceMinor
              : BigInt(item.allocation.differenceMinor) < 0n
                ? (-BigInt(item.allocation.differenceMinor)).toString()
                : item.allocation.recognizedMinor
            : item.amount;
          const dateText = new Date(item.at).toLocaleDateString("id-ID", {
            timeZone: "Asia/Jakarta",
            day: "numeric",
            month: "short",
          });
          const formattedValue = rawValue !== null ? formatMinor(rawValue, item.currency, item.exponent) : null;

          return (
            <div className="home-automation-box" key={item.key}>
              <div className="home-automation-box-top">
                <div className="home-automation-box-info">
                  <strong>{item.title}</strong>
                  <div className="home-automation-box-context">
                    <span>{item.context}</span> · <span>{dateText}</span>
                    {formattedValue && (
                      <> · <strong className="home-automation-box-amount">{formattedValue}</strong></>
                    )}
                    {item.percentageBps !== undefined && <> · {bpsToPercent(item.percentageBps)}%</>}
                  </div>
                </div>
                <span className="ui-chip" data-tone="warning">Perlu konfirmasi</span>
              </div>

              <div className="home-automation-box-bottom">
                {item.canPost && item.needsAmount && (
                  <input
                    className="home-automation-amount-input"
                    placeholder={`Nominal (${item.currency})`}
                    disabled={pending || refreshing}
                    inputMode="decimal"
                    value={amounts[item.key] ?? ""}
                    onChange={(event) =>
                      setAmounts({ ...amounts, [item.key]: event.target.value })
                    }
                  />
                )}
                {item.canSkip && (
                  <button
                    type="button"
                    className="finance-secondary home-automation-btn"
                    disabled={pending || refreshing}
                    onClick={() =>
                      setSkipping({
                        action: instanceCommand(item.storage, "skip"),
                        id: item.id,
                        name: item.title,
                      })
                    }
                  >
                    Lewati
                  </button>
                )}
                {item.allocation?.state === "additional" && !item.review?.assessmentStale ? (
                  <button
                    type="button"
                    className="button-primary home-automation-btn"
                    disabled={pending || refreshing}
                    onClick={() => setAllocationReview(item)}
                  >
                    Catat tambahan
                  </button>
                ) : item.canPost ? (
                  <AutomationConfirmButton
                    disabled={pending || refreshing}
                    onClick={() => post(item)}
                    className="home-automation-btn"
                  >
                    {busy === `${instanceCommand(item.storage, "post")}:${item.id}` ? (
                      <LoadingIndicator>Mencatat…</LoadingIndicator>
                    ) : (
                      "Konfirmasi"
                    )}
                  </AutomationConfirmButton>
                ) : (
                  <AppLink href="/transactions/automation" className="row-action">
                    Tinjau
                  </AppLink>
                )}
              </div>

              {errorId === item.id && error && (
                <p className="finance-error" role="alert">
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {items.length > limit && (
        <p className="home-automation-more">
          <AppLink href="/transactions/automation" className="text-link">
            {items.length - limit} lainnya di Otomatisasi <ArrowRight size={15} aria-hidden="true" />
          </AppLink>
        </p>
      )}

      {allocationReview && allocationReview.storage !== "schedule" && (
        <AllocationReview
          storage={allocationReview.storage}
          id={allocationReview.id}
          title={allocationReview.title}
          onClose={() => setAllocationReview(null)}
        />
      )}
      {skipping && (
        <SkipConfirmDialog
          name={skipping.name}
          pending={pending}
          error={error}
          onClose={() => setSkipping(null)}
          onConfirm={() => void run(skipping.action, skipping.id)}
        />
      )}
    </section>
  );
}

function SkipConfirmDialog({
  name,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  name: string;
  pending: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialog = useFinanceDialog(onClose);
  return (
    <dialog
      ref={dialog}
      className="detail-dialog"
      aria-labelledby="home-skip-confirm-title"
      onCancel={(event) => {
        if (pending) event.preventDefault();
      }}
    >
      <h2 id="home-skip-confirm-title">Lewati aktivitas ini?</h2>
      <p>“{name}” dilewati tanpa mencatat transaksi.</p>
      <div className="finance-actions">
        <button autoFocus type="button" className="finance-secondary" disabled={pending} onClick={onClose}>
          Kembali
        </button>
        <button type="button" className="finance-warning" disabled={pending} onClick={onConfirm}>
          {pending ? <LoadingIndicator>Menyimpan…</LoadingIndicator> : "Ya, lewati"}
        </button>
      </div>
      {error && (
        <p role="alert" className="finance-error">
          {error}
        </p>
      )}
    </dialog>
  );
}
