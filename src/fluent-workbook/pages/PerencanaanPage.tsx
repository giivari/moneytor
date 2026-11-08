import React, { useState } from 'react';
import {
  CheckCircle2,
  Lock,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  BudgetItem,
  GoalReserveItem,
  InspectorPayload,
  RoutineObligation,
} from '../types/finance';
import { formatIDR } from '../utils/formatters';
import { ExcelStatusBar } from '../components/ExcelStatusBar';

interface PerencanaanPageProps {
  hideRp: boolean;
  isMobile?: boolean;
  budgets: BudgetItem[];
  goals: GoalReserveItem[];
  obligations: RoutineObligation[];
  onSelectInspector: (payload: InspectorPayload) => void;
  selectedInspectorId?: string;
  onPayObligation: (oblId: string) => void;
  onOpenNewTxModal: (
    preset?: 'Pengeluaran' | 'Pemasukan' | 'Transfer / Top-Up' | 'Split Bill' | 'Pelunasan'
  ) => void;
}

export const PerencanaanPage: React.FC<PerencanaanPageProps> = ({
  hideRp,
  isMobile = false,
  budgets,
  goals,
  obligations,
  onSelectInspector,
  selectedInspectorId,
  onPayObligation,
}) => {
  const [activeFilter, setActiveFilter] = useState<'all' | 'budgets' | 'goals' | 'obligations'>('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const toggleSection = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const totalBudgetLimit = budgets.reduce((acc, b) => acc + b.monthlyLimit, 0);
  const totalBudgetUsed = budgets.reduce((acc, b) => acc + b.usedConsumption, 0);
  const totalGoalsCurrent = goals.reduce((acc, g) => acc + g.currentAmount, 0);
  const totalObligations = obligations.reduce((acc, o) => acc + o.amount, 0);

  const pivotTabs = [
    { id: 'all', label: 'Semua' },
    { id: 'budgets', label: 'Anggaran' },
    { id: 'goals', label: 'Target & Cadangan' },
    { id: 'obligations', label: 'Kewajiban' },
  ] as const;

  const showBudgets = activeFilter === 'all' || activeFilter === 'budgets';
  const showGoals = activeFilter === 'all' || activeFilter === 'goals';
  const showObligations = activeFilter === 'all' || activeFilter === 'obligations';

  return (
    <div className="flex flex-col h-full bg-[#f3f5f8] overflow-hidden">
      {/* Command Ribbon + Focused/Other Underline Pivot Tabs (flex-wrap, anti-overflow) */}
      <div className="bg-[#ffffff] border-b border-[#e1e6eb] px-5 pt-3 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
          <div className="flex items-center gap-3">
            <h1 className="text-[16px] font-semibold text-[#1f2328] tracking-tight">
              Perencanaan
            </h1>
            {toastMsg && (
              <span className="px-2.5 py-0.5 rounded-[4px] bg-[#e6f4ea] text-[#107c41] text-[11.5px] font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{toastMsg}</span>
              </span>
            )}
          </div>

          <div className="hidden sm:flex items-center gap-3 text-[12px] text-[#59636e]">
            <span>
              Plafon Anggaran:{' '}
              <strong className="text-[#1f2328] tabular-nums">
                {formatIDR(totalBudgetLimit, hideRp)}
              </strong>
            </span>
            <span className="text-[#cbd5e1]">|</span>
            <span>
              Sisa Plafon:{' '}
              <strong className="text-[#107c41] tabular-nums">
                {formatIDR(totalBudgetLimit - totalBudgetUsed, hideRp)}
              </strong>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {pivotTabs.map((tab) => {
            const isActive = activeFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveFilter(tab.id)}
                className={`px-3 py-2 text-[13px] relative transition-colors cursor-pointer ${
                  isActive
                    ? 'text-[#1f2328] font-semibold after:absolute after:bottom-0 after:left-2.5 after:right-2.5 after:h-[2.5px] after:rounded-t-full after:bg-[#0f6cbd]'
                    : 'text-[#59636e] font-medium hover:text-[#1f2328]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content with Collapsible Section Groups */}
      <div className={`flex-1 overflow-y-auto ${isMobile ? 'p-3 space-y-3' : 'p-5 space-y-4'}`}>
        {/* GROUP 1: ANGGARAN BELANJA */}
        {showBudgets && (
          <section className="bg-[#ffffff] rounded-[8px] border border-[#e1e6eb] shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('budgets')}
              className="w-full px-4 py-2.5 bg-[#f8fafc] border-b border-[#edf2f7] flex items-center justify-between text-left hover:bg-[#f0f6fc]/60 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                {collapsed['budgets'] ? (
                  <ChevronRight className="w-4 h-4 text-[#59636e]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#59636e]" />
                )}
                <span className="font-semibold text-[13px] text-[#1f2328]">
                  Anggaran Belanja Bulanan ({budgets.length} kategori)
                </span>
              </div>
              <span className="text-[12px] text-[#59636e]">
                Terpakai:{' '}
                <strong className="text-[#1f2328] tabular-nums">
                  {formatIDR(totalBudgetUsed, hideRp)}
                </strong>{' '}
                / {formatIDR(totalBudgetLimit, hideRp)}
              </span>
            </button>

            {!collapsed['budgets'] && (
              <div className="divide-y divide-[#edf2f7]">
                {budgets.map((b) => {
                  const pct = Math.round((b.usedConsumption / b.monthlyLimit) * 100);
                  const isOver = b.usedConsumption > b.monthlyLimit;
                  const isWarn = !isOver && pct >= 70;
                  const safeDaily = Math.max(
                    0,
                    Math.round((b.monthlyLimit - b.usedConsumption) / Math.max(1, b.remainingDays))
                  );

                  return (
                    <div
                      key={b.id}
                      onClick={() => onSelectInspector({ kind: 'budget', data: b })}
                      className={`px-4 py-3 flex flex-wrap items-center justify-between gap-4 hover:bg-[#f0f6fc] cursor-pointer ${
                        selectedInspectorId === b.id ? 'bg-[#f0f6fc]' : ''
                      }`}
                    >
                      <div className="min-w-[200px] flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-[13.5px] text-[#1f2328]">
                            {b.category}
                          </span>
                          <span
                            className={`px-1.5 py-0.2 rounded-[4px] font-semibold text-[10.5px] ${
                              isOver
                                ? 'bg-[#fde7e9] text-[#c50f1f]'
                                : isWarn
                                ? 'bg-[#fff4ce] text-[#d83b01]'
                                : 'bg-[#e6f4ea] text-[#107c41]'
                            }`}
                          >
                            {pct}%
                          </span>
                        </div>
                        <div className="text-[11.5px] text-[#59636e] mt-0.5">
                          {b.group} · Aman harian {formatIDR(safeDaily, hideRp)}/hari
                        </div>
                      </div>

                      <div className="w-40 hidden sm:block">
                        <div className="w-full h-1.5 rounded-full bg-[#f0f0f0] overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              isOver
                                ? 'bg-[#c50f1f]'
                                : isWarn
                                ? 'bg-[#d83b01]'
                                : 'bg-[#107c41]'
                            }`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                      </div>

                      <div className="text-right min-w-[160px]">
                        <div className="font-bold text-[13.5px] text-[#1f2328] tabular-nums">
                          {formatIDR(b.usedConsumption, hideRp)}
                        </div>
                        <div className="text-[11px] text-[#59636e] tabular-nums">
                          Plafon {formatIDR(b.monthlyLimit, hideRp)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* GROUP 2: TARGET & DANA CADANGAN */}
        {showGoals && (
          <section className="bg-[#ffffff] rounded-[8px] border border-[#e1e6eb] shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('goals')}
              className="w-full px-4 py-2.5 bg-[#f8fafc] border-b border-[#edf2f7] flex items-center justify-between text-left hover:bg-[#f0f6fc]/60 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                {collapsed['goals'] ? (
                  <ChevronRight className="w-4 h-4 text-[#59636e]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#59636e]" />
                )}
                <span className="font-semibold text-[13px] text-[#1f2328]">
                  Target &amp; Dana Cadangan Terkunci ({goals.length})
                </span>
              </div>
              <span className="text-[12px] text-[#59636e]">
                Terkumpul:{' '}
                <strong className="text-[#1f2328] tabular-nums">
                  {formatIDR(totalGoalsCurrent, hideRp)}
                </strong>
              </span>
            </button>

            {!collapsed['goals'] && (
              <div className="divide-y divide-[#edf2f7]">
                {goals.map((g) => {
                  const pct = Math.round((g.currentAmount / g.targetAmount) * 100);
                  return (
                    <div
                      key={g.id}
                      onClick={() => onSelectInspector({ kind: 'goal', data: g })}
                      className="px-4 py-3 flex flex-wrap items-center justify-between gap-4 hover:bg-[#f0f6fc] cursor-pointer"
                    >
                      <div className="min-w-[200px] flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-[13.5px] text-[#1f2328]">
                            {g.title}
                          </span>
                          <span className="px-2 py-0.2 rounded-[4px] bg-[#fff4ce] text-[#d83b01] text-[10.5px] font-semibold inline-flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" />
                            <span>{g.storedInAccount}</span>
                          </span>
                        </div>
                        <div className="text-[11.5px] text-[#59636e] mt-0.5">
                          Target {g.targetDate} · Setoran +{formatIDR(g.monthlyContribution, hideRp)}/bln
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="font-bold text-[13.5px] text-[#1f2328] tabular-nums">
                          {formatIDR(g.currentAmount, hideRp)} ({pct}%)
                        </div>
                        <div className="text-[11px] text-[#59636e] tabular-nums">
                          Target {formatIDR(g.targetAmount, hideRp)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* GROUP 3: KEWAJIBAN & TAGIHAN RUTIN */}
        {showObligations && (
          <section className="bg-[#ffffff] rounded-[8px] border border-[#e1e6eb] shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('obligations')}
              className="w-full px-4 py-2.5 bg-[#f8fafc] border-b border-[#edf2f7] flex items-center justify-between text-left hover:bg-[#f0f6fc]/60 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                {collapsed['obligations'] ? (
                  <ChevronRight className="w-4 h-4 text-[#59636e]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#59636e]" />
                )}
                <span className="font-semibold text-[13px] text-[#1f2328]">
                  Kewajiban &amp; Tagihan Rutin Non-Kredit ({obligations.length})
                </span>
              </div>
              <span className="text-[12px] text-[#59636e]">
                Total Bulanan:{' '}
                <strong className="text-[#1f2328] tabular-nums">
                  {formatIDR(totalObligations, hideRp)}
                </strong>
              </span>
            </button>

            {!collapsed['obligations'] && (
              <div className="overflow-x-auto">
                <table className="financial-data-table">
                  <thead>
                    <tr className="text-left">
                      <th>Nama Tagihan</th>
                      <th>Jatuh Tempo</th>
                      <th>Rekening Pembayar</th>
                      <th>Status</th>
                      <th className="text-right">Nominal</th>
                      <th className="text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {obligations.map((obl) => (
                      <tr
                        key={obl.id}
                        onClick={() => onSelectInspector({ kind: 'obligation', data: obl })}
                        className="cursor-pointer"
                      >
                        <td>
                          <div className="font-semibold text-[#1f2328]">{obl.name}</div>
                          <div className="text-[11px] text-[#59636e]">{obl.provider}</div>
                        </td>
                        <td className="whitespace-nowrap">{obl.dueDateLabel}</td>
                        <td className="whitespace-nowrap text-[#59636e]">{obl.sourceAccount}</td>
                        <td>
                          <span
                            className={`px-2 py-0.5 rounded-[4px] font-semibold text-[11px] ${
                              obl.status === 'Lunas'
                                ? 'bg-[#e6f4ea] text-[#107c41]'
                                : obl.status === 'Jatuh Tempo < 5 Hari'
                                ? 'bg-[#fde7e9] text-[#c50f1f]'
                                : 'bg-[#fff4ce] text-[#d83b01]'
                            }`}
                          >
                            {obl.status}
                          </span>
                        </td>
                        <td className="text-right font-bold tabular-nums">
                          {formatIDR(obl.amount, hideRp)}
                        </td>
                        <td className="text-right">
                          {obl.status !== 'Lunas' ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onPayObligation(obl.id);
                                setToastMsg(`Tagihan ${obl.name} dicatat lunas.`);
                                setTimeout(() => setToastMsg(null), 3000);
                              }}
                              className="button-primary h-[26px] px-2.5 text-[11px] cursor-pointer"
                            >
                              Bayar
                            </button>
                          ) : (
                            <span className="text-[11.5px] text-[#107c41] font-medium">Lunas</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>

      <ExcelStatusBar
        rowCount={budgets.length + goals.length + obligations.length}
        totalIn={totalBudgetLimit}
        totalOut={totalBudgetUsed}
        hideRp={hideRp}
        customNetLabel="Sisa Plafon Anggaran"
        customNetValue={totalBudgetLimit - totalBudgetUsed}
        isMobile={isMobile}
      />
    </div>
  );
};
