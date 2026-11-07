import { assertStoredMinor, assertCurrencyCode } from "./money.ts";
import { requireActive, type CatalogItem } from "./catalog.ts";

export type AssetReference = Readonly<{ id: string; currency: string; isActive: boolean; assetClass?: "asset" | "liability" | "receivable" }>;
export type AdjustmentReason = "reconciliation" | "opening_debt";
export type CategoryReference = CatalogItem & Readonly<{ appliesTo: "income" | "expense" }>;
export type ChargeInput = Readonly<{ id: string; amountMinor: bigint; type: CatalogItem }>;
type BaseActivity = Readonly<{ amountMinor: bigint; category?: CategoryReference }>;
export type ActivityInput =
  | (BaseActivity & Readonly<{ kind: "income"; destination: AssetReference }>)
  | (BaseActivity & Readonly<{ kind: "expense"; source: AssetReference; charges?: readonly ChargeInput[] }>)
  | Readonly<{ kind: "transfer"; amountMinor: bigint; source: AssetReference; destination: AssetReference; transferFee?: ChargeInput }>
  /** Loan disbursed: the liability account funds the destination. Not income. */
  | Readonly<{ kind: "borrow"; amountMinor: bigint; source: AssetReference; destination: AssetReference }>
  /** Loan repayment: principal reduces the liability (not an expense); interest is a charge (an expense). */
  | Readonly<{ kind: "repay"; amountMinor: bigint; source: AssetReference; destination: AssetReference; interest?: ChargeInput }>
  /** Money returned for an earlier expense; reduces that expense category, not income. */
  | Readonly<{ kind: "refund"; amountMinor: bigint; destination: AssetReference; category?: CategoryReference }>
  /** Balance difference: exactly one side (destination = increase, source = decrease). */
  | Readonly<{ kind: "adjustment"; amountMinor: bigint; reason: AdjustmentReason; source?: AssetReference; destination?: AssetReference }>;

export type PlannedMovement = Readonly<{
  assetId: string;
  currency: string;
  amountMinor: bigint;
  component: "principal" | "charge";
  chargeId?: string;
}>;
export type ActivityPlan = Readonly<{
  kind: ActivityInput["kind"];
  currency: string;
  baseAmountMinor: bigint;
  charges: readonly ChargeInput[];
  movements: readonly PlannedMovement[];
  totalOutflowMinor: bigint;
  netAssetEffectMinor: bigint;
}>;

function positiveStoredAmount(amount: bigint): bigint {
  assertStoredMinor(amount);
  if (amount <= 0n) throw new Error("Activity and charge amounts must be positive");
  return amount;
}

function activeAsset(asset: AssetReference | undefined): AssetReference {
  if (!asset) throw new Error("Asset reference is required");
  if (!asset.id.trim()) throw new Error("Asset ID is required");
  requireActive(asset, asset.id);
  assertCurrencyCode(asset.currency);
  return asset;
}

function activeCategory(category: CategoryReference | undefined, kind: "income" | "expense"): void {
  if (!category) return;
  if (!category.id.trim()) throw new Error("Category ID is required");
  requireActive(category, category.id);
  if (category.appliesTo !== kind) throw new Error("Category does not apply to activity kind");
}

function activeCharge(charge: ChargeInput): void {
  if (!charge.id.trim()) throw new Error("Charge ID is required");
  positiveStoredAmount(charge.amountMinor);
  requireActive(charge.type, charge.type?.id ?? "");
}

/** Creates a pure, exact posting plan; P3 owns atomic database posting. */
export function planActivity(input: ActivityInput): ActivityPlan {
  const principal = positiveStoredAmount(input.amountMinor);
  const movements: PlannedMovement[] = [];
  let currency: string;
  let charges: readonly ChargeInput[] = [];
  let totalOutflowMinor = 0n;

  if (input.kind === "income") {
    const destination = activeAsset(input.destination);
    activeCategory(input.category, "income");
    currency = destination.currency;
    movements.push({ assetId: destination.id, currency, amountMinor: principal, component: "principal" });
  } else if (input.kind === "expense") {
    const source = activeAsset(input.source);
    activeCategory(input.category, "expense");
    currency = source.currency;
    charges = input.charges ?? [];
    const chargeIds = new Set<string>();
    movements.push({ assetId: source.id, currency, amountMinor: -principal, component: "principal" });
    for (const charge of charges) {
      activeCharge(charge);
      if (chargeIds.has(charge.id)) throw new Error("Duplicate charge ID");
      chargeIds.add(charge.id);
      movements.push({ assetId: source.id, currency, amountMinor: -charge.amountMinor, component: "charge", chargeId: charge.id });
    }
    totalOutflowMinor = principal + charges.reduce((sum, charge) => sum + charge.amountMinor, 0n);
  } else if (input.kind === "borrow" || input.kind === "repay") {
    const source = activeAsset(input.source);
    const destination = activeAsset(input.destination);
    if (source.id === destination.id) throw new Error("Source and destination must differ");
    if (source.currency !== destination.currency) throw new Error("Currency mismatch");
    const debt = input.kind === "borrow" ? source : destination;
    if (debt.assetClass !== "liability") throw new Error("Pinjaman dan pelunasan memerlukan akun liability");
    currency = source.currency;
    movements.push(
      { assetId: source.id, currency, amountMinor: -principal, component: "principal" },
      { assetId: destination.id, currency, amountMinor: principal, component: "principal" },
    );
    if (input.kind === "repay" && input.interest) {
      const interest = input.interest;
      activeCharge(interest);
      if (interest.type.systemKey !== "loan_interest") throw new Error("Bunga pelunasan memerlukan jenis biaya loan_interest");
      charges = [interest];
      movements.push({ assetId: source.id, currency, amountMinor: -interest.amountMinor, component: "charge", chargeId: interest.id });
    }
    totalOutflowMinor = input.kind === "repay" ? principal + (charges[0]?.amountMinor ?? 0n) : 0n;
  } else if (input.kind === "refund") {
    const destination = activeAsset(input.destination);
    activeCategory(input.category, "expense");
    currency = destination.currency;
    movements.push({ assetId: destination.id, currency, amountMinor: principal, component: "principal" });
  } else if (input.kind === "adjustment") {
    if (Boolean(input.source) === Boolean(input.destination)) throw new Error("Penyesuaian hanya boleh di satu sisi akun");
    const asset = activeAsset(input.source ?? input.destination);
    if (input.reason === "opening_debt" && (!input.source || asset.assetClass !== "liability")) {
      throw new Error("Utang awal memerlukan akun liability sebagai sumber");
    }
    currency = asset.currency;
    movements.push({ assetId: asset.id, currency, amountMinor: input.source ? -principal : principal, component: "principal" });
  } else {
    const source = activeAsset(input.source);
    const destination = activeAsset(input.destination);
    if (source.id === destination.id) throw new Error("Transfer source and destination must differ");
    if (source.currency !== destination.currency) throw new Error("Currency mismatch in transfer");
    currency = source.currency;
    movements.push(
      { assetId: source.id, currency, amountMinor: -principal, component: "principal" },
      { assetId: destination.id, currency, amountMinor: principal, component: "principal" },
    );
    if (input.transferFee) {
      const fee = input.transferFee;
      if (fee.amountMinor !== 0n) {
        activeCharge(fee);
        if (!fee.type.isBuiltIn || fee.type.systemKey !== "transfer_fee") {
          throw new Error("Transfer fee requires built-in transfer_fee system key");
        }
        charges = [fee];
        movements.push({ assetId: source.id, currency, amountMinor: -fee.amountMinor, component: "charge", chargeId: fee.id });
      }
    }
    totalOutflowMinor = principal + (charges[0]?.amountMinor ?? 0n);
  }

  return {
    kind: input.kind,
    currency,
    baseAmountMinor: principal,
    charges,
    movements,
    totalOutflowMinor,
    netAssetEffectMinor: movements.reduce((sum, movement) => sum + movement.amountMinor, 0n),
  };
}
