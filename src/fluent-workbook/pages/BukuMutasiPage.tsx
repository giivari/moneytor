import React, { useState } from 'react';
import {
  ArrowUpDown,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  Upload,
  ArrowRight,
} from 'lucide-react';
import {
  AssetAccount,
  AuditLogItem,
  AutomationItem,
  InspectorPayload,
  TransactionItem,
} from '../types/finance';
import { formatIDR } from '../utils/formatters';
import { downloadTransactionsCsv } from '../utils/exportCsv';
import { ExcelStatusBar } from '../components/ExcelStatusBar';

interface BukuMutasiPageProps {
  hideRp: boolean;
  isMobile?: boolean;
  transactions: TransactionItem[];
  accounts: AssetAccount[];
  automations: AutomationItem[];
  auditLogs: AuditLogItem[];
  onSelectInspector: (payload: InspectorPayload) => void;
  selectedInspectorId?: string;
  onOpenNewTxModal: (
    preset?: 'Pengeluaran' | 'Pemasukan' | 'Transfer / Top-Up' | 'Split Bill' | 'Pelunasan'
  ) => void;
  onConfirmAutomation: (autoId: string) => void;
  onSkipAutomation: (autoId: string) => void;
  onImportSampleTxs: () => void;
}

export const BukuMutasiPage: React.FC<BukuMutasiPageProps> = ({
  hideRp,
  isMobile = false,
  transactions,
  accounts,
  automations,
  auditLogs,
  onSelectInspector,
  selectedInspectorId,
  onConfirmAutomation,
  onSkipAutomation,
  onImportSampleTxs,
}) => {
  const [activeTab, setActiveTab] = useState<'semua' | 'otomatisasi' | 'impor' | 'audit'>('semua');
  const [accountFilter, setAccountFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [sortField, setSortField] = useState<'date' | 'amount'>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const filteredTxs = transactions
    .filter((t) => {
      if (accountFilter !== 'ALL') {
        const matchSource = t.sourceAccount.toLowerCase().includes(accountFilter.toLowerCase());
        const matchTarget = t.targetAccount?.toLowerCase().includes(accountFilter.toLowerCase());
        if (!matchSource && !matchTarget) return false;
      }
      if (typeFilter !== 'ALL' && t.type !== typeFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortField === 'amount') {
        return sortAsc ? a.totalMutation - b.totalMutation : b.totalMutation - a.totalMutation;
      }
      return sortAsc ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
    });

  const totalIn = filteredTxs
    .filter((t) => t.direction === 'in' && !t.isVoided)
    .reduce((acc, t) => acc + t.totalMutation, 0);

  const totalOut = filteredTxs
    .filter((t) => t.direction === 'out' && !t.isVoided)
    .reduce((acc, t) => acc + t.totalMutation, 0);

  const totalAdmin = filteredTxs
    .filter((t) => !t.isVoided)
    .reduce((acc, t) => acc + t.adminFee, 0);

  const getTypeBadge = (type: TransactionItem['type']) => {
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

  const workbookTabs = [
    { id: 'semua', label: `Semua Mutasi` },
    { id: 'otomatisasi', label: `Otomatisasi & Jadwal` },
    { id: 'impor', label: `Impor CSV / Excel` },
    { id: 'audit', label: `Riwayat Koreksi & Void` },
  ] as const;

  return (
    <div className="flex flex-col h-full bg-[#FFFFFF] overflow-hidden">
      {/* Sleek Page Header + Fluent 2 Underline Pivot Tabs */}
      <div className={`bg-[#FFFFFF] border-b border-[#F0F0F0] ${isMobile ? 'px-4 pt-3' : 'px-6 pt-4'} shrink-0`}>
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-[18px] font-semibold text-[#111827] tracking-tight">
            Buku Mutasi
          </h1>
          {toastMsg && (
            <div className="px-2.5 py-1 rounded-[6px] bg-[#E6F4EA] text-[#107C41] text-[11.5px] font-medium flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{toastMsg}</span>
            </div>
          )}
        </div>

        {isMobile ? (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2.5 pt-1 no-scrollbar">
            {workbookTabs.map((tab) => {
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
            {workbookTabs.map((tab) => {
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

      {/* Page-Specific Filter & Export Bar (No Duplicate Transaction Creation Buttons) */}
      <div className={`h-[42px] bg-[#FFFFFF] border-b border-[#e1e6eb] ${isMobile ? 'px-4' : 'px-6'} flex items-center justify-between gap-2 shrink-0 overflow-x-auto`}>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[12px] text-[#59636e] hidden sm:inline">Filter:</span>
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="h-[28px] px-2.5 rounded-[6px] bg-white border border-[#d0d7de] text-[#1f2328] text-[12px] font-medium focus:outline-none focus:border-[#0f6cbd]"
          >
            <option value="ALL">Semua Akun</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.name}>
                {a.name}
              </option>
            ))}
            <option value="SPayLater">SPayLater</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-[30px] px-2.5 rounded-[6px] bg-white border border-[#E5E5E5] text-[#242424] text-[12px] font-medium focus:outline-none focus:border-[#0F6CBD]"
          >
            <option value="ALL">Semua Jenis</option>
            <option value="Pemasukan">Pemasukan</option>
            <option value="Pengeluaran">Pengeluaran</option>
            <option value="Split Bill">Split Bill</option>
            <option value="Transfer / Top-Up">Transfer / Top-Up</option>
            <option value="Bayar Kredit">Bayar Kredit</option>
            <option value="Investasi">Investasi</option>
            <option value="Bunga & Pajak">Bunga &amp; Pajak</option>
          </select>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => {
              if (sortField === 'date') setSortField('amount');
              else {
                setSortField('date');
                setSortAsc(!sortAsc);
              }
            }}
            className="h-[30px] px-3 rounded-[6px] bg-white hover:bg-[#FAFAFA] text-[#242424] border border-[#E5E5E5] font-medium text-[12px] flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-[#616161]" />
            <span>{sortField === 'date' ? 'Terbaru' : 'Nominal'}</span>
          </button>

          <button
            onClick={() => {
              downloadTransactionsCsv(filteredTxs);
              triggerToast('Berkas CSV Buku Mutasi berhasil diunduh.');
            }}
            className="h-[30px] px-3 rounded-[6px] bg-white hover:bg-[#FAFAFA] text-[#242424] border border-[#E5E5E5] font-medium text-[12px] flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#107C41]" />
            <span>Ekspor .CSV</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className={`flex-1 overflow-auto bg-[#FAFAFA]/60 ${isMobile ? 'p-3' : 'p-6'}`}>
        {activeTab === 'semua' && (
          <div className="bg-[#FFFFFF] rounded-[8px] border border-[#EBEBEB] overflow-hidden shadow-2xs">
            {isMobile ? (
              <div className="divide-y divide-[#F0F0F0]">
                {filteredTxs.map((tx) => {
                  const isSelected = selectedInspectorId === tx.id;
                  return (
                    <div
                      key={tx.id}
                      onClick={() => onSelectInspector({ kind: 'transaction', data: tx })}
                      className={`p-3.5 flex items-center justify-between gap-2.5 cursor-pointer transition-colors ${
                        tx.isVoided
                          ? 'opacity-50 line-through bg-[#FAFAFA]'
                          : isSelected
                          ? 'bg-[#EBF3FC]'
                          : 'hover:bg-[#F3F9FD] active:bg-[#EBF3FC]'
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-[4px] ${getTypeBadge(
                              tx.type
                            )}`}
                          >
                            {tx.type}
                          </span>
                          <span className="text-[11px] text-[#616161]">
                            {tx.date} · {tx.time}
                          </span>
                        </div>
                        <div className="font-medium text-[13px] text-[#111827] truncate">
                          {tx.note}
                        </div>
                        <div className="text-[11.5px] text-[#616161] truncate">
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
                        {tx.adminFee > 0 && (
                          <div className="text-[10.5px] text-[#D83B01] tabular-nums">
                            Admin {formatIDR(tx.adminFee, hideRp)}
                          </div>
                        )}
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
                      <th className="py-2.5 px-4 whitespace-nowrap">Tanggal &amp; Waktu</th>
                      <th className="py-2.5 px-4">Jenis</th>
                      <th className="py-2.5 px-4">Akun Sumber → Tujuan</th>
                      <th className="py-2.5 px-4">Kategori</th>
                      <th className="py-2.5 px-4">Catatan / Keterangan</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Nominal Pokok</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Biaya Admin</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Total Mutasi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0F0F0]">
                    {filteredTxs.map((tx) => {
                      const isSelected = selectedInspectorId === tx.id;
                      return (
                        <tr
                          key={tx.id}
                          onClick={() => onSelectInspector({ kind: 'transaction', data: tx })}
                          className={`transition-colors cursor-pointer ${
                            tx.isVoided
                              ? 'bg-[#FAFAFA] opacity-60 line-through'
                              : isSelected
                              ? 'bg-[#EBF3FC]'
                              : 'hover:bg-[#F3F9FD]'
                          }`}
                        >
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <div className="font-medium text-[#111827]">{tx.date}</div>
                            <div className="text-[11px] text-[#707070]">
                              {tx.time} · {tx.refCode}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <span
                              className={`inline-block px-2 py-0.5 text-[11px] font-semibold rounded-[4px] ${getTypeBadge(
                                tx.type
                              )}`}
                            >
                              {tx.type}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 font-medium text-[#111827] text-[12.5px]">
                              <span>{tx.sourceAccount}</span>
                              {tx.targetAccount && (
                                <>
                                  <ArrowRight className="w-3.5 h-3.5 text-[#707070] shrink-0" />
                                  <span className="text-[#424242]">{tx.targetAccount}</span>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap text-[12.5px] text-[#616161]">
                            {tx.category}
                          </td>
                          <td className="py-2.5 px-4 max-w-[280px]">
                            <div className="text-[#242424] truncate">{tx.note}</div>
                            {tx.correctionHistory && tx.correctionHistory.length > 0 && (
                              <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.2 rounded-[4px] bg-[#FFF4CE] text-[#D83B01] font-semibold">
                                Dikoreksi ({tx.correctionHistory.length}x)
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums whitespace-nowrap text-[#424242]">
                            {formatIDR(tx.principalAmount, hideRp)}
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums whitespace-nowrap">
                            {tx.adminFee > 0 ? (
                              <span className="text-[#D83B01] font-medium text-[12px]">
                                {formatIDR(tx.adminFee, hideRp)}
                              </span>
                            ) : (
                              <span className="text-[#C8C6C4]">—</span>
                            )}
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
        )}

        {activeTab === 'otomatisasi' && (
          <div className="bg-[#FFFFFF] rounded-[8px] border border-[#EBEBEB] overflow-hidden shadow-2xs divide-y divide-[#F0F0F0]">
            {automations.map((auto) => (
              <div
                key={auto.id}
                className="p-4 hover:bg-[#F3F9FD] flex flex-wrap items-center justify-between gap-3"
              >
                <div className="space-y-0.5 max-w-[540px]">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-[4px] bg-[#EBF3FC] text-[#0F6CBD] font-semibold text-[10.5px]">
                      {auto.type}
                    </span>
                    <span className="font-semibold text-[13.5px] text-[#111827]">{auto.title}</span>
                  </div>
                  <div className="text-[12px] text-[#616161]">
                    {auto.sourceAccount} → {auto.targetAccount} · {auto.scheduleLabel}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="font-bold text-[14px] text-[#111827] tabular-nums">
                      {formatIDR(auto.amount, hideRp)}
                    </div>
                    {auto.adminFee > 0 && (
                      <div className="text-[11px] text-[#D83B01] tabular-nums">
                        Admin/Pajak: {formatIDR(auto.adminFee, hideRp)}
                      </div>
                    )}
                  </div>

                  {auto.status === 'Perlu Konfirmasi' ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onConfirmAutomation(auto.id)}
                        className="px-3 py-1.5 rounded-[6px] bg-[#0F6CBD] text-white font-semibold text-[11.5px] cursor-pointer"
                      >
                        Konfirmasi
                      </button>
                      <button
                        onClick={() => onSkipAutomation(auto.id)}
                        className="px-2.5 py-1.5 rounded-[6px] border border-[#E0E0E0] bg-white text-[#616161] text-[11.5px] cursor-pointer"
                      >
                        Lewati
                      </button>
                    </div>
                  ) : (
                    <span className="px-2.5 py-1 rounded-[4px] bg-[#E6F4EA] text-[#107C41] font-semibold text-[11px]">
                      {auto.status}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'impor' && (
          <div className="bg-[#FFFFFF] rounded-[8px] border border-[#EBEBEB] p-5 space-y-4 shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F0F0F0] pb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-[8px] bg-[#E6F4EA] text-[#107C41] flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-semibold text-[14px] text-[#111827]">
                    Impor e-Statement CSV / Excel (BCA, Mandiri, GoPay)
                  </h2>
                  <p className="text-[12px] text-[#616161]">
                    Deteksi otomatis biaya admin BI-FAST &amp; pemetaan kategori belanja.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  onImportSampleTxs();
                  setActiveTab('semua');
                  triggerToast('2 baris e-Statement BCA berhasil diimpor ke Buku Mutasi.');
                }}
                className="h-[32px] px-4 rounded-[6px] bg-[#0F6CBD] hover:bg-[#115EA3] text-white font-semibold text-[12px] flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Impor 2 Baris Pratinjau</span>
              </button>
            </div>

            <div className="divide-y divide-[#F0F0F0] border border-[#EBEBEB] rounded-[6px]">
              <div className="p-3.5 flex items-center justify-between">
                <div>
                  <div className="text-[12.5px] font-semibold text-[#111827]">
                    13 Nov 2026 · QRIS-SHELL RADIO DALAM JKT
                  </div>
                  <div className="text-[11.5px] text-[#616161]">
                    Kategori: Transportasi &amp; BBM (BCA Tahapan → Shell Indonesia)
                  </div>
                </div>
                <div className="font-semibold text-[#C50F1F] tabular-nums">
                  -{formatIDR(310000, hideRp)}
                </div>
              </div>
              <div className="p-3.5 flex items-center justify-between">
                <div>
                  <div className="text-[12.5px] font-semibold text-[#111827]">
                    13 Nov 2026 · TRSF E-BANKING DB BI-FAST KE SEABANK
                  </div>
                  <div className="text-[11.5px] text-[#616161]">
                    Kategori: Transfer (Pokok Rp 1.000.000 + Admin Rp 2.500)
                  </div>
                </div>
                <div className="font-semibold text-[#111827] tabular-nums">
                  {formatIDR(1002500, hideRp)}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="bg-[#FFFFFF] rounded-[8px] border border-[#EBEBEB] overflow-hidden shadow-2xs divide-y divide-[#F0F0F0]">
            {auditLogs.map((log) => (
              <div key={log.id} className="p-4 hover:bg-[#F3F9FD] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11.5px] text-[#616161]">
                    {log.txRefCode} · {log.timestamp}
                  </span>
                  <span className="px-2 py-0.5 rounded-[4px] bg-[#FFF4CE] text-[#D83B01] font-semibold text-[10.5px]">
                    {log.actionType}
                  </span>
                </div>
                <div className="font-semibold text-[13px] text-[#111827]">
                  {log.accountAffected}:{' '}
                  <span className="line-through text-[#707070] font-normal">
                    {formatIDR(log.previousValue, hideRp)}
                  </span>{' '}
                  → <span className="text-[#107C41]">{formatIDR(log.newValue, hideRp)}</span>
                </div>
                <div className="text-[12px] text-[#616161]">{log.reason}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ExcelStatusBar
        rowCount={filteredTxs.length}
        totalIn={totalIn}
        totalOut={totalOut}
        hideRp={hideRp}
        extraLabel={`Total Biaya Admin: ${formatIDR(totalAdmin, hideRp)}`}
        isMobile={isMobile}
      />
    </div>
  );
};
