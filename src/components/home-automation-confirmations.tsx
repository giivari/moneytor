"use client";

import { useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { AppLink } from "./app-link";
import { AllocationReview } from "./allocation-review";
import { AutomationConfirmButton } from "./automation-confirm-button";
import { CompactFinancialRow } from "./compact-financial-row";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { useFinanceDialog } from "./finance-form-hooks";
import { LoadingIndicator } from "./loading-indicator";
import { SectionHeading } from "./section-heading";
import { bpsToPercent } from "@/lib/automation/composable-domain";
import { instanceCommand, type WorkspaceInstance } from "@/lib/automation/composable-facade";
import { activityClassification, financialStateLabel } from "@/lib/automation/review-domain";
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

export function HomeAutomationConfirmations({ items }: { items: WorkspaceInstance[] }) {
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
      <SectionHeading
        eyebrow="PERLU KONFIRMASI · OTOMATISASI"
        title={`Konfirmasi transaksi otomatis (${items.length})`}
        helper="Konfirmasi atau lewati langsung dari halaman utama tanpa perlu berpindah menu."
        action={
          <AppLink href="/transactions/automation" className="text-link">
            Buka Otomatisasi <ArrowRight size={15} aria-hidden="true" />
          </AppLink>
        }
      />
      <div className="home-automation-list">
        {items.map((item) => {
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
          const primary =
            item.allocation?.state === "additional" && !item.review?.assessmentStale ? (
              <button
                type="button"
                className="button-primary automation-confirm-button"
                disabled={pending || refreshing}
                onClick={() => setAllocationReview(item)}
              >
                Catat tambahan
              </button>
            ) : item.canPost ? (
              <AutomationConfirmButton
                disabled={pending || refreshing}
                onClick={() => post(item)}
              >
                {busy === `${instanceCommand(item.storage, "post")}:${item.id}` ? (
                  <LoadingIndicator>Mencatat…</LoadingIndicator>
                ) : undefined}
              </AutomationConfirmButton>
            ) : (
              <AppLink href="/transactions/automation" className="row-action">
                Tinjau
              </AppLink>
            );

          return (
            <div className="home-automation-item" key={item.key}>
              <CompactFinancialRow
                desktopLayout="confirmation"
                identity={<strong>{item.title}</strong>}
                context={
                  <>
                    {dateText} · {item.context}
                    {item.percentageBps !== undefined && <> · {bpsToPercent(item.percentageBps)}%</>}
                  </>
                }
                amountLabel={item.allocation ? "Tambahan" : "Akan dicatat"}
                value={
                  rawValue !== null ? (
                    <span className="financial-value financial-value--row">
                      {formatMinor(rawValue, item.currency, item.exponent)}
                    </span>
                  ) : (
                    "—"
                  )
                }
                footer={
                  <>
                    <span
                      className={`automation-status ${item.status}`}
                      data-financial-state={activityClassification(item).financialState}
                    >
                      {financialStateLabel(activityClassification(item).financialState)}
                    </span>
                    {item.actionMeaning !== item.context && (
                      <span className="finance-hint">{item.actionMeaning}</span>
                    )}
                  </>
                }
                amountControl={
                  item.canPost && item.needsAmount ? (
                    <label className="field">
                      <span className="sr-only">Nominal ({item.currency})</span>
                      <input
                        placeholder={`Nominal (${item.currency})`}
                        disabled={pending || refreshing}
                        inputMode="decimal"
                        value={amounts[item.key] ?? ""}
                        onChange={(event) =>
                          setAmounts({ ...amounts, [item.key]: event.target.value })
                        }
                      />
                    </label>
                  ) : undefined
                }
                controls={primary}
                secondaryActions={
                  item.canSkip ? (
                    <button
                      type="button"
                      className="row-action"
                      data-tone="warning"
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
                  ) : undefined
                }
                details={
                  errorId === item.id && error ? (
                    <p className="finance-error" role="alert">
                      {error}
                    </p>
                  ) : undefined
                }
              />
            </div>
          );
        })}
      </div>
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
