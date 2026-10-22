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
export type DimensionRow = FinancialMeasures & { key: string; id: string | null; name: string; archived: boolean };
export type ChargeReport = { currency: string; exponent: number; typeId: string; name: string;
  systemKey: string | null; bucket: ChargeBucket; archived: boolean; activityKind: string; amountMinor: string; chargeCount: string };
export type InvestmentFlows = { currency: string; exponent: number; purchasePrincipalMinor: string;
  saleProceedsMinor: string; feesMinor: string; netCashMinor: string; tradeCount: string };
export type AnalyticsReport = {
  version: "p6a.v1"; generatedAt: string; period: ReportingPeriod;
  summary: FinancialMeasures[]; byCategory: DimensionRow[]; byAccount: DimensionRow[];
  byOrigin: DimensionRow[]; monthly: DimensionRow[]; daily: DimensionRow[]; charges: ChargeReport[];
  investmentFlows: InvestmentFlows[];
  comparison: { period: ReportingPeriod; partialComparison: boolean; method: "full_previous_period";
    currencies: { currency: string; income: ReturnType<typeof import("./domain").periodChange>;
      spending: ReturnType<typeof import("./domain").periodChange>; net: ReturnType<typeof import("./domain").periodChange> }[] };
  context: null | { scope: "current_snapshot_not_period_end"; throughDay: string; planningReady: boolean;
    currencies: Awaited<ReturnType<typeof financeSnapshot>>["currencies"]; investments: InvestmentTotal[] };
};
