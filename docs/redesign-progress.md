# Progres redesign

## Fase logika kredit (migrasi 015), 2026-11-06
Keputusan:
- Pembelian cicilan dibukukan penuh: expense = seluruh pokok, charge "Bunga cicilan" = seluruh bunga, semuanya di ledger akun kredit.
  `credit_installments` (seq 1..360, status scheduled -> cancelled saja, append-only lewat trigger) hanya membagi tagihan per bulan.
  Status bayar diturunkan dari saldo, tidak disimpan.
- `assets.asset_class` (asset/liability/receivable) satu-satunya sumber klasifikasi; regex nama dihapus. Backfill: liability hanya dari tag
  [CREDIT] atau nama kredit bersaldo negatif dengan movement; piutang dari nama; sisanya asset. Semua dilaporkan lewat RAISE NOTICE.
- Utang akun kredit bertanda: `liabilitiesMinor` memuat seluruh sisa cicilan; kelebihan bayar masuk aset dan berstatus "Lebih bayar".
  `netWorthMinor` = aset - kewajiban. `creditDebtMinor` (30 hari) tetap untuk planning.
- Void membatalkan baris jadwal. Replace dengan request kredit membatalkan baris lama dan membuat baris baru.

File utama: `db/migrations/015_credit_asset_class.sql`, `src/lib/domain/{credit,credit-purchase,net-worth}.ts`, `src/lib/finance/{service,summary,types}.ts`,
`src/lib/repositories/assets.ts`, `src/app/api/finance/[operation]/route.ts`, `src/components/{assets-manager,transaction-editor,insights-cashflow}.tsx`.
Tes: `tests/credit-redesign.test.mjs` (a, b, c, e), `tests/credit-installment-db.test.mjs` (d, backfill, replace). Tes DB lama membaca
`MONEYTOR_DB_TEST_PORT` (default 55433), dan asersi migrasinya kini dinamis.

Hasil terakhir: typecheck dan lint bersih. test:unit 128 lulus, 1 skip. test:ui 142 lulus. Semua tes DB di container 55434 lulus:
credit 7, auth 12, finance 8, investment 50, imports 3, planning 8, automation 8, events 13, composable 22, allocation 36, analytics 16, presentation 6.

Belum selesai, diketahui:
- Transfer top-up cicilan masih memakai jadwal di catatan (bunga bulan 2..N di luar ledger).
- Koreksi pembelian cicilan dari editor mengirim ulang tenor dan bunga per bulan; pengingat planning lama dari pembelian asli tidak ikut diperbarui.
- Catatan kredit yang sudah dikompres tetap membawa bug void sampai dimigrasi manual (lihat REDESIGN-HANDOFF.md).
- Mode render analytics (`MONEYTOR_INSIGHTS_RENDER_TEST=1`, tanpa script) gagal me-resolve `next/link`; kerusakan ini sudah ada sebelumnya.

Langkah berikutnya: terapkan 015 di Neon branch dan tinjau NOTICE; pindahkan top-up cicilan ke tabel jadwal.
