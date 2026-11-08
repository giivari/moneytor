import React, { useState } from 'react';
import {
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import {
  InspectorPayload,
  InvestmentHolding,
  InvestmentTransaction,
} from '../types/finance';
import { formatIDR, formatPercent } from '../utils/formatters';
import { ExcelStatusBar } from '../components/ExcelStatusBar';

interface PortofolioInvestasiPageProps {
  hideRp: boolean;
  isMobile?: boolean;
  holdings: InvestmentHolding[];
  history: InvestmentTransaction[];
  onSelectInspector: (payload: InspectorPayload) => void;
  selectedInspectorId?: string;
  onOpenNewTxModal: (
    preset?: 'Pengeluaran' | 'Pemasukan' | 'Transfer / Top-Up' | 'Split Bill' | 'Pelunasan'
  ) => void;
  onRefreshMarketPrices: () => void;
}

export const PortofolioInvestasiPage: React.FC<PortofolioInvestasiPageProps> = ({
  hideRp,
  isMobile = false,
  holdings,
  history,
  onSelectInspector,
  selectedInspectorId,
  onRefreshMarketPrices,
}) => {
  const [activeTab, setActiveTab] = useState<'holdings' | 'history' | 'market'>('holdings');
  const [syncNotice, setSyncNotice] = useState(false);

  const totalPrincipal = holdings.reduce((acc, h) => acc + h.principalValue, 0);
  const totalMarketValue = holdings.reduce((acc, h) => acc + h.marketValue, 0);
  const totalUnrealizedPL = totalMarketValue - totalPrincipal;
  const totalPLPct = totalPrincipal > 0 ? (totalUnrealizedPL / totalPrincipal) * 100 : 0;

  const tabs = [
    { id: 'holdings', label: `Posisi & Valuasi (Holdings)` },
    { id: 'history', label: `Riwayat Beli, Jual & Dividen` },
    { id: 'market', label: `Instrumen & Harga Pasar` },
  ] as const;

  return (
    <div className="flex flex-col h-full bg-[#FFFFFF] overflow-hidden">
      {/* Sleek Page Header + Fluent 2 Underline Pivot Tabs */}
      <div className={`bg-[#FFFFFF] border-b border-[#F0F0F0] ${isMobile ? 'px-4 pt-3' : 'px-6 pt-4'} shrink-0`}>
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-[18px] font-semibold text-[#111827] tracking-tight">
            Investasi
          </h1>
          {syncNotice && (
            <div className="px-3 py-1 rounded-[6px] bg-[#E6F4EA] text-[#107C41] text-[12px] font-medium flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              <span>Harga pasar BEI, NAB &amp; Spot BTC diperbarui.</span>
            </div>
          )}
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

      {/* Portfolio Action & Valuation Bar */}
      <div className={`h-[42px] bg-[#FFFFFF] border-b border-[#e1e6eb] ${isMobile ? 'px-4' : 'px-6'} flex items-center justify-between shrink-0`}>
        <div className="flex items-center gap-4 text-[12px] text-[#59636e]">
          <span>
            Nilai Pokok: <strong className="text-[#1f2328] tabular-nums">{formatIDR(totalPrincipal, hideRp)}</strong>
          </span>
          <span className="text-[#cbd5e1]">|</span>
          <span>
            Nilai Pasar: <strong className="text-[#1f2328] tabular-nums">{formatIDR(totalMarketValue, hideRp)}</strong>
          </span>
        </div>

        <button
          onClick={() => {
            onRefreshMarketPrices();
            setSyncNotice(true);
            setTimeout(() => setSyncNotice(false), 3000);
          }}
          className="finance-secondary h-[28px] px-2.5 flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5 text-[#0f6cbd]" />
          <span>Perbarui Harga Pasar</span>
        </button>
      </div>

      {/* Main Workspace */}
      <div className={`flex-1 overflow-y-auto bg-[#FAFAFA]/60 ${isMobile ? 'p-3.5 space-y-4' : 'p-6 space-y-5'}`}>
        {/* Portfolio KPI Summary Row (Editorial Charcoal Nominals) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-[8px] border border-[#EBEBEB] p-4 shadow-2xs">
            <div className="text-[12px] font-medium text-[#616161]">Modal Pokok Investasi</div>
            <div className="text-[21px] font-bold text-[#111827] tabular-nums tracking-tight mt-1">
              {formatIDR(totalPrincipal, hideRp)}
            </div>
            <div className="text-[11px] text-[#707070] mt-1">Akumulasi DCA &amp; Lump Sum</div>
          </div>
          <div className="bg-white rounded-[8px] border border-[#EBEBEB] p-4 shadow-2xs">
            <div className="text-[12px] font-medium text-[#616161]">Nilai Pasar Saat Ini</div>
            <div className="text-[21px] font-bold text-[#111827] tabular-nums tracking-tight mt-1">
              {formatIDR(totalMarketValue, hideRp)}
            </div>
            <div className="text-[11px] text-[#707070] mt-1">
              5 Instrumen (Bibit, Stockbit, Pintu)
            </div>
          </div>
          <div className="bg-white rounded-[8px] border border-[#EBEBEB] p-4 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-[#616161]">Unrealized Profit / Loss</span>
              <span
                className={`px-2 py-0.5 rounded-[4px] font-semibold text-[11px] tabular-nums ${
                  totalUnrealizedPL >= 0
                    ? 'bg-[#E6F4EA] text-[#107C41]'
                    : 'bg-[#FDE7E9] text-[#C50F1F]'
                }`}
              >
                {formatPercent(totalPLPct)}
              </span>
            </div>
            <div className="text-[21px] font-bold text-[#111827] tabular-nums tracking-tight mt-1">
              {totalUnrealizedPL >= 0 ? '+' : ''}
              {formatIDR(totalUnrealizedPL, hideRp)}
            </div>
            <div className="text-[11px] text-[#707070] mt-1">
              Belum termasuk dividen tunai BBCA
            </div>
          </div>
        </div>

        {/* TAB 1: POSISI & VALUASI (HOLDINGS) */}
        {activeTab === 'holdings' && (
          <div className="bg-[#FFFFFF] rounded-[8px] border border-[#EBEBEB] overflow-hidden shadow-2xs">
            {isMobile ? (
              <div className="divide-y divide-[#F0F0F0]">
                {holdings.map((h) => {
                  const isProfit = h.unrealizedPL >= 0;
                  return (
                    <div
                      key={h.id}
                      onClick={() => onSelectInspector({ kind: 'investment', data: h })}
                      className="p-3.5 hover:bg-[#F3F9FD] active:bg-[#EBF3FC] flex items-center justify-between gap-2.5 cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded-[4px] bg-[#F3EBF9] text-[#5C2E91] font-mono font-bold text-[10.5px]">
                            {h.code}
                          </span>
                          <span className="font-semibold text-[13px] text-[#111827] truncate">
                            {h.name}
                          </span>
                        </div>
                        <div className="text-[11.5px] text-[#616161] mt-0.5">
                          {h.units.toLocaleString('id-ID')} {h.unitLabel} · Avg {formatIDR(h.avgCostPrice, hideRp)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold text-[13px] text-[#111827] tabular-nums">
                          {formatIDR(h.marketValue, hideRp)}
                        </div>
                        <div
                          className={`text-[11px] font-semibold tabular-nums ${
                            isProfit ? 'text-[#107C41]' : 'text-[#C50F1F]'
                          }`}
                        >
                          {isProfit ? '+' : ''}
                          {formatIDR(h.unrealizedPL, hideRp)} ({formatPercent(h.unrealizedPLPercent)})
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="bg-[#FAFAFA] border-b border-[#F0F0F0] text-left text-[11px] font-semibold text-[#616161] uppercase tracking-wider">
                      <th className="py-2.5 px-4">Instrumen &amp; Platform</th>
                      <th className="py-2.5 px-4">Kelas Aset</th>
                      <th className="py-2.5 px-4 text-right">Unit</th>
                      <th className="py-2.5 px-4 text-right">Harga Rata-Rata (Avg Cost)</th>
                      <th className="py-2.5 px-4 text-right">Harga Pasar</th>
                      <th className="py-2.5 px-4 text-right">Nilai Pokok</th>
                      <th className="py-2.5 px-4 text-right">Nilai Pasar</th>
                      <th className="py-2.5 px-4 text-right">Unrealized P/L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0F0F0]">
                    {holdings.map((h) => {
                      const isSelected = selectedInspectorId === h.id;
                      const isProfit = h.unrealizedPL >= 0;
                      return (
                        <tr
                          key={h.id}
                          onClick={() => onSelectInspector({ kind: 'investment', data: h })}
                          className={`transition-colors cursor-pointer ${
                            isSelected ? 'bg-[#EBF3FC]' : 'hover:bg-[#F3F9FD]'
                          }`}
                        >
                          <td className="py-2.5 px-4">
                            <div className="flex items-center gap-2">
                              <span className="px-1.5 py-0.5 rounded-[4px] bg-[#F3EBF9] text-[#5C2E91] font-mono font-bold text-[11px]">
                                {h.code}
                              </span>
                              <span className="font-semibold text-[#111827]">{h.name}</span>
                            </div>
                            <div className="text-[11px] text-[#616161] mt-0.5">
                              {h.platform} · {h.lastUpdated}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded-[4px] bg-[#F3EBF9] text-[#5C2E91] font-semibold text-[11px]">
                              {h.assetClass}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums whitespace-nowrap font-medium text-[#111827]">
                            {h.units.toLocaleString('id-ID')} {h.unitLabel}
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums whitespace-nowrap text-[#424242]">
                            {formatIDR(h.avgCostPrice, hideRp)}
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums whitespace-nowrap text-[#424242]">
                            {formatIDR(h.marketPrice, hideRp)}
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums whitespace-nowrap text-[#424242]">
                            {formatIDR(h.principalValue, hideRp)}
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums whitespace-nowrap font-bold text-[#111827]">
                            {formatIDR(h.marketValue, hideRp)}
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] font-semibold text-[12px] ${
                                isProfit
                                  ? 'bg-[#E6F4EA] text-[#107C41]'
                                  : 'bg-[#FDE7E9] text-[#C50F1F]'
                              }`}
                            >
                              {isProfit ? '+' : ''}
                              {formatIDR(h.unrealizedPL, hideRp)} ({formatPercent(h.unrealizedPLPercent)})
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: RIWAYAT BELI, JUAL & DIVIDEN */}
        {activeTab === 'history' && (
          <div className="bg-[#FFFFFF] rounded-[8px] border border-[#EBEBEB] overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-[#FAFAFA] border-b border-[#F0F0F0] text-left text-[11px] font-semibold text-[#616161] uppercase tracking-wider">
                    <th className="py-2.5 px-4">Tanggal</th>
                    <th className="py-2.5 px-4">Instrumen</th>
                    <th className="py-2.5 px-4">Aksi</th>
                    <th className="py-2.5 px-4 text-right">Unit / Lot</th>
                    <th className="py-2.5 px-4 text-right">Harga Eksekusi</th>
                    <th className="py-2.5 px-4 text-right">Fee / Pajak</th>
                    <th className="py-2.5 px-4 text-right">Total Bersih</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F0F0]">
                  {history.map((item) => (
                    <tr key={item.id} className="hover:bg-[#F3F9FD]">
                      <td className="py-2.5 px-4 text-[#616161]">{item.date}</td>
                      <td className="py-2.5 px-4 font-semibold text-[#111827]">
                        {item.instrumentCode} — {item.instrumentName} ({item.platform})
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-[4px] font-semibold text-[11px] ${
                            item.action === 'Dividen Tunai'
                              ? 'bg-[#E6F4EA] text-[#107C41]'
                              : 'bg-[#F3EBF9] text-[#5C2E91]'
                          }`}
                        >
                          {item.action}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums">
                        {item.units.toLocaleString('id-ID')}
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-[#424242]">
                        {formatIDR(item.pricePerUnit, hideRp)}
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-[#D83B01]">
                        {formatIDR(item.feeAndTax, hideRp)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold tabular-nums text-[#111827]">
                        {formatIDR(item.netTotal, hideRp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: INSTRUMEN & HARGA PASAR */}
        {activeTab === 'market' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {holdings.map((h) => {
              const actualWeight = ((h.marketValue / totalMarketValue) * 100).toFixed(1);
              return (
                <div
                  key={h.id}
                  onClick={() => onSelectInspector({ kind: 'investment', data: h })}
                  className="p-4 rounded-[8px] bg-white border border-[#EBEBEB] hover:border-[#D1D1D1] cursor-pointer space-y-2 shadow-2xs"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-[14px] text-[#111827]">
                      {h.code} · {h.name}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-[4px] bg-[#F3EBF9] text-[#5C2E91] font-semibold">
                      Bobot {actualWeight}% (Target {h.allocationTargetPercent}%)
                    </span>
                  </div>
                  <div className="flex justify-between text-[12.5px] pt-1">
                    <span className="text-[#616161]">Harga Pasar ({h.lastUpdated})</span>
                    <span className="font-bold text-[#111827] tabular-nums">{formatIDR(h.marketPrice, hideRp)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ExcelStatusBar
        rowCount={holdings.length}
        totalIn={totalMarketValue}
        totalOut={totalPrincipal}
        hideRp={hideRp}
        customNetLabel="Total Unrealized P/L"
        customNetValue={totalUnrealizedPL}
        extraLabel={`Return: ${formatPercent(totalPLPct)}`}
        isMobile={isMobile}
      />
    </div>
  );
};
