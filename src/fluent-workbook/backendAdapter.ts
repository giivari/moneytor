import {
  AccountCategory,
  AssetAccount,
  AuditLogItem,
  AutomationItem,
  BudgetItem,
  CashflowMonthPoint,
  CreditFacility,
  GoalReserveItem,
  InstallmentContract,
  InvestmentHolding,
  InvestmentTransaction,
  RoutineObligation,
  SplitBillSession,
  TransactionItem,
  WorkbookSummary,
} from "./types/finance";
import { parseAssetTerms, stripAssetMetaTags } from "@/lib/domain/asset-terms";
import { computeCreditBills, isCreditAsset, isReceivableAsset } from "@/lib/domain/credit";
import { installmentContracts } from "@/lib/domain/credit-overview";
import { netWorthComponents } from "@/lib/domain/home-briefing";
import type { FinanceActivity, FinanceAsset } from "@/lib/finance/types";

function minorToNumber(minor: string | bigint | undefined | null, exponent = 0): number {
  if (minor === undefined || minor === null) return 0;
  const val = typeof minor === "bigint" ? Number(minor) : Number(BigInt(minor));
  return exponent > 0 ? val / Math.pow(10, exponent) : val;
}

function shortDateId(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function shortTimeId(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Jakarta",
    });
  } catch {
    return "00:00";
  }
}

function classifyAccountCategory(asset: FinanceAsset): AccountCategory {
  const typeLower = `${asset.assetTypeName} ${asset.displayName}`.toLowerCase();
  if (typeLower.includes("e-money") || typeLower.includes("emoney") || typeLower.includes("flazz") || typeLower.includes("tapcash") || typeLower.includes("brizzi") || typeLower.includes("kartu uang elektronik")) {
    return "emoney";
  }
  const terms = parseAssetTerms(asset.note);
  const interestBps = terms.interestRateBps;
  if (!asset.normallySpendable || (interestBps && interestBps > 0) || typeLower.includes("deposito") || typeLower.includes("tabungan berjangka")) {
    return "tabungan_deposito";
  }
  return "kas_bank_ewallet";
}

export interface AdaptedWorkbookData {
  accounts: AssetAccount[];
  creditFacilities: CreditFacility[];
  installments: InstallmentContract[];
  splitBills: SplitBillSession[];
  transactions: TransactionItem[];
  auditLogs: AuditLogItem[];
  investments: InvestmentHolding[];
  investmentHistory: InvestmentTransaction[];
  budgets: BudgetItem[];
  goals: GoalReserveItem[];
  obligations: RoutineObligation[];
  automations: AutomationItem[];
  summary: WorkbookSummary;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function adaptBackendToWorkbook(raw: any): AdaptedWorkbookData {
  const snapshot = raw.snapshot;
  const assets: FinanceAsset[] = snapshot?.assets ?? [];
  const activities: FinanceActivity[] = raw.activities ?? snapshot?.recent ?? [];
  const primaryCurrency = snapshot?.currencies?.[0] ?? {
    currency: "IDR",
    exponent: 0,
    totalMinor: "0",
    liquidMinor: "0",
    eligibleMinor: "0",
    creditDebtMinor: "0",
    liabilitiesMinor: "0",
    netWorthMinor: "0",
    reservedMinor: "0",
    dueMinor: "0",
    coveredMinor: "0",
    uncoveredMinor: "0",
    spendableMinor: "0",
    availableMinor: "0",
    expenseMinor: "0",
  };
  const exp = primaryCurrency.exponent ?? 0;

  // 1. Accounts (Regular assets)
  const regularAssets = assets.filter((a) => a.isActive && !isCreditAsset(a) && !isReceivableAsset(a));
  const accounts: AssetAccount[] = regularAssets.map((a) => {
    const terms = parseAssetTerms(a.note);
    const bal = minorToNumber(a.balanceMinor, a.exponent);
    const adminFee = terms.adminFeeMinor ? minorToNumber(terms.adminFeeMinor, a.exponent) : 0;
    const ratePct = terms.interestRateBps ? terms.interestRateBps / 100 : undefined;
    const taxPct = terms.interestTaxBps ? terms.interestTaxBps / 100 : 20;
    const estNetMonthly =
      ratePct && bal > 0 ? Math.round(((bal * (ratePct / 100)) / 12) * (1 - taxPct / 100)) : undefined;

    return {
      id: a.id,
      name: a.displayName,
      institution: a.providerName || a.assetTypeName,
      category: classifyAccountCategory(a),
      accountNumber: a.safeSuffix ? `•••• ${a.safeSuffix}` : a.assetTypeName,
      subtype: a.assetTypeName,
      balance: bal,
      isSpendable: a.normallySpendable,
      isLockedReserve: !a.normallySpendable,
      monthlyAdminFee: adminFee,
      interestRatePA: ratePct,
      interestRatePa: ratePct,
      taxRate: taxPct,
      taxRateOnInterest: ratePct ? taxPct : undefined,
      estimatedNetInterestMonthly: estNetMonthly,
      lastReconciled: "Tersinkronisasi Buku Besar",
      assetTypeId: a.assetTypeId,
      providerId: a.providerId,
      normallyLiquid: a.normallyLiquid,
      normallySpendable: a.normallySpendable,
    };
  });

  // 2. Credit Facilities & Installments
  const creditAssets = assets.filter((a) => a.isActive && isCreditAsset(a));
  const creditFacilities: CreditFacility[] = creditAssets.map((a) => {
    const bills = computeCreditBills(a, snapshot?.throughDay?.slice(0, 10));
    const limit = minorToNumber(bills.limitMinor, a.exponent);
    const unpaid = minorToNumber(bills.totalUnpaidMinor, a.exponent);
    const avail = bills.availableLimitMinor !== null ? minorToNumber(bills.availableLimitMinor, a.exponent) : Math.max(0, limit - unpaid);
    const curBill = minorToNumber(bills.currentBillMinor, a.exponent);
    const nextBill = minorToNumber(bills.nextBillMinor, a.exponent);
    return {
      id: a.id,
      name: a.displayName,
      provider: a.providerName || a.assetTypeName,
      type: "Kartu Kredit",
      creditLimit: limit > 0 ? limit : Math.max(unpaid, 1000000),
      usedLimit: unpaid,
      availableLimit: avail,
      cutoffDay: bills.cutoffDay,
      dueDay: bills.dueDay,
      currentPeriodBill: curBill,
      currentBillDueDate: shortDateId(bills.currentDueIso),
      nextPeriodBill: nextBill,
      nextBillDueDate: shortDateId(bills.nextDueIso),
      interestRateMonthly: "Sesuai kontrak",
      lateFeeRule: "Sesuai ketentuan penerbit",
      status: curBill > 0 ? "Belum Dibayar" : "Lunas Bulan Ini",
    };
  });

  const installments: InstallmentContract[] = creditAssets.flatMap((a) => {
    const contracts = installmentContracts(a);
    return contracts.map((c, idx) => {
      const monthly = minorToNumber(c.monthlyMinor, a.exponent);
      const total = minorToNumber(c.totalMinor, a.exponent);
      const firstRow = (a.creditInstallments ?? []).find((r) => r.activityId === c.activityId);
      const principalPerMonth = firstRow ? minorToNumber(firstRow.principalMinor, a.exponent) : monthly;
      const interestPerMonth = firstRow ? minorToNumber(firstRow.interestMinor, a.exponent) : 0;
      const paidMonths = Math.max(0, c.count - c.upcomingCount);
      return {
        id: `${a.id}-${c.activityId}-${idx}`,
        itemName: `Kontrak Cicilan ${a.displayName} (${c.firstPeriod} s.d. ${c.lastPeriod})`,
        merchant: a.providerName || a.displayName,
        facilityName: a.displayName,
        purchaseDate: c.firstPeriod,
        totalPrincipal: principalPerMonth * c.count,
        currentInstallment: Math.min(c.count, paidMonths + 1),
        totalTenor: c.count,
        monthlyPrincipal: principalPerMonth,
        monthlyInterest: interestPerMonth,
        monthlyInterestAndFee: interestPerMonth,
        monthlyTotal: monthly,
        remainingPrincipal: total,
        remainingTotal: total,
        remainingLiability: total,
        nextDueDate: c.lastPeriod,
        status: paidMonths >= c.count ? "Lunas" : "Berjalan",
      };
    });
  });

  // 3. Receivables / Split Bills
  const receivableAssets = assets.filter((a) => a.isActive && isReceivableAsset(a));
  const splitBills: SplitBillSession[] = receivableAssets.map((a) => {
    const unpaid = Math.max(0, minorToNumber(a.balanceMinor, a.exponent));
    const cleanNote = stripAssetMetaTags(a.note || "") || a.displayName;
    return {
      id: a.id,
      title: a.displayName,
      date: "Piutang Aktif",
      paidUsingAccount: a.providerName || "Rekening Utama",
      paidViaAccount: a.providerName || "Rekening Utama",
      category: "Talangan",
      totalReceipt: unpaid,
      myPortion: 0,
      myPersonalPortion: 0,
      friendsTotalPortion: unpaid,
      notes: cleanNote,
      participants: [
        {
          id: `part-${a.id}`,
          name: cleanNote.replace(/^Piutang\s*/i, "") || a.displayName,
          portion: unpaid > 0 ? unpaid : 0,
          paidAmount: 0,
          status: unpaid <= 0 ? "Lunas" : "Belum Bayar",
        },
      ],
    };
  });

  // 4. Transactions & Audit Logs
  const auditLogs: AuditLogItem[] = [];
  const transactions: TransactionItem[] = activities.map((act) => {
    const base = minorToNumber(act.baseAmountMinor, act.exponent);
    const fee = (act.charges ?? []).reduce((acc, c) => acc + minorToNumber(c.amountMinor, act.exponent), 0);
    const refunded = act.refundedMinor ? minorToNumber(act.refundedMinor, act.exponent) : 0;
    const netExpense = act.netMinor ? minorToNumber(act.netMinor, act.exponent) : Math.max(0, base + fee - refunded);

    let type: TransactionItem["type"] = "Pengeluaran";
    let direction: TransactionItem["direction"] = "out";
    let personalConsumption = 0;

    if (act.kind === "income") {
      type = "Pemasukan";
      direction = "in";
    } else if (act.kind === "transfer" || act.kind === "borrow") {
      type = "Transfer / Top-Up";
      direction = "transfer";
      personalConsumption = fee;
    } else if (act.kind === "repay") {
      type = "Bayar Kredit";
      direction = "out";
      personalConsumption = fee;
    } else if (act.kind === "refund") {
      type = "Pemasukan";
      direction = "in";
    } else if (act.kind === "adjustment") {
      type = "Transfer / Top-Up";
      direction = act.destinationAssetId ? "in" : "out";
    } else {
      type = "Pengeluaran";
      direction = "out";
      personalConsumption = netExpense;
    }

    const isVoided = act.status === "voided" || act.status === "superseded";
    if (isVoided) {
      auditLogs.push({
        id: `aud-${act.id}`,
        timestamp: `${shortDateId(act.occurredAt)}, ${shortTimeId(act.occurredAt)} WIB`,
        txRefCode: `MUT-${act.id.slice(0, 6).toUpperCase()}`,
        actionType: act.status === "voided" ? "Void / Pembatalan" : "Koreksi Nominal",
        accountAffected: act.sourceName || act.destinationName || "Akun",
        previousValue: base + fee,
        newValue: 0,
        reason: act.note || (act.status === "voided" ? "Dibatalkan oleh pemilik" : "Digantikan oleh transaksi koreksi"),
        operator: "Owner",
      });
    }

    return {
      id: act.id,
      refCode: `MUT-${act.id.slice(0, 6).toUpperCase()}`,
      date: shortDateId(act.occurredAt),
      time: shortTimeId(act.occurredAt),
      type,
      sourceAccount: act.sourceName || act.destinationName || "Rekening",
      targetAccount: act.destinationName && act.sourceName ? act.destinationName : undefined,
      category: act.categoryName || (act.kind === "transfer" ? "Transfer Antar Akun" : act.kind === "repay" ? "Pelunasan Utang" : act.kind === "refund" ? "Refund Pengeluaran" : "Umum"),
      note: act.note || act.categoryName || type,
      principalAmount: base,
      adminFee: fee,
      totalMutation: base + fee,
      direction,
      personalConsumptionAmount: personalConsumption,
      isVoided,
      sourceAssetId: act.sourceAssetId,
      destinationAssetId: act.destinationAssetId,
      categoryId: act.categoryId,
      rawKind: act.kind,
    };
  });

  // 5. Investments
  const invSnap = raw.invSnap;
  const investments: InvestmentHolding[] = (invSnap?.holdings ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (h: any, idx: number) => {
      const inst = (invSnap?.instruments ?? []).find((i: { id: string }) => i.id === h.instrumentId);
      const port = (invSnap?.portfolios ?? []).find((p: { id: string }) => p.id === h.portfolioId);
      const iExp = inst?.exponent ?? 0;
      const costVal = minorToNumber(h.costBasisMinor, iExp);
      const mktVal = h.marketMinor !== null ? minorToNumber(h.marketMinor, iExp) : costVal;
      const pl = h.unrealizedMinor !== null ? minorToNumber(h.unrealizedMinor, iExp) : 0;
      const plPct = costVal > 0 ? (pl / costVal) * 100 : 0;
      const qty = Number(h.quantity) || 0;
      return {
        id: `${h.portfolioId}:${h.instrumentId}:${idx}`,
        code: (inst?.symbol || inst?.displayName || "INV").slice(0, 4).toUpperCase(),
        name: inst?.displayName || "Instrumen",
        platform: port?.displayName || "Portofolio",
        assetClass: inst?.typeName?.includes("Saham")
          ? "Saham IDX"
          : inst?.typeName?.includes("Kripto") || inst?.typeName?.includes("Crypto")
          ? "Crypto Spot"
          : inst?.typeName?.includes("Obligasi") || inst?.typeName?.includes("SBN")
          ? "Reksa Dana Obligasi"
          : "Reksa Dana Pasar Uang",
        units: qty,
        unitLabel: "Unit",
        avgBuyPrice: Number(h.averageCost) || 0,
        avgCostPrice: Number(h.averageCost) || 0,
        marketPrice: h.price ? Number(h.price.price) || 0 : Number(h.averageCost) || 0,
        principalValue: costVal,
        marketValue: mktVal,
        unrealizedPL: pl,
        unrealizedPLPercent: plPct,
        lastUpdated: h.price?.asOf ? shortDateId(h.price.asOf) : "Harga tercatat",
        allocationTargetPercent: 0,
      };
    }
  );

  const investmentHistory: InvestmentTransaction[] = (invSnap?.trades ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tr: any) => {
      const inst = (invSnap?.instruments ?? []).find((i: { id: string }) => i.id === tr.instrumentId);
      const port = (invSnap?.portfolios ?? []).find((p: { id: string }) => p.id === tr.portfolioId);
      const iExp = inst?.exponent ?? 0;
      return {
        id: tr.id,
        date: shortDateId(tr.occurredAt),
        type: tr.kind === "sell" ? "Jual" : "Beli (DCA)",
        action: tr.kind === "sell" ? "Jual Sebagian" : "Beli (DCA)",
        instrumentCode: (inst?.symbol || inst?.displayName || "INV").slice(0, 4).toUpperCase(),
        instrumentName: inst?.displayName || "Instrumen",
        sourceAccount: port?.displayName || "Portofolio",
        sourceOrTargetAccount: port?.displayName || "Portofolio",
        units: Number(tr.quantity) || 0,
        pricePerUnit: Number(tr.unitPrice) || 0,
        feeAndTax: minorToNumber(tr.feeMinor, iExp),
        totalAmount: minorToNumber(tr.grossMinor, iExp),
        netTotal: minorToNumber(tr.grossMinor, iExp),
      };
    }
  );

  // 6. Planning (Budgets, Goals/Reserves, Obligations)
  const planning = raw.planning;
  const budgets: BudgetItem[] = (planning?.budgets ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b: any) => {
      const limit = minorToNumber(b.limitMinor, b.exponent ?? 0);
      const spent = Math.max(0, minorToNumber(b.spentMinor, b.exponent ?? 0));
      return {
        id: b.id,
        category: b.name || b.categoryName || "Anggaran",
        group: "Kebutuhan Pokok",
        monthlyLimit: limit > 0 ? limit : 1,
        usedConsumption: spent,
        usedCashflow: spent,
        txCount: 0,
        remainingDays: 15,
        notes: "",
      };
    }
  );

  const goals: GoalReserveItem[] = [
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(planning?.goals ?? []).map((g: any) => ({
      id: g.id,
      title: g.name,
      targetAmount: Math.max(1, minorToNumber(g.targetMinor, g.exponent ?? 0)),
      currentAmount: minorToNumber(g.progressMinor, g.exponent ?? 0),
      storedInAccount: "Dana Target",
      targetDate: g.targetOn ? shortDateId(g.targetOn) : "Fleksibel",
      monthlyContribution: 0,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(planning?.reserves ?? []).map((r: any) => ({
      id: r.id,
      title: r.name,
      targetAmount: Math.max(1, minorToNumber(r.amountMinor, r.exponent ?? 0)),
      currentAmount: minorToNumber(r.amountMinor, r.exponent ?? 0),
      storedInAccount: r.sourceAssetName || "Dana Cadangan",
      targetDate: "Cadangan Aktif",
      monthlyContribution: 0,
    })),
  ];

  const obligations: RoutineObligation[] = (planning?.obligations ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (o: any) => ({
      id: o.id,
      name: o.name,
      provider: o.note || "Kewajiban Rutin",
      category: "Rutin",
      dueDay: 7,
      dueDateLabel: shortDateId(o.dueOn),
      dueDate: shortDateId(o.dueOn),
      daysRemaining: 7,
      amount: minorToNumber(o.amountMinor, o.exponent ?? 0),
      sourceAccount: "Rekening Utama",
      isVariableAmount: false,
      isCoveredByReserve: BigInt(o.uncoveredMinor ?? o.amountMinor ?? "0") === 0n,
      status: o.status === "settled" ? "Lunas" : "Menunggu Pembayaran",
      autopay: false,
    })
  );

  // 7. Automations
  const automations: AutomationItem[] = (snapshot?.pendingAutomations ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (inst: any) => ({
      id: inst.id,
      title: inst.title,
      description: inst.actionMeaning || inst.context || "Otomatisasi terjadwal",
      scheduleLabel: shortDateId(inst.at),
      sourceAccount: inst.context || "Rekening",
      targetAccount: "Otomatis",
      amount: minorToNumber(inst.amount, inst.exponent ?? 0),
      adminFee: 0,
      type: "Tagihan Rutin",
      status: inst.status === "pending" ? "Perlu Konfirmasi" : "Terkonfirmasi",
    })
  );

  // 8. Summary & 6-Month Trend
  const nwParts = netWorthComponents(
    assets,
    (snapshot?.investment?.totals ?? []).map((t: { currency: string; exponent: number; marketMinor: string }) => ({ ...t })),
    primaryCurrency.currency
  );
  const cashAndBank = accounts
    .filter((a) => a.category === "kas_bank_ewallet")
    .reduce((s, a) => s + a.balance, 0);
  const highYieldSavings = accounts
    .filter((a) => a.category === "tabungan_deposito")
    .reduce((s, a) => s + a.balance, 0);
  const eMoney = accounts
    .filter((a) => a.category === "emoney")
    .reduce((s, a) => s + a.balance, 0);

  const monthlyRows = raw.analytics6m?.monthly ?? [];
  const sixMonthTrend: CashflowMonthPoint[] =
    monthlyRows.length > 0
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        monthlyRows.slice(-6).map((m: any) => {
          const inc = minorToNumber(m.incomeMinor, m.exponent ?? exp);
          const sp = Math.max(0, minorToNumber(m.spendingMinor, m.exponent ?? exp));
          const chg = minorToNumber(m.chargesMinor, m.exponent ?? exp);
          const trf = minorToNumber(m.transferPrincipalMinor, m.exponent ?? exp);
          const label = new Date(`${m.key}-01T00:00:00+07:00`).toLocaleDateString("id-ID", {
            month: "short",
            year: "2-digit",
            timeZone: "Asia/Jakarta",
          });
          return {
            month: label,
            income: inc,
            consumption: sp,
            cashflowOut: sp + trf,
            adminAndInterest: chg,
          };
        })
      : [
          {
            month: "Bulan Ini",
            income: 0,
            consumption: Math.max(0, minorToNumber(primaryCurrency.expenseMinor, exp)),
            cashflowOut: Math.max(0, minorToNumber(primaryCurrency.expenseMinor, exp)),
            adminAndInterest: 0,
          },
        ];

  const monthMeasures = raw.analyticsMonth?.summary?.[0];
  const monthlyIncome = monthMeasures ? minorToNumber(monthMeasures.incomeMinor, exp) : sixMonthTrend[sixMonthTrend.length - 1]?.income ?? 0;
  const monthlyPureConsumption = monthMeasures
    ? Math.max(0, minorToNumber(monthMeasures.spendingMinor, exp))
    : Math.max(0, minorToNumber(primaryCurrency.expenseMinor, exp));
  const monthlyRealCashOut = monthMeasures
    ? monthlyPureConsumption + minorToNumber(monthMeasures.transferPrincipalMinor, exp)
    : monthlyPureConsumption;

  // Catalogs
  const allCats = raw.catalogs?.categories ?? [];
  const expenseCategories = allCats
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((c: any) => c.isActive && c.appliesTo === "expense")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((c: any) => ({ id: c.id, name: c.displayName, group: c.effectiveNature || "Umum" }));
  const incomeCategories = allCats
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((c: any) => c.isActive && c.appliesTo === "income")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((c: any) => ({ id: c.id, name: c.displayName }));

  const summary: WorkbookSummary = {
    currency: primaryCurrency.currency,
    exponent: exp,
    trueNetWorth: minorToNumber(primaryCurrency.netWorthMinor, exp),
    spendableCash: minorToNumber(
      snapshot?.planningReady ? primaryCurrency.availableMinor : primaryCurrency.spendableMinor,
      exp
    ),
    cashAndBank,
    highYieldSavings,
    eMoney,
    investmentsValue: minorToNumber(nwParts.investmentsMinor, exp),
    receivables: minorToNumber(nwParts.receivablesMinor, exp),
    totalLiabilities: minorToNumber(nwParts.liabilitiesMinor, exp),
    lockedReserve: minorToNumber(primaryCurrency.reservedMinor, exp),
    upcomingCreditBills: minorToNumber(primaryCurrency.creditDebtMinor, exp),
    monthlyIncome,
    monthlyPureConsumption,
    monthlyRealCashOut,
    sixMonthTrend,
    catalogs: {
      expenseCategories,
      incomeCategories,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assetTypes: (raw.catalogs?.assetTypes ?? []).map((t: any) => ({ id: t.id, name: t.displayName })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      providers: (raw.catalogs?.providers ?? []).map((p: any) => ({ id: p.id, name: p.displayName })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chargeTypes: (raw.catalogs?.chargeTypes ?? []).map((c: any) => ({
        id: c.id,
        name: c.displayName,
        systemKey: c.systemKey ?? null,
      })),
    },
  };

  return {
    accounts,
    creditFacilities,
    installments,
    splitBills,
    transactions,
    auditLogs,
    investments,
    investmentHistory,
    budgets,
    goals,
    obligations,
    automations,
    summary,
  };
}
