import React from 'react';
import {
  Home,
  Table2,
  Wallet,
  CreditCard,
  TrendingUp,
  CalendarCheck2,
  BarChart3,
  Settings,
} from 'lucide-react';
import { NavPageId } from '../types/finance';

interface LeftNavRailProps {
  activePage: NavPageId;
  onSelectPage: (page: NavPageId) => void;
  onOpenSettings: () => void;
  hideRp: boolean;
  trueNetWorth: number;
  spendableCash: number;
  pendingAutomationsCount: number;
  unpaidFriendsCount: number;
}

interface NavMenuItem {
  id: NavPageId;
  shortLabel: string;
  fullLabel: string;
  icon: React.FC<{ className?: string }>;
  badgeCount?: number;
  badgeColor?: string;
}

export const LeftNavRail: React.FC<LeftNavRailProps> = ({
  activePage,
  onSelectPage,
  onOpenSettings,
  pendingAutomationsCount,
  unpaidFriendsCount,
}) => {
  const navItems: NavMenuItem[] = [
    {
      id: 'home',
      shortLabel: 'Beranda',
      fullLabel:
        pendingAutomationsCount > 0
          ? `Beranda — ${pendingAutomationsCount} otomatisasi menunggu konfirmasi`
          : 'Beranda (Ringkasan & KPI)',
      icon: Home,
      badgeCount: pendingAutomationsCount > 0 ? pendingAutomationsCount : undefined,
      badgeColor: 'bg-[#d83b01]',
    },
    {
      id: 'mutasi',
      shortLabel: 'Mutasi',
      fullLabel: 'Buku Mutasi (Jurnal, Impor & Audit)',
      icon: Table2,
    },
    {
      id: 'rekening',
      shortLabel: 'Aset',
      fullLabel: 'Rekening & Aset (Kas, Bank, Tabungan, E-Money)',
      icon: Wallet,
    },
    {
      id: 'kredit',
      shortLabel: 'Kredit',
      fullLabel:
        unpaidFriendsCount > 0
          ? `Kredit & Talangan — ${unpaidFriendsCount} piutang teman belum lunas`
          : 'Kredit & Talangan (PayLater, Cicilan, Split Bill)',
      icon: CreditCard,
      badgeCount: unpaidFriendsCount > 0 ? unpaidFriendsCount : undefined,
      badgeColor: 'bg-[#c50f1f]',
    },
    {
      id: 'investasi',
      shortLabel: 'Investasi',
      fullLabel: 'Portofolio Investasi',
      icon: TrendingUp,
    },
    {
      id: 'perencanaan',
      shortLabel: 'Rencana',
      fullLabel: 'Perencanaan (Anggaran & Rutin)',
      icon: CalendarCheck2,
    },
    {
      id: 'analitik',
      shortLabel: 'Analitik',
      fullLabel: 'Analitik (Konsumsi vs Kas Riil)',
      icon: BarChart3,
    },
  ];

  return (
    <aside
      aria-label="Modul aplikasi"
      className="w-[62px] shrink-0 bg-[#eef2f6] border-r border-[#dde3ea] py-2 flex flex-col items-center justify-between select-none z-20"
    >
      <nav className="flex flex-col items-center gap-1 w-full px-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectPage(item.id)}
              title={item.fullLabel}
              className={`w-full relative py-1.5 rounded-[6px] flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer group ${
                isActive
                  ? 'bg-[#ffffff] text-[#0f6cbd] shadow-2xs'
                  : 'text-[#59636e] hover:bg-[#e2e8f0]/70 hover:text-[#1f2328]'
              }`}
            >
              {/* Left Vertical Blue Indicator (#0f6cbd) */}
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[18px] bg-[#0f6cbd] rounded-r-full" />
              )}

              <div className="relative">
                <Icon
                  className={`w-[17px] h-[17px] ${
                    isActive ? 'text-[#0f6cbd]' : 'text-[#59636e] group-hover:text-[#1f2328]'
                  }`}
                />
                {item.badgeCount !== undefined && (
                  <span
                    className={`absolute -top-1 -right-1.5 w-3.5 h-3.5 rounded-full text-[9px] font-bold text-white flex items-center justify-center ${item.badgeColor}`}
                  >
                    {item.badgeCount}
                  </span>
                )}
              </div>

              <span
                className={`text-[9.5px] leading-tight tracking-tight ${
                  isActive ? 'font-semibold text-[#0f6cbd]' : 'font-medium text-[#59636e]'
                }`}
              >
                {item.shortLabel}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="w-full px-1 pt-2 pb-14 border-t border-[#dde3ea] flex flex-col items-center">
        <button
          onClick={onOpenSettings}
          title="Pengaturan Buku Kerja"
          className="w-full py-1.5 rounded-[6px] text-[#59636e] hover:bg-[#e2e8f0]/70 hover:text-[#1f2328] transition-colors cursor-pointer flex flex-col items-center justify-center gap-0.5"
        >
          <Settings className="w-[17px] h-[17px]" />
          <span className="text-[9.5px] font-medium leading-tight">Setelan</span>
        </button>
      </div>
    </aside>
  );
};
