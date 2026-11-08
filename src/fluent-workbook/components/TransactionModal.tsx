import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Users,
  Calculator,
  CreditCard,
  Trash2,
  Info,
} from 'lucide-react';
import {
  AssetAccount,
  CreditFacility,
  SplitBillSession,
  TransactionItem,
} from '../types/finance';
import { formatIDR } from '../utils/formatters';

export type ModalScenarioTab =
  | 'pengeluaran'
  | 'transfer'
  | 'splitbill'
  | 'pemasukan'
  | 'pelunasan';

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  presetType?: 'Pengeluaran' | 'Pemasukan' | 'Transfer / Top-Up' | 'Split Bill' | 'Pelunasan';
  presetTargetAccount?: string;
  accounts: AssetAccount[];
  creditFacilities: CreditFacility[];
  splitBills: SplitBillSession[];
  onAddTransaction: (
    tx: Omit<TransactionItem, 'id' | 'refCode'>,
    newSplitSession?: Omit<SplitBillSession, 'id'>,
    options?: {
      netOffCategory?: string;
      triggerSalaryAutoAllocation?: boolean;
      creditFacilityUsedId?: string;
      creditInstallmentTenor?: number;
    }
  ) => void;
  onPayCreditBill: (creditId: string, sourceAccName: string, amount: number) => void;
  onSettleSplitParticipant: (
    sessionId: string,
    participantId: string,
    amountPaid: number,
    targetAccountName: string
  ) => void;
  categories?: string[];
}

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  onClose,
  presetType = 'Pengeluaran',
  presetTargetAccount,
  accounts,
  creditFacilities,
  splitBills,
  onAddTransaction,
  onPayCreditBill,
  onSettleSplitParticipant,
}) => {
  const [activeTab, setActiveTab] = useState<ModalScenarioTab>('pengeluaran');
  const [layoutMode, setLayoutMode] = useState<'modal' | 'slideover'>('modal');

  // --- TAB 1: PENGELUARAN ---
  const [expSource, setExpSource] = useState('SPayLater');
  const [expMerchant, setExpMerchant] = useState('Samsung Official Store');
  const [expCategory, setExpCategory] = useState('Elektronik & Produktivitas');
  const [expAmount, setExpAmount] = useState('250000');
  const [expTenor, setExpTenor] = useState<number>(1);
  const [expBillingPeriod, setExpBillingPeriod] = useState<'current' | 'next'>('current');
  const [expCreditInterest, setExpCreditInterest] = useState('15000');
  const [showExtraFees, setShowExtraFees] = useState(true);
  const [expTaxPb1, setExpTaxPb1] = useState('0');
  const [expServiceFee, setExpServiceFee] = useState('2500');
  const [expNote, setExpNote] = useState('');

  // --- TAB 2: TOP-UP & TRANSFER (3 MODE BIAYA ADMIN) ---
  const [trfSource, setTrfSource] = useState('Mandiri');
  const [trfTarget, setTrfTarget] = useState('GoPay');
  const [trfNominal, setTrfNominal] = useState('20000');
  const [trfFeeMode, setTrfFeeMode] = useState<'addon' | 'deducted' | 'dual'>('dual');
  const [trfSingleFee, setTrfSingleFee] = useState('2000');
  const [trfDualSourceFee, setTrfDualSourceFee] = useState('2500');
  const [trfDualTargetFee, setTrfDualTargetFee] = useState('1000');
  const [trfCreditTenor, setTrfCreditTenor] = useState<number>(1);
  const [trfCreditInterest, setTrfCreditInterest] = useState('5000');
  const [trfNote] = useState('');

  // --- TAB 3: SPLIT BILL / TALANGAN ---
  const [sbTitle, setSbTitle] = useState('Kopi & Makan Siang');
  const [sbSourceAcc, setSbSourceAcc] = useState('BCA Tahapan');
  const [sbCategory, setSbCategory] = useState('Makanan & Restoran');
  const [sbTotalReceipt, setSbTotalReceipt] = useState('330000');
  const [sbSplitMethod, setSbSplitMethod] = useState<'equal' | 'custom'>('equal');
  const [sbMyPortion, setSbMyPortion] = useState('110000');
  const [sbFriends, setSbFriends] = useState<{ id: string; name: string; amount: string }[]>([
    { id: 'f-1', name: 'Budi', amount: '110000' },
    { id: 'f-2', name: 'Siti', amount: '110000' },
  ]);

  // --- TAB 4: PEMASUKAN & REFUND ---
  const [incInflowType, setIncInflowType] = useState<'active' | 'passive' | 'refund'>('active');
  const [incTargetAcc, setIncTargetAcc] = useState('BCA Tahapan');
  const [incSourceTitle, setIncSourceTitle] = useState('PT Nusantara Digital Tbk');
  const [incAmount, setIncAmount] = useState('18500000');
  const [incTaxWithheld, setIncTaxWithheld] = useState('0');
  const [incNetOffCategory, setIncNetOffCategory] = useState('Makanan & Restoran');
  const [incAutoAllocate, setIncAutoAllocate] = useState(true);
  const [incNote] = useState('');

  // --- TAB 5: BAYAR TAGIHAN / TERIMA GANTI ---
  const [settleSubMode, setSettleSubMode] = useState<'pay_credit' | 'receive_friend'>('pay_credit');
  const [creditPaySourceAcc, setCreditPaySourceAcc] = useState('BCA Tahapan');
  const [selectedFriendReceiverAcc, setSelectedFriendReceiverAcc] = useState('BCA Tahapan');

  useEffect(() => {
    if (isOpen) {
      if (presetType === 'Pengeluaran') setActiveTab('pengeluaran');
      else if (presetType === 'Transfer / Top-Up') setActiveTab('transfer');
      else if (presetType === 'Split Bill') setActiveTab('splitbill');
      else if (presetType === 'Pemasukan') setActiveTab('pemasukan');
      else if (presetType === 'Pelunasan') setActiveTab('pelunasan');

      if (presetTargetAccount) {
        setTrfTarget(presetTargetAccount);
      }
    }
  }, [isOpen, presetType, presetTargetAccount]);

  useEffect(() => {
    if (sbSplitMethod === 'equal') {
      const total = Number(sbTotalReceipt) || 0;
      const count = 1 + sbFriends.length;
      const perPerson = Math.round(total / Math.max(1, count));
      setSbMyPortion(String(perPerson));
      setSbFriends((prev) =>
        prev.map((f, idx) => {
          if (idx === prev.length - 1) {
            const remainder = total - perPerson * prev.length;
            return { ...f, amount: String(Math.max(0, remainder)) };
          }
          return { ...f, amount: String(perPerson) };
        })
      );
    }
  }, [sbTotalReceipt, sbSplitMethod, sbFriends.length]);

  if (!isOpen) return null;

  const findCreditFacility = (name: string) =>
    creditFacilities.find((c) => c.name.toLowerCase() === name.toLowerCase());

  const expCreditFacility = findCreditFacility(expSource);
  const trfCreditFacility = findCreditFacility(trfSource);

  // Tab 1 Calculations
  const numExpPrincipal = Number(expAmount) || 0;
  const numExpTax = showExtraFees ? Number(expTaxPb1) || 0 : 0;
  const numExpService = showExtraFees ? Number(expServiceFee) || 0 : 0;
  const numExpCreditInt = expCreditFacility ? Number(expCreditInterest) || 0 : 0;
  const totalExpExtraFee = numExpTax + numExpService + numExpCreditInt;
  const totalExpMutation = numExpPrincipal + totalExpExtraFee;

  // Tab 2 Calculations (3 Admin Fee Modes)
  const numTrfNominal = Number(trfNominal) || 0;
  const numTrfSingle = Number(trfSingleFee) || 0;
  const numTrfSourceFee = Number(trfDualSourceFee) || 0;
  const numTrfTargetFee = Number(trfDualTargetFee) || 0;
  const numTrfPaylaterFee = trfCreditFacility ? Number(trfCreditInterest) || 0 : 0;

  let trfOutFromSource = numTrfNominal;
  let trfNetIntoTarget = numTrfNominal;
  let trfBurnedAdmin = 0;

  if (trfFeeMode === 'addon') {
    trfBurnedAdmin = numTrfSingle + numTrfPaylaterFee;
    trfOutFromSource = numTrfNominal + trfBurnedAdmin;
    trfNetIntoTarget = numTrfNominal;
  } else if (trfFeeMode === 'deducted') {
    trfBurnedAdmin = numTrfSingle + numTrfPaylaterFee;
    trfOutFromSource = numTrfNominal + numTrfPaylaterFee;
    trfNetIntoTarget = Math.max(0, numTrfNominal - numTrfSingle);
  } else {
    trfBurnedAdmin = numTrfSourceFee + numTrfTargetFee + numTrfPaylaterFee;
    trfOutFromSource = numTrfNominal + numTrfSourceFee + numTrfPaylaterFee;
    trfNetIntoTarget = Math.max(0, numTrfNominal - numTrfTargetFee);
  }

  // Tab 3 Calculations
  const numSbMine = Number(sbMyPortion) || 0;
  const numSbFriendsSum = sbFriends.reduce((acc, f) => acc + (Number(f.amount) || 0), 0);
  const sbAllocatedSum = numSbMine + numSbFriendsSum;

  // Tab 4 Calculations
  const numIncGross = Number(incAmount) || 0;
  const numIncTax = incInflowType === 'passive' ? Number(incTaxWithheld) || 0 : 0;
  const numIncNet = Math.max(0, numIncGross - numIncTax);

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(
    2,
    '0'
  )}`;

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();

    if (activeTab === 'pengeluaran') {
      const creditSuffix = expCreditFacility
        ? ` [${
            expTenor === 1 ? 'Bayar Penuh 1x' : `Cicilan ${expTenor}x`
          } · Masuk Tagihan ${
            expBillingPeriod === 'current'
              ? expCreditFacility.currentBillDueDate
              : expCreditFacility.nextBillDueDate
          }]`
        : '';

      onAddTransaction(
        {
          date: '14 Nov 2026',
          time: timeStr,
          type: 'Pengeluaran',
          sourceAccount: expSource,
          targetAccount: expMerchant || 'Merchant',
          category: expCategory,
          note:
            (expNote.trim() || `Pengeluaran ${expCategory} di ${expMerchant}`) + creditSuffix,
          principalAmount: numExpPrincipal,
          adminFee: totalExpExtraFee,
          totalMutation: totalExpMutation,
          direction: 'out',
          personalConsumptionAmount: totalExpMutation,
        },
        undefined,
        {
          creditFacilityUsedId: expCreditFacility?.id,
          creditInstallmentTenor: expTenor,
        }
      );
      onClose();
    } else if (activeTab === 'transfer') {
      const modeLabel =
        trfFeeMode === 'addon'
          ? 'Add-on Luar Nominal'
          : trfFeeMode === 'deducted'
          ? 'Potong di Dalam/Jalan'
          : `Biaya Ganda (Sumber ${formatIDR(numTrfSourceFee)} + Tujuan ${formatIDR(
              numTrfTargetFee
            )})`;

      onAddTransaction({
        date: '14 Nov 2026',
        time: timeStr,
        type: 'Transfer / Top-Up',
        sourceAccount: trfSource,
        targetAccount: trfTarget,
        category: 'Top-Up & Transfer',
        note:
          trfNote.trim() ||
          `Top-Up / Transfer ${trfSource} → ${trfTarget} [${modeLabel} · Masuk Bersih ${formatIDR(
            trfNetIntoTarget
          )}]`,
        principalAmount: trfNetIntoTarget,
        adminFee: trfBurnedAdmin,
        totalMutation: trfOutFromSource,
        direction: 'transfer',
        personalConsumptionAmount: trfBurnedAdmin,
      });
      onClose();
    } else if (activeTab === 'splitbill') {
      const participants = sbFriends
        .filter((f) => f.name.trim() && Number(f.amount) > 0)
        .map((f, idx) => ({
          id: `part-${Date.now()}-${idx}`,
          name: f.name.trim(),
          portion: Number(f.amount) || 0,
          paidAmount: 0,
          status: 'Belum Bayar' as const,
        }));

      onAddTransaction(
        {
          date: '14 Nov 2026',
          time: timeStr,
          type: 'Split Bill',
          sourceAccount: sbSourceAcc,
          targetAccount: sbTitle,
          category: sbCategory,
          note: `${sbTitle} (Porsi Pribadi ${formatIDR(numSbMine)} + Talangan ${participants
            .map((p) => p.name)
            .join(' & ')} ${formatIDR(numSbFriendsSum)})`,
          principalAmount: sbAllocatedSum,
          adminFee: 0,
          totalMutation: sbAllocatedSum,
          direction: 'out',
          personalConsumptionAmount: numSbMine,
        },
        {
          title: `${sbTitle} (14 Nov)`,
          date: '14 Nov 2026',
          paidUsingAccount: sbSourceAcc,
          category: sbCategory,
          totalReceipt: sbAllocatedSum,
          myPortion: numSbMine,
          friendsTotalPortion: numSbFriendsSum,
          participants,
          notes: `Metode: ${
            sbSplitMethod === 'equal' ? 'Bagi Rata' : 'Per Orang / Proporsional Pajak'
          }. Dibayar pakai ${sbSourceAcc}.`,
        }
      );
      onClose();
    } else if (activeTab === 'pemasukan') {
      const isRefund = incInflowType === 'refund';
      const isPassive = incInflowType === 'passive';

      onAddTransaction(
        {
          date: '14 Nov 2026',
          time: timeStr,
          type: isPassive ? 'Bunga & Pajak' : 'Pemasukan',
          sourceAccount: incSourceTitle || 'Sumber Dana',
          targetAccount: incTargetAcc,
          category: isRefund
            ? `Refund / Net-Off: ${incNetOffCategory}`
            : isPassive
            ? 'Penghasilan Pasif (Bunga / Dividen)'
            : 'Penghasilan Aktif (Gaji / Usaha)',
          note:
            incNote.trim() ||
            (isRefund
              ? `[Refund Net-Off ${incNetOffCategory}] Pengembalian dana / cashback ke ${incTargetAcc}`
              : isPassive
              ? `Pencairan Bunga/Dividen Bersih ke ${incTargetAcc}`
              : `Penerimaan Penghasilan Aktif dari ${incSourceTitle}`),
          principalAmount: numIncGross,
          adminFee: numIncTax,
          totalMutation: numIncNet,
          direction: 'in',
          personalConsumptionAmount: isRefund ? -numIncNet : numIncTax,
        },
        undefined,
        {
          netOffCategory: isRefund ? incNetOffCategory : undefined,
          triggerSalaryAutoAllocation: incInflowType === 'active' && incAutoAllocate,
        }
      );
      onClose();
    }
  };

  const allSourceAccounts = [
    ...creditFacilities.map((c) => ({
      label: `[PayLater/Kredit] ${c.name} — Sisa Limit ${formatIDR(c.availableLimit)}`,
      value: c.name,
      isCredit: true,
    })),
    ...accounts.map((a) => ({
      label: `[Aset ${a.subtype}] ${a.name} — Saldo ${formatIDR(a.balance)}`,
      value: a.name,
      isCredit: false,
    })),
  ];

  const scenarioTabs: { id: ModalScenarioTab; num: string; label: string; badge?: string }[] = [
    { id: 'pengeluaran', num: '1', label: 'Pengeluaran' },
    { id: 'transfer', num: '2', label: 'Transfer' },
    { id: 'splitbill', num: '3', label: 'Split Bill' },
    { id: 'pemasukan', num: '4', label: 'Pemasukan' },
    { id: 'pelunasan', num: '5', label: 'Pelunasan' },
  ];

  return (
    <div
      className={`fixed inset-0 bg-black/35 z-50 flex select-none ${
        layoutMode === 'slideover' ? 'justify-end' : 'items-center justify-center p-4'
      }`}
    >
      <div
        className={`bg-[#FFFFFF] border border-[#D1D1D1] shadow-2xl flex flex-col overflow-hidden transition-all ${
          layoutMode === 'slideover'
            ? 'w-full max-w-[680px] h-full rounded-l-[8px]'
            : 'w-full max-w-[780px] max-h-[92vh] rounded-[8px]'
        }`}
      >
        {/* Fluent UI 2 Window Header Bar */}
        <div className="h-[42px] px-4 bg-[#EAF1F8] border-b border-[#D1D1D1] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded-[4px] bg-[#0F6CBD] text-white flex items-center justify-center font-bold text-[11px]">
              M
            </div>
            <span className="font-semibold text-[13px] text-[#242424]">
              Catat Transaksi Baru — Formulir 5 Skenario Nyata (Microsoft Fluent 2)
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setLayoutMode(layoutMode === 'modal' ? 'slideover' : 'modal')}
              className="h-[26px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1] hover:bg-[#FAF9F8] text-[11px] font-medium text-[#424242] cursor-pointer"
            >
              {layoutMode === 'modal' ? 'Mode Slide-Over Kanan ⇥' : 'Mode Dialog Tengah ⊡'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-[4px] hover:bg-[#D8E3EF] flex items-center justify-center text-[#424242] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 5 Scenario Pivot Tabs */}
        <div className="grid grid-cols-5 border-b border-[#e1e6eb] bg-white px-2 shrink-0 overflow-hidden">
          {scenarioTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative py-2.5 px-2 text-[12px] whitespace-nowrap flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  isActive
                    ? 'text-[#0F6CBD] font-semibold bg-white border-x border-t border-[#E0E0E0] rounded-t-[6px] -mb-px'
                    : 'text-[#616161] hover:text-[#242424] font-medium'
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-[3px] text-[10px] font-bold flex items-center justify-center ${
                    isActive ? 'bg-[#0F6CBD] text-white' : 'bg-[#E1DFDD] text-[#424242]'
                  }`}
                >
                  {tab.num}
                </span>
                <span>{tab.label}</span>
                {tab.badge && (
                  <span className="px-1.5 py-0.2 rounded-[3px] bg-[#FFF4CE] text-[#D83B01] text-[10px] font-semibold">
                    {tab.badge}
                  </span>
                )}
                {isActive && (
                  <span className="absolute bottom-0 left-2 right-2 h-[2.5px] bg-[#0F6CBD] rounded-t-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto p-5 text-[12.5px]">
          {/* TAB 1: PENGELUARAN */}
          {activeTab === 'pengeluaran' && (
            <form id="tx-form" onSubmit={handleSubmitForm} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-[11.5px] font-semibold text-[#242424] mb-1">
                    Pilih Akun Sumber (Coba pilih SPayLater / Kredivo)
                  </label>
                  <select
                    value={expSource}
                    onChange={(e) => setExpSource(e.target.value)}
                    className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1] focus:border-[#0F6CBD] focus:outline-none font-medium"
                  >
                    {allSourceAccounts.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11.5px] font-semibold text-[#242424] mb-1">
                    Merchant / Penerima Pembayaran
                  </label>
                  <input
                    type="text"
                    value={expMerchant}
                    onChange={(e) => setExpMerchant(e.target.value)}
                    placeholder="Contoh: Samsung Official Store, Kopi Kenangan..."
                    className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1] focus:border-[#0F6CBD] focus:outline-none"
                  />
                </div>
              </div>

              {/* OTOMATIS MUNCUL BOKS PENGATURAN SKEMA KREDIT JIKA AKUN PAYLATER DIPILIH */}
              {expCreditFacility && (
                <div className="p-3.5 rounded-[6px] bg-[#FFF4CE]/55 border border-[#D83B01]/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[#D83B01] font-bold text-[12.5px]">
                      <CreditCard className="w-4 h-4" />
                      <span>Skema Kredit Otomatis — {expCreditFacility.name}</span>
                    </div>
                    <span className="px-2 py-0.5 rounded-[4px] bg-white border border-[#D83B01]/30 text-[#D83B01] font-semibold text-[11px]">
                      Cutoff tgl {expCreditFacility.cutoffDay} → Jatuh Tempo tgl{' '}
                      {expCreditFacility.dueDay}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-[#424242] mb-1">
                        Tenor Pembayaran
                      </label>
                      <select
                        value={expTenor}
                        onChange={(e) => setExpTenor(Number(e.target.value))}
                        className="w-full h-[32px] px-2 rounded-[4px] bg-white border border-[#D83B01]/40 font-semibold text-[#242424]"
                      >
                        <option value={1}>Bayar Penuh 1x</option>
                        <option value={3}>Cicilan 3x</option>
                        <option value={6}>Cicilan 6x</option>
                        <option value={12}>Cicilan 12x</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-[#424242] mb-1">
                        Periode Tagihan Statement
                      </label>
                      <select
                        value={expBillingPeriod}
                        onChange={(e) => setExpBillingPeriod(e.target.value as 'current' | 'next')}
                        className="w-full h-[32px] px-2 rounded-[4px] bg-white border border-[#D83B01]/40 font-medium text-[#242424]"
                      >
                        <option value="current">
                          Otomatis sesuai Cutoff tgl {expCreditFacility.cutoffDay} → Masuk Tagihan{' '}
                          {expCreditFacility.currentBillDueDate.replace(' 2026', '')}
                        </option>
                        <option value="next">
                          Lewat Cutoff tgl {expCreditFacility.cutoffDay} → Masuk Tagihan{' '}
                          {expCreditFacility.nextBillDueDate.replace(' 2027', '')}
                        </option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-[#D83B01] mb-1">
                        Bunga / Biaya Kredit (Rp)
                      </label>
                      <input
                        type="number"
                        value={expCreditInterest}
                        onChange={(e) => setExpCreditInterest(e.target.value)}
                        className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#D83B01]/40 font-bold text-[#C50F1F] tabular-nums"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-[11.5px] font-semibold text-[#242424] mb-1">
                    Nominal Pokok Belanja (Rp)
                  </label>
                  <input
                    type="number"
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value)}
                    className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1] font-bold text-[13.5px] tabular-nums focus:border-[#0F6CBD] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11.5px] font-semibold text-[#242424] mb-1">
                    Kategori Pengeluaran
                  </label>
                  <select
                    value={expCategory}
                    onChange={(e) => setExpCategory(e.target.value)}
                    className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1]"
                  >
                    <option value="Makanan & Restoran">Makanan &amp; Restoran</option>
                    <option value="Elektronik & Produktivitas">Elektronik &amp; Produktivitas</option>
                    <option value="Belanja Kebutuhan Rumah">Belanja Kebutuhan Rumah</option>
                    <option value="Transportasi & BBM">Transportasi &amp; BBM</option>
                    <option value="Tagihan & Utilitas">Tagihan &amp; Utilitas</option>
                    <option value="Olahraga & Kesehatan">Olahraga &amp; Kesehatan</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11.5px] font-semibold text-[#242424] mb-1">
                    Catatan Keterangan
                  </label>
                  <input
                    type="text"
                    value={expNote}
                    onChange={(e) => setExpNote(e.target.value)}
                    placeholder="Opsional..."
                    className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1]"
                  />
                </div>
              </div>

              {/* Opsi Tambahan: Rincian Biaya Tambahan (Pajak PB1, Biaya Layanan) */}
              <div className="p-3 rounded-[6px] bg-[#FAF9F8] border border-[#E0E0E0] space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 font-semibold text-[12px] text-[#242424] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showExtraFees}
                      onChange={(e) => setShowExtraFees(e.target.checked)}
                      className="rounded-[3px] accent-[#0F6CBD]"
                    />
                    <span>Opsi Tambahan: Rincian Biaya Tambahan (Pajak PB1, Biaya Layanan)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setExpTaxPb1(String(Math.round(numExpPrincipal * 0.1)))}
                    className="text-[11px] text-[#0F6CBD] hover:underline font-medium cursor-pointer"
                  >
                    + Hitung Otomatis PB1 10% ({formatIDR(Math.round(numExpPrincipal * 0.1))})
                  </button>
                </div>

                {showExtraFees && (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[11px] text-[#616161] mb-1">
                        Pajak Restoran PB1 / PPN (Rp)
                      </label>
                      <input
                        type="number"
                        value={expTaxPb1}
                        onChange={(e) => setExpTaxPb1(e.target.value)}
                        className="w-full h-[30px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1] tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#616161] mb-1">
                        Biaya Layanan / Platform (Rp)
                      </label>
                      <input
                        type="number"
                        value={expServiceFee}
                        onChange={(e) => setExpServiceFee(e.target.value)}
                        className="w-full h-[30px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1] tabular-nums"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="p-3 rounded-[6px] bg-[#F3F9FD] border border-[#0F6CBD]/30 flex items-center justify-between">
                <div className="text-[12px]">
                  <div className="font-semibold text-[#0F6CBD]">Pratinjau Jurnal Pengeluaran</div>
                  <div className="text-[#424242]">
                    Pokok: <strong>{formatIDR(numExpPrincipal)}</strong> + Biaya Tambahan/Bunga:{' '}
                    <strong className="text-[#D83B01]">{formatIDR(totalExpExtraFee)}</strong>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-[#616161]">Total Beban Mutasi</div>
                  <div className="text-[16px] font-bold text-[#C50F1F] tabular-nums">
                    -{formatIDR(totalExpMutation)}
                  </div>
                </div>
              </div>
            </form>
          )}

          {/* TAB 2: TOP-UP & TRANSFER (3 MODE BIAYA ADMIN) */}
          {activeTab === 'transfer' && (
            <form id="tx-form" onSubmit={handleSubmitForm} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-[11.5px] font-semibold text-[#242424] mb-1">
                    Akun Sumber (Termasuk SPayLater)
                  </label>
                  <select
                    value={trfSource}
                    onChange={(e) => setTrfSource(e.target.value)}
                    className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1] font-medium"
                  >
                    {allSourceAccounts.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11.5px] font-semibold text-[#242424] mb-1">
                    Akun Tujuan (Misal GoPay / Flazz)
                  </label>
                  <select
                    value={trfTarget}
                    onChange={(e) => setTrfTarget(e.target.value)}
                    className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1] font-medium"
                  >
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.name}>
                        {acc.name} ({acc.subtype} · {formatIDR(acc.balance)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11.5px] font-semibold text-[#0F6CBD] mb-1">
                    Nominal Top-Up / Transfer (Rp)
                  </label>
                  <input
                    type="number"
                    value={trfNominal}
                    onChange={(e) => setTrfNominal(e.target.value)}
                    className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#0F6CBD] font-bold text-[13.5px] tabular-nums"
                  />
                </div>
              </div>

              {/* Jika Sumber dari SPayLater ke Flazz/e-Money */}
              {trfCreditFacility && (
                <div className="p-3 rounded-[6px] bg-[#FFF4CE]/55 border border-[#D83B01]/40 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#D83B01] mb-1">
                      Tenor Top-Up via {trfCreditFacility.name} (Cutoff tgl {trfCreditFacility.cutoffDay})
                    </label>
                    <select
                      value={trfCreditTenor}
                      onChange={(e) => setTrfCreditTenor(Number(e.target.value))}
                      className="w-full h-[30px] px-2 rounded-[4px] bg-white border border-[#D83B01]/40 font-semibold"
                    >
                      <option value={1}>
                        Bayar Penuh 1x → Masuk Tagihan {trfCreditFacility.currentBillDueDate}
                      </option>
                      <option value={3}>Cicilan 3x</option>
                      <option value={6}>Cicilan 6x</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#D83B01] mb-1">
                      Bunga / Biaya Layanan PayLater (Rp)
                    </label>
                    <input
                      type="number"
                      value={trfCreditInterest}
                      onChange={(e) => setTrfCreditInterest(e.target.value)}
                      className="w-full h-[30px] px-2.5 rounded-[4px] bg-white border border-[#D83B01]/40 font-bold text-[#C50F1F] tabular-nums"
                    />
                  </div>
                </div>
              )}

              {/* SKEMA POTONGAN BIAYA ADMIN (3 RADIO BUTTON) */}
              <div className="p-3.5 rounded-[6px] bg-[#FAF9F8] border border-[#E0E0E0] space-y-3">
                <div className="font-semibold text-[12px] text-[#242424] flex items-center gap-1.5">
                  <Calculator className="w-4 h-4 text-[#0F6CBD]" />
                  <span>Skema Potongan Biaya Admin (Kalkulator 3 Mode):</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {/* Mode 1: Add-on */}
                  <label
                    onClick={() => setTrfFeeMode('addon')}
                    className={`p-2.5 rounded-[6px] border cursor-pointer transition-all ${
                      trfFeeMode === 'addon'
                        ? 'bg-[#F3F9FD] border-[#0F6CBD] ring-1 ring-[#0F6CBD]/30'
                        : 'bg-white border-[#E0E0E0] hover:bg-[#F5F5F5]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="feeMode"
                        checked={trfFeeMode === 'addon'}
                        onChange={() => setTrfFeeMode('addon')}
                        className="mt-0.5 accent-[#0F6CBD]"
                      />
                      <div>
                        <div className="font-semibold text-[12px] text-[#242424]">
                          Tambah di luar nominal (Add-on)
                        </div>
                        <div className="text-[11px] text-[#616161] mt-0.5">
                          Isi Rp 20.000 + admin Rp 2.000 → Keluar Rp 22.000, Masuk Rp 20.000.
                        </div>
                      </div>
                    </div>
                  </label>

                  {/* Mode 2: Deducted */}
                  <label
                    onClick={() => setTrfFeeMode('deducted')}
                    className={`p-2.5 rounded-[6px] border cursor-pointer transition-all ${
                      trfFeeMode === 'deducted'
                        ? 'bg-[#F3F9FD] border-[#0F6CBD] ring-1 ring-[#0F6CBD]/30'
                        : 'bg-white border-[#E0E0E0] hover:bg-[#F5F5F5]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="feeMode"
                        checked={trfFeeMode === 'deducted'}
                        onChange={() => setTrfFeeMode('deducted')}
                        className="mt-0.5 accent-[#0F6CBD]"
                      />
                      <div>
                        <div className="font-semibold text-[12px] text-[#242424]">
                          Potong di dalam / di jalan (Deducted)
                        </div>
                        <div className="text-[11px] text-[#616161] mt-0.5">
                          Bayar Rp 20.000, kepotong Rp 2.000 → Keluar Rp 20.000, Masuk bersih Rp 18.000.
                        </div>
                      </div>
                    </div>
                  </label>

                  {/* Mode 3: Biaya Ganda */}
                  <label
                    onClick={() => setTrfFeeMode('dual')}
                    className={`p-2.5 rounded-[6px] border cursor-pointer transition-all ${
                      trfFeeMode === 'dual'
                        ? 'bg-[#F3F9FD] border-[#0F6CBD] ring-1 ring-[#0F6CBD]/30'
                        : 'bg-white border-[#E0E0E0] hover:bg-[#F5F5F5]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="feeMode"
                        checked={trfFeeMode === 'dual'}
                        onChange={() => setTrfFeeMode('dual')}
                        className="mt-0.5 accent-[#0F6CBD]"
                      />
                      <div>
                        <div className="font-semibold text-[12px] text-[#242424]">
                          Biaya Ganda (Sumber + Tujuan)
                        </div>
                        <div className="text-[11px] text-[#616161] mt-0.5">
                          Admin di Bank Sumber + potongan di E-Wallet Tujuan.
                        </div>
                      </div>
                    </div>
                  </label>
                </div>

                {trfFeeMode === 'dual' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[11px] font-semibold text-[#D83B01] mb-1">
                        Biaya Admin di Bank Sumber (mis. Rp 2.500)
                      </label>
                      <input
                        type="number"
                        value={trfDualSourceFee}
                        onChange={(e) => setTrfDualSourceFee(e.target.value)}
                        className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#D83B01]/50 font-semibold tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#C50F1F] mb-1">
                        Potongan di E-Wallet Tujuan (mis. Rp 1.000)
                      </label>
                      <input
                        type="number"
                        value={trfDualTargetFee}
                        onChange={(e) => setTrfDualTargetFee(e.target.value)}
                        className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#C50F1F]/50 font-semibold tabular-nums"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="pt-1">
                    <label className="block text-[11px] font-semibold text-[#D83B01] mb-1">
                      {trfFeeMode === 'addon'
                        ? 'Biaya Admin di Luar Nominal (mis. Rp 2.000)'
                        : 'Potongan Biaya di Dalam / di Jalan (mis. Rp 2.000)'}
                    </label>
                    <input
                      type="number"
                      value={trfSingleFee}
                      onChange={(e) => setTrfSingleFee(e.target.value)}
                      className="w-full max-w-[260px] h-[32px] px-2.5 rounded-[4px] bg-white border border-[#D83B01]/50 font-semibold tabular-nums"
                    />
                  </div>
                )}

                {/* Kotak Preview Kalkulasi Otomatis */}
                <div className="p-3 rounded-[6px] bg-white border border-[#0F6CBD]/40">
                  <div className="text-[11px] font-bold text-[#0F6CBD] uppercase tracking-wider mb-1">
                    Preview Kalkulasi Otomatis:
                  </div>
                  <div className="text-[12.5px] font-medium text-[#242424]">
                    Keluar dari Bank Sumber: <strong className="text-[#C50F1F] tabular-nums">-{formatIDR(trfOutFromSource)}</strong>
                    {' · '}
                    Masuk bersih ke E-Wallet Tujuan: <strong className="text-[#107C41] tabular-nums">+{formatIDR(trfNetIntoTarget)}</strong>
                    {' · '}
                    Total Biaya Admin Hangus: <strong className="text-[#D83B01] tabular-nums">{formatIDR(trfBurnedAdmin)}</strong>
                  </div>
                </div>
              </div>
            </form>
          )}

          {/* TAB 3: SPLIT BILL / TALANGAN */}
          {activeTab === 'splitbill' && (
            <form id="tx-form" onSubmit={handleSubmitForm} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11.5px] font-semibold text-[#242424] mb-1">
                    Nama Acara / Merchant
                  </label>
                  <input
                    type="text"
                    value={sbTitle}
                    onChange={(e) => setSbTitle(e.target.value)}
                    className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1] font-medium"
                  />
                </div>
                <div>
                  <label className="block text-[11.5px] font-semibold text-[#242424] mb-1">
                    Akun Pembayar
                  </label>
                  <select
                    value={sbSourceAcc}
                    onChange={(e) => setSbSourceAcc(e.target.value)}
                    className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1] font-medium"
                  >
                    {allSourceAccounts.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.value}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11.5px] font-semibold text-[#242424] mb-1">
                    Kategori Porsi Pribadi
                  </label>
                  <select
                    value={sbCategory}
                    onChange={(e) => setSbCategory(e.target.value)}
                    className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1]"
                  >
                    <option value="Makanan & Restoran">Makanan</option>
                    <option value="Olahraga & Kesehatan">Olahraga</option>
                    <option value="Hiburan & Nongkrong">Hiburan</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11.5px] font-semibold text-[#0F6CBD] mb-1">
                    Total Bayar di Struk (Rp)
                  </label>
                  <input
                    type="number"
                    value={sbTotalReceipt}
                    onChange={(e) => setSbTotalReceipt(e.target.value)}
                    className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#0F6CBD] font-bold text-[13.5px] tabular-nums"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-[6px] bg-[#FAF9F8] border border-[#E0E0E0]">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-[#242424]">Metode Bagi:</span>
                  <button
                    type="button"
                    onClick={() => setSbSplitMethod('equal')}
                    className={`h-[28px] px-3 rounded-[4px] text-[12px] font-semibold cursor-pointer ${
                      sbSplitMethod === 'equal'
                        ? 'bg-[#0F6CBD] text-white'
                        : 'bg-white border border-[#D1D1D1] text-[#424242]'
                    }`}
                  >
                    Bagi Rata
                  </button>
                  <button
                    type="button"
                    onClick={() => setSbSplitMethod('custom')}
                    className={`h-[28px] px-3 rounded-[4px] text-[12px] font-semibold cursor-pointer ${
                      sbSplitMethod === 'custom'
                        ? 'bg-[#0F6CBD] text-white'
                        : 'bg-white border border-[#D1D1D1] text-[#424242]'
                    }`}
                  >
                    Per Orang / Proporsional Pajak
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setSbFriends((prev) => [
                      ...prev,
                      { id: `f-${Date.now()}`, name: `Teman ${prev.length + 1}`, amount: '0' },
                    ])
                  }
                  className="h-[28px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1] hover:bg-[#F3F2F1] text-[11.5px] font-semibold text-[#0F6CBD] cursor-pointer"
                >
                  + Tambah Partisipan
                </button>
              </div>

              {/* Daftar Baris Partisipan */}
              <div className="rounded-[6px] border border-[#E0E0E0] overflow-hidden divide-y divide-[#EDEBE9]">
                <div className="p-3 bg-[#F3F9FD] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-[4px] bg-[#0F6CBD] text-white font-bold text-[11px] flex items-center justify-center">
                      1
                    </span>
                    <div>
                      <div className="font-bold text-[#242424] text-[12.5px]">
                        Anda (Porsi Pribadi)
                      </div>
                      <div className="text-[11px] text-[#107C41] font-semibold">
                        Hanya angka ini yang masuk ke Pengeluaran &amp; Anggaran Makanan!
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-[#616161]">Rp</span>
                    <input
                      type="number"
                      value={sbMyPortion}
                      onChange={(e) => {
                        setSbSplitMethod('custom');
                        setSbMyPortion(e.target.value);
                      }}
                      className="w-36 h-[30px] px-2.5 rounded-[4px] bg-white border border-[#0F6CBD] font-bold text-right tabular-nums text-[#0F6CBD]"
                    />
                  </div>
                </div>

                {sbFriends.map((friend, idx) => (
                  <div
                    key={friend.id}
                    className="p-3 bg-white flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-6 h-6 rounded-[4px] bg-[#FFF4CE] text-[#D83B01] font-bold text-[11px] flex items-center justify-center">
                        {idx + 2}
                      </span>
                      <div>
                        <input
                          type="text"
                          value={friend.name}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSbFriends((prev) =>
                              prev.map((item) =>
                                item.id === friend.id ? { ...item, name: val } : item
                              )
                            );
                          }}
                          className="h-[28px] px-2 rounded-[4px] border border-[#D1D1D1] font-semibold text-[#242424]"
                        />
                        <span className="ml-2 px-2 py-0.5 rounded-[4px] bg-[#FFF4CE] text-[#D83B01] text-[11px] font-semibold">
                          Masuk ke Piutang Talangan
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-[#616161]">Rp</span>
                      <input
                        type="number"
                        value={friend.amount}
                        onChange={(e) => {
                          setSbSplitMethod('custom');
                          const val = e.target.value;
                          setSbFriends((prev) =>
                            prev.map((item) =>
                              item.id === friend.id ? { ...item, amount: val } : item
                            )
                          );
                        }}
                        className="w-36 h-[30px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1] font-bold text-right tabular-nums text-[#D83B01]"
                      />
                      {sbFriends.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setSbFriends((prev) => prev.filter((item) => item.id !== friend.id))
                          }
                          className="p-1 text-[#616161] hover:text-[#C50F1F] cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </form>
          )}

          {/* TAB 4: PEMASUKAN & REFUND */}
          {activeTab === 'pemasukan' && (
            <form id="tx-form" onSubmit={handleSubmitForm} className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-[#242424] mb-2">
                  Pilihan Sifat Uang Masuk (Jenis Inflow):
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  <label
                    onClick={() => {
                      setIncInflowType('active');
                      setIncSourceTitle('PT Nusantara Digital Tbk');
                      setIncAmount('18500000');
                    }}
                    className={`p-3 rounded-[6px] border cursor-pointer transition-all ${
                      incInflowType === 'active'
                        ? 'bg-[#E6F4EA]/60 border-[#107C41] ring-1 ring-[#107C41]/30'
                        : 'bg-white border-[#E0E0E0] hover:bg-[#FAF9F8]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="radio"
                        checked={incInflowType === 'active'}
                        onChange={() => setIncInflowType('active')}
                        className="mt-0.5 accent-[#107C41]"
                      />
                      <div>
                        <div className="font-bold text-[12px] text-[#107C41]">
                          Penghasilan Aktif (Gaji / Bonus / Usaha)
                        </div>
                        <div className="text-[11px] text-[#616161] mt-1">
                          Masuk ke grafik Income &amp; memicu Alokasi Otomatis.
                        </div>
                      </div>
                    </div>
                  </label>

                  <label
                    onClick={() => {
                      setIncInflowType('passive');
                      setIncSourceTitle('SeaBank Indonesia (Bunga Tabungan)');
                      setIncAmount('78125');
                      setIncTaxWithheld('15625');
                    }}
                    className={`p-3 rounded-[6px] border cursor-pointer transition-all ${
                      incInflowType === 'passive'
                        ? 'bg-[#EBF3FC] border-[#0F6CBD] ring-1 ring-[#0F6CBD]/30'
                        : 'bg-white border-[#E0E0E0] hover:bg-[#FAF9F8]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="radio"
                        checked={incInflowType === 'passive'}
                        onChange={() => setIncInflowType('passive')}
                        className="mt-0.5 accent-[#0F6CBD]"
                      />
                      <div>
                        <div className="font-bold text-[12px] text-[#0F6CBD]">
                          Penghasilan Pasif (Bunga Tabungan / Dividen)
                        </div>
                        <div className="text-[11px] text-[#616161] mt-1">
                          Mencatat bunga/dividen beserta potongan Pajak PPh.
                        </div>
                      </div>
                    </div>
                  </label>

                  <label
                    onClick={() => {
                      setIncInflowType('refund');
                      setIncSourceTitle('Refund Batal Belanja / Cashback');
                      setIncAmount('125000');
                    }}
                    className={`p-3 rounded-[6px] border cursor-pointer transition-all ${
                      incInflowType === 'refund'
                        ? 'bg-[#FFF4CE]/60 border-[#D83B01] ring-1 ring-[#D83B01]/30'
                        : 'bg-white border-[#E0E0E0] hover:bg-[#FAF9F8]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="radio"
                        checked={incInflowType === 'refund'}
                        onChange={() => setIncInflowType('refund')}
                        className="mt-0.5 accent-[#D83B01]"
                      />
                      <div>
                        <div className="font-bold text-[12px] text-[#D83B01]">
                          Refund Batal Belanja / Cashback
                        </div>
                        <div className="text-[11px] text-[#616161] mt-1">
                          Memilih kategori pengeluaran yang dikurangi (net-off) agar tidak menggelembungkan grafik penghasilan.
                        </div>
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-[11.5px] font-semibold text-[#242424] mb-1">
                    Rekening Penerima
                  </label>
                  <select
                    value={incTargetAcc}
                    onChange={(e) => setIncTargetAcc(e.target.value)}
                    className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1] font-medium"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.name}>
                        {a.name} ({formatIDR(a.balance)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11.5px] font-semibold text-[#242424] mb-1">
                    Sumber Pemberi / Keterangan
                  </label>
                  <input
                    type="text"
                    value={incSourceTitle}
                    onChange={(e) => setIncSourceTitle(e.target.value)}
                    className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1]"
                  />
                </div>

                <div>
                  <label className="block text-[11.5px] font-semibold text-[#107C41] mb-1">
                    Nominal Uang Masuk (Rp)
                  </label>
                  <input
                    type="number"
                    value={incAmount}
                    onChange={(e) => setIncAmount(e.target.value)}
                    className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#107C41] font-bold text-[13.5px] tabular-nums"
                  />
                </div>
              </div>

              {incInflowType === 'active' && (
                <div className="p-3 rounded-[6px] bg-[#E6F4EA]/40 border border-[#107C41]/30">
                  <label className="flex items-center gap-2 text-[12px] font-medium text-[#242424] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={incAutoAllocate}
                      onChange={(e) => setIncAutoAllocate(e.target.checked)}
                      className="accent-[#107C41]"
                    />
                    <span>
                      Picu aturan <strong>Alokasi Otomatis 20% ke bluSaving</strong> ({formatIDR(
                        Math.round(numIncGross * 0.2)
                      )})
                    </span>
                  </label>
                </div>
              )}

              {incInflowType === 'passive' && (
                <div className="p-3 rounded-[6px] bg-[#FAF9F8] border border-[#E0E0E0] grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#D83B01] mb-1">
                      Potongan Pajak Bunga PPh 20% / Dividen (Rp)
                    </label>
                    <input
                      type="number"
                      value={incTaxWithheld}
                      onChange={(e) => setIncTaxWithheld(e.target.value)}
                      className="w-full h-[30px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1] tabular-nums"
                    />
                  </div>
                  <div className="flex flex-col justify-center">
                    <span className="text-[11px] text-[#616161]">Masuk Bersih ke {incTargetAcc}:</span>
                    <span className="text-[14px] font-bold text-[#107C41] tabular-nums">
                      +{formatIDR(numIncNet)}
                    </span>
                  </div>
                </div>
              )}

              {incInflowType === 'refund' && (
                <div className="p-3.5 rounded-[6px] bg-[#FFF4CE]/55 border border-[#D83B01]/40 space-y-2">
                  <label className="block text-[12px] font-bold text-[#D83B01]">
                    Kategori Pengeluaran yang Dikurangi (Net-Off):
                  </label>
                  <select
                    value={incNetOffCategory}
                    onChange={(e) => setIncNetOffCategory(e.target.value)}
                    className="w-full h-[32px] px-2.5 rounded-[4px] bg-white border border-[#D83B01]/50 font-semibold"
                  >
                    <option value="Makanan & Restoran">Makanan &amp; Restoran</option>
                    <option value="Belanja Kebutuhan Rumah">Belanja Kebutuhan Rumah</option>
                    <option value="Transportasi, BBM & Tol">Transportasi, BBM &amp; Tol</option>
                    <option value="Olahraga, Hobi & Hiburan">Olahraga, Hobi &amp; Hiburan</option>
                  </select>
                  <div className="text-[11.5px] text-[#616161]">
                    Pemakaian anggaran <strong>{incNetOffCategory}</strong> akan dikurangi sebesar{' '}
                    <strong className="text-[#107C41]">-{formatIDR(numIncNet)}</strong> (Net-Off).
                  </div>
                </div>
              )}
            </form>
          )}

          {/* TAB 5: BAYAR TAGIHAN / TERIMA GANTI */}
          {activeTab === 'pelunasan' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 p-1 rounded-[6px] bg-[#FAF9F8] border border-[#E0E0E0]">
                <button
                  type="button"
                  onClick={() => setSettleSubMode('pay_credit')}
                  className={`h-[32px] rounded-[4px] font-semibold text-[12px] cursor-pointer flex items-center justify-center gap-2 ${
                    settleSubMode === 'pay_credit'
                      ? 'bg-[#0F6CBD] text-white'
                      : 'text-[#616161] hover:text-[#242424]'
                  }`}
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Melunasi Tagihan Statement PayLater</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSettleSubMode('receive_friend')}
                  className={`h-[32px] rounded-[4px] font-semibold text-[12px] cursor-pointer flex items-center justify-center gap-2 ${
                    settleSubMode === 'receive_friend'
                      ? 'bg-[#107C41] text-white'
                      : 'text-[#616161] hover:text-[#242424]'
                  }`}
                >
                  <Users className="w-4 h-4" />
                  <span>Mencatat Pelunasan Uang Talangan Teman</span>
                </button>
              </div>

              {settleSubMode === 'pay_credit' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[12px] text-[#242424]">
                      Rekening Sumber Pembayaran:
                    </span>
                    <select
                      value={creditPaySourceAcc}
                      onChange={(e) => setCreditPaySourceAcc(e.target.value)}
                      className="h-[30px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1] font-semibold"
                    >
                      {accounts
                        .filter((a) => a.category === 'kas_bank_ewallet')
                        .map((a) => (
                          <option key={a.id} value={a.name}>
                            {a.name} — Saldo {formatIDR(a.balance)}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    {creditFacilities.map((cr) => (
                      <div
                        key={cr.id}
                        className="p-3 rounded-[6px] bg-white border border-[#E0E0E0] flex flex-wrap items-center justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-[13.5px] text-[#242424]">{cr.name}</span>
                            <span className="px-2 py-0.5 rounded-[4px] bg-[#FDE7E9] text-[#C50F1F] text-[11px] font-semibold">
                              Jatuh Tempo {cr.currentBillDueDate}
                            </span>
                          </div>
                          <div className="text-[11.5px] text-[#616161] mt-0.5">
                            Tagihan Periode Berjalan:{' '}
                            <strong className="text-[#C50F1F] tabular-nums">
                              {formatIDR(cr.currentPeriodBill)}
                            </strong>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={cr.currentPeriodBill <= 0}
                          onClick={() => {
                            onPayCreditBill(cr.id, creditPaySourceAcc, cr.currentPeriodBill);
                            onClose();
                          }}
                          className="h-[30px] px-3.5 rounded-[4px] bg-[#0F6CBD] hover:bg-[#115EA3] disabled:bg-[#C8C6C4] text-white font-semibold text-[11.5px] cursor-pointer"
                        >
                          {cr.currentPeriodBill > 0
                            ? `Lunasi 1-Klik (${formatIDR(cr.currentPeriodBill)})`
                            : 'Lunas ✓'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[12px] text-[#242424]">
                      Rekening / E-Wallet Penerima:
                    </span>
                    <select
                      value={selectedFriendReceiverAcc}
                      onChange={(e) => setSelectedFriendReceiverAcc(e.target.value)}
                      className="h-[30px] px-2.5 rounded-[4px] bg-white border border-[#D1D1D1] font-semibold"
                    >
                      {accounts
                        .filter((a) => a.category === 'kas_bank_ewallet')
                        .map((a) => (
                          <option key={a.id} value={a.name}>
                            {a.name} — Saldo {formatIDR(a.balance)}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    {splitBills.map((sb) =>
                      sb.participants.map((p) => {
                        const rem = Math.max(0, p.portion - p.paidAmount);
                        return (
                          <div
                            key={`${sb.id}-${p.id}`}
                            className="p-3 rounded-[6px] bg-white border border-[#E0E0E0] flex items-center justify-between gap-3"
                          >
                            <div>
                              <div className="font-bold text-[13px] text-[#242424]">
                                {p.name}{' '}
                                <span className="font-normal text-[11.5px] text-[#616161]">
                                  — {sb.title}
                                </span>
                              </div>
                              <div className="text-[11px] text-[#616161]">
                                Porsi: {formatIDR(p.portion)} ·{' '}
                                <strong className="text-[#D83B01]">Sisa: {formatIDR(rem)}</strong>
                              </div>
                            </div>

                            {rem > 0 ? (
                              <button
                                type="button"
                                onClick={() => {
                                  onSettleSplitParticipant(
                                    sb.id,
                                    p.id,
                                    rem,
                                    selectedFriendReceiverAcc
                                  );
                                  onClose();
                                }}
                                className="h-[30px] px-3 rounded-[4px] bg-[#107C41] hover:bg-[#0E6A37] text-white font-semibold text-[11.5px] cursor-pointer shrink-0"
                              >
                                Terima Ganti 1-Klik ({formatIDR(rem)})
                              </button>
                            ) : (
                              <span className="px-2 py-0.5 rounded-[4px] bg-[#E6F4EA] text-[#107C41] font-semibold text-[11px]">
                                Lunas ✓
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Dialog Footer */}
        <div className="h-[48px] px-5 bg-[#FAF9F8] border-t border-[#E0E0E0] flex items-center justify-between shrink-0">
          <div className="text-[11px] text-[#616161] flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-[#0F6CBD]" />
            <span>Jurnal ganda otomatis memperbarui Buku Mutasi, Saldo &amp; Anggaran.</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-[30px] px-3.5 rounded-[4px] border border-[#D1D1D1] bg-white hover:bg-[#F3F2F1] text-[#242424] font-medium text-[12px] cursor-pointer"
            >
              Batal
            </button>
            {activeTab !== 'pelunasan' && (
              <button
                type="submit"
                form="tx-form"
                className="h-[30px] px-4 rounded-[4px] bg-[#0F6CBD] hover:bg-[#115EA3] text-white font-semibold text-[12px] flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Simpan Transaksi</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
