import type { ReportingPeriod } from "./periods";
import type { ChargeBucket } from "./domain";
import type { InvestmentTotal } from "../investments/types";
import type { financeSnapshot } from "../finance/summary";
export type AnalyticsOrigin = "manual" | "automation" | "allocation_adjustment";
/** P6B preference contract only. No persistence or client-only preference state in P6A. */
export type HomeMetricKey = "spendable" | "liquid_assets" | "known_assets" | "after_obligations"
  | "monthly_spending" | "investment_market" | "investment_unrealized";
export type HomeMetricPreferenceDraft = { version: 1; orderedVisibleMetrics: HomeMetricKey[] };
export type FinancialMeasures = {
  currency: string; exponent: number;
  incomeMinor: string; expensePrincipalMinor: string; feesMinor: string; taxesMinor: string;
  otherChargesMinor: string; transferFeesMinor: string; chargesMinor: string;
  spendingMinor: string; netMinor: string; transferPrincipalMinor: string;
  activityCount: string; incomeCount: string; expenseCount: string; transferCount: string;
};
export type DimensionRow = FinancialMeasures & {
  key: string;
  id: string | null;
  name: string;
  archived: boolean;
  transferInMinor?: string;
  transferInCount?: string;
};
export type ChargeReport = { currency: string; exponent: number; typeId: string; name: string;
  systemKey: string | null; bucket: ChargeBucket; archived: boolean; activityKind: string; amountMinor: string; chargeCount: string };
export type InvestmentFlows = { currency: string; exponent: number; purchasePrincipalMinor: string;
  saleProceedsMinor: string; feesMinor: string; netCashMinor: string; tradeCount: string };
export type AnalyticsExpenseItem = {
  id: string;
  occurredAt: string;
  currency: string;
  exponent: number;
  baseAmountMinor: string;
  chargesMinor: string;
  spendingMinor: string;
  categoryId: string | null;
  categoryName: string | null;
  sourceAssetId: string;
  sourceName: string;
  isCreditSource?: boolean;
  note: string | null;
  origin: AnalyticsOrigin;
  charges: { typeId: string; name?: string; amountMinor: string }[];
};
export type AnalyticsCreditFacility = {
  id: string;
  name: string;
  providerName: string | null;
  isActive: boolean;
  currentBillMinor: string;
  currentDueIso: string;
  nextBillMinor: string;
  nextDueIso: string;
  /** Installments due after nextDueIso; included in totalUnpaidMinor. */
  laterBillMinor: string;
  totalUnpaidMinor: string;
  limitMinor: string;
  availableLimitMinor: string | null;
  dueDay: number;
  cutoffDay: number;
  periodSpendingMinor: string;
  periodExpenseCount: string;
  /** Principal moved out of the facility by transfer (e.g. e-money top-up via PayLater); fees stay in spending. */
  periodDrawdownMinor: string;
  periodDrawdownCount: string;
  /** Everything the facility financed in the period: spending (incl. fees/interest) plus transfer principal. */
  periodUsageMinor: string;
  periodRepaymentMinor: string;
  periodRepaymentCount: string;
};
export type AnalyticsObligationItem = {
  id: string;
  title: string;
  labelName: string;
  amountMinor: string;
  coveredMinor: string;
  uncoveredMinor: string;
  dueOn: string;
  status: "open" | "settled";
};
export type AnalyticsBillCategoryItem = {
  key: string;
  name: string;
  spendingMinor: string;
  expenseCount: string;
  archived: boolean;
};
export type AnalyticsCreditAndBills = {
  currency: string;
  exponent: number;
  cashSpendingMinor: string;
  creditSpendingMinor: string;
  /** Transfer principal drawn from credit facilities; not spending, but it raises the credit bill. */
  creditDrawdownMinor: string;
  creditDrawdownCount: string;
  creditExpenseCount: string;
  creditRepaymentMinor: string;
  creditRepaymentCount: string;
  currentCycleBillsMinor: string;
  nextCycleBillsMinor: string;
  totalCreditUnpaidMinor: string;
  facilities: AnalyticsCreditFacility[];
  billCategorySpendingMinor: string;
  billCategoryCount: string;
  billCategories?: AnalyticsBillCategoryItem[];
  automatedSpendingMinor: string;
  automatedExpenseCount: string;
  openObligationsMinor: string;
  openObligationsUncoveredMinor: string;
  openObligationsCount: number;
  settledInPeriodMinor: string;
  settledInPeriodCount: number;
  obligations: AnalyticsObligationItem[];
};
export type AnalyticsReport = {
  version: "p6a.v1"; generatedAt: string; period: ReportingPeriod;
  summary: FinancialMeasures[]; byCategory: DimensionRow[]; byAccount: DimensionRow[];
  byOrigin: DimensionRow[]; monthly: DimensionRow[]; daily: DimensionRow[]; charges: ChargeReport[];
  investmentFlows: InvestmentFlows[];
  byIncomeCategory?: DimensionRow[];
  byWeekday?: DimensionRow[];
  expenseItems?: AnalyticsExpenseItem[];
  creditAndBills?: AnalyticsCreditAndBills[];
  comparison: { period: ReportingPeriod; partialComparison: boolean; method: "full_previous_period";
    currencies: { currency: string; income: ReturnType<typeof import("./domain").periodChange>;
      spending: ReturnType<typeof import("./domain").periodChange>; net: ReturnType<typeof import("./domain").periodChange> }[] };
  context: null | { scope: "current_snapshot_not_period_end"; throughDay: string; planningReady: boolean;
    currencies: Awaited<ReturnType<typeof financeSnapshot>>["currencies"]; investments: InvestmentTotal[] };
};
