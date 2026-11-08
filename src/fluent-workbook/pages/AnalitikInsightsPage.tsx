import React, { useState } from 'react';
import {
  Info,
} from 'lucide-react';
import {
  BudgetItem,
  InspectorPayload,
  TransactionItem,
  WorkbookSummary,
} from '../types/finance';
import { SIX_MONTH_CASHFLOW_TREND } from '../data/mockFinanceData';
import { formatIDR, formatPercent } from '../utils/formatters';
import { ExcelStatusBar } from '../components/ExcelStatusBar';

interface AnalitikInsightsPageProps {
  hideRp: boolean;
  isMobile?: boolean;
  analyticsMode: 'consumption' | 'cashflow';
  onChangeAnalyticsMode: (m: 'consumption' | 'cashflow') => void;
  transactions: TransactionItem[];
  budgets: BudgetItem[];
  onSelectInspector: (payload: InspectorPayload) => void;
  summary?: WorkbookSummary;
}

export const AnalitikInsightsPage: React.FC<AnalitikInsightsPageProps> = ({
  hideRp,
  isMobile = false,
  analyticsMode,
  onChangeAnalyticsMode,
  budgets,
  onSelectInspector,
  summary,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'distribution' | 'audit_fees'>('overview');

  const isPureConsumption = analyticsMode === 'consumption';

  const novIncome = summary ? summary.monthlyIncome : 0;
  const novPureConsumption = summary ? summary.monthlyPureConsumption : 0;
  const novRealCashOut = summary ? summary.monthlyRealCashOut : 0;
  const displayedExpense = isPureConsumption ? novPureConsumption : novRealCashOut;
  const displayedSurplus = novIncome - displayedExpense;
  const savingsRate = novIncome > 0 ? (displayedSurplus / novIncome) * 100 : 0;
  const trendData = summary?.sixMonthTrend?.length ? summary.sixMonthTrend : SIX_MONTH_CASHFLOW_TREND;

  const leakItems = [
    {
      id: 'leak-1',
      name: 'Bunga Cicilan SPayLater (SSD Eksternal Samsung T7)',
      type: 'Bunga Kredit',
      account: 'SPayLater',
      amount: 25000,
      recommendation: 'Lunasi dipercepat jika kas mencukupi atau gunakan Cicilan 0% Kartu Kredit.',
    },
    {
      id: 'leak-2',
      name: 'Bunga Cicilan Kredivo (Monitor Dell UltraSharp)',
      type: 'Bunga Kredit',
      account: 'Kredivo',
      amount: 35000,
      recommendation: 'Hindari tenor cicilan di atas 3 bulan dengan bunga bulanan.',
    },
    {
      id: 'leak-3',
      name: 'Biaya Layanan Top-Up Flazz via SPayLater',
      type: 'Biaya Layanan',
      account: 'SPayLater → Flazz BCA',
      amount: 5000,
      recommendation: 'Top-up Flazz langsung dari m-BCA (Rp 0 biaya admin).',
    },
    {
      id: 'leak-4',
      name: 'Potongan Biaya Ganda Top-Up GoPay dari Mandiri',
      type: 'Admin Transfer',
      account: 'Mandiri → GoPay',
      amount: 2500,
      recommendation: 'Kurangi frekuensi top-up kecil; lakukan 1x top-up bulanan sekaligus.',
    },
    {
      id: 'leak-5',
      name: 'Biaya Admin Bulanan Rekening BCA Tahapan & Mandiri',
      type: 'Admin Bank',
      account: 'BCA & Mandiri',
      amount: 27500,
      recommendation: 'Sudah tertutup sepenuhnya oleh bunga bersih SeaBank (+Rp 62.500/bln).',
    },
    {
      id: 'leak-6',
      name: 'Potongan Pajak PPh 20% Bunga Tabungan SeaBank & bluSaving',
      type: 'Pajak Bunga',
      account: 'SeaBank & bluSaving',
      amount: 23125,
      recommendation: 'Untuk pajak lebih rendah (10%) pertimbangkan Reksa Dana Obligasi / SBN.',
    },
  ];

  const totalLeaks = leakItems.reduce((acc, l) => acc + l.amount, 0);

  const tabs = [
    { id: 'overview', label: `Ikhtisar & Tren` },
    { id: 'distribution', label: `Distribusi Kategori & Akun` },
    { id: 'audit_fees', label: `Audit Biaya Admin, Pajak & Bunga Kredit` },
  ] as const;

  return (
    <div className="flex flex-col h-full bg-[#FFFFFF] overflow-hidden">
      {/* Sleek Page Header + Mode Switcher + Fluent 2 Underline Pivot Tabs */}
      <div className={`bg-[#FFFFFF] border-b border-[#F0F0F0] ${isMobile ? 'px-4 pt-3' : 'px-6 pt-4'} shrink-0`}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h1 className="text-[18px] font-semibold text-[#111827] tracking-tight">
            Analitik
          </h1>

          {/* Sakelar Utama: [Mode Konsumsi Murni] vs [Mode Arus Kas Riil] */}
          <div className="flex items-center p-0.5 rounded-[6px] bg-[#F3F2F1] border border-[#E5E5E5]">
            <button
              onClick={() => onChangeAnalyticsMode('consumption')}
              className={`h-[26px] px-3 rounded-[4px] text-[11.5px] font-medium transition-all cursor-pointer ${
                isPureConsumption
                  ? 'bg-[#FFFFFF] text-[#0F6CBD] font-semibold shadow-2xs'
                  : 'text-[#616161] hover:text-[#242424]'
              }`}
            >
              Mode Konsumsi Murni
            </button>
            <button
              onClick={() => onChangeAnalyticsMode('cashflow')}
              className={`h-[26px] px-3 rounded-[4px] text-[11.5px] font-medium transition-all cursor-pointer ${
                !isPureConsumption
                  ? 'bg-[#FFFFFF] text-[#0F6CBD] font-semibold shadow-2xs'
                  : 'text-[#616161] hover:text-[#242424]'
              }`}
            >
              Mode Arus Kas Riil
            </button>
          </div>
        </div>

        {isMobile ? (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2.5 pt-1 no-scrollbar">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#0F6CBD] text-white shadow-2xs'
                      : 'bg-[#F3F2F1] text-[#616161] hover:text-[#242424]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-2 -ml-3 overflow-x-auto">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-2.5 text-[13px] whitespace-nowrap relative transition-colors cursor-pointer ${
                    isActive
                      ? 'text-[#242424] font-semibold after:absolute after:bottom-0 after:left-3 after:right-3 after:h-[3px] after:rounded-t-full after:bg-[#0F6CBD]'
                      : 'text-[#616161] font-medium hover:text-[#242424]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Clean White Command Bar (44px, px-6) */}
      <div className={`h-[44px] bg-[#FFFFFF] border-b border-[#F0F0F0] ${isMobile ? 'px-4' : 'px-6'} flex items-center justify-between shrink-0`}>
        <div className="flex items-center gap-2 text-[12px] text-[#616161] truncate">
          <Info className="w-3.5 h-3.5 text-[#0F6CBD] shrink-0" />
          {isPureConsumption ? (
            <span className="truncate">
              <strong className="text-[#242424]">Mode Konsumsi Murni:</strong> Hanya menghitung porsi pribadi pada Split Bill &amp; mengabaikan transfer antar rekening sendiri.
            </span>
          ) : (
            <span className="truncate">
              <strong className="text-[#242424]">Mode Arus Kas Riil:</strong> Menghitung seluruh uang keluar dari rekening bank termasuk talangan teman yang belum diganti.
            </span>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className={`flex-1 overflow-y-auto bg-[#FAFAFA]/60 ${isMobile ? 'p-3.5 space-y-4' : 'p-6 space-y-5'}`}>
        {/* Top Editorial Comparison Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-[8px] border border-[#EBEBEB] p-4 shadow-2xs">
            <div className="text-[12px] font-medium text-[#616161]">
              Pendapatan Bersih (Nov 2026)
            </div>
            <div className="text-[20px] font-bold text-[#111827] tabular-nums tracking-tight mt-1">
              {formatIDR(novIncome, hideRp)}
            </div>
            <div className="text-[11px] text-[#707070] mt-1">Gaji + Bunga Bersih Tabungan</div>
          </div>

          <div className="bg-white rounded-[8px] border border-[#EBEBEB] p-4 shadow-2xs">
            <div className="text-[12px] font-medium text-[#616161]">
              {isPureConsumption ? 'Pengeluaran Konsumsi Murni' : 'Total Kas Keluar Riil'}
            </div>
            <div className="text-[20px] font-bold text-[#111827] tabular-nums tracking-tight mt-1">
              {formatIDR(displayedExpense, hideRp)}
            </div>
            <div className="text-[11px] text-[#707070] mt-1">
              {isPureConsumption
                ? 'Selisih -Rp 920.000 dari Kas Riil'
                : 'Termasuk Rp 470.000 talangan'}
            </div>
          </div>

          <div className="bg-white rounded-[8px] border border-[#EBEBEB] p-4 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-[#616161]">Surplus Tabungan</span>
              <span className="px-1.5 py-0.2 rounded-[4px] bg-[#E6F4EA] text-[#107C41] text-[10.5px] font-semibold">
                {formatPercent(savingsRate, false)}
              </span>
            </div>
            <div className="text-[20px] font-bold text-[#111827] tabular-nums tracking-tight mt-1">
              {formatIDR(displayedSurplus, hideRp)}
            </div>
            <div className="text-[11px] text-[#707070] mt-1">Di atas target ideal 45%</div>
          </div>

          <div className="bg-white rounded-[8px] border border-[#EBEBEB] p-4 shadow-2xs">
            <div className="text-[12px] font-medium text-[#616161]">
              Total Admin, Pajak &amp; Bunga
            </div>
            <div className="text-[20px] font-bold text-[#111827] tabular-nums tracking-tight mt-1">
              {formatIDR(totalLeaks, hideRp)}
            </div>
            <div className="text-[11px] text-[#D83B01] font-medium mt-1">
              6 komponen biaya terdeteksi
            </div>
          </div>
        </div>

        {/* TAB 1: IKHTISAR & TREN */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-7 bg-white rounded-[8px] border border-[#EBEBEB] overflow-hidden shadow-2xs">
              <div className="px-5 py-3.5 border-b border-[#F0F0F0] font-semibold text-[13.5px] text-[#111827]">
                Perbandingan Historis 6 Bulan: Konsumsi Murni vs Arus Kas Riil
              </div>
              <div className="p-5 space-y-3.5">
                {trendData.map((m) => {
                  const activeVal = isPureConsumption ? m.consumption : m.cashflowOut;
                  const pctOfIncome = m.income > 0 ? Math.round((activeVal / m.income) * 100) : 0;
                  return (
                    <div key={m.month} className="space-y-1.5">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="font-semibold text-[#111827] w-16">{m.month}</span>
                        <span className="text-[#616161]">
                          Konsumsi: <strong className="text-[#111827] tabular-nums">{formatIDR(m.consumption, hideRp)}</strong> · Kas Riil:{' '}
                          <strong className="text-[#111827] tabular-nums">{formatIDR(m.cashflowOut, hideRp)}</strong>
                        </span>
                        <span className="font-semibold text-[#0F6CBD] tabular-nums">
                          {pctOfIncome}%
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-[#F0F0F0] overflow-hidden flex">
                        <div
                          className="h-full bg-[#0F6CBD] transition-all"
                          style={{ width: `${Math.min(100, m.income > 0 ? Math.round((m.consumption / m.income) * 100) : 0)}%` }}
                        />
                        {!isPureConsumption && (
                          <div
                            className="h-full bg-[#D83B01] transition-all"
                            style={{
                              width: `${Math.max(
                                2,
                                m.income > 0 ? Math.round(((m.cashflowOut - m.consumption) / m.income) * 100) : 0
                              )}%`,
                            }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="lg:col-span-5 bg-white rounded-[8px] border border-[#EBEBEB] overflow-hidden shadow-2xs">
              <div className="px-5 py-3.5 border-b border-[#F0F0F0] font-semibold text-[13.5px] text-[#111827]">
                Jembatan Rekonsiliasi Kas vs Konsumsi
              </div>
              <div className="p-5 space-y-2.5 text-[13px]">
                <div className="flex justify-between py-1.5 border-b border-[#F3F2F1]">
                  <span className="text-[#616161]">Total Kas Keluar Rekening</span>
                  <span className="font-bold text-[#111827] tabular-nums">
                    {formatIDR(novRealCashOut, hideRp)}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#F3F2F1]">
                  <span className="text-[#616161]">
                    (−) Talangan Sate Senayan (Budi &amp; Siti)
                  </span>
                  <span className="font-medium text-[#107C41] tabular-nums">
                    -{formatIDR(300000, hideRp)}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#F3F2F1]">
                  <span className="text-[#616161]">
                    (−) Talangan Badminton (Dimas)
                  </span>
                  <span className="font-medium text-[#107C41] tabular-nums">
                    -{formatIDR(170000, hideRp)}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#F3F2F1]">
                  <span className="text-[#616161]">
                    (−) Pelunasan Pokok Cicilan Lama
                  </span>
                  <span className="font-medium text-[#107C41] tabular-nums">
                    -{formatIDR(450000, hideRp)}
                  </span>
                </div>
                <div className="pt-2 flex justify-between font-bold text-[14px] text-[#111827]">
                  <span>= Pengeluaran Konsumsi Murni</span>
                  <span className="tabular-nums">{formatIDR(novPureConsumption, hideRp)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: DISTRIBUSI KATEGORI & AKUN */}
        {activeTab === 'distribution' && (
          <div className="bg-white rounded-[8px] border border-[#EBEBEB] overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-[#FAFAFA] border-b border-[#F0F0F0] text-left text-[11px] font-semibold text-[#616161] uppercase tracking-wider">
                    <th className="py-2.5 px-4">Kategori Pengeluaran</th>
                    <th className="py-2.5 px-4">Kelompok</th>
                    <th className="py-2.5 px-4 text-right">Mode Konsumsi Murni</th>
                    <th className="py-2.5 px-4 text-right">Mode Arus Kas Riil</th>
                    <th className="py-2.5 px-4 text-right">Selisih Talangan / Top-Up</th>
                    <th className="py-2.5 px-4 text-right">Plafon Anggaran</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F0F0]">
                  {budgets.map((b) => {
                    const diff = b.usedCashflow - b.usedConsumption;
                    return (
                      <tr
                        key={b.id}
                        onClick={() => onSelectInspector({ kind: 'budget', data: b })}
                        className="hover:bg-[#F3F9FD] cursor-pointer"
                      >
                        <td className="py-2.5 px-4 font-semibold text-[#111827]">
                          {b.category}
                        </td>
                        <td className="py-2.5 px-4 text-[#616161]">{b.group}</td>
                        <td
                          className={`py-2.5 px-4 text-right tabular-nums ${
                            isPureConsumption ? 'font-bold text-[#111827]' : 'text-[#616161]'
                          }`}
                        >
                          {formatIDR(b.usedConsumption, hideRp)}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right tabular-nums ${
                            !isPureConsumption ? 'font-bold text-[#111827]' : 'text-[#616161]'
                          }`}
                        >
                          {formatIDR(b.usedCashflow, hideRp)}
                        </td>
                        <td className="py-2.5 px-4 text-right tabular-nums">
                          {diff > 0 ? (
                            <span className="px-2 py-0.5 rounded-[4px] bg-[#FFF4CE] text-[#D83B01] font-semibold text-[11px]">
                              +{formatIDR(diff, hideRp)}
                            </span>
                          ) : (
                            <span className="text-[#C8C6C4]">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right tabular-nums font-medium text-[#111827]">
                          {formatIDR(b.monthlyLimit, hideRp)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: AUDIT BIAYA ADMIN, PAJAK & BUNGA KREDIT */}
        {activeTab === 'audit_fees' && (
          <div className="bg-white rounded-[8px] border border-[#EBEBEB] overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-[#FAFAFA] border-b border-[#F0F0F0] text-left text-[11px] font-semibold text-[#616161] uppercase tracking-wider">
                    <th className="py-2.5 px-4">Sumber Kebocoran Biaya</th>
                    <th className="py-2.5 px-4">Kategori Beban</th>
                    <th className="py-2.5 px-4">Rekening / Fasilitas</th>
                    <th className="py-2.5 px-4 text-right">Nominal Beban</th>
                    <th className="py-2.5 px-4">Rekomendasi Optimasi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F0F0]">
                  {leakItems.map((item) => (
                    <tr key={item.id} className="hover:bg-[#F3F9FD]">
                      <td className="py-2.5 px-4 font-semibold text-[#111827]">
                        {item.name}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-[4px] bg-[#FFF4CE] text-[#D83B01] font-semibold text-[11px]">
                          {item.type}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap text-[#424242]">
                        {item.account}
                      </td>
                      <td className="py-2.5 px-4 text-right font-semibold text-[#C50F1F] tabular-nums whitespace-nowrap">
                        -{formatIDR(item.amount, hideRp)}
                      </td>
                      <td className="py-2.5 px-4 text-[12px] text-[#616161]">
                        {item.recommendation}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <ExcelStatusBar
        rowCount={activeTab === 'audit_fees' ? leakItems.length : budgets.length}
        totalIn={novIncome}
        totalOut={displayedExpense}
        hideRp={hideRp}
        extraLabel={`Basis: ${
          isPureConsumption ? 'Mode Konsumsi Murni' : 'Mode Arus Kas Riil'
        }`}
        isMobile={isMobile}
      />
    </div>
  );
};
