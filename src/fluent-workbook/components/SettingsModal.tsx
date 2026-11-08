import React, { useState } from 'react';
import Link from 'next/link';
import { X, Settings, CheckCircle2, Download, ShieldCheck } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  analyticsMode: 'consumption' | 'cashflow';
  onChangeAnalyticsMode: (m: 'consumption' | 'cashflow') => void;
  onExportAllCsv?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  analyticsMode,
  onChangeAnalyticsMode,
  onExportAllCsv,
}) => {
  const [paydayDate, setPaydayDate] = useState('25');
  const [taxRate, setTaxRate] = useState('20');
  const [savedNotice, setSavedNotice] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/35 flex items-center justify-center z-50 p-4 select-none">
      <div className="w-full max-w-[520px] bg-white rounded-[8px] border border-[#E0E0E0] shadow-xl overflow-hidden">
        <div className="h-[46px] px-4 bg-[#FAF9F8] border-b border-[#E0E0E0] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-[#0F6CBD]" />
            <span className="font-semibold text-[14px] text-[#242424]">
              Pengaturan Buku Kerja moneytor
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-[6px] hover:bg-[#EDEBE9] flex items-center justify-center text-[#616161] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-[12.5px]">
          {savedNotice && (
            <div className="p-2.5 rounded-[6px] bg-[#E6F4EA] border border-[#107C41]/30 text-[#107C41] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>Preferensi buku kerja berhasil diperbarui.</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11.5px] font-semibold text-[#424242] mb-1">
                Tanggal Siklus Gaji Bulanan
              </label>
              <select
                value={paydayDate}
                onChange={(e) => {
                  setPaydayDate(e.target.value);
                  setSavedNotice(true);
                }}
                className="w-full h-[34px] px-2.5 rounded-[6px] border border-[#E0E0E0] bg-white"
              >
                <option value="1">Setiap Tanggal 1</option>
                <option value="25">Setiap Tanggal 25 (Default)</option>
                <option value="28">Setiap Tanggal 28</option>
              </select>
            </div>
            <div>
              <label className="block text-[11.5px] font-semibold text-[#424242] mb-1">
                Pajak Bunga Tabungan / Deposito (%)
              </label>
              <input
                type="number"
                value={taxRate}
                onChange={(e) => {
                  setTaxRate(e.target.value);
                  setSavedNotice(true);
                }}
                className="w-full h-[34px] px-2.5 rounded-[6px] border border-[#E0E0E0] bg-white tabular-nums"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11.5px] font-semibold text-[#424242] mb-1.5">
              Basis Perhitungan Default pada Analitik &amp; Anggaran
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  onChangeAnalyticsMode('consumption');
                  setSavedNotice(true);
                }}
                className={`p-3 rounded-[6px] border text-left cursor-pointer transition-colors ${
                  analyticsMode === 'consumption'
                    ? 'bg-[#F3F9FD] border-[#0F6CBD] text-[#0F6CBD]'
                    : 'bg-white border-[#E0E0E0] text-[#424242]'
                }`}
              >
                <div className="font-semibold">Mode Konsumsi Murni</div>
                <div className="text-[11px] opacity-80 mt-0.5">
                  Hanya menghitung porsi makan/belanja pribadi (tanpa talangan teman)
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  onChangeAnalyticsMode('cashflow');
                  setSavedNotice(true);
                }}
                className={`p-3 rounded-[6px] border text-left cursor-pointer transition-colors ${
                  analyticsMode === 'cashflow'
                    ? 'bg-[#F3F9FD] border-[#0F6CBD] text-[#0F6CBD]'
                    : 'bg-white border-[#E0E0E0] text-[#424242]'
                }`}
              >
                <div className="font-semibold">Mode Arus Kas Riil</div>
                <div className="text-[11px] opacity-80 mt-0.5">
                  Menghitung seluruh uang keluar/masuk rekening bank saat itu
                </div>
              </button>
            </div>
          </div>

          <div className="p-3 rounded-[6px] bg-[#FAF9F8] border border-[#E0E0E0] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4 text-[#107C41]" />
              <div>
                <div className="font-semibold text-[#242424]">Ekspor Cadangan Buku Mutasi (.CSV)</div>
                <div className="text-[11px] text-[#616161]">
                  Unduh seluruh baris mutasi yang dapat dibuka di Microsoft Excel
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onExportAllCsv?.();
                setSavedNotice(true);
              }}
              className="h-[30px] px-3 rounded-[6px] bg-white border border-[#E0E0E0] hover:bg-[#F3F2F1] font-semibold flex items-center gap-1.5 text-[11.5px] cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#0F6CBD]" />
              <span>Unduh .CSV</span>
            </button>
          </div>

          <div className="pt-3 border-t border-[#EDEBE9] flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/settings/catalogs/categories" className="finance-secondary h-[32px] px-3 inline-flex items-center justify-center">
                Kelola Katalog Kategori
              </Link>
              <Link href="/settings/data" className="finance-secondary h-[32px] px-3 inline-flex items-center justify-center">
                Impor / Ekspor &amp; Backup Data
              </Link>
              <Link href="/settings" className="finance-secondary h-[32px] px-3 inline-flex items-center justify-center">
                Keamanan Passkey &amp; Sesi
              </Link>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-[34px] px-4 rounded-[6px] bg-[#0F6CBD] hover:bg-[#115EA3] text-white font-semibold cursor-pointer shrink-0"
            >
              Selesai &amp; Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
