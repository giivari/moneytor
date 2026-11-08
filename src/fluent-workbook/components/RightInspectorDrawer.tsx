import React, { useState } from 'react';
import {
  X,
  FileText,
  Wallet,
  CreditCard,
  Users,
  TrendingUp,
  History,
  CheckCircle2,
  ArrowRight,
  Edit3,
  Ban,
  RefreshCw,
  Calendar,
  PlusCircle,
} from 'lucide-react';
import {
  AssetAccount,
  InspectorPayload,
  TransactionItem,
} from '../types/finance';
import { formatIDR, formatPercent } from '../utils/formatters';

interface RightInspectorDrawerProps {
  payload: InspectorPayload | null;
  onClose: () => void;
  hideRp: boolean;
  allTransactions: TransactionItem[];
  accounts: AssetAccount[];
  onCorrectTransaction: (txId: string, newPrincipal: number, reason: string) => void;
  onVoidTransaction: (txId: string, reason: string) => void;
  onReconcileAccount: (accId: string, newBalance: number, reason: string) => void;
  onPayCreditBill: (creditId: string, sourceAccName: string, amount: number) => void;
  onSettleSplitParticipant: (
    sessionId: string,
    participantId: string,
    amountPaid: number,
    targetAccountName: string
  ) => void;
  onTopUpAccount: (targetAccName: string) => void;
  onPayObligation: (obligationId: string) => void;
  isMobile?: boolean;
}

export const RightInspectorDrawer: React.FC<RightInspectorDrawerProps> = ({
  payload,
  onClose,
  hideRp,
  allTransactions,
  accounts,
  onCorrectTransaction,
  onVoidTransaction,
  onReconcileAccount,
  onPayCreditBill,
  onSettleSplitParticipant,
  onTopUpAccount,
  onPayObligation,
  isMobile = false,
}) => {
  const [isEditingTx, setIsEditingTx] = useState(false);
  const [editAmount, setEditAmount] = useState('');
  const [editReason, setEditReason] = useState('');

  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileBalance, setReconcileBalance] = useState('');
  const [reconcileReason, setReconcileReason] = useState('');

  const [paySourceAcc, setPaySourceAcc] = useState('BCA Tahapan');
  const [settleTargetAcc, setSettleTargetAcc] = useState('BCA Tahapan');
  const [customSettleAmount, setCustomSettleAmount] = useState<Record<string, string>>({});
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  if (!payload) return null;

  const triggerFeedback = (msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => setActionFeedback(null), 3500);
  };

  const drawerInner = (
    <>
      {isMobile && (
        <div className="pt-2 pb-1 bg-white flex justify-center shrink-0">
          <div className="w-10 h-1 rounded-full bg-[#C8C6C4]" />
        </div>
      )}
      {/* Drawer Top Header */}
      <div className="h-[52px] px-5 bg-white border-b border-[#F0F0F0] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          {payload.kind === 'transaction' && <FileText className="w-4 h-4 text-[#0F6CBD]" />}
          {payload.kind === 'account' && <Wallet className="w-4 h-4 text-[#107C41]" />}
          {payload.kind === 'credit' && <CreditCard className="w-4 h-4 text-[#C50F1F]" />}
          {payload.kind === 'installment' && <Calendar className="w-4 h-4 text-[#D83B01]" />}
          {payload.kind === 'splitbill' && <Users className="w-4 h-4 text-[#D83B01]" />}
          {payload.kind === 'investment' && <TrendingUp className="w-4 h-4 text-[#5C2E91]" />}
          {(payload.kind === 'budget' || payload.kind === 'goal' || payload.kind === 'obligation') && (
            <FileText className="w-4 h-4 text-[#0F6CBD]" />
          )}
          <span className="font-semibold text-[14px] text-[#111827]">
            {payload.kind === 'transaction' && 'Rincian Transaksi'}
            {payload.kind === 'account' && 'Rincian Rekening'}
            {payload.kind === 'credit' && 'Rincian Fasilitas Kredit'}
            {payload.kind === 'installment' && 'Rincian Kontrak Cicilan'}
            {payload.kind === 'splitbill' && 'Rincian Split Bill'}
            {payload.kind === 'investment' && 'Rincian Portofolio'}
            {payload.kind === 'budget' && 'Rincian Anggaran'}
            {payload.kind === 'goal' && 'Rincian Dana Cadangan'}
            {payload.kind === 'obligation' && 'Rincian Tagihan Rutin'}
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-[6px] hover:bg-[#F3F2F1] flex items-center justify-center text-[#616161] hover:text-[#242424] transition-colors cursor-pointer"
          title="Tutup Task Pane"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Feedback Toast inside Drawer */}
      {actionFeedback && (
        <div className="mx-5 mt-3 px-3.5 py-2 rounded-[6px] bg-[#E6F4EA] text-[#107C41] text-[12px] font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionFeedback}</span>
        </div>
      )}

      {/* Drawer Body Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* 1. TRANSACTION INSPECTOR */}
        {payload.kind === 'transaction' && (() => {
          const tx = payload.data;
          return (
            <>
              <div className="p-4 rounded-[8px] bg-[#FAFAFA] border border-[#EBEBEB] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-[4px] bg-white border border-[#E0E0E0] text-[#616161]">
                    {tx.refCode}
                  </span>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-[4px] ${
                      tx.isVoided
                        ? 'bg-[#EDEBE9] text-[#616161] line-through'
                        : tx.direction === 'in'
                        ? 'bg-[#E6F4EA] text-[#107C41]'
                        : tx.direction === 'out'
                        ? 'bg-[#FDE7E9] text-[#C50F1F]'
                        : 'bg-[#FFF4CE] text-[#D83B01]'
                    }`}
                  >
                    {tx.isVoided ? 'VOID / DIBATALKAN' : tx.type}
                  </span>
                </div>

                <div>
                  <div className="text-[11px] text-[#616161]">Total Mutasi Rekening</div>
                  <div
                    className={`text-[22px] font-bold tabular-nums tracking-tight ${
                      tx.isVoided
                        ? 'text-[#A19F9D] line-through'
                        : tx.direction === 'in'
                        ? 'text-[#107C41]'
                        : tx.direction === 'out'
                        ? 'text-[#C50F1F]'
                        : 'text-[#0F6CBD]'
                    }`}
                  >
                    {tx.direction === 'in' ? '+' : tx.direction === 'out' ? '-' : ''}
                    {formatIDR(tx.totalMutation, hideRp)}
                  </div>
                </div>

                <div className="text-[12.5px] font-medium text-[#242424] leading-snug">
                  {tx.note}
                </div>

                <div className="pt-2 border-t border-[#EDEBE9] grid grid-cols-2 gap-2 text-[11.5px]">
                  <div>
                    <span className="text-[#616161] block">Tanggal &amp; Waktu</span>
                    <span className="font-medium text-[#242424]">{tx.date} · {tx.time} WIB</span>
                  </div>
                  <div>
                    <span className="text-[#616161] block">Kategori</span>
                    <span className="font-medium text-[#242424]">{tx.category}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-[#616161] block">Alur Rekening (Sumber → Tujuan)</span>
                    <div className="mt-0.5 flex items-center gap-1.5 font-semibold text-[#0F6CBD]">
                      <span>{tx.sourceAccount}</span>
                      {tx.targetAccount && (
                        <>
                          <ArrowRight className="w-3.5 h-3.5 text-[#616161]" />
                          <span>{tx.targetAccount}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Breakdown Nominal Pokok vs Biaya Admin vs Konsumsi Murni */}
              <div className="rounded-[8px] border border-[#E0E0E0] overflow-hidden">
                <div className="px-3 py-2 bg-[#FAF9F8] border-b border-[#EDEBE9] font-semibold text-[12px] text-[#242424]">
                  Bedah Komponen Akuntansi
                </div>
                <div className="p-3 space-y-2 text-[12px]">
                  <div className="flex justify-between">
                    <span className="text-[#616161]">Nominal Pokok Transaksi</span>
                    <span className="font-medium tabular-nums">{formatIDR(tx.principalAmount, hideRp)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#616161]">Biaya Admin / Layanan / Pajak</span>
                    <span
                      className={`font-semibold tabular-nums ${
                        tx.adminFee > 0 ? 'text-[#D83B01]' : 'text-[#616161]'
                      }`}
                    >
                      {tx.adminFee > 0 ? `+${formatIDR(tx.adminFee, hideRp)}` : 'Rp 0'}
                    </span>
                  </div>
                  <div className="pt-1.5 border-t border-[#EDEBE9] flex justify-between font-semibold">
                    <span>Total Arus Kas Riil</span>
                    <span className="tabular-nums">{formatIDR(tx.totalMutation, hideRp)}</span>
                  </div>
                  <div className="p-2 rounded-[6px] bg-[#F3F9FD] border border-[#0F6CBD]/20 flex justify-between items-center text-[11.5px]">
                    <span className="text-[#0F6CBD] font-medium">Porsi Konsumsi Murni Pribadi:</span>
                    <span className="font-bold text-[#0F6CBD] tabular-nums">
                      {formatIDR(tx.personalConsumptionAmount, hideRp)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Riwayat Koreksi */}
              <div className="rounded-[8px] border border-[#E0E0E0] overflow-hidden">
                <div className="px-3 py-2 bg-[#FAF9F8] border-b border-[#EDEBE9] flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-semibold text-[12px]">
                    <History className="w-3.5 h-3.5 text-[#0F6CBD]" />
                    <span>Jejak Audit &amp; Riwayat Koreksi</span>
                  </div>
                  <span className="text-[11px] text-[#616161]">
                    {tx.correctionHistory ? tx.correctionHistory.length : 0} revisi
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  {tx.correctionHistory && tx.correctionHistory.length > 0 ? (
                    tx.correctionHistory.map((ch, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-[6px] bg-[#FFF4CE]/50 border border-[#D83B01]/25 text-[11.5px] space-y-1"
                      >
                        <div className="flex justify-between text-[#616161]">
                          <span>{ch.date}</span>
                          <span className="font-semibold text-[#D83B01]">KOREKSI NOMINAL</span>
                        </div>
                        <div className="font-medium text-[#242424]">
                          {formatIDR(ch.oldAmount, hideRp)} →{' '}
                          <span className="text-[#107C41] font-bold">{formatIDR(ch.newAmount, hideRp)}</span>
                        </div>
                        <div className="text-[#616161]">Alasan: &quot;{ch.reason}&quot;</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-[12px] text-[#616161] py-1">
                      Belum ada riwayat perubahan sejak transaksi dicatat.
                    </div>
                  )}
                </div>
              </div>

              {/* Tombol Aksi Cepat: Koreksi & Void */}
              {!tx.isVoided && (
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        setIsEditingTx(!isEditingTx);
                        setEditAmount(String(tx.principalAmount));
                      }}
                      className="h-[34px] px-3 rounded-[6px] bg-[#0F6CBD] hover:bg-[#115EA3] text-white font-semibold text-[12px] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Koreksi Nominal</span>
                    </button>
                    <button
                      onClick={() => {
                        onVoidTransaction(tx.id, 'Dibatalkan oleh pengguna melalui Inspector Transaksi');
                        triggerFeedback('Transaksi berhasil ditandai VOID & dicatat di Log Audit.');
                      }}
                      className="h-[34px] px-3 rounded-[6px] bg-[#FDE7E9] hover:bg-[#F9D0D5] text-[#C50F1F] border border-[#C50F1F]/30 font-semibold text-[12px] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>Void / Batalkan</span>
                    </button>
                  </div>

                  {isEditingTx && (
                    <div className="p-3 rounded-[8px] bg-[#FAF9F8] border border-[#0F6CBD] space-y-2.5">
                      <div className="text-[12px] font-semibold text-[#0F6CBD]">
                        Formulir Koreksi Audit Transaksi
                      </div>
                      <div>
                        <label className="block text-[11px] text-[#616161] mb-1">
                          Nominal Pokok Baru (Rp)
                        </label>
                        <input
                          type="number"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          className="w-full h-[32px] px-2.5 rounded-[6px] bg-white border border-[#E0E0E0] text-[13px] tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-[#616161] mb-1">
                          Alasan Koreksi (Wajib untuk Audit)
                        </label>
                        <input
                          type="text"
                          value={editReason}
                          onChange={(e) => setEditReason(e.target.value)}
                          placeholder="Contoh: Selisih struk parkir / diskon QRIS..."
                          className="w-full h-[32px] px-2.5 rounded-[6px] bg-white border border-[#E0E0E0] text-[12px]"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setIsEditingTx(false)}
                          className="px-3 py-1.5 rounded-[6px] border border-[#E0E0E0] bg-white text-[12px] cursor-pointer"
                        >
                          Batal
                        </button>
                        <button
                          onClick={() => {
                            const num = Number(editAmount);
                            if (num > 0) {
                              onCorrectTransaction(
                                tx.id,
                                num,
                                editReason.trim() || 'Penyesuaian nominal oleh pengguna'
                              );
                              setIsEditingTx(false);
                              setEditReason('');
                              triggerFeedback('Nominal berhasil dikoreksi & riwayat tersimpan.');
                            }
                          }}
                          className="px-3 py-1.5 rounded-[6px] bg-[#107C41] text-white font-semibold text-[12px] cursor-pointer"
                        >
                          Simpan Koreksi
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          );
        })()}

        {/* 2. ACCOUNT INSPECTOR */}
        {payload.kind === 'account' && (() => {
          const acc = payload.data;
          const relatedTxs = allTransactions
            .filter(
              (t) =>
                t.sourceAccount.toLowerCase().includes(acc.name.toLowerCase()) ||
                (t.targetAccount && t.targetAccount.toLowerCase().includes(acc.name.toLowerCase()))
            )
            .slice(0, 10);

          return (
            <>
              <div className="p-3.5 rounded-[8px] bg-[#FAF9F8] border border-[#E0E0E0] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[4px] bg-[#E6F4EA] text-[#107C41]">
                    {acc.subtype}
                  </span>
                  <span className="text-[11px] font-mono text-[#616161]">{acc.accountNumber}</span>
                </div>
                <div>
                  <div className="text-[14px] font-bold text-[#242424]">{acc.name}</div>
                  <div className="text-[11.5px] text-[#616161]">{acc.institution}</div>
                </div>
                <div className="pt-1">
                  <div className="text-[11px] text-[#616161]">Saldo Aktif Tersedia</div>
                  <div className="text-[22px] font-bold text-[#107C41] tabular-nums">
                    {formatIDR(acc.balance, hideRp)}
                  </div>
                </div>
                <div className="text-[11px] text-[#616161] flex items-center justify-between pt-2 border-t border-[#EDEBE9]">
                  <span>Rekonsiliasi Terakhir:</span>
                  <span className="font-medium text-[#242424]">{acc.lastReconciled}</span>
                </div>
              </div>

              {/* Parameter Bunga, Pajak & Admin Bulanan */}
              <div className="rounded-[8px] border border-[#E0E0E0] overflow-hidden">
                <div className="px-3 py-2 bg-[#FAF9F8] border-b border-[#EDEBE9] font-semibold text-[12px]">
                  Rincian Bunga, Pajak &amp; Biaya Admin Bulanan
                </div>
                <div className="p-3 space-y-2 text-[12px]">
                  <div className="flex justify-between">
                    <span className="text-[#616161]">Suku Bunga Tahunan (p.a.)</span>
                    <span className="font-semibold text-[#107C41] tabular-nums">
                      {acc.interestRatePa !== undefined ? `${acc.interestRatePa.toFixed(2).replace('.', ',')}% p.a.` : '0,00% (Non-Bunga)'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#616161]">Potongan Pajak Bunga (PPh 4 ayat 2)</span>
                    <span className="font-medium tabular-nums">
                      {acc.taxRate !== undefined ? `${acc.taxRate}%` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#616161]">Tanggal Cair Bunga Bulanan</span>
                    <span className="font-medium">
                      {acc.disbursementDay ? `Setiap Tanggal ${acc.disbursementDay}` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#616161]">Estimasi Bunga Bersih / Bulan</span>
                    <span className="font-bold text-[#107C41] tabular-nums">
                      +{formatIDR(acc.estimatedNetInterestMonthly || 0, hideRp)}/bln
                    </span>
                  </div>
                  <div className="pt-1.5 border-t border-[#EDEBE9] flex justify-between">
                    <span className="text-[#616161]">Biaya Admin Bank / Bulan</span>
                    <span
                      className={`font-semibold tabular-nums ${
                        acc.monthlyAdminFee > 0 ? 'text-[#C50F1F]' : 'text-[#107C41]'
                      }`}
                    >
                      {acc.monthlyAdminFee > 0
                        ? `-${formatIDR(acc.monthlyAdminFee, hideRp)}/bln`
                        : 'Rp 0 (Gratis Admin)'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Tombol Aksi Rekening */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => onTopUpAccount(acc.name)}
                  className="h-[34px] px-3 rounded-[6px] bg-[#0F6CBD] hover:bg-[#115EA3] text-white font-semibold text-[12px] flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Top-Up / Transfer</span>
                </button>
                <button
                  onClick={() => {
                    setIsReconciling(!isReconciling);
                    setReconcileBalance(String(acc.balance));
                  }}
                  className="h-[34px] px-3 rounded-[6px] bg-white hover:bg-[#FAF9F8] text-[#242424] border border-[#E0E0E0] font-semibold text-[12px] flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-[#0F6CBD]" />
                  <span>Rekonsiliasi Saldo</span>
                </button>
              </div>

              {isReconciling && (
                <div className="p-3 rounded-[8px] bg-[#FAF9F8] border border-[#0F6CBD] space-y-2.5">
                  <div className="text-[12px] font-semibold text-[#0F6CBD]">
                    Rekonsiliasi Saldo Aktual ({acc.name})
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#616161] mb-1">
                      Saldo Aktual di M-Banking / Kartu Fisik (Rp)
                    </label>
                    <input
                      type="number"
                      value={reconcileBalance}
                      onChange={(e) => setReconcileBalance(e.target.value)}
                      className="w-full h-[32px] px-2.5 rounded-[6px] bg-white border border-[#E0E0E0] text-[13px] tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#616161] mb-1">
                      Keterangan Penyesuaian
                    </label>
                    <input
                      type="text"
                      value={reconcileReason}
                      onChange={(e) => setReconcileReason(e.target.value)}
                      placeholder="Misal: Selisih biaya materai atau parkir tunai..."
                      className="w-full h-[32px] px-2.5 rounded-[6px] bg-white border border-[#E0E0E0] text-[12px]"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setIsReconciling(false)}
                      className="px-3 py-1.5 rounded-[6px] border border-[#E0E0E0] bg-white text-[12px] cursor-pointer"
                    >
                      Batal
                    </button>
                    <button
                      onClick={() => {
                        const val = Number(reconcileBalance);
                        if (!isNaN(val) && val >= 0) {
                          onReconcileAccount(
                            acc.id,
                            val,
                            reconcileReason.trim() || 'Opname rekonsiliasi saldo mandiri'
                          );
                          setIsReconciling(false);
                          setReconcileReason('');
                          triggerFeedback('Saldo rekening berhasil direkonsiliasi!');
                        }
                      }}
                      className="px-3 py-1.5 rounded-[6px] bg-[#107C41] text-white font-semibold text-[12px] cursor-pointer"
                    >
                      Sesuaikan Saldo
                    </button>
                  </div>
                </div>
              )}

              {/* 10 Mutasi Terakhir Rekening */}
              <div className="rounded-[8px] border border-[#E0E0E0] overflow-hidden">
                <div className="px-3 py-2 bg-[#FAF9F8] border-b border-[#EDEBE9] flex items-center justify-between">
                  <span className="font-semibold text-[12px]">10 Mutasi Terakhir ({acc.name})</span>
                  <span className="text-[11px] text-[#616161]">{relatedTxs.length} transaksi</span>
                </div>
                <div className="divide-y divide-[#EDEBE9]">
                  {relatedTxs.length > 0 ? (
                    relatedTxs.map((t) => {
                      const isIncoming =
                        t.direction === 'in' ||
                        (t.direction === 'transfer' &&
                          t.targetAccount?.toLowerCase().includes(acc.name.toLowerCase()));
                      return (
                        <div key={t.id} className="p-2.5 hover:bg-[#F3F9FD] flex items-center justify-between text-[12px]">
                          <div className="min-w-0 pr-2">
                            <div className="font-medium text-[#242424] truncate">{t.note}</div>
                            <div className="text-[11px] text-[#616161]">
                              {t.date} · {t.category}
                            </div>
                          </div>
                          <div
                            className={`font-semibold tabular-nums shrink-0 ${
                              isIncoming ? 'text-[#107C41]' : 'text-[#C50F1F]'
                            }`}
                          >
                            {isIncoming ? '+' : '-'}
                            {formatIDR(t.totalMutation, hideRp)}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-3 text-[12px] text-[#616161]">
                      Belum ada mutasi tercatat pada periode ini.
                    </div>
                  )}
                </div>
              </div>
            </>
          );
        })()}

        {/* 3. CREDIT FACILITY INSPECTOR */}
        {payload.kind === 'credit' && (() => {
          const cr = payload.data;
          const usedPct = Math.round((cr.usedLimit / cr.creditLimit) * 100);
          return (
            <>
              <div className="p-3.5 rounded-[8px] bg-[#FAF9F8] border border-[#E0E0E0] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[4px] bg-[#FDE7E9] text-[#C50F1F]">
                    LIABILITAS · {cr.type.toUpperCase()}
                  </span>
                  <span className="text-[11px] text-[#D83B01] font-semibold">
                    Cutoff Tgl {cr.cutoffDay} · Jatuh Tempo Tgl {cr.dueDay}
                  </span>
                </div>
                <div>
                  <div className="text-[15px] font-bold text-[#242424]">{cr.name}</div>
                  <div className="text-[11.5px] text-[#616161]">{cr.provider}</div>
                </div>

                {/* Progress Limit */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11.5px]">
                    <span className="text-[#616161]">Terpakai: {formatIDR(cr.usedLimit, hideRp)} ({usedPct}%)</span>
                    <span className="font-semibold text-[#107C41]">
                      Sisa Limit: {formatIDR(cr.availableLimit, hideRp)}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#EDEBE9] overflow-hidden">
                    <div
                      className="h-full bg-[#C50F1F] rounded-full"
                      style={{ width: `${Math.min(100, usedPct)}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-[#616161] text-right">
                    Plafon Total: {formatIDR(cr.creditLimit, hideRp)}
                  </div>
                </div>
              </div>

              {/* Kotak Tagihan Periode Berjalan vs Depan */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3 rounded-[6px] bg-[#FDE7E9]/60 border border-[#C50F1F]/30">
                  <div className="text-[11px] font-semibold text-[#C50F1F]">
                    Tagihan {cr.currentBillDueDate}
                  </div>
                  <div className="text-[10.5px] text-[#616161] mb-1">Periode Berjalan</div>
                  <div className="text-[15px] font-bold text-[#C50F1F] tabular-nums">
                    {formatIDR(cr.currentPeriodBill, hideRp)}
                  </div>
                </div>
                <div className="p-3 rounded-[6px] bg-[#FFF4CE]/60 border border-[#D83B01]/30">
                  <div className="text-[11px] font-semibold text-[#D83B01]">
                    Tagihan {cr.nextBillDueDate}
                  </div>
                  <div className="text-[10.5px] text-[#616161] mb-1">Periode Depan</div>
                  <div className="text-[15px] font-bold text-[#D83B01] tabular-nums">
                    {formatIDR(cr.nextPeriodBill, hideRp)}
                  </div>
                </div>
              </div>

              {/* Form Pelunasan Tagihan Cepat */}
              <div className="p-3.5 rounded-[8px] bg-white border border-[#0F6CBD] space-y-3">
                <div className="font-semibold text-[12.5px] text-[#0F6CBD]">
                  Bayar Tagihan Periode Berjalan ({cr.currentBillDueDate})
                </div>
                <div>
                  <label className="block text-[11px] text-[#616161] mb-1">
                    Pilih Rekening Sumber Pembayaran
                  </label>
                  <select
                    value={paySourceAcc}
                    onChange={(e) => setPaySourceAcc(e.target.value)}
                    className="w-full h-[32px] px-2 rounded-[6px] bg-[#FAF9F8] border border-[#E0E0E0] text-[12.5px]"
                  >
                    {accounts
                      .filter((a) => a.category === 'kas_bank_ewallet')
                      .map((a) => (
                        <option key={a.id} value={a.name}>
                          {a.name} — Saldo {formatIDR(a.balance, hideRp)}
                        </option>
                      ))}
                  </select>
                </div>
                <button
                  disabled={cr.currentPeriodBill <= 0}
                  onClick={() => {
                    onPayCreditBill(cr.id, paySourceAcc, cr.currentPeriodBill);
                    triggerFeedback(
                      `Tagihan ${cr.name} sebesar ${formatIDR(cr.currentPeriodBill, false)} telah dibayar dari ${paySourceAcc}!`
                    );
                  }}
                  className="w-full h-[34px] rounded-[6px] bg-[#0F6CBD] hover:bg-[#115EA3] disabled:bg-[#C8C6C4] text-white font-semibold text-[12.5px] cursor-pointer transition-colors"
                >
                  {cr.currentPeriodBill > 0
                    ? `Bayar Lunas ${formatIDR(cr.currentPeriodBill, hideRp)}`
                    : 'Tagihan Periode Berjalan Sudah Lunas'}
                </button>
              </div>
            </>
          );
        })()}

        {/* 4. SPLIT BILL INSPECTOR */}
        {payload.kind === 'splitbill' && (() => {
          const sb = payload.data;
          return (
            <>
              <div className="p-3.5 rounded-[8px] bg-[#FAF9F8] border border-[#E0E0E0] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[4px] bg-[#FFF4CE] text-[#D83B01]">
                    SESI SPLIT BILL
                  </span>
                  <span className="text-[11px] text-[#616161]">{sb.date}</span>
                </div>
                <div className="text-[14px] font-bold text-[#242424]">{sb.title}</div>
                <div className="text-[11.5px] text-[#616161]">{sb.notes}</div>

                <div className="pt-2 border-t border-[#EDEBE9] grid grid-cols-3 gap-2 text-[11.5px]">
                  <div>
                    <span className="text-[#616161] block">Total Struk</span>
                    <span className="font-bold text-[#242424] tabular-nums">
                      {formatIDR(sb.totalReceipt, hideRp)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#616161] block">Porsi Anda</span>
                    <span className="font-bold text-[#0F6CBD] tabular-nums">
                      {formatIDR(sb.myPortion, hideRp)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#616161] block">Total Talangan</span>
                    <span className="font-bold text-[#D83B01] tabular-nums">
                      {formatIDR(sb.friendsTotalPortion, hideRp)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Pilih Rekening Penerima Ganti */}
              <div className="p-3 rounded-[8px] bg-[#FAF9F8] border border-[#E0E0E0]">
                <label className="block text-[11px] font-semibold text-[#616161] mb-1">
                  Rekening Tujuan Penerimaan Ganti Uang Teman:
                </label>
                <select
                  value={settleTargetAcc}
                  onChange={(e) => setSettleTargetAcc(e.target.value)}
                  className="w-full h-[32px] px-2 rounded-[6px] bg-white border border-[#E0E0E0] text-[12px]"
                >
                  {accounts
                    .filter((a) => a.category === 'kas_bank_ewallet')
                    .map((a) => (
                      <option key={a.id} value={a.name}>
                        {a.name} ({formatIDR(a.balance, hideRp)})
                      </option>
                    ))}
                </select>
              </div>

              {/* Daftar Peserta Split Bill */}
              <div className="space-y-2.5">
                <div className="text-[12px] font-semibold text-[#242424]">
                  Rincian Talangan Per Teman ({sb.participants.length} Orang)
                </div>
                {sb.participants.map((p) => {
                  const remaining = Math.max(0, p.portion - p.paidAmount);
                  return (
                    <div
                      key={p.id}
                      className="p-3 rounded-[8px] bg-white border border-[#E0E0E0] space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-[13px] text-[#242424]">{p.name}</div>
                          <div className="text-[11px] text-[#616161]">
                            Porsi Awal: {formatIDR(p.portion, hideRp)} · Sudah Bayar:{' '}
                            {formatIDR(p.paidAmount, hideRp)}
                          </div>
                        </div>
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded-[4px] ${
                            p.status === 'Lunas'
                              ? 'bg-[#E6F4EA] text-[#107C41]'
                              : p.status === 'Dicicil'
                              ? 'bg-[#FFF4CE] text-[#D83B01]'
                              : 'bg-[#FDE7E9] text-[#C50F1F]'
                          }`}
                        >
                          {p.status === 'Dicicil'
                            ? `Dicicil · Sisa ${formatIDR(remaining, hideRp)}`
                            : p.status}
                        </span>
                      </div>

                      {remaining > 0 && (
                        <div className="pt-2 border-t border-[#EDEBE9] flex items-center gap-2">
                          <input
                            type="number"
                            placeholder={String(remaining)}
                            value={customSettleAmount[p.id] ?? ''}
                            onChange={(e) =>
                              setCustomSettleAmount({
                                ...customSettleAmount,
                                [p.id]: e.target.value,
                              })
                            }
                            className="w-28 h-[30px] px-2 rounded-[6px] border border-[#E0E0E0] text-[12px] tabular-nums"
                          />
                          <button
                            onClick={() => {
                              const raw = customSettleAmount[p.id];
                              const amountToSettle = raw ? Number(raw) : remaining;
                              if (amountToSettle > 0) {
                                onSettleSplitParticipant(
                                  sb.id,
                                  p.id,
                                  Math.min(remaining, amountToSettle),
                                  settleTargetAcc
                                );
                                triggerFeedback(
                                  `Penerimaan ganti dari ${p.name} (${formatIDR(
                                    Math.min(remaining, amountToSettle),
                                    false
                                  )}) dicatat ke ${settleTargetAcc}!`
                                );
                              }
                            }}
                            className="flex-1 h-[30px] px-2.5 rounded-[6px] bg-[#107C41] hover:bg-[#0E6A37] text-white font-semibold text-[11.5px] cursor-pointer"
                          >
                            Terima Ganti ({formatIDR(
                              customSettleAmount[p.id]
                                ? Number(customSettleAmount[p.id])
                                : remaining,
                              hideRp
                            )})
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          );
        })()}

        {/* 5. INSTALLMENT CONTRACT INSPECTOR */}
        {payload.kind === 'installment' && (() => {
          const inst = payload.data;
          return (
            <div className="space-y-3">
              <div className="p-3.5 rounded-[8px] bg-[#FAF9F8] border border-[#E0E0E0] space-y-2">
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[4px] bg-[#FFF4CE] text-[#D83B01]">
                  KONTRAK CICILAN {inst.currentInstallment}/{inst.totalTenor}
                </span>
                <div className="text-[14px] font-bold text-[#242424]">{inst.itemName}</div>
                <div className="text-[11.5px] text-[#616161]">
                  Fasilitas: {inst.facilityName} · Merchant: {inst.merchant}
                </div>
                <div className="pt-2 border-t border-[#EDEBE9] space-y-1.5 text-[12px]">
                  <div className="flex justify-between">
                    <span className="text-[#616161]">Pokok Cicilan / Bulan:</span>
                    <span className="font-medium tabular-nums">{formatIDR(inst.monthlyPrincipal, hideRp)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#616161]">Bunga Kredit / Bulan:</span>
                    <span className="font-semibold text-[#C50F1F] tabular-nums">
                      +{formatIDR(inst.monthlyInterest, hideRp)}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold pt-1 border-t border-[#EDEBE9]">
                    <span>Total Tagihan / Bulan:</span>
                    <span className="text-[#D83B01] tabular-nums">{formatIDR(inst.monthlyTotal, hideRp)}</span>
                  </div>
                  <div className="flex justify-between text-[11.5px] pt-1">
                    <span className="text-[#616161]">Sisa Kewajiban Belum Jatuh Tempo:</span>
                    <span className="font-bold text-[#C50F1F] tabular-nums">
                      {formatIDR(inst.remainingTotal, hideRp)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* 6. INVESTMENT HOLDING INSPECTOR */}
        {payload.kind === 'investment' && (() => {
          const inv = payload.data;
          const isProfit = inv.unrealizedPL >= 0;
          return (
            <div className="space-y-3">
              <div className="p-3.5 rounded-[8px] bg-[#FAF9F8] border border-[#E0E0E0] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[4px] bg-[#F3EBF9] text-[#5C2E91]">
                    {inv.assetClass} · {inv.platform}
                  </span>
                  <span className="text-[11px] font-mono text-[#616161]">{inv.code}</span>
                </div>
                <div className="text-[14px] font-bold text-[#242424]">{inv.name}</div>
                <div>
                  <div className="text-[11px] text-[#616161]">Nilai Pasar Saat Ini (Market Value)</div>
                  <div className="text-[22px] font-bold text-[#5C2E91] tabular-nums">
                    {formatIDR(inv.marketValue, hideRp)}
                  </div>
                </div>
                <div className="pt-2 border-t border-[#EDEBE9] space-y-1.5 text-[12px]">
                  <div className="flex justify-between">
                    <span className="text-[#616161]">Jumlah Kepemilikan:</span>
                    <span className="font-semibold tabular-nums">
                      {inv.units.toLocaleString('id-ID')} {inv.unitLabel}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#616161]">Harga Beli Rata-Rata (Avg Cost):</span>
                    <span className="font-medium tabular-nums">{formatIDR(inv.avgCostPrice, hideRp)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#616161]">Harga Pasar Terkini:</span>
                    <span className="font-medium tabular-nums">{formatIDR(inv.marketPrice, hideRp)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#616161]">Modal Pokok Investasi:</span>
                    <span className="font-medium tabular-nums">{formatIDR(inv.principalValue, hideRp)}</span>
                  </div>
                  <div className="flex justify-between pt-1.5 border-t border-[#EDEBE9] font-bold">
                    <span>Unrealized Profit / Loss:</span>
                    <span className={`tabular-nums ${isProfit ? 'text-[#107C41]' : 'text-[#C50F1F]'}`}>
                      {isProfit ? '+' : ''}
                      {formatIDR(inv.unrealizedPL, hideRp)} ({formatPercent(inv.unrealizedPLPercent)})
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* 7. BUDGET / GOAL / OBLIGATION INSPECTOR */}
        {payload.kind === 'budget' && (() => {
          const b = payload.data;
          const safeDaily = Math.max(
            0,
            Math.round((b.monthlyLimit - b.usedConsumption) / Math.max(1, b.remainingDays))
          );
          return (
            <div className="p-3.5 rounded-[8px] bg-[#FAF9F8] border border-[#E0E0E0] space-y-2.5 text-[12px]">
              <div className="text-[14px] font-bold text-[#242424]">{b.category}</div>
              <div className="text-[#616161]">{b.notes}</div>
              <div className="pt-2 border-t border-[#EDEBE9] space-y-1.5">
                <div className="flex justify-between">
                  <span>Plafon Anggaran Bulanan:</span>
                  <span className="font-bold tabular-nums">{formatIDR(b.monthlyLimit, hideRp)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Terpakai (Mode Konsumsi Murni):</span>
                  <span className="font-semibold text-[#0F6CBD] tabular-nums">
                    {formatIDR(b.usedConsumption, hideRp)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Terpakai (Mode Arus Kas Riil):</span>
                  <span className="font-semibold text-[#D83B01] tabular-nums">
                    {formatIDR(b.usedCashflow, hideRp)}
                  </span>
                </div>
                <div className="p-2 rounded-[6px] bg-[#E6F4EA] text-[#107C41] font-semibold flex justify-between">
                  <span>Batas Aman Harian ({b.remainingDays} hari tersisa):</span>
                  <span className="tabular-nums">{formatIDR(safeDaily, hideRp)}/hari</span>
                </div>
              </div>
            </div>
          );
        })()}

        {payload.kind === 'goal' && (() => {
          const g = payload.data;
          return (
            <div className="p-3.5 rounded-[8px] bg-[#FAF9F8] border border-[#E0E0E0] space-y-2.5 text-[12px]">
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[4px] bg-[#E6F4EA] text-[#107C41]">
                {g.type} · Prioritas {g.priority}
              </span>
              <div className="text-[14px] font-bold text-[#242424]">{g.title}</div>
              <div className="pt-2 border-t border-[#EDEBE9] space-y-1.5">
                <div className="flex justify-between">
                  <span>Tersimpan di Rekening:</span>
                  <span className="font-semibold text-[#0F6CBD]">{g.storedInAccount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Dana Terkumpul Saat Ini:</span>
                  <span className="font-bold text-[#107C41] tabular-nums">
                    {formatIDR(g.currentAmount, hideRp)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Target Total:</span>
                  <span className="font-bold tabular-nums">{formatIDR(g.targetAmount, hideRp)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Setoran Rutin Bulanan:</span>
                  <span className="font-medium tabular-nums">
                    {formatIDR(g.monthlyContribution, hideRp)}/bln
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        {payload.kind === 'obligation' && (() => {
          const ob = payload.data;
          return (
            <div className="p-3.5 rounded-[8px] bg-[#FAF9F8] border border-[#E0E0E0] space-y-3 text-[12px]">
              <div className="text-[14px] font-bold text-[#242424]">{ob.name}</div>
              <div className="text-[#616161]">Provider: {ob.provider} · Jatuh Tempo: {ob.dueDateLabel}</div>
              <div className="flex justify-between font-bold text-[14px] pt-2 border-t border-[#EDEBE9]">
                <span>Nominal Tagihan:</span>
                <span className="text-[#C50F1F] tabular-nums">{formatIDR(ob.amount, hideRp)}</span>
              </div>
              {ob.status !== 'Lunas' && (
                <button
                  onClick={() => {
                    onPayObligation(ob.id);
                    triggerFeedback(`Tagihan ${ob.name} berhasil dicatat lunas!`);
                  }}
                  className="w-full h-[34px] rounded-[6px] bg-[#0F6CBD] hover:bg-[#115EA3] text-white font-semibold cursor-pointer"
                >
                  Catat Pembayaran Sekarang ({formatIDR(ob.amount, hideRp)})
                </button>
              )}
            </div>
          );
        })()}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/40 z-40 flex items-end justify-center select-none"
      >
        <aside
          onClick={(e) => e.stopPropagation()}
          className="w-full max-h-[82%] bg-[#FFFFFF] rounded-t-[14px] border-t border-[#EBEBEB] flex flex-col overflow-hidden shadow-2xl"
        >
          {drawerInner}
        </aside>
      </div>
    );
  }

  return (
    <aside className="w-[420px] shrink-0 bg-[#FFFFFF] border-l border-[#F0F0F0] flex flex-col h-full select-none z-20 shadow-[-8px_0_24px_rgba(0,0,0,0.06)]">
      {drawerInner}
    </aside>
  );
};
