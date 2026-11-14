"use client";

import { useRef, useState } from "react";
import { Plus, X } from "@phosphor-icons/react";
import type { financeSnapshot } from "@/lib/finance/summary";
import type { FinanceAsset } from "@/lib/finance/types";
import { formatMinor, inputToMinor } from "@/lib/finance/format";
import { sortNamed } from "@/lib/list-order";
import {
  creditStateForDesiredBills,
  encodeCreditNote,
  formatShortDueIso,
  nextMonthlyDueDayIso,
} from "@/lib/domain/credit";
import { creditBillsDue, receivablesSummary } from "@/lib/domain/home-briefing";
import {
  billPayment,
  creditFacilities,
  creditTotals,
  installmentContracts,
  receivableAccounts,
  type CreditFacility,
} from "@/lib/domain/credit-overview";
import { resolveProviderMark } from "@/lib/domain/provider-marks";
import { ProviderBrandMark } from "./provider-brand-mark";
import { AssetDetail, CreditDetail, creditStatusLabel } from "./entity-details";
import { Amount, Card, Chip, PageHeading, monthLabel, shortDate, toneOf } from "./ui";
import { InspectorRow, InspectorRowButton } from "./inspector";
import { PageTabs } from "./page-tabs";
import { PayBillButton, RepayDebtButton, SettleReceivableButton } from "./pay-bill-button";
import { ExcelStatusBar } from "./excel-status-bar";
import { FinanceOptionsStatus, useFinanceDialog, useFinanceOptions } from "./finance-form-hooks";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";
import { financeRequest } from "@/lib/finance/client";
import { ICON_SM } from "./icon-size";

type Snapshot = Awaited<ReturnType<typeof financeSnapshot>>;

const provider = (asset: FinanceAsset) => asset.providerName ?? asset.assetTypeName;

function CreateCreditFacilityDialog({ onClose }: { onClose: () => void }) {
  const dialog = useFinanceDialog(onClose);
  const { refresh, notify } = useFinanceFeedback();
  const { options, optionsError, retry } = useFinanceOptions();
  const { pending, begin, finish } = useMutationPending();
  const [error, setError] = useState("");
  const createReplay = useRef<{ payload: string; key: string; at: string } | null>(null);

  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("IDR");
  const [creditLimit, setCreditLimit] = useState("");
  const [cutoffDay, setCutoffDay] = useState("20");
  const [dueDay, setDueDay] = useState("1");
  const [currentBillInput, setCurrentBillInput] = useState("");
  const [nextBillInput, setNextBillInput] = useState("");
  const [suffix, setSuffix] = useState("");
  const [note, setNote] = useState("");

  const exponent = options?.currencies.find((item) => item.code === currency)?.exponent ?? 0;
  const parsedDueNum = Number(dueDay) >= 1 && Number(dueDay) <= 31 ? Number(dueDay) : 1;
  const previewCurrentDue = formatShortDueIso(nextMonthlyDueDayIso(parsedDueNum, 0));
  const previewNextDue = formatShortDueIso(nextMonthlyDueDayIso(parsedDueNum, 1));

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!begin()) return;
    setError("");
    try {
      const parsedDue = dueDay.trim() ? Number(dueDay.trim()) : 1;
      const parsedCutoff = cutoffDay.trim() ? Number(cutoffDay.trim()) : 20;
      const limitMinor = creditLimit.trim()
        ? BigInt(inputToMinor(creditLimit.trim(), exponent))
        : 0n;
      const desiredCurrentMinor = currentBillInput.trim()
        ? BigInt(inputToMinor(currentBillInput.trim(), exponent))
        : 0n;
      const desiredNextMinor = nextBillInput.trim()
        ? BigInt(inputToMinor(nextBillInput.trim(), exponent))
        : 0n;

      const encodedNote = encodeCreditNote(
        note,
        true,
        creditStateForDesiredBills({
          balanceMinor: 0n,
          desiredCurrentMinor,
          desiredNextMinor,
          dueDay: parsedDue,
          cutoffDay: parsedCutoff,
          limitMinor,
        })
      );

      const facility = {
        displayName: name,
        currency,
        openingAmountMinor: "0",
        assetTypeId: options?.catalogs.assetTypes[0]?.id,
        normallyLiquid: false,
        normallySpendable: false,
        safeSuffix: suffix || undefined,
        note: encodedNote,
        assetClass: "liability",
      };
      const facilityPayload = JSON.stringify(facility);
      if (createReplay.current?.payload !== facilityPayload) {
        createReplay.current = { payload: facilityPayload, key: crypto.randomUUID(), at: new Date().toISOString() };
      }
      await financeRequest("asset-create", { ...facility, openingEffectiveAt: createReplay.current.at, idempotencyKey: createReplay.current.key });

      refresh();
      notify("Fasilitas Kredit / PayLater berhasil ditambahkan.");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menyimpan fasilitas kredit.");
    } finally {
      finish();
    }
  }

  return (
    <dialog
      ref={dialog}
      className="finance-dialog"
      onCancel={(event) => {
        if (pending) event.preventDefault();
      }}
      aria-labelledby="create-credit-title"
    >
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">FASILITAS KREDIT &amp; PAYLATER</span>
          <h2 id="create-credit-title">Tambah Kredit / PayLater</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => dialog.current?.close()}
          aria-label="Tutup"
          disabled={pending}
        >
          <X size={20} />
        </button>
      </div>
      {!options ? (
        <FinanceOptionsStatus error={optionsError} retry={retry} />
      ) : (
        <form onSubmit={save} aria-busy={pending}>
          <fieldset className="finance-fieldset" disabled={pending}>
            <label className="field">
              <span>Nama fasilitas kredit / PayLater</span>
              <input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Mis. BCA Everyday Card, SPayLater, Kredivo"
              />
            </label>
            <div className="field-grid">
              <label className="field">
                <span>Mata uang</span>
                <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {options.currencies.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Limit kredit ({currency})</span>
                <input
                  inputMode="decimal"
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
                  placeholder="0"
                />
              </label>
            </div>
            <div className="field-grid">
              <label className="field">
                <span>Tanggal cetak / Cutoff (1–31)</span>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={cutoffDay}
                  onChange={(e) => setCutoffDay(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Tanggal jatuh tempo (1–31)</span>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={dueDay}
                  onChange={(e) => setDueDay(e.target.value)}
                />
              </label>
            </div>
            <div className="field-grid">
              <label className="field">
                <span>Tagihan berjalan ({previewCurrentDue})</span>
                <input
                  inputMode="decimal"
                  value={currentBillInput}
                  onChange={(e) => setCurrentBillInput(e.target.value)}
                  placeholder="0"
                />
              </label>
              <label className="field">
                <span>Tagihan bulan depan ({previewNextDue})</span>
                <input
                  inputMode="decimal"
                  value={nextBillInput}
                  onChange={(e) => setNextBillInput(e.target.value)}
                  placeholder="0"
                />
              </label>
            </div>
            <div className="field-grid">
              <label className="field">
                <span>4 digit akhir kartu (opsional)</span>
                <input
                  maxLength={4}
                  value={suffix}
                  onChange={(e) => setSuffix(e.target.value)}
                  placeholder="8812"
                />
              </label>
              <label className="field">
                <span>Catatan (opsional)</span>
                <input
                  maxLength={240}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Opsional"
                />
              </label>
            </div>
            {error && (
              <p role="alert" className="finance-error">
                {error}
              </p>
            )}
            <div className="finance-actions">
              <button
                type="button"
                className="finance-secondary"
                onClick={() => dialog.current?.close()}
              >
                Batal
              </button>
              <button type="submit" className="button-primary" disabled={pending} aria-busy={pending}>
                {pending ? <LoadingIndicator>Menyimpan…</LoadingIndicator> : "Simpan Kredit / PayLater"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </dialog>
  );
}

function FacilityCard({ facility }: { facility: CreditFacility }) {
  const { asset, bills, status } = facility;
  const money = (value: bigint) => formatMinor(value, asset.currency, asset.exponent);
  const state = creditStatusLabel[status];
  const payment = billPayment(facility);
  const used =
    bills.limitMinor > 0n
      ? Number((bills.totalUnpaidMinor * 1000n) / bills.limitMinor) / 10
      : null;
  const mark = resolveProviderMark(asset.providerName, asset.displayName, "coral");

  return (
    <InspectorRow
      as="div"
      id={`credit:${asset.id}`}
      title={asset.displayName}
      subtitle="Rincian fasilitas kredit"
      detail={<CreditDetail asset={asset} link={false} />}
      className="ui-card credit-facility"
    >
      <header className="credit-facility-header">
        <div className="credit-facility-identity">
          <ProviderBrandMark mark={mark} />
          <div className="ui-row-copy">
            <InspectorRowButton>
              <strong>{asset.displayName}</strong>
            </InspectorRowButton>
            <small>
              {provider(asset)}
              {asset.safeSuffix ? ` · •••• ${asset.safeSuffix}` : ""}
            </small>
          </div>
        </div>
        <Chip tone={state.tone}>{state.label}</Chip>
      </header>

      <div className="credit-facility-cycle-row">
        <span className="credit-facility-cycle">
          Cetak tgl {bills.cutoffDay} · Jatuh tempo tgl {bills.dueDay}
        </span>
      </div>

      {bills.availableLimitMinor !== null && used !== null && (
        <div className="credit-facility-limit">
          <div>
            <span>Sisa limit</span>
            <Amount value={money(bills.availableLimitMinor)} level="entity" />
          </div>
          <div
            className="ui-meter"
            data-tone={used >= 90 ? "negative" : undefined}
            role="img"
            aria-label={`Terpakai ${used.toLocaleString("id-ID")}% dari limit`}
          >
            <span style={{ width: `${Math.min(100, used)}%` }} />
          </div>
          <small>
            Limit <Amount value={money(bills.limitMinor)} />
          </small>
        </div>
      )}

      <dl className="credit-facility-bills">
        <div>
          <dt>Tagihan {shortDate(bills.currentDueIso)}</dt>
          <dd>
            <Amount
              value={money(bills.currentBillMinor)}
              level="entity"
              tone={bills.currentBillMinor > 0n ? "negative" : ""}
            />
          </dd>
        </div>
        <div>
          <dt>Tagihan {shortDate(bills.nextDueIso)}</dt>
          <dd>
            <Amount value={money(bills.nextBillMinor)} level="entity" />
          </dd>
        </div>
      </dl>

      {(payment || (asset.isActive && bills.totalUnpaidMinor > 0n)) && (
        <div className="credit-facility-actions">
          {payment && (
            <PayBillButton
              assetId={asset.id}
              name={asset.displayName}
              exponent={asset.exponent}
              amountMinor={payment.amountMinor.toString()}
              dueIso={payment.dueIso}
            />
          )}
          {asset.isActive && bills.totalUnpaidMinor > 0n && (
            <RepayDebtButton
              assetId={asset.id}
              name={asset.displayName}
              exponent={asset.exponent}
              amountMinor={bills.totalUnpaidMinor.toString()}
            />
          )}
        </div>
      )}

      <footer className="credit-facility-footer">
        <span>{bills.overpaidMinor > 0n ? "Lebih bayar" : "Sisa seluruh utang"}</span>
        <Amount
          value={money(bills.overpaidMinor > 0n ? bills.overpaidMinor : bills.totalUnpaidMinor)}
          tone={
            bills.overpaidMinor > 0n
              ? "positive"
              : bills.totalUnpaidMinor > 0n
              ? "negative"
              : ""
          }
        />
      </footer>
    </InspectorRow>
  );
}

function Facilities({
  facilities,
  onAddCredit,
}: {
  facilities: CreditFacility[];
  onAddCredit: () => void;
}) {
  const active = facilities.filter((item) => item.asset.isActive);
  const archived = facilities.filter((item) => !item.asset.isActive);

  if (!facilities.length) {
    return (
      <section className="ui-card ui-empty">
        <h2>Belum ada akun kredit</h2>
        <p>
          Tambahkan kartu kredit atau fasilitas PayLater untuk memantau tanggal cetak tagihan, jatuh tempo, sisa limit, dan cicilan bulanan Anda di sini.
        </p>
        <button type="button" className="button-primary" onClick={onAddCredit}>
          <Plus size={ICON_SM} weight="bold" aria-hidden="true" />
          <span>Tambah Kredit / PayLater</span>
        </button>
      </section>
    );
  }

  return (
    <div className="credit-stack">
      <div className="credit-grid">
        {active.map((facility) => (
          <FacilityCard key={facility.asset.id} facility={facility} />
        ))}
      </div>
      {archived.length > 0 && (
        <Card title="Diarsipkan" meta="Sisa utangnya tetap dihitung sebagai kewajiban">
          <ul className="ui-rows">
            {archived.map(({ asset, bills }) => (
              <InspectorRow
                key={asset.id}
                id={`credit:${asset.id}`}
                title={asset.displayName}
                subtitle="Rincian fasilitas kredit"
                detail={<CreditDetail asset={asset} link={false} />}
                className="ui-row"
              >
                <div className="ui-row-copy">
                  <InspectorRowButton>
                    <strong>{asset.displayName}</strong>
                  </InspectorRowButton>
                  <small>{provider(asset)}</small>
                </div>
                <Amount
                  value={formatMinor(bills.totalUnpaidMinor, asset.currency, asset.exponent)}
                  tone={bills.totalUnpaidMinor > 0n ? "negative" : ""}
                />
              </InspectorRow>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Installments({ facilities }: { facilities: CreditFacility[] }) {
  const contracts = facilities.flatMap((facility) =>
    installmentContracts(facility.asset).map((contract) => ({ facility, contract }))
  );
  if (!contracts.length) {
    return (
      <section className="ui-card ui-empty">
        <h2>Belum ada cicilan terjadwal</h2>
        <p>
          Pembelian cicilan dari Catat (Pengeluaran dari akun kredit, dengan tenor) membuat jadwal di sini. Seluruh pokok dan bunganya sudah dibukukan saat pembelian.
        </p>
      </section>
    );
  }
  return (
    <Card title="Kontrak cicilan aktif" meta={`${contracts.length} kontrak berjalan`}>
      <div className="credit-contract-head" aria-hidden="true">
        <span>Fasilitas Kredit</span>
        <span>Tenor</span>
        <span>Periode Kontrak</span>
        <span>Tagihan / Bln</span>
        <span>Total Kontrak</span>
      </div>
      <ul className="ui-rows">
        {contracts.map(({ facility, contract }) => {
          const { asset } = facility;
          const money = (value: bigint) => formatMinor(value, asset.currency, asset.exponent);
          return (
            <InspectorRow
              key={`${asset.id}:${contract.activityId}`}
              id={`credit:${asset.id}`}
              title={asset.displayName}
              subtitle="Rincian fasilitas kredit"
              detail={<CreditDetail asset={asset} link={false} />}
              className="credit-contract-row"
            >
              <div className="ui-row-copy">
                <InspectorRowButton>
                  <strong>{asset.displayName}</strong>
                </InspectorRowButton>
                <small>
                  {contract.upcomingCount
                    ? `${contract.upcomingCount} bulan tersisa di jadwal`
                    : "Seluruh bulan sudah lewat"}
                </small>
              </div>
              <span className="credit-contract-tenor">
                <Chip tone="warning">{contract.count} bulan</Chip>
              </span>
              <span className="credit-contract-period">
                {monthLabel(contract.firstPeriod)} – {monthLabel(contract.lastPeriod)}
              </span>
              <Amount value={money(contract.monthlyMinor)} />
              <Amount value={money(contract.totalMinor)} level="entity" />
            </InspectorRow>
          );
        })}
      </ul>
      <p className="ui-muted ui-card-body credit-note">
        Status bayar tiap bulan dihitung dari saldo akun kredit, bukan dari jadwal.
      </p>
    </Card>
  );
}

function Receivables({ assets, currencies }: { assets: FinanceAsset[]; currencies: string[] }) {
  const lists = currencies
    .map((currency) => ({
      currency,
      items: receivableAccounts(assets, currency),
      summary: receivablesSummary(assets, currency),
    }))
    .filter((list) => list.items.length);

  if (!lists.length) {
    return (
      <section className="ui-card ui-empty">
        <h2>Belum ada piutang</h2>
        <p>
          Split bill dari menu Catat otomatis membuat akun piutang untuk porsi pembayaran teman yang belum diganti.
        </p>
      </section>
    );
  }

  return (
    <div className="credit-stack">
      {lists.map(({ currency, items, summary }) => {
        const exponent = items[0]?.asset.exponent ?? 0;
        return (
          <Card
            key={currency}
            title={`Split Bill & Piutang Teman · ${currency}`}
            meta={`${summary.openCount} belum lunas · ${formatMinor(
              summary.totalMinor,
              currency,
              exponent
            )}`}
          >
            <ul className="ui-rows">
              {items.map(({ asset, status }) => {
                const mark = resolveProviderMark(asset.providerName, asset.displayName, "teal");
                return (
                  <InspectorRow
                    key={asset.id}
                    id={`asset:${asset.id}`}
                    title={asset.displayName}
                    subtitle="Rincian piutang & talangan"
                    detail={<AssetDetail asset={asset} />}
                    className="ui-row credit-receivable-row"
                  >
                    <div className="credit-facility-identity">
                      <ProviderBrandMark mark={mark} size="sm" />
                      <div className="ui-row-copy">
                        <InspectorRowButton>
                          <strong>{asset.displayName}</strong>
                        </InspectorRowButton>
                        <small>
                          {[provider(asset), asset.isActive ? null : "Diarsipkan"]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </div>
                    </div>
                    <Chip tone={status === "lunas" ? "positive" : "warning"}>
                      {status === "lunas" ? "Lunas" : "Menunggu"}
                    </Chip>
                    <Amount
                      value={formatMinor(asset.balanceMinor, asset.currency, asset.exponent)}
                      tone={toneOf(BigInt(asset.balanceMinor))}
                    />
                    {asset.isActive && BigInt(asset.balanceMinor) > 0n && (
                      <SettleReceivableButton
                        assetId={asset.id}
                        name={asset.displayName}
                        exponent={asset.exponent}
                        amountMinor={asset.balanceMinor}
                      />
                    )}
                  </InspectorRow>
                );
              })}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

export function CreditOverview({ snapshot }: { snapshot: Snapshot }) {
  const [creatingCredit, setCreatingCredit] = useState(false);
  const { assets, throughDay } = snapshot;
  const facilities = creditFacilities(assets);
  const horizon = shortDate(throughDay);
  const relevant = sortNamed(
    snapshot.currencies,
    (entry) => entry.currency,
    (entry) => entry.currency
  ).filter(
    (entry) =>
      facilities.some((item) => item.asset.currency === entry.currency) ||
      receivablesSummary(assets, entry.currency).totalMinor !== 0n ||
      assets.some((asset) => asset.currency === entry.currency && asset.assetClass === "receivable")
  );

  const primary = relevant[0] ?? snapshot.currencies[0];
  const pCurr = primary?.currency ?? "IDR";
  const pExp = primary?.exponent ?? 0;

  const totalReceivablesBig = relevant.reduce(
    (sum, entry) => sum + BigInt(receivablesSummary(assets, entry.currency).totalMinor),
    0n
  );
  const totalBillsBig = relevant.reduce((sum, entry) => sum + BigInt(entry.creditDebtMinor), 0n);
  const totalDebtBig = relevant.reduce((sum, entry) => sum + BigInt(entry.liabilitiesMinor), 0n);

  const heading = (
    <PageHeading
      title="Kredit & Talangan"
      summary={
        <>
          <span>
            Tagihan Berjalan: <strong>{formatMinor(totalBillsBig.toString(), pCurr, pExp)}</strong>
          </span>
          <span aria-hidden="true">|</span>
          <span>
            Piutang Teman:{" "}
            <strong>{formatMinor(totalReceivablesBig.toString(), pCurr, pExp)}</strong>
          </span>
        </>
      }
      actions={
        <button
          type="button"
          className="button-primary"
          onClick={() => setCreatingCredit(true)}
        >
          <Plus size={ICON_SM} weight="bold" aria-hidden="true" />
          <span>Tambah Kredit / PayLater</span>
        </button>
      }
    />
  );

  const compactSummaryStrip =
    relevant.length > 0 ? (
      <div className="credit-currencies">
        {relevant.map((entry) => {
          const money = (value: string | bigint) =>
            formatMinor(value, entry.currency, entry.exponent);
          const totals = creditTotals(assets, entry.currency, throughDay);
          const nearest = creditBillsDue(assets, entry.currency, throughDay).nearest;
          const receivables = receivablesSummary(assets, entry.currency);
          return (
            <section
              className="credit-summary-strip"
              key={entry.currency}
              aria-label={`Ringkasan kredit ${entry.currency}`}
            >
              <div className="credit-summary-cell">
                <span className="credit-summary-label">Sisa seluruh utang ({entry.currency})</span>
                <strong className="credit-summary-val pnl-negative">
                  {money(entry.liabilitiesMinor)}
                </strong>
                <small className="credit-summary-sub">
                  {totals.facilityCount} fasilitas · termasuk cicilan
                </small>
              </div>
              <div className="credit-summary-cell">
                <span className="credit-summary-label">Tagihan s.d. {horizon}</span>
                <strong className="credit-summary-val">{money(entry.creditDebtMinor)}</strong>
                <small className="credit-summary-sub">
                  {nearest
                    ? `${shortDate(nearest.dueIso)} · ${nearest.names.join(", ")}`
                    : "Tidak ada tagihan 30 hari"}
                </small>
              </div>
              <div className="credit-summary-cell">
                <span className="credit-summary-label">Sisa limit</span>
                <strong className="credit-summary-val">{money(totals.availableLimitMinor)}</strong>
                <small className="credit-summary-sub">
                  {totals.limitKnownCount
                    ? `Dari ${totals.limitKnownCount} fasilitas aktif`
                    : "Limit belum diatur"}
                </small>
              </div>
              <div className="credit-summary-cell">
                <span className="credit-summary-label">Piutang terbuka</span>
                <strong className="credit-summary-val pnl-positive">
                  {money(receivables.totalMinor)}
                </strong>
                <small className="credit-summary-sub">
                  {receivables.openCount
                    ? `${receivables.openCount} akun menunggu pelunasan`
                    : "Tidak ada piutang terbuka"}
                </small>
              </div>
            </section>
          );
        })}
      </div>
    ) : undefined;

  return (
    <div className="page credit-page">
      <PageTabs
        label="Tampilan Kredit & Talangan"
        heading={heading}
        shared={compactSummaryStrip}
        tabs={[
          {
            id: "kredit",
            label: "Kredit & PayLater",
            panel: (
              <Facilities
                facilities={facilities}
                onAddCredit={() => setCreatingCredit(true)}
              />
            ),
          },
          { id: "cicilan", label: "Cicilan", panel: <Installments facilities={facilities} /> },
          {
            id: "piutang",
            label: "Piutang & talangan",
            panel: (
              <Receivables
                assets={assets}
                currencies={relevant.map((entry) => entry.currency)}
              />
            ),
          },
        ]}
      />

      <ExcelStatusBar
        rowCount={facilities.length}
        totalIn={formatMinor(totalReceivablesBig.toString(), pCurr, pExp)}
        totalOut={formatMinor(totalBillsBig.toString(), pCurr, pExp)}
        customNetLabel="Total Seluruh Utang"
        customNetValue={formatMinor(totalDebtBig.toString(), pCurr, pExp)}
        isNetNegative={totalDebtBig > 0n}
      />

      {creatingCredit && (
        <CreateCreditFacilityDialog onClose={() => setCreatingCredit(false)} />
      )}
    </div>
  );
}
