import React, { useState } from 'react';
import {
  Home,
  Table2,
  Plus,
  Wallet,
  MoreHorizontal,
  CreditCard,
  TrendingUp,
  CalendarCheck2,
  BarChart3,
  Settings,
  X,
} from 'lucide-react';
import { NavPageId } from '../types/finance';

interface MobileBottomDockProps {
  activePage: NavPageId;
  onSelectPage: (page: NavPageId) => void;
  onOpenNewTxModal: (
    preset?: 'Pengeluaran' | 'Pemasukan' | 'Transfer / Top-Up' | 'Split Bill' | 'Pelunasan'
  ) => void;
  onOpenSettings: () => void;
  pendingAutomationsCount: number;
  unpaidFriendsCount: number;
}

export const MobileBottomDock: React.FC<MobileBottomDockProps> = ({
  activePage,
  onSelectPage,
  onOpenNewTxModal,
  onOpenSettings,
  pendingAutomationsCount,
  unpaidFriendsCount,
}) => {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showAssetCreditPicker, setShowAssetCreditPicker] = useState(false);

  const isAssetOrCredit = activePage === 'rekening' || activePage === 'kredit';
  const isMoreActive =
    activePage === 'investasi' || activePage === 'perencanaan' || activePage === 'analitik';

  return (
    <>
      {/* Pop-up Selector for "Aset & Kredit" */}
      {showAssetCreditPicker && (
        <div
          onClick={() => setShowAssetCreditPicker(false)}
          className="absolute inset-0 bg-black/35 z-40 flex items-end justify-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-white rounded-t-[12px] border-t border-[#E0E0E0] p-3.5 space-y-2 shadow-xl animate-in slide-in-from-bottom"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#EDEBE9]">
              <span className="font-semibold text-[13px] text-[#242424]">
                Pilih Modul Aset atau Kredit &amp; Talangan
              </span>
              <button
                onClick={() => setShowAssetCreditPicker(false)}
                className="p-1 text-[#616161]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={() => {
                onSelectPage('rekening');
                setShowAssetCreditPicker(false);
              }}
              className={`w-full p-3 rounded-[6px] border flex items-center justify-between text-left cursor-pointer ${
                activePage === 'rekening'
                  ? 'bg-[#F3F9FD] border-[#0F6CBD] text-[#0F6CBD]'
                  : 'bg-[#FAF9F8] border-[#E0E0E0] text-[#242424]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Wallet className="w-4 h-4 text-[#107C41]" />
                <div>
                  <div className="font-semibold text-[13px]">Rekening &amp; Aset</div>
                  <div className="text-[11px] text-[#616161]">
                    Kas, Bank, Tabungan Deposito &amp; Kartu E-Money
                  </div>
                </div>
              </div>
              <span className="text-[11px] font-semibold text-[#107C41]">Harta Sendiri</span>
            </button>

            <button
              onClick={() => {
                onSelectPage('kredit');
                setShowAssetCreditPicker(false);
              }}
              className={`w-full p-3 rounded-[6px] border flex items-center justify-between text-left cursor-pointer ${
                activePage === 'kredit'
                  ? 'bg-[#F3F9FD] border-[#0F6CBD] text-[#0F6CBD]'
                  : 'bg-[#FAF9F8] border-[#E0E0E0] text-[#242424]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <CreditCard className="w-4 h-4 text-[#C50F1F]" />
                <div>
                  <div className="font-semibold text-[13px]">Kredit &amp; Talangan</div>
                  <div className="text-[11px] text-[#616161]">
                    PayLater, Kontrak Cicilan &amp; Split Bill Teman
                  </div>
                </div>
              </div>
              {unpaidFriendsCount > 0 && (
                <span className="px-2 py-0.5 rounded-[4px] bg-[#FDE7E9] text-[#C50F1F] text-[10.5px] font-semibold">
                  {unpaidFriendsCount} Belum Lunas
                </span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Pop-up Sheet for "Lainnya" */}
      {showMoreMenu && (
        <div
          onClick={() => setShowMoreMenu(false)}
          className="absolute inset-0 bg-black/35 z-40 flex items-end justify-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-white rounded-t-[12px] border-t border-[#E0E0E0] p-3.5 space-y-1.5 shadow-xl"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#EDEBE9]">
              <span className="font-semibold text-[13px] text-[#242424]">
                Menu Lainnya (Microsoft 365 Mobile)
              </span>
              <button onClick={() => setShowMoreMenu(false)} className="p-1 text-[#616161]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={() => {
                onSelectPage('investasi');
                setShowMoreMenu(false);
              }}
              className={`w-full p-2.5 rounded-[6px] flex items-center gap-3 text-left cursor-pointer ${
                activePage === 'investasi' ? 'bg-[#F3EBF9] text-[#5C2E91] font-semibold' : 'hover:bg-[#FAF9F8]'
              }`}
            >
              <TrendingUp className="w-4 h-4 text-[#5C2E91]" />
              <div>
                <div className="text-[13px]">Portofolio Investasi</div>
                <div className="text-[11px] text-[#616161]">Bibit Reksa Dana, Saham IDX &amp; Crypto BTC</div>
              </div>
            </button>

            <button
              onClick={() => {
                onSelectPage('perencanaan');
                setShowMoreMenu(false);
              }}
              className={`w-full p-2.5 rounded-[6px] flex items-center gap-3 text-left cursor-pointer ${
                activePage === 'perencanaan' ? 'bg-[#EBF3FC] text-[#0F6CBD] font-semibold' : 'hover:bg-[#FAF9F8]'
              }`}
            >
              <CalendarCheck2 className="w-4 h-4 text-[#107C41]" />
              <div>
                <div className="text-[13px]">Perencanaan (Planning)</div>
                <div className="text-[11px] text-[#616161]">Anggaran Belanja, Dana Cadangan &amp; Tagihan Rutin</div>
              </div>
            </button>

            <button
              onClick={() => {
                onSelectPage('analitik');
                setShowMoreMenu(false);
              }}
              className={`w-full p-2.5 rounded-[6px] flex items-center gap-3 text-left cursor-pointer ${
                activePage === 'analitik' ? 'bg-[#FFF4CE] text-[#D83B01] font-semibold' : 'hover:bg-[#FAF9F8]'
              }`}
            >
              <BarChart3 className="w-4 h-4 text-[#D83B01]" />
              <div>
                <div className="text-[13px]">Analitik (Insights Power BI)</div>
                <div className="text-[11px] text-[#616161]">Mode Konsumsi Murni vs Arus Kas Riil &amp; Audit Admin</div>
              </div>
            </button>

            <div className="border-t border-[#EDEBE9] pt-1">
              <button
                onClick={() => {
                  setShowMoreMenu(false);
                  onOpenSettings();
                }}
                className="w-full p-2.5 rounded-[6px] flex items-center gap-3 text-left hover:bg-[#FAF9F8] cursor-pointer"
              >
                <Settings className="w-4 h-4 text-[#616161]" />
                <span className="text-[13px] font-medium">Pengaturan Aplikasi</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation Dock (58px) */}
      <nav className="h-[58px] bg-[#FFFFFF] border-t border-[#E0E0E0] px-2 flex items-center justify-around shrink-0 z-30 select-none">
        {/* 1. Home */}
        <button
          onClick={() => {
            setShowAssetCreditPicker(false);
            setShowMoreMenu(false);
            onSelectPage('home');
          }}
          className={`relative flex flex-col items-center justify-center w-14 py-1 rounded-[6px] cursor-pointer ${
            activePage === 'home' ? 'text-[#0F6CBD] font-semibold' : 'text-[#616161]'
          }`}
        >
          <Home className="w-4 h-4" />
          <span className="text-[10.5px] mt-0.5">Home</span>
          {pendingAutomationsCount > 0 && (
            <span className="absolute top-0.5 right-2.5 w-2 h-2 rounded-full bg-[#D83B01]" />
          )}
        </button>

        {/* 2. Mutasi */}
        <button
          onClick={() => {
            setShowAssetCreditPicker(false);
            setShowMoreMenu(false);
            onSelectPage('mutasi');
          }}
          className={`flex flex-col items-center justify-center w-14 py-1 rounded-[6px] cursor-pointer ${
            activePage === 'mutasi' ? 'text-[#0F6CBD] font-semibold' : 'text-[#616161]'
          }`}
        >
          <Table2 className="w-4 h-4" />
          <span className="text-[10.5px] mt-0.5">Mutasi</span>
        </button>

        {/* 3. Center Prominent Button: + Catat */}
        <button
          onClick={() => onOpenNewTxModal('Pengeluaran')}
          className="flex flex-col items-center justify-center -mt-3 cursor-pointer"
        >
          <div className="w-10 h-10 rounded-full bg-[#0F6CBD] hover:bg-[#115EA3] text-white shadow-md flex items-center justify-center">
            <Plus className="w-5 h-5 stroke-[2.5]" />
          </div>
          <span className="text-[10.5px] font-semibold text-[#0F6CBD] mt-0.5">+ Catat</span>
        </button>

        {/* 4. Aset & Kredit */}
        <button
          onClick={() => {
            setShowMoreMenu(false);
            setShowAssetCreditPicker(!showAssetCreditPicker);
          }}
          className={`relative flex flex-col items-center justify-center w-16 py-1 rounded-[6px] cursor-pointer ${
            isAssetOrCredit ? 'text-[#0F6CBD] font-semibold' : 'text-[#616161]'
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span className="text-[10.5px] mt-0.5">Aset &amp; Kredit</span>
          {unpaidFriendsCount > 0 && (
            <span className="absolute top-0.5 right-2 w-2 h-2 rounded-full bg-[#C50F1F]" />
          )}
        </button>

        {/* 5. Lainnya */}
        <button
          onClick={() => {
            setShowAssetCreditPicker(false);
            setShowMoreMenu(!showMoreMenu);
          }}
          className={`flex flex-col items-center justify-center w-14 py-1 rounded-[6px] cursor-pointer ${
            isMoreActive ? 'text-[#0F6CBD] font-semibold' : 'text-[#616161]'
          }`}
        >
          <MoreHorizontal className="w-4 h-4" />
          <span className="text-[10.5px] mt-0.5">Lainnya</span>
        </button>
      </nav>
    </>
  );
};
