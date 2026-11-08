import React, { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  CreditFacility,
  InspectorPayload,
  InstallmentContract,
  SplitBillSession,
} from '../types/finance';
import { formatIDR } from '../utils/formatters';
import { ExcelStatusBar } from '../components/ExcelStatusBar';

interface KreditTalanganPageProps {
  hideRp: boolean;
  isMobile?: boolean;
  creditFacilities: CreditFacility[];
  installments: InstallmentContract[];
  splitBills: SplitBillSession[];
  onSelectInspector: (payload: InspectorPayload) => void;
  selectedInspectorId?: string;
  onPayCreditBill: (creditId: string, sourceAccName: string, amount: number) => void;
  onSettleSplitParticipant: (
    sessionId: string,
    participantId: string,
    amountPaid: number,
    targetAccountName: string
  ) => void;
  onOpenNewTxModal: (
    preset?: 'Pengeluaran' | 'Pemasukan' | 'Transfer / Top-Up' | 'Split Bill' | 'Pelunasan'
  ) => void;
}

export const KreditTalanganPage: React.FC<KreditTalanganPageProps> = ({
  hideRp,
  isMobile = false,
  creditFacilities,
  installments,
  splitBills,
  onSelectInspector,
  selectedInspectorId,
  onPayCreditBill,
  onSettleSplitParticipant,
}) => {
  const [activeFilter, setActiveFilter] = useState<'all' | 'kredit' | 'cicilan' | 'splitbill'>('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  const toggleSection = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const showFeedback = (msg: string) => {
    setFeedbackBanner(msg);
    setTimeout(() => setFeedbackBanner(null), 3500);
  };

  const totalCurrentCreditBills = creditFacilities.reduce(
    (acc, c) => acc + c.currentPeriodBill,
    0
  );
  const totalUsedCredit = creditFacilities.reduce((acc, c) => acc + c.usedLimit, 0);

  let unpaidFriendsReceivable = 0;
  splitBills.forEach((sb) => {
    sb.participants.forEach((p) => {
      unpaidFriendsReceivable += Math.max(0, p.portion - p.paidAmount);
    });
  });

  const pivotTabs = [
    { id: 'all', label: 'Semua' },
    { id: 'kredit', label: 'Kredit & PayLater' },
    { id: 'cicilan', label: 'Kontrak Cicilan' },
    { id: 'splitbill', label: 'Piutang & Split Bill' },
  ] as const;

  const showKredit = activeFilter === 'all' || activeFilter === 'kredit';
  const showCicilan = activeFilter === 'all' || activeFilter === 'cicilan';
  const showSplit = activeFilter === 'all' || activeFilter === 'splitbill';

  return (
    <div className="flex flex-col h-full bg-[#f3f5f8] overflow-hidden">
      {/* Command Ribbon + Focused/Other Underline Pivot Tabs (flex-wrap, no overflow) */}
      <div className="bg-[#ffffff] border-b border-[#e1e6eb] px-5 pt-3 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
          <div className="flex items-center gap-3">
            <h1 className="text-[16px] font-semibold text-[#1f2328] tracking-tight">
              Kredit &amp; Talangan
            </h1>
            {feedbackBanner && (
              <span className="px-2.5 py-0.5 rounded-[4px] bg-[#e6f4ea] text-[#107c41] text-[11.5px] font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{feedbackBanner}</span>
              </span>
            )}
          </div>

          <div className="hidden sm:flex items-center gap-3 text-[12px] text-[#59636e]">
            <span>
              Tagihan Berjalan:{' '}
              <strong className="text-[#c50f1f] tabular-nums">
                {formatIDR(totalCurrentCreditBills, hideRp)}
              </strong>
            </span>
            <span className="text-[#cbd5e1]">|</span>
            <span>
              Piutang Teman:{' '}
              <strong className="text-[#d83b01] tabular-nums">
                {formatIDR(unpaidFriendsReceivable, hideRp)}
              </strong>
            </span>
          </div>
        </div>

        {/* Underline Pivot Filter (Default: Semua) */}
        <div className="flex flex-wrap items-center gap-1">
          {pivotTabs.map((tab) => {
            const isActive = activeFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveFilter(tab.id)}
                className={`px-3 py-2 text-[13px] relative transition-colors cursor-pointer ${
                  isActive
                    ? 'text-[#1f2328] font-semibold after:absolute after:bottom-0 after:left-2.5 after:right-2.5 after:h-[2.5px] after:rounded-t-full after:bg-[#0f6cbd]'
                    : 'text-[#59636e] font-medium hover:text-[#1f2328]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content with Outlook-style Collapsible Section Groups */}
      <div className={`flex-1 overflow-y-auto ${isMobile ? 'p-3 space-y-3' : 'p-5 space-y-4'}`}>
        {/* GROUP 1: FASILITAS KREDIT & PAYLATER */}
        {showKredit && (
          <section className="bg-[#ffffff] rounded-[8px] border border-[#e1e6eb] shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('kredit')}
              className="w-full px-4 py-2.5 bg-[#f8fafc] border-b border-[#edf2f7] flex items-center justify-between text-left hover:bg-[#f0f6fc]/60 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                {collapsed['kredit'] ? (
                  <ChevronRight className="w-4 h-4 text-[#59636e]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#59636e]" />
                )}
                <span className="font-semibold text-[13px] text-[#1f2328]">
                  Fasilitas Kredit &amp; PayLater ({creditFacilities.length})
                </span>
              </div>
              <span className="text-[12px] text-[#59636e]">
                Tagihan Berjalan:{' '}
                <strong className="text-[#c50f1f] tabular-nums">
                  {formatIDR(totalCurrentCreditBills, hideRp)}
                </strong>
              </span>
            </button>

            {!collapsed['kredit'] && (
              <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
                {creditFacilities.map((cr) => {
                  const isSelected = selectedInspectorId === cr.id;
                  const usedPct = Math.round((cr.usedLimit / cr.creditLimit) * 100);
                  return (
                    <div
                      key={cr.id}
                      onClick={() => onSelectInspector({ kind: 'credit', data: cr })}
                      className={`rounded-[8px] border p-4 transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'border-[#0f6cbd] bg-[#f0f6fc]/40'
                          : 'border-[#e1e6eb] bg-white hover:border-[#cbd5e1]'
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="font-semibold text-[14.5px] text-[#1f2328]">
                              {cr.name}
                            </h3>
                            <p className="text-[11.5px] text-[#59636e]">{cr.provider}</p>
                          </div>
                          <span className="px-2 py-0.5 rounded-[4px] bg-[#f8fafc] border border-[#e1e6eb] text-[#59636e] text-[10.5px] font-medium shrink-0">
                            Cutoff tgl {cr.cutoffDay} · Jatuh tempo tgl {cr.dueDay}
                          </span>
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between items-baseline text-[12px]">
                            <span className="text-[#59636e]">Sisa Limit</span>
                            <span className="font-bold text-[15px] text-[#1f2328] tabular-nums">
                              {formatIDR(cr.availableLimit, hideRp)}
                            </span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-[#f0f0f0] overflow-hidden">
                            <div
                              className="h-full bg-[#0f6cbd] rounded-full"
                              style={{ width: `${Math.min(100, usedPct)}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-[11px] text-[#59636e]">
                            <span>Terpakai {formatIDR(cr.usedLimit, hideRp)}</span>
                            <span>Limit {formatIDR(cr.creditLimit, hideRp)}</span>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-[#edf2f7] grid grid-cols-2 gap-3 text-[12px]">
                          <div>
                            <div className="text-[11px] text-[#59636e]">
                              Tagihan {cr.currentBillDueDate.replace(' 2026', '')} (Berjalan)
                            </div>
                            <div className="font-bold text-[14px] text-[#c50f1f] tabular-nums mt-0.5">
                              {formatIDR(cr.currentPeriodBill, hideRp)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-[#59636e]">
                              Tagihan {cr.nextBillDueDate.replace(' 2027', '')} (Depan)
                            </div>
                            <div className="font-semibold text-[14px] text-[#1f2328] tabular-nums mt-0.5">
                              {formatIDR(cr.nextPeriodBill, hideRp)}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-[#edf2f7] flex items-center justify-between">
                        <span className="text-[11px] text-[#59636e]">{cr.interestRateMonthly}</span>
                        <button
                          type="button"
                          disabled={cr.currentPeriodBill <= 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            onPayCreditBill(cr.id, 'BCA Tahapan', cr.currentPeriodBill);
                            showFeedback(
                              `Tagihan ${cr.name} sebesar ${formatIDR(
                                cr.currentPeriodBill,
                                false
                              )} dibayar dari BCA Tahapan.`
                            );
                          }}
                          className="button-primary h-[28px] px-3 text-[11.5px] disabled:bg-[#e1e6eb] disabled:text-[#59636e] cursor-pointer"
                        >
                          {cr.currentPeriodBill > 0 ? 'Bayar Tagihan' : 'Lunas'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* GROUP 2: KONTRAK CICILAN AKTIF */}
        {showCicilan && (
          <section className="bg-[#ffffff] rounded-[8px] border border-[#e1e6eb] shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('cicilan')}
              className="w-full px-4 py-2.5 bg-[#f8fafc] border-b border-[#edf2f7] flex items-center justify-between text-left hover:bg-[#f0f6fc]/60 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                {collapsed['cicilan'] ? (
                  <ChevronRight className="w-4 h-4 text-[#59636e]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#59636e]" />
                )}
                <span className="font-semibold text-[13px] text-[#1f2328]">
                  Kontrak Cicilan Aktif ({installments.length})
                </span>
              </div>
              <span className="text-[12px] text-[#59636e]">Pemisahan Pokok &amp; Bunga</span>
            </button>

            {!collapsed['cicilan'] && (
              <div className="overflow-x-auto">
                <table className="financial-data-table">
                  <thead>
                    <tr className="text-left">
                      <th>Barang &amp; Kontrak</th>
                      <th>Fasilitas</th>
                      <th className="text-center">Tenor</th>
                      <th className="text-right">Pokok / bln</th>
                      <th className="text-right">Bunga / bln</th>
                      <th className="text-right">Tagihan / bln</th>
                      <th className="text-right">Sisa Kewajiban</th>
                    </tr>
                  </thead>
                  <tbody>
                    {installments.map((inst) => (
                      <tr
                        key={inst.id}
                        onClick={() => onSelectInspector({ kind: 'installment', data: inst })}
                        className="cursor-pointer"
                      >
                        <td>
                          <div className="font-semibold text-[#1f2328]">{inst.itemName}</div>
                          <div className="text-[11.5px] text-[#59636e]">
                            {inst.merchant} · Tgl Beli {inst.purchaseDate}
                          </div>
                        </td>
                        <td>
                          <span className="px-2 py-0.5 rounded-[4px] bg-[#fde7e9] text-[#c50f1f] font-semibold text-[11px]">
                            {inst.facilityName}
                          </span>
                        </td>
                        <td className="text-center">
                          <span className="px-2 py-0.5 rounded-[4px] bg-[#fff4ce] text-[#d83b01] font-semibold text-[11px]">
                            Cicilan {inst.currentInstallment}/{inst.totalTenor}
                          </span>
                        </td>
                        <td className="text-right tabular-nums">
                          {formatIDR(inst.monthlyPrincipal, hideRp)}
                        </td>
                        <td className="text-right tabular-nums text-[#d83b01]">
                          +{formatIDR(inst.monthlyInterest, hideRp)}
                        </td>
                        <td className="text-right tabular-nums font-semibold">
                          {formatIDR(inst.monthlyTotal, hideRp)}/bln
                        </td>
                        <td className="text-right tabular-nums font-bold">
                          {formatIDR(inst.remainingTotal, hideRp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* GROUP 3: SPLIT BILL & PIUTANG TEMAN */}
        {showSplit && (
          <section className="bg-[#ffffff] rounded-[8px] border border-[#e1e6eb] shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('splitbill')}
              className="w-full px-4 py-2.5 bg-[#f8fafc] border-b border-[#edf2f7] flex items-center justify-between text-left hover:bg-[#f0f6fc]/60 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                {collapsed['splitbill'] ? (
                  <ChevronRight className="w-4 h-4 text-[#59636e]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#59636e]" />
                )}
                <span className="font-semibold text-[13px] text-[#1f2328]">
                  Split Bill &amp; Piutang Teman ({splitBills.length} sesi)
                </span>
              </div>
              <span className="text-[12px] text-[#59636e]">
                Belum Diganti:{' '}
                <strong className="text-[#d83b01] tabular-nums">
                  {formatIDR(unpaidFriendsReceivable, hideRp)}
                </strong>
              </span>
            </button>

            {!collapsed['splitbill'] && (
              <div className="divide-y divide-[#edf2f7]">
                {splitBills.map((sb) => (
                  <div
                    key={sb.id}
                    onClick={() => onSelectInspector({ kind: 'splitbill', data: sb })}
                    className="p-4 hover:bg-[#f0f6fc]/50 transition-colors cursor-pointer space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-semibold text-[14px] text-[#1f2328]">
                          {sb.title}
                        </span>
                        <span className="ml-2 text-[12px] text-[#59636e]">
                          · Dibayar pakai <strong>{sb.paidUsingAccount}</strong> · Porsi Anda{' '}
                          <strong className="text-[#1f2328] tabular-nums">
                            {formatIDR(sb.myPortion, hideRp)}
                          </strong>
                        </span>
                      </div>
                      <span className="text-[12.5px] font-semibold text-[#1f2328] tabular-nums">
                        Total Struk {formatIDR(sb.totalReceipt, hideRp)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {sb.participants.map((p) => {
                        const remaining = Math.max(0, p.portion - p.paidAmount);
                        return (
                          <div
                            key={p.id}
                            className="px-3 py-1.5 rounded-[6px] bg-[#f8fafc] border border-[#e1e6eb] flex items-center gap-3 text-[12px]"
                          >
                            <div>
                              <span className="font-semibold text-[#1f2328]">{p.name}</span>
                              <span className="mx-1.5 text-[#cbd5e1]">|</span>
                              {p.status === 'Belum Bayar' && (
                                <span className="text-[#c50f1f] font-medium tabular-nums">
                                  Belum Bayar {formatIDR(p.portion, hideRp)}
                                </span>
                              )}
                              {p.status === 'Dicicil' && (
                                <span className="text-[#d83b01] font-medium tabular-nums">
                                  Dicicil {formatIDR(p.paidAmount, hideRp)} · Sisa{' '}
                                  {formatIDR(remaining, hideRp)}
                                </span>
                              )}
                              {p.status === 'Lunas' && (
                                <span className="text-[#107c41] font-medium">Lunas</span>
                              )}
                            </div>

                            {remaining > 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSettleSplitParticipant(sb.id, p.id, remaining, 'BCA Tahapan');
                                  showFeedback(
                                    `Talangan ${p.name} (${formatIDR(
                                      remaining,
                                      false
                                    )}) diterima ke BCA Tahapan.`
                                  );
                                }}
                                className="button-primary h-[24px] px-2.5 text-[11px] cursor-pointer"
                              >
                                Terima Ganti
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <ExcelStatusBar
        rowCount={creditFacilities.length + installments.length + splitBills.length}
        totalIn={unpaidFriendsReceivable}
        totalOut={totalCurrentCreditBills}
        hideRp={hideRp}
        customNetLabel="Total Eksposur Kredit"
        customNetValue={-totalUsedCredit}
        isMobile={isMobile}
      />
    </div>
  );
};
