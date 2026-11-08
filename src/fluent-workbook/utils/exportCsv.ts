import { TransactionItem } from '../types/finance';

export function downloadTransactionsCsv(
  transactions: TransactionItem[],
  filename = 'moneytor_buku_mutasi_nov2026.csv'
) {
  const headers = [
    'Kode Referensi',
    'Tanggal',
    'Waktu',
    'Jenis',
    'Akun Sumber',
    'Akun Tujuan',
    'Kategori',
    'Catatan',
    'Nominal Pokok (IDR)',
    'Biaya Admin (IDR)',
    'Total Mutasi (IDR)',
    'Konsumsi Murni Pribadi (IDR)',
    'Status',
  ];

  const rows = transactions.map((t) => [
    t.refCode,
    t.date,
    t.time,
    t.type,
    `"${t.sourceAccount.replace(/"/g, '""')}"`,
    `"${(t.targetAccount || '-').replace(/"/g, '""')}"`,
    `"${t.category.replace(/"/g, '""')}"`,
    `"${t.note.replace(/"/g, '""')}"`,
    t.principalAmount,
    t.adminFee,
    t.totalMutation,
    t.personalConsumptionAmount,
    t.isVoided ? 'VOID' : 'VALID',
  ]);

  const csvContent =
    '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
