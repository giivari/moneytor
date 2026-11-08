import React from 'react';
import { Calculator } from 'lucide-react';
import { formatIDR, formatSignedIDR } from '../utils/formatters';

interface ExcelStatusBarProps {
  rowCount: number;
  totalIn: number;
  totalOut: number;
  hideRp: boolean;
  extraLabel?: string;
  customNetLabel?: string;
  customNetValue?: number;
  isMobile?: boolean;
}

export const ExcelStatusBar: React.FC<ExcelStatusBarProps> = ({
  rowCount,
  totalIn,
  totalOut,
  hideRp,
  extraLabel,
  customNetLabel,
  customNetValue,
  isMobile = false,
}) => {
  const netDiff = customNetValue !== undefined ? customNetValue : totalIn - totalOut;

  if (isMobile) {
    return (
      <div className="h-[30px] bg-[#FAF9F8] border-t border-[#E0E0E0] px-3 flex items-center justify-between text-[11px] text-[#424242] shrink-0 select-none">
        <span>
          <strong>{rowCount}</strong> baris
        </span>
        <span>
          Masuk: <strong className="text-[#107C41] tabular-nums">+{formatIDR(totalIn, hideRp)}</strong>
        </span>
        <span>
          Keluar: <strong className="text-[#C50F1F] tabular-nums">-{formatIDR(totalOut, hideRp)}</strong>
        </span>
      </div>
    );
  }

  return (
    <div className="h-[32px] bg-[#FAF9F8] border-t border-[#E0E0E0] px-3.5 flex items-center justify-between text-[12px] text-[#424242] shrink-0 select-none">
      <div className="flex items-center gap-3 overflow-x-auto whitespace-nowrap">
        <span>
          Menampilkan <strong className="font-semibold text-[#242424] tabular-nums">{rowCount}</strong> baris
        </span>
        <span className="text-[#C8C6C4]">|</span>
        <span>
          Total Masuk:{' '}
          <strong className="font-semibold text-[#107C41] tabular-nums">
            +{formatIDR(totalIn, hideRp)}
          </strong>
        </span>
        <span className="text-[#C8C6C4]">|</span>
        <span>
          Total Keluar:{' '}
          <strong className="font-semibold text-[#C50F1F] tabular-nums">
            -{formatIDR(totalOut, hideRp)}
          </strong>
        </span>
        <span className="text-[#C8C6C4]">|</span>
        <span>
          {customNetLabel || 'Selisih Bersih'}:{' '}
          <strong
            className={`font-semibold tabular-nums ${
              netDiff >= 0 ? 'text-[#107C41]' : 'text-[#C50F1F]'
            }`}
          >
            {formatSignedIDR(netDiff, hideRp)}
          </strong>
        </span>
      </div>

      <div className="hidden md:flex items-center gap-2.5 text-[11.5px] text-[#616161] shrink-0">
        {extraLabel && (
          <>
            <span>{extraLabel}</span>
            <span className="text-[#C8C6C4]">|</span>
          </>
        )}
        <div className="flex items-center gap-1 text-[#0F6CBD] font-medium">
          <Calculator className="w-3.5 h-3.5" />
          <span>Kalkulasi Real-Time</span>
        </div>
      </div>
    </div>
  );
};
