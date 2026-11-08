import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import {
  Search,
  Eye,
  EyeOff,
  Plus,
  Wallet,
  Users,
  CreditCard,
  X,
  ChevronDown,
  Monitor,
  Smartphone,
  HelpCircle,
  CheckCircle2,
} from 'lucide-react';
import {
  AssetAccount,
  CreditFacility,
  InspectorPayload,
  NavPageId,
  SplitBillSession,
  TransactionItem,
} from '../types/finance';
import { formatIDR } from '../utils/formatters';

interface TopHeaderProps {
  activePage: NavPageId;
  hideRp: boolean;
  onToggleHideRp: () => void;
  viewportMode: 'desktop' | 'mobile';
  onChangeViewportMode: (mode: 'desktop' | 'mobile') => void;
  onOpenNewTxModal: (
    presetType?: 'Pengeluaran' | 'Pemasukan' | 'Transfer / Top-Up' | 'Split Bill' | 'Pelunasan'
  ) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  transactions: TransactionItem[];
  accounts: AssetAccount[];
  splitBills: SplitBillSession[];
  creditFacilities: CreditFacility[];
  onSelectInspector: (payload: InspectorPayload) => void;
  onNavigate: (page: NavPageId) => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  hideRp,
  onToggleHideRp,
  viewportMode,
  onChangeViewportMode,
  onOpenNewTxModal,
  searchQuery,
  onSearchChange,
  transactions,
  accounts,
  splitBills,
  creditFacilities,
  onSelectInspector,
  onNavigate,
}) => {
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isSplitDropdownOpen, setIsSplitDropdownOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const splitBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchFocused(false);
      }
      if (splitBtnRef.current && !splitBtnRef.current.contains(e.target as Node)) {
        setIsSplitDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const q = searchQuery.trim().toLowerCase();
  const matchedTxs = q
    ? transactions
        .filter(
          (t) =>
            t.note.toLowerCase().includes(q) ||
            t.category.toLowerCase().includes(q) ||
            t.sourceAccount.toLowerCase().includes(q) ||
            (t.targetAccount && t.targetAccount.toLowerCase().includes(q)) ||
            t.refCode.toLowerCase().includes(q)
        )
        .slice(0, 4)
    : [];

  const matchedAccounts = q
    ? accounts.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.institution.toLowerCase().includes(q) ||
          a.accountNumber.toLowerCase().includes(q)
      )
    : [];

  const matchedSplits = q
    ? splitBills.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.participants.some((p) => p.name.toLowerCase().includes(q))
      )
    : [];

  const matchedCredits = q
    ? creditFacilities.filter(
        (c) => c.name.toLowerCase().includes(q) || c.provider.toLowerCase().includes(q)
      )
    : [];

  const hasResults =
    matchedTxs.length > 0 ||
    matchedAccounts.length > 0 ||
    matchedSplits.length > 0 ||
    matchedCredits.length > 0;

  return (
    <>
      <header
        data-area="site-header"
        className="site-header h-[48px] bg-[#eef2f6] border-b border-[#dde3ea] px-4 flex items-center justify-between gap-4 shrink-0 z-30 select-none"
      >
        {/* 1. Left: Brand Identity Only (No Duplicate Module Links) */}
        <div
          onClick={() => onNavigate('home')}
          className="flex items-center gap-2.5 cursor-pointer shrink-0"
        >
          <Image
            src="/icon.png"
            alt="moneytor"
            width={28}
            height={28}
            className="w-7 h-7 rounded-[6px] object-cover shadow-2xs"
            priority
          />
          <span className="font-bold text-[15px] text-[#1f2328] tracking-tight">
            moneytor
          </span>
        </div>

        {/* 2. Center: Clean White Microsoft 365 Search Bar */}
        <div ref={searchContainerRef} className="relative flex-1 max-w-[440px]">
          <div
            className={`flex items-center h-[32px] px-3 rounded-[6px] bg-[#ffffff] border shadow-2xs transition-all ${
              isSearchFocused
                ? 'border-[#0f6cbd] ring-2 ring-[#0f6cbd]/15'
                : 'border-[#d0d7de] hover:border-[#94a3b8]'
            }`}
          >
            <Search className="w-3.5 h-3.5 text-[#59636e] mr-2 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onFocus={() => setIsSearchFocused(true)}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Cari transaksi, rekening, atau teman split bill..."
              className="w-full bg-transparent text-[12.5px] text-[#1f2328] placeholder-[#59636e] focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="text-[#59636e] hover:text-[#1f2328] p-0.5 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Instant Search Dropdown */}
          {isSearchFocused && q.length > 0 && (
            <div className="absolute left-0 right-0 top-[36px] bg-white border border-[#e1e6eb] rounded-[8px] shadow-xl overflow-hidden z-50 max-h-[380px] overflow-y-auto">
              <div className="px-3.5 py-2 bg-[#f8fafc] border-b border-[#edf2f7] flex items-center justify-between text-[11px] text-[#59636e]">
                <span>Hasil Pencarian &quot;{searchQuery}&quot;</span>
                <span>Klik item untuk buka Inspector</span>
              </div>

              {!hasResults ? (
                <div className="p-4 text-center text-[#59636e] text-[12px]">
                  Tidak ditemukan hasil yang cocok.
                </div>
              ) : (
                <div className="divide-y divide-[#edf2f7]">
                  {matchedAccounts.length > 0 && (
                    <div className="p-1.5">
                      <div className="px-2.5 py-1 text-[10.5px] font-semibold text-[#59636e] uppercase tracking-wider">
                        Rekening &amp; Aset ({matchedAccounts.length})
                      </div>
                      {matchedAccounts.map((acc) => (
                        <button
                          key={acc.id}
                          onClick={() => {
                            onNavigate('rekening');
                            onSelectInspector({ kind: 'account', data: acc });
                            setIsSearchFocused(false);
                          }}
                          className="w-full px-2.5 py-1.5 rounded-[6px] hover:bg-[#f0f6fc] flex items-center justify-between text-left cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Wallet className="w-3.5 h-3.5 text-[#0f6cbd]" />
                            <div>
                              <div className="font-medium text-[#1f2328]">{acc.name}</div>
                              <div className="text-[11px] text-[#59636e]">{acc.institution}</div>
                            </div>
                          </div>
                          <span className="font-semibold tabular-nums text-[#1f2328]">
                            {formatIDR(acc.balance, hideRp)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {matchedSplits.length > 0 && (
                    <div className="p-1.5">
                      <div className="px-2.5 py-1 text-[10.5px] font-semibold text-[#59636e] uppercase tracking-wider">
                        Split Bill &amp; Piutang ({matchedSplits.length})
                      </div>
                      {matchedSplits.map((sb) => (
                        <button
                          key={sb.id}
                          onClick={() => {
                            onNavigate('kredit');
                            onSelectInspector({ kind: 'splitbill', data: sb });
                            setIsSearchFocused(false);
                          }}
                          className="w-full px-2.5 py-1.5 rounded-[6px] hover:bg-[#f0f6fc] flex items-center justify-between text-left cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Users className="w-3.5 h-3.5 text-[#d83b01]" />
                            <div>
                              <div className="font-medium text-[#1f2328]">{sb.title}</div>
                              <div className="text-[11px] text-[#59636e]">
                                Teman: {sb.participants.map((p) => p.name).join(', ')}
                              </div>
                            </div>
                          </div>
                          <span className="font-semibold tabular-nums text-[#1f2328]">
                            {formatIDR(sb.totalReceipt, hideRp)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {matchedCredits.length > 0 && (
                    <div className="p-1.5">
                      <div className="px-2.5 py-1 text-[10.5px] font-semibold text-[#59636e] uppercase tracking-wider">
                        Fasilitas Kredit ({matchedCredits.length})
                      </div>
                      {matchedCredits.map((cr) => (
                        <button
                          key={cr.id}
                          onClick={() => {
                            onNavigate('kredit');
                            onSelectInspector({ kind: 'credit', data: cr });
                            setIsSearchFocused(false);
                          }}
                          className="w-full px-2.5 py-1.5 rounded-[6px] hover:bg-[#f0f6fc] flex items-center justify-between text-left cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <CreditCard className="w-3.5 h-3.5 text-[#c50f1f]" />
                            <div className="font-medium text-[#1f2328]">{cr.name}</div>
                          </div>
                          <span className="font-semibold tabular-nums text-[#c50f1f]">
                            {formatIDR(cr.currentPeriodBill, hideRp)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {matchedTxs.length > 0 && (
                    <div className="p-1.5">
                      <div className="px-2.5 py-1 text-[10.5px] font-semibold text-[#59636e] uppercase tracking-wider">
                        Buku Mutasi ({matchedTxs.length})
                      </div>
                      {matchedTxs.map((tx) => (
                        <button
                          key={tx.id}
                          onClick={() => {
                            onNavigate('mutasi');
                            onSelectInspector({ kind: 'transaction', data: tx });
                            setIsSearchFocused(false);
                          }}
                          className="w-full px-2.5 py-1.5 rounded-[6px] hover:bg-[#f0f6fc] flex items-center justify-between text-left cursor-pointer"
                        >
                          <div className="min-w-0 pr-3">
                            <div className="font-medium text-[#1f2328] truncate">{tx.note}</div>
                            <div className="text-[11px] text-[#59636e]">
                              {tx.date} · {tx.sourceAccount}
                            </div>
                          </div>
                          <span className="font-semibold tabular-nums shrink-0 text-[#1f2328]">
                            {formatIDR(tx.totalMutation, hideRp)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3. Right Actions: Desktop/Mobile Toggle, Privacy Toggle, Panduan, [+ Transaksi baru] */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Desktop / Mobile Switcher */}
          <div className="flex items-center p-0.5 rounded-[6px] bg-[#dde3ea]/80 border border-[#cbd5e1]">
            <button
              type="button"
              onClick={() => onChangeViewportMode('desktop')}
              title="Mode Layar: Desktop (1440px)"
              className={`h-[26px] px-2 rounded-[4px] text-[11.5px] font-medium flex items-center gap-1 transition-all cursor-pointer ${
                viewportMode === 'desktop'
                  ? 'bg-[#ffffff] text-[#0f6cbd] font-semibold shadow-2xs'
                  : 'text-[#59636e] hover:text-[#1f2328]'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Desktop</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeViewportMode('mobile')}
              title="Mode Layar: Mobile (390px)"
              className={`h-[26px] px-2 rounded-[4px] text-[11.5px] font-medium flex items-center gap-1 transition-all cursor-pointer ${
                viewportMode === 'mobile'
                  ? 'bg-[#ffffff] text-[#0f6cbd] font-semibold shadow-2xs'
                  : 'text-[#59636e] hover:text-[#1f2328]'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Mobile</span>
            </button>
          </div>

          {/* Privacy Amount Toggle */}
          <button
            onClick={onToggleHideRp}
            className={`h-[30px] px-2.5 rounded-[6px] border text-[12px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              hideRp
                ? 'bg-[#fff4ce] border-[#d83b01]/35 text-[#d83b01]'
                : 'finance-secondary'
            }`}
            title="Sembunyikan atau tampilkan nominal Rupiah"
          >
            {hideRp ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{hideRp ? 'Tampilkan Rp' : 'Privasi Rp'}</span>
          </button>

          {/* Panduan (Feature Onboarding) */}
          <button
            onClick={() => setIsGuideOpen(true)}
            className="finance-secondary h-[30px] px-2.5 flex items-center gap-1.5 cursor-pointer"
            title="Panduan Singkat Fitur moneytor"
          >
            <HelpCircle className="w-3.5 h-3.5 text-[#0f6cbd]" />
            <span className="hidden md:inline">Panduan</span>
          </button>

          {/* Outlook "New mail" Style Primary Split Button: [+ Transaksi baru | v] */}
          <div ref={splitBtnRef} className="relative flex items-center">
            <button
              onClick={() => onOpenNewTxModal('Pengeluaran')}
              className="button-primary h-[30px] px-3 rounded-l-[6px] rounded-r-none flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Transaksi baru</span>
            </button>
            <button
              onClick={() => setIsSplitDropdownOpen(!isSplitDropdownOpen)}
              className="button-primary h-[30px] px-1.5 rounded-r-[6px] rounded-l-none border-l border-white/25 flex items-center justify-center cursor-pointer shadow-2xs"
              title="Pilih skenario transaksi"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {isSplitDropdownOpen && (
              <div className="absolute right-0 top-[36px] w-[250px] bg-white border border-[#e1e6eb] rounded-[8px] shadow-xl py-1.5 z-50 text-[12px]">
                <div className="px-3.5 py-1 text-[10.5px] font-semibold text-[#59636e] uppercase tracking-wider">
                  Pilih Skenario (5 Tab)
                </div>
                <button
                  onClick={() => {
                    setIsSplitDropdownOpen(false);
                    onOpenNewTxModal('Pengeluaran');
                  }}
                  className="w-full px-3.5 py-1.5 hover:bg-[#f0f6fc] flex items-center justify-between text-left cursor-pointer"
                >
                  <span className="font-medium text-[#1f2328]">1. Pengeluaran &amp; Kredit</span>
                  <span className="text-[10.5px] text-[#59636e]">Tab 1</span>
                </button>
                <button
                  onClick={() => {
                    setIsSplitDropdownOpen(false);
                    onOpenNewTxModal('Transfer / Top-Up');
                  }}
                  className="w-full px-3.5 py-1.5 hover:bg-[#f0f6fc] flex items-center justify-between text-left cursor-pointer"
                >
                  <span className="font-medium text-[#1f2328]">2. Top-Up &amp; Transfer</span>
                  <span className="text-[10.5px] text-[#59636e]">Tab 2</span>
                </button>
                <button
                  onClick={() => {
                    setIsSplitDropdownOpen(false);
                    onOpenNewTxModal('Split Bill');
                  }}
                  className="w-full px-3.5 py-1.5 hover:bg-[#f0f6fc] flex items-center justify-between text-left cursor-pointer"
                >
                  <span className="font-medium text-[#1f2328]">3. Split Bill / Talangan</span>
                  <span className="text-[10.5px] text-[#59636e]">Tab 3</span>
                </button>
                <button
                  onClick={() => {
                    setIsSplitDropdownOpen(false);
                    onOpenNewTxModal('Pemasukan');
                  }}
                  className="w-full px-3.5 py-1.5 hover:bg-[#f0f6fc] flex items-center justify-between text-left cursor-pointer"
                >
                  <span className="font-medium text-[#1f2328]">4. Pemasukan &amp; Refund</span>
                  <span className="text-[10.5px] text-[#59636e]">Tab 4</span>
                </button>
                <button
                  onClick={() => {
                    setIsSplitDropdownOpen(false);
                    onOpenNewTxModal('Pelunasan');
                  }}
                  className="w-full px-3.5 py-1.5 hover:bg-[#f0f6fc] flex items-center justify-between text-left cursor-pointer"
                >
                  <span className="font-medium text-[#1f2328]">5. Bayar Tagihan / Ganti</span>
                  <span className="text-[10.5px] text-[#59636e]">Tab 5</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Panduan (Feature Onboarding) Modal */}
      {isGuideOpen && (
        <div
          onClick={() => setIsGuideOpen(false)}
          className="fixed inset-0 bg-black/35 z-50 flex items-center justify-center p-4 select-none"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[540px] bg-white rounded-[10px] border border-[#e1e6eb] shadow-2xl overflow-hidden"
          >
            <div className="h-[48px] px-5 bg-[#f8fafc] border-b border-[#e1e6eb] flex items-center justify-between">
              <span className="font-semibold text-[14px] text-[#1f2328]">
                Panduan Alur Kerja Keuangan moneytor
              </span>
              <button
                onClick={() => setIsGuideOpen(false)}
                className="w-7 h-7 rounded-[6px] hover:bg-[#edf2f7] flex items-center justify-center text-[#59636e] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-[12.5px] text-[#1f2328]">
              <div className="p-3 rounded-[8px] bg-[#f8fafc] border border-[#e1e6eb] space-y-1">
                <div className="font-semibold text-[#0f6cbd]">1. Harta Sendiri vs Liabilitas &amp; Piutang</div>
                <p className="text-[#59636e]">
                  Saldo bank/e-wallet berada di <strong>Aset</strong>, sedangkan tagihan SPayLater/Kredivo dan talangan teman berada di <strong>Kredit &amp; Talangan</strong> dengan pengelompokan lipat (<em>Collapsible Groups</em>).
                </p>
              </div>
              <div className="p-3 rounded-[8px] bg-[#f8fafc] border border-[#e1e6eb] space-y-1">
                <div className="font-semibold text-[#0f6cbd]">2. Kalkulator Biaya Admin 3 Mode &amp; Split Bill</div>
                <p className="text-[#59636e]">
                  Klik tombol biru <strong>[+ Transaksi baru]</strong> di kanan atas untuk mencatat pengeluaran PayLater, transfer dengan potongan ganda, atau bagi tagihan makan bersama teman.
                </p>
              </div>
              <div className="p-3 rounded-[8px] bg-[#f8fafc] border border-[#e1e6eb] space-y-1">
                <div className="font-semibold text-[#0f6cbd]">3. Inspector Drawer Kanan &amp; Rekonsiliasi</div>
                <p className="text-[#59636e]">
                  Klik baris mana pun di tabel untuk membuka panel rincian di sebelah kanan layar tanpa menutup tabel utama.
                </p>
              </div>
              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setIsGuideOpen(false)}
                  className="button-primary h-[32px] px-4 cursor-pointer flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Mengerti</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
