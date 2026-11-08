import React, { useState } from 'react';
import {
  Download,
  CheckCircle2,
  ArrowRight,
  TrendingUp,
  Wallet,
  CreditCard,
  Users,
  Sparkles,
  CalendarClock,
} from 'lucide-react';
import {
  AutomationItem,
  CreditFacility,
  InspectorPayload,
  NavPageId,
  RoutineObligation,
  SplitBillSession,
  TransactionItem,
  WorkbookSummary,
} from '../types/finance';
import { SIX_MONTH_CASHFLOW_TREND } from '../data/mockFinanceData';
import { formatIDR } from '../utils/formatters';
import { downloadTransactionsCsv } from '../utils/exportCsv';
import { ExcelStatusBar } from '../components/ExcelStatusBar';

interface HomeBriefingPageProps {
  hideRp: boolean;
  isMobile?: boolean;
  transactions: TransactionItem[];
  automations: AutomationItem[];
  creditFacilities: CreditFacility[];
  obligations: RoutineObligation[];
  splitBills: SplitBillSession[];
  onConfirmAutomation: (autoId: string) => void;
  onSkipAutomation: (autoId: string) => void;
  onSelectInspector: (payload: InspectorPayload) => void;
  selectedInspectorId?: string;
  onNavigate: (page: NavPageId) => void;
  onOpenNewTxModal?: (
    preset?: 'Pengeluaran' | 'Pemasukan' | 'Transfer / Top-Up' | 'Split Bill' | 'Pelunasan'
  ) => void;
  summary?: WorkbookSummary;
}

export const HomeBriefingPage: React.FC<HomeBriefingPageProps> = ({
  hideRp,
  isMobile = false,
  transactions,
  automations,
  creditFacilities,
  splitBills,
  onConfirmAutomation,
  onSkipAutomation,
  onSelectInspector,
  selectedInspectorId,
  onNavigate,
  summary,
}) => {
  const [activeSheet, setActiveSheet] = useState<'briefing' | 'networth_formula'>('briefing');
  const [hoveredMonthIdx, setHoveredMonthIdx] = useState<number>(5);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const recentSixTxs = transactions.slice(0, 6);

  const totalInRecent = recentSixTxs
    .filter((t) => t.direction === 'in' && !t.isVoided)
    .reduce((acc, t) => acc + t.totalMutation, 0);
  const totalOutRecent = recentSixTxs
    .filter((t) => t.direction === 'out' && !t.isVoided)
    .reduce((acc, t) => acc + t.totalMutation, 0);

  const pendingAutomations = automations.filter((a) => a.status === 'Perlu Konfirmasi');

  let unpaidTotal = 0;
  let unpaidFriendsCount = 0;
  splitBills.forEach((sb) => {
    sb.participants.forEach((p) => {
      const rem = p.portion - p.paidAmount;
      if (rem > 0) {
        unpaidTotal += rem;
        unpaidFriendsCount += 1;
      }
    });
  });

  const upcomingBillsTotal = summary?.upcomingCreditBills ?? creditFacilities.reduce((acc, c) => acc + c.currentPeriodBill, 0);
  const billedFacilities = creditFacilities.filter((c) => c.currentPeriodBill > 0);
  const billedFacilitiesText = billedFacilities.length > 0
    ? billedFacilities.map((c) => c.name).join(', ')
    : 'Tidak ada tagihan tertunda';

  const handleExport = () => {
    downloadTransactionsCsv(recentSixTxs, 'moneytor_ringkasan_briefing.csv');
    setExportNotice('Berkas moneytor_ringkasan_briefing.csv berhasil diunduh.');
    setTimeout(() => setExportNotice(null), 3000);
  };

  const getBadgeForTxType = (type: TransactionItem['type']) => {
    switch (type) {
      case 'Pemasukan':
        return 'bg-[#E6F4EA] text-[#107C41]';
      case 'Pengeluaran':
        return 'bg-[#FDE7E9] text-[#C50F1F]';
      case 'Split Bill':
        return 'bg-[#FFF4CE] text-[#D83B01]';
      case 'Transfer / Top-Up':
        return 'bg-[#EBF3FC] text-[#0F6CBD]';
      case 'Investasi':
        return 'bg-[#F3EBF9] text-[#5C2E91]';
      case 'Bunga & Pajak':
        return 'bg-[#E6F4EA] text-[#107C41]';
      case 'Bayar Kredit':
        return 'bg-[#FDE7E9] text-[#C50F1F]';
    }
  };

  const sheetTabs = [
    { id: 'briefing', label: 'Ringkasan Eksekutif' },
    { id: 'networth_formula', label: 'Rincian Kalkulasi Net Worth' },
  ] as const;

  return (
    <div className="flex flex-col h-full bg-[#FFFFFF] overflow-hidden">
      {/* Sleek Page Header + Fluent 2 Underline Pivot Tabs */}
      <div className={`bg-[#FFFFFF] border-b border-[#e1e6eb] ${isMobile ? 'px-4 pt-3' : 'px-6 pt-3.5'} shrink-0`}>
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-[18px] font-semibold text-[#111827] tracking-tight">
            Beranda
          </h1>
          <div className="flex items-center gap-2">
            {exportNotice && (
              <span className="text-[11.5px] px-2.5 py-1 rounded-[6px] bg-[#E6F4EA] text-[#107C41] font-medium">
                {exportNotice}
              </span>
            )}
            {!isMobile && (
              <button
                onClick={handleExport}
                className="finance-secondary h-[28px] px-2.5 flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#107C41]" />
                <span>Ekspor Ringkasan (.CSV)</span>
              </button>
            )}
          </div>
        </div>

        {isMobile ? (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2.5 pt-1 no-scrollbar">
            {sheetTabs.map((t) => {
              const active = activeSheet === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveSheet(t.id)}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#0F6CBD] text-white shadow-2xs'
                      : 'bg-[#F3F2F1] text-[#616161] hover:text-[#242424]'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-2 -ml-3">
            {sheetTabs.map((t) => {
              const active = activeSheet === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveSheet(t.id)}
                  className={`px-3 py-2.5 text-[13px] relative transition-colors cursor-pointer ${
                    active
                      ? 'text-[#242424] font-semibold after:absolute after:bottom-0 after:left-3 after:right-3 after:h-[3px] after:rounded-t-full after:bg-[#0F6CBD]'
                      : 'text-[#616161] font-medium hover:text-[#242424]'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Main Scrollable Workspace */}
      <div className={`flex-1 overflow-y-auto bg-[#FAFAFA]/60 ${isMobile ? 'p-3.5 space-y-3.5' : 'p-6 space-y-5'}`}>
        {/* ROW OF 4 EDITORIAL KPI CARDS (Charcoal Black Nominals, No Mid-Card Divider) */}
        <div
          className={`grid gap-3.5 ${
            isMobile ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4'
          }`}
        >
          {/* KPI 1 */}
          <div
            onClick={() => setActiveSheet('networth_formula')}
            className="bg-[#FFFFFF] rounded-[8px] border border-[#EBEBEB] hover:border-[#D1D1D1] p-4 shadow-2xs transition-all cursor-pointer flex flex-col justify-between min-h-[112px]"
          >
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-[#616161]">
                Kekayaan Bersih Murni
              </span>
              <span className="w-6 h-6 rounded-[6px] bg-[#E6F4EA] text-[#107C41] flex items-center justify-center shrink-0">
                <TrendingUp className="w-3.5 h-3.5" />
              </span>
            </div>
            <div
              className={`${
                isMobile ? 'text-[16px]' : 'text-[21px]'
              } font-bold text-[#111827] tabular-nums tracking-tight my-1`}
            >
              {formatIDR(summary ? summary.trueNetWorth : 0, hideRp)}
            </div>
            <div className="text-[11px] text-[#707070] truncate">
              Aset + Investasi + Piutang − Hutang
            </div>
          </div>

          {/* KPI 2 */}
          <div
            onClick={() => onNavigate('rekening')}
            className="bg-[#FFFFFF] rounded-[8px] border border-[#EBEBEB] hover:border-[#D1D1D1] p-4 shadow-2xs transition-all cursor-pointer flex flex-col justify-between min-h-[112px]"
          >
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-[#616161]">
                Dana Siap Pakai
              </span>
              <span className="w-6 h-6 rounded-[6px] bg-[#EBF3FC] text-[#0F6CBD] flex items-center justify-center shrink-0">
                <Wallet className="w-3.5 h-3.5" />
              </span>
            </div>
            <div
              className={`${
                isMobile ? 'text-[16px]' : 'text-[21px]'
              } font-bold text-[#111827] tabular-nums tracking-tight my-1`}
            >
              {formatIDR(summary ? summary.spendableCash : 0, hideRp)}
            </div>
            <div className="text-[11px] text-[#707070] truncate">
              Bebas cadangan &amp; tagihan 30 hari
            </div>
          </div>

          {/* KPI 3 */}
          <div
            onClick={() => {
              onNavigate('kredit');
              if (creditFacilities[0]) {
                onSelectInspector({ kind: 'credit', data: creditFacilities[0] });
              }
            }}
            className="bg-[#FFFFFF] rounded-[8px] border border-[#EBEBEB] hover:border-[#D1D1D1] p-4 shadow-2xs transition-all cursor-pointer flex flex-col justify-between min-h-[112px]"
          >
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-[#616161]">
                Tagihan Kredit Terdekat
              </span>
              <span className="w-6 h-6 rounded-[6px] bg-[#FDE7E9] text-[#C50F1F] flex items-center justify-center shrink-0">
                <CreditCard className="w-3.5 h-3.5" />
              </span>
            </div>
            <div
              className={`${
                isMobile ? 'text-[16px]' : 'text-[21px]'
              } font-bold text-[#111827] tabular-nums tracking-tight my-1`}
            >
              {formatIDR(upcomingBillsTotal, hideRp)}
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="px-1.5 py-0.2 rounded-[4px] bg-[#FDE7E9] text-[#C50F1F] font-semibold text-[10.5px]">
                {billedFacilities[0]?.currentBillDueDate || '30 Hari'}
              </span>
              <span className="text-[#707070] truncate">{billedFacilitiesText}</span>
            </div>
          </div>

          {/* KPI 4 */}
          <div
            onClick={() => {
              onNavigate('kredit');
              if (splitBills[0]) {
                onSelectInspector({ kind: 'splitbill', data: splitBills[0] });
              }
            }}
            className="bg-[#FFFFFF] rounded-[8px] border border-[#EBEBEB] hover:border-[#D1D1D1] p-4 shadow-2xs transition-all cursor-pointer flex flex-col justify-between min-h-[112px]"
          >
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-[#616161]">
                Piutang Belum Diganti
              </span>
              <span className="w-6 h-6 rounded-[6px] bg-[#FFF4CE] text-[#D83B01] flex items-center justify-center shrink-0">
                <Users className="w-3.5 h-3.5" />
              </span>
            </div>
            <div
              className={`${
                isMobile ? 'text-[16px]' : 'text-[21px]'
              } font-bold text-[#111827] tabular-nums tracking-tight my-1`}
            >
              {formatIDR(unpaidTotal, hideRp)}
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="px-1.5 py-0.2 rounded-[4px] bg-[#FFF4CE] text-[#D83B01] font-semibold text-[10.5px]">
                {unpaidFriendsCount} Teman
              </span>
              <span className="text-[#707070] truncate">Menunggu pelunasan</span>
            </div>
          </div>
        </div>

        {activeSheet === 'networth_formula' ? (
          <div className={`grid gap-5 ${isMobile ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
            <div className="bg-white rounded-[8px] border border-[#EBEBEB] overflow-hidden shadow-2xs">
              <div className="px-5 py-3 bg-[#FAFAFA] border-b border-[#F0F0F0] font-semibold text-[13px] flex items-center justify-between">
                <span className="text-[#242424]">1. Komponen Kekayaan Bersih Murni</span>
                <span className="text-[#111827] font-bold tabular-nums">{formatIDR(summary ? summary.trueNetWorth : 0, hideRp)}</span>
              </div>
              <div className="p-5 space-y-2.5 text-[13px]">
                <div className="flex justify-between py-1.5 border-b border-[#F3F2F1]">
                  <span className="text-[#616161]">Kas, Bank &amp; E-Wallet</span>
                  <span className="font-semibold text-[#111827] tabular-nums">{formatIDR(summary ? summary.cashAndBank : 0, hideRp)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#F3F2F1]">
                  <span className="text-[#616161]">Tabungan Bunga Tinggi &amp; Deposito</span>
                  <span className="font-semibold text-[#111827] tabular-nums">{formatIDR(summary ? summary.highYieldSavings : 0, hideRp)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#F3F2F1]">
                  <span className="text-[#616161]">Kartu E-Money</span>
                  <span className="font-semibold text-[#111827] tabular-nums">{formatIDR(summary ? summary.eMoney : 0, hideRp)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#F3F2F1]">
                  <span className="text-[#616161]">Portofolio Investasi</span>
                  <span className="font-semibold text-[#111827] tabular-nums">{formatIDR(summary ? summary.investmentsValue : 0, hideRp)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#F3F2F1]">
                  <span className="text-[#616161]">Piutang Split Bill Teman</span>
                  <span className="font-semibold text-[#111827] tabular-nums">{formatIDR(summary ? summary.receivables : unpaidTotal, hideRp)}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-[#C50F1F]">Dikurangi: Liabilitas PayLater &amp; Kredit</span>
                  <span className="font-semibold text-[#C50F1F] tabular-nums">-{formatIDR(summary ? summary.totalLiabilities : 0, hideRp)}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-[8px] border border-[#EBEBEB] overflow-hidden shadow-2xs">
              <div className="px-5 py-3 bg-[#FAFAFA] border-b border-[#F0F0F0] font-semibold text-[13px] flex items-center justify-between">
                <span className="text-[#242424]">2. Rumus Dana Siap Pakai (Spendable Cash)</span>
                <span className="text-[#111827] font-bold tabular-nums">{formatIDR(summary ? summary.spendableCash : 0, hideRp)}</span>
              </div>
              <div className="p-5 space-y-2.5 text-[13px]">
                <div className="flex justify-between py-1.5 border-b border-[#F3F2F1]">
                  <span className="text-[#616161]">Total Likuiditas Kas &amp; Tabungan</span>
                  <span className="font-semibold text-[#111827] tabular-nums">{formatIDR(summary ? summary.cashAndBank + summary.highYieldSavings : 0, hideRp)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#F3F2F1]">
                  <span className="text-[#616161]">Dikunci: Dana Cadangan</span>
                  <span className="font-semibold text-[#D83B01] tabular-nums">-{formatIDR(summary ? summary.lockedReserve : 0, hideRp)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#F3F2F1]">
                  <span className="text-[#616161]">Dikurangi: Tagihan Kredit 30 Hari</span>
                  <span className="font-semibold text-[#C50F1F] tabular-nums">-{formatIDR(summary ? summary.upcomingCreditBills : 0, hideRp)}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-[#616161]">Dikurangi: Saldo Chip E-Money</span>
                  <span className="font-semibold text-[#616161] tabular-nums">-{formatIDR(summary ? summary.eMoney : 0, hideRp)}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div
            className={`grid gap-5 items-start ${
              isMobile ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-12'
            }`}
          >
            {/* LEFT COLUMN: Chart + 6 Recent Mutations */}
            <div className={`${isMobile ? '' : 'xl:col-span-7'} space-y-5`}>
              {/* Chart Card */}
              <div className="bg-[#FFFFFF] rounded-[8px] border border-[#EBEBEB] overflow-hidden shadow-2xs">
                <div className="px-5 py-3.5 border-b border-[#F0F0F0] flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold text-[13.5px] text-[#111827]">
                    Tren Arus Kas 6 Bulan
                  </h2>
                  <div className="flex items-center gap-3 text-[11px] text-[#616161]">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-[2px] bg-[#107C41]" />
                      <span>Pemasukan</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-[2px] bg-[#0F6CBD]" />
                      <span>Konsumsi</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-[2px] bg-[#D83B01]" />
                      <span>Admin &amp; Bunga</span>
                    </span>
                  </div>
                </div>

                <div className="p-5">
                  {(() => {
                    const trendData = summary?.sixMonthTrend?.length ? summary.sixMonthTrend : SIX_MONTH_CASHFLOW_TREND;
                    const maxScale = Math.max(1, ...trendData.map((d) => Math.max(d.income, d.consumption, 1)));
                    const safeHoverIdx = Math.min(hoveredMonthIdx, trendData.length - 1);
                    const selectedItem = trendData[safeHoverIdx >= 0 ? safeHoverIdx : 0];

                    return (
                      <>
                        <div
                          className="grid gap-2.5 h-[148px] items-end pt-2 pb-2.5 border-b border-[#F0F0F0]"
                          style={{ gridTemplateColumns: `repeat(${trendData.length}, minmax(0, 1fr))` }}
                        >
                          {trendData.map((item, idx) => {
                            const incHeight = Math.round((item.income / maxScale) * 112);
                            const consHeight = Math.round((item.consumption / maxScale) * 112);
                            const adminHeight = Math.max(4, Math.round((item.adminAndInterest / maxScale) * 112));
                            const isHovered = safeHoverIdx === idx;

                            return (
                              <div
                                key={item.month}
                                onClick={() => setHoveredMonthIdx(idx)}
                                onMouseEnter={() => setHoveredMonthIdx(idx)}
                                className={`flex flex-col items-center h-full justify-end rounded-[6px] px-1 pt-1 transition-colors cursor-pointer ${
                                  isHovered ? 'bg-[#F3F9FD]' : 'hover:bg-[#FAFAFA]'
                                }`}
                              >
                                <div className="flex items-end gap-1.5 w-full justify-center">
                                  <div
                                    style={{ height: `${incHeight}px` }}
                                    className="w-2.5 sm:w-3.5 bg-[#107C41] rounded-t-[3px]"
                                  />
                                  <div
                                    style={{ height: `${consHeight}px` }}
                                    className="w-2.5 sm:w-3.5 bg-[#0F6CBD] rounded-t-[3px]"
                                  />
                                  <div
                                    style={{ height: `${adminHeight}px` }}
                                    className="w-2 bg-[#D83B01] rounded-t-[3px]"
                                  />
                                </div>
                                <span
                                  className={`mt-2 text-[11px] ${
                                    isHovered ? 'text-[#0F6CBD] font-semibold' : 'text-[#616161]'
                                  }`}
                                >
                                  {item.month}
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        {selectedItem && (
                          <div className="mt-3 px-3.5 py-2 rounded-[6px] bg-[#FAFAFA] flex flex-wrap items-center justify-between gap-2 text-[12px]">
                            <span className="font-semibold text-[#242424]">{selectedItem.month}</span>
                            <span className="text-[#616161]">
                              Masuk: <strong className="text-[#107C41] tabular-nums">+{formatIDR(selectedItem.income, hideRp)}</strong>
                            </span>
                            <span className="text-[#616161]">
                              Konsumsi: <strong className="text-[#111827] tabular-nums">{formatIDR(selectedItem.consumption, hideRp)}</strong>
                            </span>
                            <span className="text-[#616161]">
                              Admin: <strong className="text-[#D83B01] tabular-nums">{formatIDR(selectedItem.adminAndInterest, hideRp)}</strong>
                            </span>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* 6 Mutasi Terakhir */}
              <div className="bg-[#FFFFFF] rounded-[8px] border border-[#EBEBEB] overflow-hidden shadow-2xs">
                <div className="px-5 py-3.5 border-b border-[#F0F0F0] flex items-center justify-between">
                  <h2 className="font-semibold text-[13.5px] text-[#111827]">Mutasi Terakhir</h2>
                  <button
                    onClick={() => onNavigate('mutasi')}
                    className="text-[12px] font-medium text-[#0F6CBD] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <span>Lihat Semua</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {isMobile ? (
                  <div className="divide-y divide-[#F0F0F0]">
                    {recentSixTxs.map((tx) => (
                      <div
                        key={tx.id}
                        onClick={() => onSelectInspector({ kind: 'transaction', data: tx })}
                        className="p-3.5 hover:bg-[#F3F9FD] active:bg-[#EBF3FC] flex items-center justify-between gap-2.5 cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span
                              className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-[4px] ${getBadgeForTxType(
                                tx.type
                              )}`}
                            >
                              {tx.type}
                            </span>
                            <span className="text-[11px] text-[#616161]">{tx.date}</span>
                          </div>
                          <div className="font-medium text-[12.5px] text-[#111827] truncate">
                            {tx.note}
                          </div>
                          <div className="text-[11px] text-[#616161] truncate">
                            {tx.sourceAccount} {tx.targetAccount ? `→ ${tx.targetAccount}` : ''}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div
                            className={`font-semibold text-[13px] tabular-nums ${
                              tx.direction === 'in'
                                ? 'text-[#107C41]'
                                : tx.direction === 'out'
                                ? 'text-[#C50F1F]'
                                : 'text-[#111827]'
                            }`}
                          >
                            {tx.direction === 'in' ? '+' : tx.direction === 'out' ? '-' : ''}
                            {formatIDR(tx.totalMutation, hideRp)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[13px]">
                      <thead>
                        <tr className="bg-[#FAFAFA] border-b border-[#F0F0F0] text-left text-[11px] font-semibold text-[#616161] uppercase tracking-wider">
                          <th className="py-2.5 px-4">Tanggal</th>
                          <th className="py-2.5 px-4">Jenis</th>
                          <th className="py-2.5 px-4">Alur Rekening</th>
                          <th className="py-2.5 px-4">Keterangan</th>
                          <th className="py-2.5 px-4 text-right">Total Mutasi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F0F0F0]">
                        {recentSixTxs.map((tx) => {
                          const isSelected = selectedInspectorId === tx.id;
                          return (
                            <tr
                              key={tx.id}
                              onClick={() => onSelectInspector({ kind: 'transaction', data: tx })}
                              className={`transition-colors cursor-pointer ${
                                isSelected ? 'bg-[#EBF3FC]' : 'hover:bg-[#F3F9FD]'
                              }`}
                            >
                              <td className="py-2.5 px-4 whitespace-nowrap text-[12px] text-[#616161]">
                                {tx.date}
                              </td>
                              <td className="py-2.5 px-4 whitespace-nowrap">
                                <span
                                  className={`inline-block px-2 py-0.5 text-[11px] font-semibold rounded-[4px] ${getBadgeForTxType(
                                    tx.type
                                  )}`}
                                >
                                  {tx.type}
                                </span>
                              </td>
                              <td className="py-2.5 px-4 whitespace-nowrap text-[12.5px] font-medium text-[#242424]">
                                {tx.sourceAccount}
                                {tx.targetAccount ? ` → ${tx.targetAccount}` : ''}
                              </td>
                              <td className="py-2.5 px-4 max-w-[220px] truncate text-[#424242]">
                                {tx.note}
                              </td>
                              <td
                                className={`py-2.5 px-4 text-right font-semibold tabular-nums whitespace-nowrap ${
                                  tx.direction === 'in'
                                    ? 'text-[#107C41]'
                                    : tx.direction === 'out'
                                    ? 'text-[#C50F1F]'
                                    : 'text-[#111827]'
                                }`}
                              >
                                {tx.direction === 'in' ? '+' : tx.direction === 'out' ? '-' : ''}
                                {formatIDR(tx.totalMutation, hideRp)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN: Konfirmasi Otomatisasi + Jatuh Tempo Terdekat */}
            <div className={`${isMobile ? '' : 'xl:col-span-5'} space-y-5`}>
              <div className="bg-[#FFFFFF] rounded-[8px] border border-[#EBEBEB] overflow-hidden shadow-2xs">
                <div className="px-5 py-3.5 border-b border-[#F0F0F0] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#D83B01]" />
                    <h2 className="font-semibold text-[13.5px] text-[#111827]">
                      Konfirmasi Otomatisasi
                    </h2>
                  </div>
                  {pendingAutomations.length > 0 && (
                    <span className="px-2 py-0.5 rounded-[4px] bg-[#FFF4CE] text-[#D83B01] font-semibold text-[11px]">
                      {pendingAutomations.length} Menunggu
                    </span>
                  )}
                </div>

                <div className="p-4 space-y-3">
                  {automations.slice(0, 3).map((auto) => {
                    const isPending = auto.status === 'Perlu Konfirmasi';
                    return (
                      <div
                        key={auto.id}
                        className={`p-3.5 rounded-[8px] border transition-all ${
                          isPending
                            ? 'bg-[#FAFAFA] border-[#EBEBEB]'
                            : 'bg-[#FFFFFF] border-[#F0F0F0] opacity-75'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-[12.5px] text-[#111827]">
                              {auto.title}
                            </div>
                            <div className="text-[11.5px] text-[#616161] mt-0.5">
                              {auto.sourceAccount} → {auto.targetAccount} ·{' '}
                              <strong className="text-[#111827] tabular-nums">
                                {formatIDR(auto.amount, hideRp)}
                              </strong>
                            </div>
                          </div>
                          <span
                            className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-[4px] shrink-0 ${
                              auto.status === 'Terkonfirmasi'
                                ? 'bg-[#E6F4EA] text-[#107C41]'
                                : auto.status === 'Dilewati'
                                ? 'bg-[#F3F2F1] text-[#616161]'
                                : 'bg-[#FFF4CE] text-[#D83B01]'
                            }`}
                          >
                            {auto.status}
                          </span>
                        </div>

                        {isPending && (
                          <div className="mt-3 flex items-center justify-end gap-2">
                            <button
                              onClick={() => onSkipAutomation(auto.id)}
                              className="h-[28px] px-3 rounded-[6px] bg-white hover:bg-[#F3F2F1] border border-[#E0E0E0] text-[#424242] font-medium text-[11.5px] cursor-pointer"
                            >
                              Lewati
                            </button>
                            <button
                              onClick={() => onConfirmAutomation(auto.id)}
                              className="h-[28px] px-3 rounded-[6px] bg-[#0F6CBD] hover:bg-[#115EA3] text-white font-semibold text-[11.5px] flex items-center gap-1 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Konfirmasi</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Jatuh Tempo Terdekat */}
              <div className="bg-[#FFFFFF] rounded-[8px] border border-[#EBEBEB] overflow-hidden shadow-2xs">
                <div className="px-5 py-3.5 border-b border-[#F0F0F0] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="w-4 h-4 text-[#C50F1F]" />
                    <h2 className="font-semibold text-[13.5px] text-[#111827]">
                      Jatuh Tempo Terdekat
                    </h2>
                  </div>
                  <span className="text-[11px] text-[#616161]">30 Hari</span>
                </div>

                <div className="divide-y divide-[#F0F0F0]">
                  {creditFacilities.map((cr) => (
                    <div
                      key={cr.id}
                      onClick={() => onSelectInspector({ kind: 'credit', data: cr })}
                      className="px-5 py-3.5 hover:bg-[#F3F9FD] flex items-center justify-between cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="px-2 py-1 rounded-[4px] bg-[#FDE7E9] text-[#C50F1F] font-semibold text-[11px] text-center min-w-[52px]">
                          {cr.currentBillDueDate.replace(' 2026', '')}
                        </span>
                        <div>
                          <div className="font-semibold text-[13px] text-[#111827]">
                            {cr.name}
                          </div>
                          <div className="text-[11.5px] text-[#616161]">
                            Cutoff tgl {cr.cutoffDay}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-[#111827] tabular-nums text-[13.5px]">
                          {formatIDR(cr.currentPeriodBill, hideRp)}
                        </div>
                        <span className="text-[11px] text-[#0F6CBD] font-medium">Rincian →</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <ExcelStatusBar
        rowCount={recentSixTxs.length}
        totalIn={totalInRecent}
        totalOut={totalOutRecent}
        hideRp={hideRp}
        extraLabel="6 Mutasi Terakhir"
        isMobile={isMobile}
      />
    </div>
  );
};
