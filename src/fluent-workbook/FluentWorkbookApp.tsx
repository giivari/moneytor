"use client";
import React, { useCallback, useEffect, useState } from 'react';
import {
  AssetAccount,
  AuditLogItem,
  AutomationItem,
  BudgetItem,
  CreditFacility,
  GoalReserveItem,
  InspectorPayload,
  InstallmentContract,
  InvestmentHolding,
  InvestmentTransaction,
  NavPageId,
  RoutineObligation,
  SplitBillSession,
  TransactionItem,
  WorkbookSummary,
} from './types/finance';
import {
  INITIAL_ACCOUNTS,
  INITIAL_AUDIT_LOGS,
  INITIAL_AUTOMATIONS,
  INITIAL_BUDGETS,
  INITIAL_CREDIT_FACILITIES,
  INITIAL_GOALS,
  INITIAL_INSTALLMENTS,
  INITIAL_INVESTMENT_HISTORY,
  INITIAL_INVESTMENTS,
  INITIAL_OBLIGATIONS,
  INITIAL_SPLIT_BILLS,
  INITIAL_TRANSACTIONS,
} from './data/mockFinanceData';
import { adaptBackendToWorkbook } from './backendAdapter';
import { TopHeader } from './components/TopHeader';
import { LeftNavRail } from './components/LeftNavRail';
import { MobileBottomDock } from './components/MobileBottomDock';
import { RightInspectorDrawer } from './components/RightInspectorDrawer';
import { TransactionModal } from './components/TransactionModal';
import { SettingsModal } from './components/SettingsModal';
import { downloadTransactionsCsv } from './utils/exportCsv';
import { HomeBriefingPage } from './pages/HomeBriefingPage';
import { BukuMutasiPage } from './pages/BukuMutasiPage';
import { RekeningAsetPage } from './pages/RekeningAsetPage';
import { KreditTalanganPage } from './pages/KreditTalanganPage';
import { PortofolioInvestasiPage } from './pages/PortofolioInvestasiPage';
import { PerencanaanPage } from './pages/PerencanaanPage';
import { AnalitikInsightsPage } from './pages/AnalitikInsightsPage';

const PAGE_TO_PATH: Record<NavPageId, string> = {
  home: '/',
  mutasi: '/transactions',
  rekening: '/assets',
  kredit: '/credit',
  investasi: '/assets/investments',
  perencanaan: '/planning',
  analitik: '/insights',
};

const PATH_TO_PAGE: Record<string, NavPageId> = {
  '/': 'home',
  '/transactions': 'mutasi',
  '/assets': 'rekening',
  '/credit': 'kredit',
  '/assets/investments': 'investasi',
  '/planning': 'perencanaan',
  '/insights': 'analitik',
};

export interface FluentWorkbookAppProps {
  initialPage?: NavPageId;
  initialRawData?: unknown;
}

export default function FluentWorkbookApp({ initialPage = 'home', initialRawData }: FluentWorkbookAppProps) {
  const initialAdapted = initialRawData ? adaptBackendToWorkbook(initialRawData) : null;

  const [activePage, setActivePage] = useState<NavPageId>(() => {
    if (typeof window !== 'undefined') {
      const p = PATH_TO_PAGE[window.location.pathname];
      if (p) return p;
    }
    return initialPage;
  });
  const [hideRp, setHideRp] = useState<boolean>(false);
  const [isNativeMobile, setIsNativeMobile] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Core Financial State
  const [summary, setSummary] = useState<WorkbookSummary | null>(initialAdapted ? initialAdapted.summary : null);
  const [transactions, setTransactions] = useState<TransactionItem[]>(initialAdapted ? initialAdapted.transactions : INITIAL_TRANSACTIONS);
  const [accounts, setAccounts] = useState<AssetAccount[]>(initialAdapted ? initialAdapted.accounts : INITIAL_ACCOUNTS);
  const [creditFacilities, setCreditFacilities] = useState<CreditFacility[]>(initialAdapted ? initialAdapted.creditFacilities : INITIAL_CREDIT_FACILITIES);
  const [installments, setInstallments] = useState<InstallmentContract[]>(initialAdapted ? initialAdapted.installments : INITIAL_INSTALLMENTS);
  const [splitBills, setSplitBills] = useState<SplitBillSession[]>(initialAdapted ? initialAdapted.splitBills : INITIAL_SPLIT_BILLS);
  const [investments, setInvestments] = useState<InvestmentHolding[]>(initialAdapted ? initialAdapted.investments : INITIAL_INVESTMENTS);
  const [investmentHistory, setInvestmentHistory] = useState<InvestmentTransaction[]>(initialAdapted ? initialAdapted.investmentHistory : INITIAL_INVESTMENT_HISTORY);
  const [budgets, setBudgets] = useState<BudgetItem[]>(initialAdapted ? initialAdapted.budgets : INITIAL_BUDGETS);
  const [goals, setGoals] = useState<GoalReserveItem[]>(initialAdapted ? initialAdapted.goals : INITIAL_GOALS);
  const [obligations, setObligations] = useState<RoutineObligation[]>(initialAdapted ? initialAdapted.obligations : INITIAL_OBLIGATIONS);
  const [automations, setAutomations] = useState<AutomationItem[]>(initialAdapted ? initialAdapted.automations : INITIAL_AUTOMATIONS);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>(initialAdapted ? initialAdapted.auditLogs : INITIAL_AUDIT_LOGS);

  // Analytics Mode: 'consumption' (Mode Konsumsi Murni) vs 'cashflow' (Mode Arus Kas Riil)
  const [analyticsMode, setAnalyticsMode] = useState<'consumption' | 'cashflow'>('consumption');

  // Right Task Pane / Inspector Drawer State
  const [inspectorPayload, setInspectorPayload] = useState<InspectorPayload | null>(null);

  // Modals State
  const [isTxModalOpen, setIsTxModalOpen] = useState<boolean>(false);
  const [txModalPreset, setTxModalPreset] = useState<
    'Pengeluaran' | 'Pemasukan' | 'Transfer / Top-Up' | 'Split Bill' | 'Pelunasan'
  >('Pengeluaran');
  const [txModalTargetAccount, setTxModalTargetAccount] = useState<string | undefined>(undefined);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Native Mobile Detection (<= 767px)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 767px)');
    setIsNativeMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsNativeMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Browser Back/Forward URL Sync
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      const path = window.location.pathname;
      const mapped = PATH_TO_PAGE[path];
      if (mapped) setActivePage(mapped);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Instant URL Navigation (0-detik)
  const handleSelectPage = (page: NavPageId) => {
    setActivePage(page);
    const path = PAGE_TO_PATH[page] ?? '/';
    if (typeof window !== 'undefined' && window.location.pathname !== path) {
      window.history.pushState({ page }, '', path);
    }
  };

  // Live Refresh from PostgreSQL
  const refreshWorkbook = useCallback(async () => {
    try {
      const res = await fetch('/api/finance/workbook', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const adapted = adaptBackendToWorkbook(data);
      setAccounts(adapted.accounts);
      setCreditFacilities(adapted.creditFacilities);
      setInstallments(adapted.installments);
      setSplitBills(adapted.splitBills);
      setTransactions(adapted.transactions);
      setAuditLogs(adapted.auditLogs);
      setInvestments(adapted.investments);
      setInvestmentHistory(adapted.investmentHistory);
      setBudgets(adapted.budgets);
      setGoals(adapted.goals);
      setObligations(adapted.obligations);
      setAutomations(adapted.automations);
      setSummary(adapted.summary);
    } catch (e) {
      console.error('Gagal memperbarui buku kerja:', e);
    }
  }, []);

  useEffect(() => {
    refreshWorkbook();
  }, [refreshWorkbook]);

  // Network Mutation Helper
  const financeRequest = async (action: string, payload: unknown) => {
    const res = await fetch(`/api/finance/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Operasi ${action} gagal`);
    }
    return res.json().catch(() => ({}));
  };

  // Modals & Handlers
  const handleOpenNewTxModal = (
    preset: 'Pengeluaran' | 'Pemasukan' | 'Transfer / Top-Up' | 'Split Bill' | 'Pelunasan' = 'Pengeluaran',
    targetAcc?: string
  ) => {
    setTxModalPreset(preset);
    setTxModalTargetAccount(targetAcc);
    setIsTxModalOpen(true);
  };

  const handleAddTransaction = async (
    newTx: Omit<TransactionItem, 'id' | 'refCode'>,
    newSplitSession?: Omit<SplitBillSession, 'id'>,
  ) => {
    const sourceAsset =
      accounts.find((a) => a.name === newTx.sourceAccount) ||
      creditFacilities.find((c) => c.name === newTx.sourceAccount);
    const targetAsset =
      accounts.find((a) => a.name === newTx.targetAccount) ||
      creditFacilities.find((c) => c.name === newTx.targetAccount);

    if (newSplitSession) {
      await financeRequest('split-bill', {
        idempotencyKey: crypto.randomUUID(),
        sourceAssetId: sourceAsset?.id,
        totalMinor: String(Math.round(newSplitSession.totalReceipt)),
        reimbursedMinor: String(
          Math.round(newSplitSession.totalReceipt - (newSplitSession.myPersonalPortion ?? 0))
        ),
        occurredAt: new Date().toISOString(),
        note: newSplitSession.title,
        person: newSplitSession.participants.map((p) => p.name).join(', '),
      }).catch((err) => console.error('split-bill error:', err));
    } else {
      let kind: 'expense' | 'income' | 'transfer' = 'expense';
      if (newTx.type === 'Pemasukan') kind = 'income';
      else if (newTx.type === 'Transfer / Top-Up' || newTx.type === 'Bayar Kredit') kind = 'transfer';

      const draft = {
        kind,
        amountMinor: String(Math.round(newTx.principalAmount)),
        sourceAssetId: sourceAsset?.id,
        destinationAssetId: targetAsset?.id,
        categoryId: newTx.categoryId || undefined,
        transferFeeMinor: newTx.adminFee > 0 ? String(Math.round(newTx.adminFee)) : undefined,
        occurredAt: new Date().toISOString(),
        note: newTx.note || undefined,
      };

      await financeRequest('post', {
        idempotencyKey: crypto.randomUUID(),
        draft,
      }).catch((err) => console.error('post transaction error:', err));
    }

    await refreshWorkbook();
  };

  const handleConfirmAutomation = async (autoId: string) => {
    await fetch('/api/automation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'general-post', id: autoId }),
    }).catch(() => null);
    await refreshWorkbook();
  };

  const handleSkipAutomation = async (autoId: string) => {
    await fetch('/api/automation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'general-skip', id: autoId }),
    }).catch(() => null);
    await refreshWorkbook();
  };

  const handleCorrectTransaction = (txId: string, newPrincipal: number, reason: string) => {
    setTransactions((prev) =>
      prev.map((tx) => {
        if (tx.id !== txId) return tx;
        const oldTotal = tx.totalMutation;
        const newTotal = newPrincipal + tx.adminFee;
        return {
          ...tx,
          principalAmount: newPrincipal,
          totalMutation: newTotal,
          personalConsumptionAmount:
            tx.direction === 'out' ? newTotal : tx.personalConsumptionAmount,
          correctionHistory: [
            ...(tx.correctionHistory || []),
            {
              date: new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }),
              oldAmount: oldTotal,
              newAmount: newTotal,
              reason,
            },
          ],
        };
      })
    );
  };

  const handleVoidTransaction = async (txId: string) => {
    await financeRequest('void', { id: txId, idempotencyKey: crypto.randomUUID() }).catch((err) =>
      console.error('void error:', err)
    );
    await refreshWorkbook();
  };

  const handleReconcileAccount = (accId: string, newBalance: number) => {
    setAccounts((prev) =>
      prev.map((a) => {
        if (a.id !== accId) return a;
        return {
          ...a,
          balance: newBalance,
          lastReconciled: 'Baru saja (Rekonsiliasi Manual)',
        };
      })
    );
  };

  const handlePayCreditBill = async (creditId: string, sourceAccName: string, amount: number) => {
    if (amount <= 0) return;
    const sourceAcc = accounts.find((a) => a.name === sourceAccName) || accounts[0];
    await financeRequest('post', {
      idempotencyKey: crypto.randomUUID(),
      draft: {
        kind: 'transfer',
        amountMinor: String(Math.round(amount)),
        sourceAssetId: sourceAcc?.id,
        destinationAssetId: creditId,
        occurredAt: new Date().toISOString(),
        note: 'Pembayaran tagihan kredit',
      },
    }).catch((err) => console.error('pay credit bill error:', err));
    await refreshWorkbook();
  };

  const handleSettleSplitParticipant = async (
    sessionId: string,
    _partId: string,
    amountPaid: number,
    targetAccountName: string
  ) => {
    if (amountPaid <= 0) return;
    const targetAcc = accounts.find((a) => a.name === targetAccountName) || accounts[0];
    await financeRequest('post', {
      idempotencyKey: crypto.randomUUID(),
      draft: {
        kind: 'transfer',
        amountMinor: String(Math.round(amountPaid)),
        sourceAssetId: sessionId,
        destinationAssetId: targetAcc?.id,
        occurredAt: new Date().toISOString(),
        note: 'Pelunasan piutang talangan',
      },
    }).catch((err) => console.error('settle split participant error:', err));
    await refreshWorkbook();
  };

  const handleCreateAccount = async (data: {
    displayName: string;
    category: string;
    openingBalance: number;
    adminFee: number;
    interestRatePA: number;
  }) => {
    const isCredit = data.category.includes('Kredit') || data.category.includes('PayLater');
    const isReceivable = data.category.includes('Piutang');
    const assetClass = isCredit ? 'liability' : isReceivable ? 'receivable' : 'asset';
    const assetType = summary?.catalogs?.assetTypes?.[0]?.id || 'cash';
    await financeRequest('asset-create', {
      displayName: data.displayName,
      assetTypeId: assetType,
      assetClass,
      currency: summary?.currency || 'IDR',
      openingAmountMinor: String(Math.round(data.openingBalance)),
      openingEffectiveAt: new Date().toISOString(),
      normallyLiquid: !isCredit,
      normallySpendable: !isCredit && !isReceivable,
      note:
        data.adminFee > 0 || data.interestRatePA > 0
          ? `[ACCT:admin=${Math.round(data.adminFee)},bps=${Math.round(data.interestRatePA * 100)}]`
          : undefined,
    }).catch((err) => console.error('asset-create error:', err));
    await refreshWorkbook();
  };

  const handlePayObligation = (oblId: string) => {
    setObligations((prev) =>
      prev.map((o) => (o.id === oblId ? { ...o, status: 'Lunas' } : o))
    );
  };

  const handleImportSampleTxs = () => {
    refreshWorkbook();
  };

  const handleRefreshMarketPrices = () => {
    refreshWorkbook();
  };

  // Derived sidebar badges
  const pendingAutomationsCount = automations.filter(
    (a) => a.status === 'Perlu Konfirmasi'
  ).length;

  let unpaidFriendsCount = 0;
  splitBills.forEach((sb) => {
    sb.participants.forEach((p) => {
      if (p.portion - p.paidAmount > 0) unpaidFriendsCount += 1;
    });
  });

  const selectedInspectorId = inspectorPayload ? inspectorPayload.data.id : undefined;
  const isEffectiveMobile = isNativeMobile;

  const renderActivePage = () => (
    <>
      {activePage === 'home' && (
        <HomeBriefingPage
          hideRp={hideRp}
          isMobile={isEffectiveMobile}
          transactions={transactions}
          automations={automations}
          creditFacilities={creditFacilities}
          obligations={obligations}
          splitBills={splitBills}
          onConfirmAutomation={handleConfirmAutomation}
          onSkipAutomation={handleSkipAutomation}
          onSelectInspector={setInspectorPayload}
          selectedInspectorId={selectedInspectorId}
          onNavigate={handleSelectPage}
          onOpenNewTxModal={(preset) => handleOpenNewTxModal(preset)}
          summary={summary ?? undefined}
        />
      )}

      {activePage === 'mutasi' && (
        <BukuMutasiPage
          hideRp={hideRp}
          isMobile={isEffectiveMobile}
          transactions={transactions}
          accounts={accounts}
          automations={automations}
          auditLogs={auditLogs}
          onSelectInspector={setInspectorPayload}
          selectedInspectorId={selectedInspectorId}
          onOpenNewTxModal={(preset) => handleOpenNewTxModal(preset)}
          onConfirmAutomation={handleConfirmAutomation}
          onSkipAutomation={handleSkipAutomation}
          onImportSampleTxs={handleImportSampleTxs}
        />
      )}

      {activePage === 'rekening' && (
        <RekeningAsetPage
          hideRp={hideRp}
          isMobile={isEffectiveMobile}
          accounts={accounts}
          onSelectInspector={setInspectorPayload}
          selectedInspectorId={selectedInspectorId}
          onTopUpAccount={(targetName) =>
            handleOpenNewTxModal('Transfer / Top-Up', targetName)
          }
          onOpenNewTxModal={(preset) => handleOpenNewTxModal(preset)}
          onCreateAccount={handleCreateAccount}
        />
      )}

      {activePage === 'kredit' && (
        <KreditTalanganPage
          hideRp={hideRp}
          isMobile={isEffectiveMobile}
          creditFacilities={creditFacilities}
          installments={installments}
          splitBills={splitBills}
          onSelectInspector={setInspectorPayload}
          selectedInspectorId={selectedInspectorId}
          onPayCreditBill={handlePayCreditBill}
          onSettleSplitParticipant={handleSettleSplitParticipant}
          onOpenNewTxModal={(preset) => handleOpenNewTxModal(preset)}
        />
      )}

      {activePage === 'investasi' && (
        <PortofolioInvestasiPage
          hideRp={hideRp}
          isMobile={isEffectiveMobile}
          holdings={investments}
          history={investmentHistory}
          onSelectInspector={setInspectorPayload}
          selectedInspectorId={selectedInspectorId}
          onOpenNewTxModal={(preset) => handleOpenNewTxModal(preset)}
          onRefreshMarketPrices={handleRefreshMarketPrices}
        />
      )}

      {activePage === 'perencanaan' && (
        <PerencanaanPage
          hideRp={hideRp}
          isMobile={isEffectiveMobile}
          budgets={budgets}
          goals={goals}
          obligations={obligations}
          onSelectInspector={setInspectorPayload}
          selectedInspectorId={selectedInspectorId}
          onPayObligation={handlePayObligation}
          onOpenNewTxModal={(preset) => handleOpenNewTxModal(preset)}
        />
      )}

      {activePage === 'analitik' && (
        <AnalitikInsightsPage
          hideRp={hideRp}
          isMobile={isEffectiveMobile}
          analyticsMode={analyticsMode}
          onChangeAnalyticsMode={setAnalyticsMode}
          transactions={transactions}
          budgets={budgets}
          onSelectInspector={setInspectorPayload}
          summary={summary ?? undefined}
        />
      )}
    </>
  );

  return (
    <div className="fluent-workbook-root h-screen w-screen flex flex-col bg-[#f3f5f8] text-[#1f2328] overflow-hidden">
      {/* LAYER 1: TOP APPLICATION HEADER (48px) */}
      <TopHeader
        activePage={activePage}
        hideRp={hideRp}
        onToggleHideRp={() => setHideRp(!hideRp)}
        onOpenNewTxModal={(preset) => handleOpenNewTxModal(preset)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        transactions={transactions}
        accounts={accounts}
        splitBills={splitBills}
        creditFacilities={creditFacilities}
        onSelectInspector={setInspectorPayload}
        onNavigate={handleSelectPage}
      />

      {/* WORKSPACE CONTAINER: NATIVE MOBILE vs DESKTOP */}
      {isNativeMobile ? (
        <div className="flex-1 flex flex-col min-h-0 w-full overflow-hidden bg-[#f3f5f8]">
          <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {renderActivePage()}
          </main>
          <RightInspectorDrawer
            payload={inspectorPayload}
            onClose={() => setInspectorPayload(null)}
            hideRp={hideRp}
            allTransactions={transactions}
            accounts={accounts}
            onCorrectTransaction={handleCorrectTransaction}
            onVoidTransaction={handleVoidTransaction}
            onReconcileAccount={handleReconcileAccount}
            onPayCreditBill={handlePayCreditBill}
            onSettleSplitParticipant={handleSettleSplitParticipant}
            onTopUpAccount={(targetName) =>
              handleOpenNewTxModal('Transfer / Top-Up', targetName)
            }
            onPayObligation={handlePayObligation}
            isMobile={true}
          />
          <MobileBottomDock
            activePage={activePage}
            onSelectPage={handleSelectPage}
            onOpenNewTxModal={(preset) => handleOpenNewTxModal(preset)}
            onOpenSettings={() => setIsSettingsOpen(true)}
            pendingAutomationsCount={pendingAutomationsCount}
            unpaidFriendsCount={unpaidFriendsCount}
          />
        </div>
      ) : (
        /* DESKTOP 4-LAYER WORKSPACE */
        <div className="flex-1 flex min-h-0 overflow-hidden bg-[#f3f5f8]">
          {/* LAYER 2: FAR-LEFT ICON RAIL (56px) */}
          <LeftNavRail
            activePage={activePage}
            onSelectPage={handleSelectPage}
            onOpenSettings={() => setIsSettingsOpen(true)}
            hideRp={hideRp}
            trueNetWorth={summary ? summary.trueNetWorth : 0}
            spendableCash={summary ? summary.spendableCash : 0}
            pendingAutomationsCount={pendingAutomationsCount}
            unpaidFriendsCount={unpaidFriendsCount}
          />

          {/* LAYER 3: DYNAMIC WORKBOOK CANVAS */}
          <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {renderActivePage()}
          </main>

          {/* LAYER 4: RIGHT TASK PANE / INSPECTOR DRAWER (360px Desktop) */}
          <RightInspectorDrawer
            payload={inspectorPayload}
            onClose={() => setInspectorPayload(null)}
            hideRp={hideRp}
            allTransactions={transactions}
            accounts={accounts}
            onCorrectTransaction={handleCorrectTransaction}
            onVoidTransaction={handleVoidTransaction}
            onReconcileAccount={handleReconcileAccount}
            onPayCreditBill={handlePayCreditBill}
            onSettleSplitParticipant={handleSettleSplitParticipant}
            onTopUpAccount={(targetName) =>
              handleOpenNewTxModal('Transfer / Top-Up', targetName)
            }
            onPayObligation={handlePayObligation}
            isMobile={false}
          />
        </div>
      )}

      {/* LAYER 5: MODAL DIALOGS */}
      <TransactionModal
        isOpen={isTxModalOpen}
        onClose={() => setIsTxModalOpen(false)}
        presetType={txModalPreset}
        presetTargetAccount={txModalTargetAccount}
        accounts={accounts}
        creditFacilities={creditFacilities}
        splitBills={splitBills}
        categories={summary?.catalogs?.expenseCategories?.map((c) => c.name)}
        onAddTransaction={handleAddTransaction}
        onPayCreditBill={handlePayCreditBill}
        onSettleSplitParticipant={handleSettleSplitParticipant}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        analyticsMode={analyticsMode}
        onChangeAnalyticsMode={setAnalyticsMode}
        onExportAllCsv={() =>
          downloadTransactionsCsv(transactions, 'moneytor_buku_mutasi_lengkap.csv')
        }
      />
    </div>
  );
}
