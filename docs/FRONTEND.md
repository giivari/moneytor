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
