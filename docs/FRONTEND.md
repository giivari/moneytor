# UI dan gaya

Dipindahkan utuh dari CLAUDE.md. Berlaku untuk pekerjaan frontend (`src/components/**`, `src/app/**/*.css`, `**/page.tsx`, tes UI).

- Keadaan sekarang: satu `tokens.css` (satu `:root`) dan SEMUA CSS di `src/` lolos stylelint (`.stylelintrc.json`, `ignoreFiles` hanya folder non-sumber;
  dijaga `tests/style-tokens.test.mjs`). Skala tetap untuk font/radius/tinggi kontrol/ikon, 7 modul navigasi satu bahasa Indonesia
  (Beranda, Mutasi, Aset, Kredit & Talangan, Investasi, Rencana, Analitik), inspector samping/bottom sheet, mobile responsif.
- Primitif bersama: `src/app/ui.css` + `src/components/ui.tsx` (Card, Kpi, Chip, Amount, PageHeading), `components/inspector.tsx`, `page-tabs.tsx`.
  Halaman baru memakainya dulu; CSS halaman hanya untuk tata letak khusus.
- Editor transaksi (`transaction-editor.tsx`) tiga langkah: Jenis, Akun & nominal, Opsi lanjutan; semua state di induk. Prop `preset`
  (`TransactionPreset`: jenis, akun, tujuan, jumlah, catatan) dipakai `QuickAdd kind=...` dan tombol "Bayar tagihan" (`PayBillButton`);
  koreksi atau preset jenis mulai di langkah 2.
- Jangan menambah hex, radius, ukuran font, ukuran ikon, `!important`, atau `:root` baru di luar token. Teks konten minimal 12px; kontras teks >= AA.
  Transparansi (scrim, bayangan, sorotan) memakai token (`--scrim`, `--shadow-1..3`) atau `transparent`, jangan hex beralpha yang dipetakan otomatis ke warna pekat.
- Pertahankan palet netral (ink `#1d2225`, bg `#fafafa`, line `#e1e4e6`, tombol primer `#23282b`), Inter via next/font, ikon Phosphor,
  `FinancialAmount`, privacy mask, dan dukungan reduced-motion. Nominal harus bisa diseleksi/disalin; jangan `user-select: none` (stylelint melarangnya; `user-select: all` untuk kode pemulihan boleh).
- Angka di layar berasal dari `financeSnapshot` atau domain, bukan literal. Teks UI Indonesia, satu bahasa per layar.

# Pekerjaan frontend dari perubahan backend (Gemini)

Kontrak data dan contoh JSON nyata: `docs/CONTRACT.md` (bagian "Contoh nyata dari fixture tes", dibangkitkan `scripts/contract-examples.mjs`). Komponen tidak diubah oleh backend.

## Status galat tipe (cabang `backend/integrated`)

`npm run typecheck` bersih (0 galat): `ActivityKind` sengaja tetap tiga jenis lama (income/expense/transfer) supaya komponen tetap mengompilasi.
Konsekuensinya `FinanceActivity.kind` bisa berisi `borrow | repay | refund | adjustment` saat runtime (GET `/api/finance/activities`, `financeSnapshot().recent`), padahal tipenya tidak menyebutnya.
Saat tipe dilebarkan ke `AnyActivityKind` (sudah ada di `src/lib/finance/types.ts`), uji coba menghasilkan galat berikut; itulah daftar yang harus diubah:
- `transactions-view.tsx` (TS7053): peta label/ikon/warna per `kind` (baris 69, 71, 104, 118, 132, 138, 139).
- `automation-builder.tsx` dan `automation-manager.tsx` (TS7053, TS2322): peta per jenis. Otomasi hanya mengenal tiga jenis lama, jadi cukup mempersempit tipe ke `ActivityKind`.
- `transaction-editor.tsx` (TS2339, TS2322): label jenis (baris 452) dan prop `kind` ke `QuickAdd`/preset (baris 635).
- `money-movement-row.tsx` dan `quick-add.tsx`: memakai `ActivityKind` untuk tampilan baris dan preset.
Sampai komponen siap, daftar transaksi menampilkan label kosong/undefined untuk empat jenis baru.

## Layar yang harus berubah, data yang dipakai, dan prioritas

1. **Transaksi dan editor** (`/transactions`, `transaction-editor.tsx`, `transactions-view.tsx`, `money-movement-row.tsx`)
   - Editor: jenis baru borrow, repay, refund, adjustment (opening_debt) lewat `POST /api/finance/post` (`kind`, `refundOfActivityId`, `adjustmentReason`, `charges[]` jenis `loan_interest`, `creditCycle`/`creditInstallments` untuk borrow); split bill memakai `POST /api/finance/split-bill` (satu permintaan, `receivableCreated`).
   - Daftar: label/ikon empat jenis baru; refund dan adjustment tidak tampil sebagai pemasukan/pengeluaran; kategori refund mengikuti pengeluaran asal; tampilkan `refundedMinor`/`netMinor` pada pengeluaran yang di-refund. `monthlyExpenses` boleh negatif: batasi tampilan di 0.
2. **Akun dan kredit** (`/assets`, `/credit`, `assets-manager.tsx`, `credit-overview.tsx`)
   - `assetClass` eksplisit di formulir; ubah kelas lewat `POST /api/finance/asset-class-change` (ditolak bila ada jadwal `scheduled`, pesan di `error`).
   - `creditInstallments` (jadwal per bulan), tombol "Bayar tagihan"; detail akun dari `GET /api/finance/asset-detail` memakai `activitySummary.expenseMinor` (bersih, boleh negatif), `refundMinor`, `transferOutMinor` (pokok saja).
3. **Piutang dan utang** (`/credit` bagian Talangan, beranda)
   - Piutang = akun `receivable`; hasil split bill; pinjaman: borrow dari akun liability, repay dengan bunga sebagai biaya, utang awal (`adjustment` opening_debt) tanpa saldo awal negatif. `balanceMinor` liability negatif.
4. **Laporan** (`/insights`, `home-analytics.tsx`, `insights-*.tsx`)
   - `byCategoryParent` dan `byNature` (kelompok per induk dan per sifat; `key` `none` = tanpa sifat); `spendingItems[]` (refund negatif) dan `expenseItems[].refundedMinor/netMinor`; kolom `debtBorrowedMinor`, `debtRepaidMinor`, `adjustmentInMinor/OutMinor`, `refundCount` terpisah dari pemasukan/pengeluaran.
   - Nilai pengeluaran bersih per kategori/bulan boleh negatif: batasi tampilan di 0 di frontend. `netWorthMinor` dan `availableMinor` dari `financeSnapshot` (satu sumber; jangan hitung ulang).
5. **Katalog** (`/settings/catalogs/[catalog]`, `catalog-manager.tsx`, `inline-catalog-select.tsx`)
   - Kategori dua tingkat (`parentId`), sifat (`nature`, `natureOverride`, `effectiveNature`), buat anak lewat `catalog-create` (`parentId`), ubah sifat lewat `POST /api/finance/category-nature`; jenis aset/biaya bawaan baru; penyedia/jaringan bawaan dari katalog (29 penyedia, 5 jaringan).
