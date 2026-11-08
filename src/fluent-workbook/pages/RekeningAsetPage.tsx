import React, { useState } from 'react';
import {
  Plus,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  X,
} from 'lucide-react';
import { AccountCategory, AssetAccount, InspectorPayload } from '../types/finance';
import { formatIDR } from '../utils/formatters';
import { ExcelStatusBar } from '../components/ExcelStatusBar';

interface RekeningAsetPageProps {
  hideRp: boolean;
  isMobile?: boolean;
  accounts: AssetAccount[];
  onSelectInspector: (payload: InspectorPayload) => void;
  selectedInspectorId?: string;
  onTopUpAccount: (targetAccName: string) => void;
  onOpenNewTxModal?: (
    preset?: 'Pengeluaran' | 'Pemasukan' | 'Transfer / Top-Up' | 'Split Bill' | 'Pelunasan'
  ) => void;
  onCreateAccount?: (data: {
    displayName: string;
    category: string;
    openingBalance: number;
    adminFee: number;
    interestRatePA: number;
  }) => Promise<void>;
}

export const RekeningAsetPage: React.FC<RekeningAsetPageProps> = ({
  hideRp,
  isMobile = false,
  accounts,
  onSelectInspector,
  selectedInspectorId,
  onTopUpAccount,
  onCreateAccount,
}) => {
  const [activeFilter, setActiveFilter] = useState<'all' | AccountCategory>('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newAccName, setNewAccName] = useState('');
  const [newAccCategory, setNewAccCategory] = useState('Kas & Rekening Bank');
  const [newAccOpeningBalance, setNewAccOpeningBalance] = useState('0');
  const [newAccAdminFee, setNewAccAdminFee] = useState('0');
  const [newAccInterestRate, setNewAccInterestRate] = useState('0');

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const visibleAccounts =
    activeFilter === 'all'
      ? accounts
      : accounts.filter((a) => a.category === activeFilter);

  const totalAllAssets = accounts.reduce((acc, a) => acc + a.balance, 0);
  const totalVisibleBalance = visibleAccounts.reduce((acc, a) => acc + a.balance, 0);
  const totalEstInterest = visibleAccounts.reduce(
    (acc, a) => acc + (a.estimatedNetInterestMonthly || 0),
    0
  );
  const totalMonthlyAdmin = visibleAccounts.reduce((acc, a) => acc + a.monthlyAdminFee, 0);

  const pivotTabs: { id: 'all' | AccountCategory; label: string }[] = [
    { id: 'all', label: 'Semua' },
    { id: 'kas_bank_ewallet', label: 'Kas & Rekening' },
    { id: 'tabungan_deposito', label: 'Tabungan & Deposito' },
    { id: 'emoney', label: 'Kartu E-Money' },
  ];

  const sectionGroups: {
    id: AccountCategory;
    title: string;
    items: AssetAccount[];
  }[] = [
    {
      id: 'kas_bank_ewallet',
      title: 'Kas, Bank Operasional & E-Wallet',
      items: accounts.filter((a) => a.category === 'kas_bank_ewallet'),
    },
    {
      id: 'tabungan_deposito',
      title: 'Tabungan Bunga Tinggi & Deposito',
      items: accounts.filter((a) => a.category === 'tabungan_deposito'),
    },
    {
      id: 'emoney',
      title: 'Kartu Prabayar E-Money (Chip NFC)',
      items: accounts.filter((a) => a.category === 'emoney'),
    },
  ];

  const filteredGroups =
    activeFilter === 'all'
      ? sectionGroups
      : sectionGroups.filter((g) => g.id === activeFilter);

  const getInitials = (name: string) => {
    const words = name.split(' ');
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const getShortAccNumber = (num: string) => {
    if (num.includes('••••')) {
      const parts = num.split('••••');
      return `•••• ${parts[parts.length - 1].trim()}`;
    }
    return num;
  };

  return (
    <div className="flex flex-col h-full bg-[#f3f5f8] overflow-hidden">
      {/* Command Ribbon + Focused/Other Underline Pivot Tabs (flex-wrap, no overflow) */}
      <div className="bg-[#ffffff] border-b border-[#e1e6eb] px-5 pt-3 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
          <div className="flex items-center gap-3">
            <h1 className="text-[16px] font-semibold text-[#1f2328] tracking-tight">
              Rekening &amp; Aset
            </h1>
            <span className="text-[12px] text-[#59636e] hidden sm:inline">
              Total Tercatat:{' '}
              <strong className="text-[#1f2328] tabular-nums">
                {formatIDR(totalAllAssets, hideRp)}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="button-primary h-[28px] px-2.5 flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Tambah Rekening</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (visibleAccounts[0]) {
                  onSelectInspector({ kind: 'account', data: visibleAccounts[0] });
                }
              }}
              className="finance-secondary h-[28px] px-2.5 flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-[#107c41]" />
              <span>Rekonsiliasi Saldo</span>
            </button>
          </div>
        </div>

        {/* Focused / Other Underline Pivot Tabs (flex-wrap: wrap, anti-overflow) */}
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
        {filteredGroups.map((group) => {
          const isCollapsed = !!collapsedGroups[group.id];
          const groupSubtotal = group.items.reduce((sum, a) => sum + a.balance, 0);

          return (
            <section
              key={group.id}
              className="bg-[#ffffff] rounded-[8px] border border-[#e1e6eb] shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden"
            >
              {/* Outlook Collapsible Group Header (v Akun & Nilai Tercatat) */}
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="w-full px-4 py-2.5 bg-[#f8fafc] border-b border-[#edf2f7] flex items-center justify-between text-left hover:bg-[#f0f6fc]/60 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  {isCollapsed ? (
                    <ChevronRight className="w-4 h-4 text-[#59636e]" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[#59636e]" />
                  )}
                  <span className="font-semibold text-[13px] text-[#1f2328]">
                    {group.title}
                  </span>
                  <span className="text-[11.5px] text-[#59636e]">
                    ({group.items.length} akun)
                  </span>
                </div>
                <span className="font-semibold text-[13px] text-[#1f2328] tabular-nums">
                  {formatIDR(groupSubtotal, hideRp)}
                </span>
              </button>

              {!isCollapsed && (
                <div className="divide-y divide-[#edf2f7]">
                  {group.items.map((acc) => {
                    const isSelected = selectedInspectorId === acc.id;
                    return (
                      <div
                        key={acc.id}
                        onClick={() => onSelectInspector({ kind: 'account', data: acc })}
                        className={`px-4 py-3 flex flex-wrap items-center justify-between gap-3 transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-[#f0f6fc] outline-1 outline-[#0f6cbd] -outline-offset-1'
                            : 'hover:bg-[#f0f6fc]'
                        }`}
                      >
                        {/* Left: Initial Avatar + Account Name & Institution */}
                        <div className="flex items-center gap-3 min-w-[200px]">
                          <div className="w-8 h-8 rounded-[6px] bg-[#eef2f6] text-[#0f6cbd] font-bold text-[11.5px] flex items-center justify-center shrink-0">
                            {getInitials(acc.name)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-[13.5px] text-[#1f2328]">
                                {acc.name}
                              </span>
                              <span className="text-[11px] font-mono text-[#59636e]">
                                {getShortAccNumber(acc.accountNumber)}
                              </span>
                            </div>
                            <div className="text-[11.5px] text-[#59636e]">
                              {acc.institution} · {acc.subtype}
                            </div>
                          </div>
                        </div>

                        {/* Middle: Parameter Info (Bunga / Admin / NFC Status) */}
                        <div className="hidden md:flex items-center gap-3 text-[12px] text-[#59636e]">
                          {acc.category === 'tabungan_deposito' ? (
                            <span>
                              Bunga {String(acc.interestRatePa).replace('.', ',')}% p.a. (Pajak{' '}
                              {acc.taxRate}%) ·{' '}
                              <strong className="text-[#107c41] tabular-nums">
                                +{formatIDR(acc.estimatedNetInterestMonthly || 0, hideRp)}/bln
                              </strong>
                            </span>
                          ) : acc.category === 'emoney' ? (
                            <span>{acc.lastReconciled}</span>
                          ) : (
                            <span>
                              {acc.monthlyAdminFee > 0
                                ? `Admin ${formatIDR(acc.monthlyAdminFee, hideRp)}/bln`
                                : 'Bebas biaya admin'}
                            </span>
                          )}
                        </div>

                        {/* Right: Balance + Quick Action */}
                        <div className="flex items-center gap-3 ml-auto">
                          <div className="text-right">
                            <div className="font-bold text-[14.5px] text-[#1f2328] tabular-nums">
                              {formatIDR(acc.balance, hideRp)}
                            </div>
                            <div className="text-[10.5px] text-[#59636e]">Saldo Tercatat</div>
                          </div>

                          {acc.category === 'emoney' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onTopUpAccount(acc.name);
                              }}
                              className="finance-secondary h-[26px] px-2.5 text-[11.5px] font-semibold text-[#0f6cbd] flex items-center gap-1 cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Top-Up</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <ExcelStatusBar
        rowCount={visibleAccounts.length}
        totalIn={totalEstInterest}
        totalOut={totalMonthlyAdmin}
        hideRp={hideRp}
        customNetLabel="Total Nilai Tercatat"
        customNetValue={totalVisibleBalance}
        isMobile={isMobile}
      />

      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-[10px] border border-[#d0d7de] shadow-2xl w-full max-w-[460px] overflow-hidden">
            <div className="h-[44px] px-4 bg-[#f3f5f8] border-b border-[#e1e6eb] flex items-center justify-between">
              <span className="font-semibold text-[13px] text-[#1f2328]">Tambah Rekening Baru</span>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="w-7 h-7 rounded-[4px] hover:bg-[#e2e8f0] flex items-center justify-center text-[#59636e] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newAccName.trim() || !onCreateAccount) return;
                setIsSubmitting(true);
                try {
                  await onCreateAccount({
                    displayName: newAccName.trim(),
                    category: newAccCategory,
                    openingBalance: Number(newAccOpeningBalance) || 0,
                    adminFee: Number(newAccAdminFee) || 0,
                    interestRatePA: Number(newAccInterestRate) || 0,
                  });
                  setIsAddModalOpen(false);
                  setNewAccName('');
                  setNewAccOpeningBalance('0');
                  setNewAccAdminFee('0');
                  setNewAccInterestRate('0');
                } finally {
                  setIsSubmitting(false);
                }
              }}
              className="p-4 space-y-3 text-[12.5px]"
            >
              <div>
                <label className="block text-[11.5px] font-semibold text-[#1f2328] mb-1">Nama Rekening / Akun</label>
                <input
                  type="text"
                  required
                  value={newAccName}
                  onChange={(e) => setNewAccName(e.target.value)}
                  placeholder="Contoh: BCA Payroll, GoPay, SeaBank"
                  className="w-full h-[32px] px-2.5 rounded-[6px] border border-[#d0d7de] focus:border-[#0f6cbd] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11.5px] font-semibold text-[#1f2328] mb-1">Kelompok Akun</label>
                <select
                  value={newAccCategory}
                  onChange={(e) => setNewAccCategory(e.target.value)}
                  className="w-full h-[32px] px-2.5 rounded-[6px] border border-[#d0d7de] bg-white focus:border-[#0f6cbd] focus:outline-none"
                >
                  <option value="Kas & Rekening Bank">Kas &amp; Rekening Bank</option>
                  <option value="Tabungan & Deposito">Tabungan &amp; Deposito</option>
                  <option value="Kartu E-Money">Kartu E-Money</option>
                  <option value="Kartu Kredit / PayLater">Kartu Kredit / PayLater</option>
                  <option value="Piutang">Piutang</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11.5px] font-semibold text-[#1f2328] mb-1">Saldo Awal (Rp)</label>
                  <input
                    type="number"
                    min="0"
                    value={newAccOpeningBalance}
                    onChange={(e) => setNewAccOpeningBalance(e.target.value)}
                    className="w-full h-[32px] px-2.5 rounded-[6px] border border-[#d0d7de] focus:border-[#0f6cbd] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11.5px] font-semibold text-[#1f2328] mb-1">Biaya Admin Bulanan (Rp)</label>
                  <input
                    type="number"
                    min="0"
                    value={newAccAdminFee}
                    onChange={(e) => setNewAccAdminFee(e.target.value)}
                    className="w-full h-[32px] px-2.5 rounded-[6px] border border-[#d0d7de] focus:border-[#0f6cbd] focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11.5px] font-semibold text-[#1f2328] mb-1">Bunga p.a. (%)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newAccInterestRate}
                  onChange={(e) => setNewAccInterestRate(e.target.value)}
                  placeholder="0.0"
                  className="w-full h-[32px] px-2.5 rounded-[6px] border border-[#d0d7de] focus:border-[#0f6cbd] focus:outline-none"
                />
              </div>
              <div className="pt-2 border-t border-[#e1e6eb] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="finance-secondary h-[32px] px-3 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !newAccName.trim()}
                  className="button-primary h-[32px] px-4 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Menyimpan...' : 'Simpan Rekening'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
