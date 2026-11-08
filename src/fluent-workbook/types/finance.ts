export type NavPageId =
  | 'home'
  | 'mutasi'
  | 'rekening'
  | 'kredit'
  | 'investasi'
  | 'perencanaan'
  | 'analitik';

export type TransactionType =
  | 'Pemasukan'
  | 'Pengeluaran'
  | 'Split Bill'
  | 'Transfer / Top-Up'
  | 'Bayar Kredit'
  | 'Investasi'
  | 'Bunga & Pajak';

export interface SplitParticipant {
  id: string;
  name: string;
  portion: number;
  paidAmount: number;
  status: 'Belum Bayar' | 'Dicicil' | 'Lunas';
  paidDate?: string;
  paidToAccount?: string;
}

export interface TransactionItem {
  id: string;
  refCode: string;
  date: string; // e.g., "14 Nov 2026"
  time: string; // e.g., "19:42"
  type: TransactionType;
  sourceAccount: string;
  targetAccount?: string;
  category: string;
  note: string;
  principalAmount: number; // Nominal Pokok
  adminFee: number; // Biaya Admin / Bunga / Layanan
  totalMutation: number; // Total uang keluar/masuk rekening sumber
  direction: 'in' | 'out' | 'transfer';
  personalConsumptionAmount: number; // Untuk Mode Konsumsi Murni vs Arus Kas Riil
  isVoided?: boolean;
  correctionHistory?: {
    date: string;
    oldAmount: number;
    newAmount: number;
    reason: string;
  }[];
  splitBillSessionId?: string;
  sourceAssetId?: string | null;
  destinationAssetId?: string | null;
  categoryId?: string | null;
  rawKind?: string;
}

export type AccountCategory = 'kas_bank_ewallet' | 'tabungan_deposito' | 'emoney';

export interface AssetAccount {
  id: string;
  name: string;
  institution: string;
  accountNumber: string;
  category: AccountCategory;
  subtype: 'Bank Utama' | 'E-Wallet' | 'Tunai' | 'Tabungan Bunga Tinggi' | 'Deposito' | 'Kartu E-Money' | string;
  balance: number;
  isSpendable?: boolean;
  interestRatePa?: number; // e.g. 3.75
  interestRatePA?: number;
  taxRate?: number; // e.g. 20
  taxRateOnInterest?: number;
  disbursementDay?: number; // e.g. 1
  estimatedNetInterestMonthly?: number; // e.g. 62500
  monthlyAdminFee: number;
  lastReconciled: string;
  isLockedReserve?: boolean;
  cardNumberMasked?: string;
  notes?: string;
  assetTypeId?: string;
  providerId?: string | null;
  normallyLiquid?: boolean;
  normallySpendable?: boolean;
}

export interface CreditFacility {
  id: string;
  name: string;
  provider: string;
  type: 'PayLater' | 'Kartu Kredit' | string;
  creditLimit: number;
  availableLimit: number;
  usedLimit: number;
  cutoffDay: number;
  dueDay: number;
  currentBillDueDate: string; // e.g. "1 Des 2026"
  currentPeriodBill: number; // Tagihan periode berjalan
  nextBillDueDate: string; // e.g. "1 Jan 2027"
  nextPeriodBill: number; // Tagihan periode depan
  interestRateMonthly: string;
  lateFeeRule: string;
  status: 'Belum Jatuh Tempo' | 'Segera Jatuh Tempo' | 'Lunas Bulan Ini' | 'Belum Dibayar' | string;
}

export interface InstallmentContract {
  id: string;
  itemName: string;
  facilityName: string;
  merchant: string;
  purchaseDate: string;
  currentInstallment: number;
  totalTenor: number;
  totalPrincipal?: number;
  monthlyPrincipal: number;
  monthlyInterest: number;
  monthlyInterestAndFee?: number;
  monthlyTotal: number;
  remainingPrincipal: number;
  remainingTotal: number;
  remainingLiability?: number;
  nextDueDate: string;
  status: 'Berjalan' | 'Segera Lunas' | 'Lunas' | string;
}

export interface SplitBillSession {
  id: string;
  title: string;
  date: string;
  paidUsingAccount: string;
  paidViaAccount?: string;
  category: string;
  totalReceipt: number;
  myPortion: number;
  myPersonalPortion?: number;
  friendsTotalPortion: number;
  participants: SplitParticipant[];
  notes: string;
}

export interface InvestmentHolding {
  id: string;
  code: string;
  name: string;
  platform: 'Bibit' | 'Stockbit' | 'Pintu' | 'Bareksa' | string;
  assetClass: 'Reksa Dana Pasar Uang' | 'Reksa Dana Obligasi' | 'Saham IDX' | 'Crypto' | string;
  units: number;
  unitLabel: string; // 'Unit' | 'Lot' | 'BTC'
  avgCostPrice: number;
  avgBuyPrice?: number;
  marketPrice: number;
  principalValue: number; // Nilai Pokok
  marketValue: number; // Nilai Pasar
  unrealizedPL: number;
  unrealizedPLPercent: number;
  lastUpdated: string;
  allocationTargetPercent: number;
}

export interface InvestmentTransaction {
  id: string;
  date: string;
  instrumentCode: string;
  instrumentName: string;
  platform: string;
  action: 'Beli (DCA)' | 'Beli (Lump Sum)' | 'Jual Sebagian' | 'Dividen Tunai' | string;
  type?: string;
  units: number;
  pricePerUnit: number;
  feeAndTax: number;
  netTotal: number;
  totalAmount?: number;
  sourceAccount?: string;
  sourceOrTargetAccount: string;
}

export interface BudgetItem {
  id: string;
  category: string;
  group: 'Kebutuhan Pokok' | 'Gaya Hidup' | 'Transportasi' | 'Beban Keuangan' | string;
  monthlyLimit: number;
  usedConsumption: number; // Mode Konsumsi Murni
  usedCashflow: number; // Mode Arus Kas Riil (termasuk talangan)
  txCount: number;
  remainingDays: number;
  notes: string;
}

export interface GoalReserveItem {
  id: string;
  title: string;
  type: 'Dana Darurat' | 'Sinking Fund Tahunan' | 'Target Pembelian' | string;
  storedInAccount: string;
  targetAmount: number;
  currentAmount: number;
  monthlyContribution: number;
  targetDate: string;
  priority: 'Kritis' | 'Tinggi' | 'Menengah' | string;
}

export interface RoutineObligation {
  id: string;
  name: string;
  provider: string;
  category: string;
  dueDay: number;
  dueDateLabel: string;
  dueDate?: string;
  daysRemaining?: number;
  amount: number;
  sourceAccount: string;
  isVariableAmount: boolean;
  status: 'Lunas' | 'Menunggu Pembayaran' | 'Jatuh Tempo < 5 Hari' | string;
  autopay: boolean;
  isCoveredByReserve?: boolean;
}

export interface AutomationItem {
  id: string;
  title: string;
  description: string;
  scheduleLabel: string;
  sourceAccount: string;
  targetAccount: string;
  amount: number;
  adminFee: number;
  type: 'Alokasi Gaji' | 'Autodebet Tagihan' | 'Bunga Tabungan' | 'Investasi Rutin (DCA)' | string;
  status: 'Perlu Konfirmasi' | 'Terkonfirmasi' | 'Dilewati' | 'Jadwal Aktif' | string;
}

export interface AuditLogItem {
  id: string;
  timestamp: string;
  txRefCode: string;
  actionType: 'Koreksi Nominal' | 'Void / Pembatalan' | 'Rekonsiliasi Saldo' | 'Penyesuaian Split Bill';
  accountAffected: string;
  previousValue: number;
  newValue: number;
  reason: string;
  operator: string;
}

export type InspectorPayload =
  | { kind: 'transaction'; data: TransactionItem }
  | { kind: 'account'; data: AssetAccount }
  | { kind: 'credit'; data: CreditFacility }
  | { kind: 'installment'; data: InstallmentContract }
  | { kind: 'splitbill'; data: SplitBillSession }
  | { kind: 'investment'; data: InvestmentHolding }
  | { kind: 'budget'; data: BudgetItem }
  | { kind: 'goal'; data: GoalReserveItem }
  | { kind: 'obligation'; data: RoutineObligation };

export interface CashflowMonthPoint {
  month: string;
  income: number;
  consumption: number;
  cashflowOut: number;
  adminAndInterest: number;
}

export interface WorkbookSummary {
  currency: string;
  exponent: number;
  trueNetWorth: number;
  spendableCash: number;
  cashAndBank: number;
  highYieldSavings: number;
  eMoney: number;
  investmentsValue: number;
  receivables: number;
  totalLiabilities: number;
  lockedReserve: number;
  upcomingCreditBills: number;
  monthlyIncome: number;
  monthlyPureConsumption: number;
  monthlyRealCashOut: number;
  sixMonthTrend: CashflowMonthPoint[];
  catalogs: {
    expenseCategories: { id: string; name: string; group: string }[];
    incomeCategories: { id: string; name: string }[];
    assetTypes: { id: string; name: string }[];
    providers: { id: string; name: string }[];
    chargeTypes: { id: string; name: string; systemKey: string | null }[];
  };
}
