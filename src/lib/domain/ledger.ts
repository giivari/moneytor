import { assertStoredMinor, assertCurrencyCode } from "./money.ts";
import { requireActive, type CatalogItem } from "./catalog.ts";

export type AssetReference = Readonly<{ id: string; currency: string; isActive: boolean }>;
export type CategoryReference = CatalogItem & Readonly<{ appliesTo: "income" | "expense" }>;
export type ChargeInput = Readonly<{ id: string; amountMinor: bigint; type: CatalogItem }>;
type BaseActivity = Readonly<{ amountMinor: bigint; category?: CategoryReference }>;
export type ActivityInput =
  | (BaseActivity & Readonly<{ kind: "income"; destination: AssetReference }>)
  | (BaseActivity & Readonly<{ kind: "expense"; source: AssetReference; charges?: readonly ChargeInput[] }>)
  | Readonly<{ kind: "transfer"; amountMinor: bigint; source: AssetReference; destination: AssetReference; transferFee?: ChargeInput }>;

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
