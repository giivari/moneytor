# moneytor: serah-terima analisis + redesign (untuk Claude Code & Antigravity)

Isi: (A) audit logika keuangan, (B) peta fitur aplikasi akuntansi pribadi, (C) temuan UI/UX/estetika lama,
(D) adopsi penuh desain referensi Figma Make (`Fluent 2 Financial Workbook`), (E) rencana kerja, (F) temuan operasional/keamanan.
Letakkan zip referensi di `references/design-reference/` (gitignored). Gunakan komponen dan tata letak di dalam `references/design-reference/src/` serta `DESIGN_SYSTEM.md` sebagai acuan langsung desain UI/UX, sambil tetap menjaga aturan backend `BIGINT` dan ledger di repo ini.

Status verifikasi ditandai: [JALAN] dibuktikan dengan menjalankan kode, [BACA] dari membaca kode, [DUGAAN] belum diuji.

---------------------------------------------------------------------------
## A. Audit logika keuangan (Sudah diselesaikan di Backend Migrasi 015–020)

Akar masalah lama: utang dan piutang belum punya model data sendiri, jadi ditambal lewat tebakan nama akun dan teks di kolom `note`.

1. [SELESAI di 015] Klasifikasi kredit dulu memakai regex nama (`CREDIT_NAME_RE`). Kini `assets.asset_class` (`asset | liability | receivable`) menjadi sumber tunggal (`isCreditAsset`, `isReceivableAsset`).
2. [SELESAI di 015] Kelebihan bayar/refund di akun kredit kini masuk ke aset dan berstatus "Lebih bayar" (`overpaidMinor`).
3. [SELESAI di 015] Kekayaan bersih (`netWorthMinor`) kini menghitung `aset - seluruh kewajiban` (termasuk seluruh sisa kontrak cicilan di `credit_installments`).
4. [SELESAI] Dokumentasi diseragamkan menjadi **ledger aset single-entry** (append-only, koreksi/void lewat pembalik/reversal).
5. [SELESAI di 015] Jadwal cicilan pembelian dan top-up baru disimpan di tabel `credit_installments` (`seq 1..360`, `principalMinor`, `interestMinor`, `status: scheduled | cancelled`), bukan lagi dipadatkan di `assets.note`.
6. [SELESAI di 017] Saldo awal utang lama kini didukung lewat aktivitas `adjustment` dengan `adjustmentReason: "opening_debt"` pada akun `liability` tanpa melanggar constraint `opening_balance >= 0`.
7. [BACA] Pemasukan belum memiliki rincian potongan slip gaji (PPh 21/BPJS) tersendiri di tabel khusus, namun biaya/pajak pada transaksi sudah didukung lewat `charges[]`.
8. [BACA] Belum ada tabel kurs otomatis; total dihitung per mata uang tanpa konsolidasi lintas mata uang.
9. [BACA] Pajak bunga tabungan default flat 20% (bisa diatur 0% per akun di syarat akun).
10. [BACA] Saldo akun reguler boleh negatif tanpa blokir keras di server.
11. [SELESAI di 015 & 020] Pembelian cicilan dari akun kredit langsung membukukan seluruh pokok sebagai pengeluaran dan seluruh bunga sebagai biaya (`Bunga cicilan`) pada saat pembelian; `credit_installments` membagi tagihan per bulan jatuh tempo.
12. [BACA] Investasi mendukung beli/jual + harga rata-rata + biaya transaksi (`investment_trade_fees`).
13. [SELESAI di 016 & 017] Jenis aktivitas kini mencakup 7 jenis (`income`, `expense`, `transfer`, `borrow`, `repay`, `refund`, `adjustment`) serta endpoint atomik `POST /api/finance/split-bill`.

Yang wajib dipertahankan di backend: bayar tagihan kartu dicatat sebagai transfer/repay (pokok bukan pengeluaran dua kali); ledger append-only dengan reversal; kunci idempotensi; `bigint` minor unit + desimal 18 digit untuk unit investasi; saldo awal immutable; `planningTotals` dan `availableFunds` bebas hitung ganda antara cadangan, kewajiban rencana, dan tagihan kredit.

---------------------------------------------------------------------------
## B. Peta aliran uang vs cakupan moneytor

| Aliran | Contoh | Di moneytor |
|---|---|---|
| Masuk, mengubah kekayaan | gaji, THR, freelance, bunga, dividen, kupon, sewa | Ada (`income`) |
| Keluar, mengubah kekayaan | konsumsi, langganan, pajak kendaraan/PBB, premi, zakat, denda, bunga cicilan | Ada (`expense` + `charges[]` + `spending_effects`) |
| Berputar, tak mengubah kekayaan | transfer, top-up e-wallet, bayar kartu, ke investasi | Ada (`transfer` + transaksi investasi) |
| Masuk tapi bukan penghasilan | pinjaman cair (`borrow`), pelunasan piutang (`transfer` dari `receivable`), `refund` | Sudah ada di backend (`016` & `017`); wajib ditampilkan penuh di UI |
| Utang | kartu kredit, paylater, KTA, pinjaman | Akun `asset_class = 'liability'` + tabel `credit_installments` + `borrow`/`repay`/`opening_debt` |
| Piutang | talangan, split bill | Akun `asset_class = 'receivable'` + `POST /api/finance/split-bill` |
| Aset non-kas | saham, reksa dana, SBN, emas, kripto | Modul Investasi (`investment_positions`, `investment_Holdings`) |
| Perencanaan | anggaran, dana darurat, sinking fund, target, kewajiban rutin | Modul Rencana (`planning_items`, `availableFunds`) |
| Audit & Rekonsiliasi | rekonsiliasi saldo, koreksi saldo awal, riwayat void/superseded, audit biaya admin & bunga | Ada (`adjustment`, `asset-opening-correct`, `charges[]`) |

---------------------------------------------------------------------------
## C. Masalah UI/UX saat ini yang harus dibereskan oleh Frontend

1. **Tema terbalik ke Dark Mode hitam pekat (`#141414`):** Blok `@media (prefers-color-scheme: dark)` di `src/app/tokens.css` memaksa aplikasi menjadi gelap gulita saat OS pengguna memakai dark mode. Wajib dihapus agar aplikasi selalu tampil dalam **Fluent 2 Light Workbook** (`#EEF2F6` shell, `#F3F5F8` canvas, `#FFFFFF` surface) secara default.
2. **Sidebar terlalu lebar (`224px`) & Header kosong:** Sidebar `224px` memakan ruang tabel dan belum memiliki kotak pencarian global maupun tombol split `[+ Transaksi baru | ▾]` 5 skenario di header.
3. **Beranda menumpuk terlalu banyak kartu:** Beranda saat ini menampilkan kartu `Akun & aset`, `Investasi`, dan `Komposisi belanja` yang sempit dan berdesakan. Wajib disederhanakan menjadi 4 KPI Charcoal + 2 kolom (`Tren 6 Bulan + Tabel 6 Mutasi Terakhir` di kiri; `Konfirmasi Otomatisasi + Jatuh Tempo Terdekat` di kanan) sesuai Figma Make.
4. **Editor transaksi 3-langkah (`1. Jenis -> 2. Akun & nominal -> 3. Opsi lanjutan`) lambat dan kaku:** Pengguna harus klik bolak-balik antar step. Wajib diganti menjadi **Modal 5-Tab Skenario Satu Layar** (`1. Pengeluaran & Skema Kredit`, `2. Top-Up & Transfer 3 Mode Admin`, `3. Split Bill / Talangan`, `4. Pemasukan & Refund`, `5. Bayar Tagihan / Terima Ganti`) dengan opsi *Mode Dialog Tengah* dan *Mode Slide-Over Kanan*.
5. **Belum ada Collapsible Section Groups & `ExcelStatusBar`:** Halaman `Aset`, `Kredit & Talangan`, dan `Rencana` belum menggunakan grup lipat ala New Outlook dan belum memiliki bar status ala Excel (`32px`) di bagian bawah layar.

---------------------------------------------------------------------------
## D. Panduan Adopsi Referensi Figma Make (`references/design-reference/`)

**Wajib Diambil & Diterapkan Penuh ke `src/components/**` dan `src/app/**/*.css`:**
- **Skin Visual & Palet Fluent 2 Financial Workbook (`DESIGN_SYSTEM.md`):**
  - Bingkai *Calm Mica* (`--shell-bg: #eef2f6`, border `#dde3ea`), latar kanvas (`--bg: #f3f5f8`), permukaan putih (`--surface: #ffffff`), header grup/tabel (`--surface-sunken: #f8fafc`), hover baris biru muda (`--surface-hover: #f0f6fc`).
  - Tipografi `'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif`, nominal utama berwarna **Hitam Arang (`#111827` / `#1f2328`)** dengan `tabular-nums`, tombol utama biru Office (`--primary: #0f6cbd`), hijau Excel (`--positive: #107c41`), merah Outlook (`--negative: #c50f1f`), oranye Office (`--warning: #9e3600`), ungu OneNote (`--data-violet: #5c2e91`).
- **Arsitektur Bingkai 4 Lapis:**
  - `TopHeader` (`48px`): Brand `moneytor` di kiri, **Instant Global Search Bar** di tengah, tombol `Privasi Rp`, `Panduan`, dan **Split Button `[+ Transaksi baru | ▾]`** di kanan.
  - `LeftNavRail` (`62px`): Navigasi vertikal ramping dengan ikon di atas label untuk 7 modul (`Beranda`, `Mutasi`, `Aset`, `Kredit`, `Investasi`, `Rencana`, `Analitik`) + `Setelan` di bawah, dan **Bottom Navigation Dock** di layar ponsel (`<= 767px`).
  - `ExcelStatusBar` (`32px`): Bar status di bagian bawah setiap halaman yang merangkum jumlah baris, Total Masuk, Total Keluar, dan Selisih Bersih secara real-time.
  - `InspectorPanel` (`420px`): Panel rincian di sisi kanan layar (atau *Bottom Sheet* di ponsel) saat baris tabel/kartu diklik.
- **Struktur Halaman & Komponen Figma Make:**
  - **Beranda (`HomeBriefingPage.tsx`):** 2 Tab Pivot (`Ringkasan Eksekutif` & `Rincian Kalkulasi Net Worth`), 4 KPI Charcoal, Grid `7:5` (`Tren Arus Kas 6 Bulan + Tabel 6 Mutasi Terakhir` di kiri; `Konfirmasi Otomatisasi + Jatuh Tempo Terdekat` di kanan).
  - **Buku Mutasi (`BukuMutasiPage.tsx`):** 4 Tab Pivot dalam satu halaman (`Semua Mutasi`, `Otomatisasi & Jadwal`, `Impor CSV / Excel`, `Riwayat Koreksi & Void`), *Command Ribbon* filter tipis, dan tabel 8 kolom (`Tanggal & Waktu`, `Jenis`, `Alur Sumber -> Tujuan`, `Kategori`, `Catatan`, `Nominal Pokok`, `Biaya Admin`, `Total Mutasi`).
  - **Rekening & Aset (`RekeningAsetPage.tsx`):** 4 Tab Pivot (`Semua`, `Kas & Rekening`, `Tabungan & Deposito`, `Kartu E-Money`) dengan *Collapsible Section Groups* ala New Outlook, badge bunga/biaya admin per akun, dan aksi edit/koreksi saldo awal di dalam Inspector kanan.
  - **Kredit & Talangan (`KreditTalanganPage.tsx`):** 4 Tab Pivot (`Semua`, `Kredit & PayLater`, `Kontrak Cicilan`, `Piutang & Split Bill`) di mana tab `Semua` menampilkan ke-3 grup lipat sekaligus (grid kartu fasilitas kredit dengan meter limit & tombol `Bayar Tagihan`, tabel kontrak cicilan, serta daftar piutang split bill dengan tombol `Terima Ganti`).
  - **Investasi (`PortofolioInvestasiPage.tsx`):** 3 Tab Pivot (`Posisi & Valuasi`, `Riwayat Beli, Jual & Dividen`, `Instrumen & Harga Pasar`), 3 KPI, dan tabel Holdings yang langsung terbuka (tidak disembunyikan di dalam `<details>`).
  - **Perencanaan (`PerencanaanPage.tsx`):** 4 Tab Pivot (`Semua`, `Anggaran`, `Target & Cadangan`, `Kewajiban`) dengan 3 grup lipat dan progress bar pemakaian anggaran/target.
  - **Analitik (`AnalitikInsightsPage.tsx`):** Sakelar `Mode Konsumsi Murni` vs `Mode Arus Kas Riil`, 3 Tab Pivot (`Ikhtisar & Tren`, `Distribusi Kategori & Akun`, `Audit Biaya Admin, Pajak & Bunga Kredit`), dan kartu *Jembatan Rekonsiliasi Kas vs Konsumsi*.
  - **Modal Catat Transaksi (`TransactionModal.tsx`):** Modal 5-Tab Skenario satu layar dengan opsi *Mode Dialog Tengah* dan *Mode Slide-Over Kanan*.

**Yang Tidak Boleh Dibawa Mentah dari Kode Figma Make (Harus Disesuaikan ke Sistem `moneytor`):**
- Jangan menyalin angka mock statis (`148250000`, `18450000`, dll.) atau tipe `number`/float; semua angka wajib berasal dari `financeSnapshot`, API backend, dan `bigint` minor unit (`formatMinor`).
- Jangan memakai `overflow: hidden` atau `user-select: none` pada `body`; gunakan CSS responsif asli (`@media` dan `@container`) serta daftarkan seluruh warna/ukuran di `src/app/tokens.css` agar lulus `stylelint`.
- Jangan mengubah data secara langsung di state lokal tanpa memanggil endpoint backend (`POST /api/finance/post`, `replace`, `void`, `split-bill`, `asset-class-change`, `category-nature`) sesuai `docs/CONTRACT.md`.

---------------------------------------------------------------------------
## E. Rencana Kerja Redesign Frontend

1. **Langkah 1 — Fondasi Token, Tipe `AnyActivityKind`, dan Shell (`tokens.css`, `shell.css`, `app-shell.tsx`, `excel-status-bar.tsx`):**
   - Hapus `@media (prefers-color-scheme: dark)` dari `src/app/tokens.css` agar default selalu Fluent 2 Light Mode; set `--rail-width: 62px`, `--header-height: 48px`, `--inspector-width: 420px`.
   - Lebarkan penanganan `FinanceActivity["kind"]` ke 7 jenis (`income | expense | transfer | borrow | repay | refund | adjustment`) sesuai daftar di `docs/FRONTEND.md`.
   - Terapkan Top Header (`48px`) dengan Global Search Bar & Split Button `[+ Transaksi baru | ▾]`, Far-Left Icon Rail (`62px`), dan komponen `<ExcelStatusBar />`.
2. **Langkah 2 — Modal Transaksi 5-Skenario (`transaction-editor.tsx` & `quick-add.tsx`):**
   - Rombak editor transaksi menjadi 5 tab skenario satu layar (`Pengeluaran`, `Top-Up & Transfer`, `Split Bill / Talangan`, `Pemasukan & Refund`, `Bayar Tagihan / Terima Ganti`) yang terhubung penuh ke API `docs/CONTRACT.md`.
3. **Langkah 3 — Rombak 7 Halaman Utama Sesuai Figma Make:**
   - Kerjakan berurutan: `home-overview.tsx` -> `transactions-view.tsx` -> `assets-manager.tsx` -> `credit-overview.tsx` -> `investment-manager.tsx` -> `planning-manager.tsx` -> `insights-workspace.tsx` & `insights-report.tsx`.
4. **Langkah 4 — Perbarui Asersi `tests/*.test.mjs` & Verifikasi Penuh:**
   - Sesuaikan tes UI di `tests/home-overview.test.mjs`, `tests/transaction-editor-steps.test.mjs`, `tests/credit-page.test.mjs`, `tests/insights-presentation.test.mjs`, dan `tests/style-tokens.test.mjs` dengan komponen baru.
   - Jalankan `npm run typecheck`, `npm run lint`, `npm run test:unit`, dan `npm run test:ui` hingga seluruhnya lulus bersih.

---------------------------------------------------------------------------
## F. Temuan operasional dan keamanan repo (Tetap Berlaku)

1. Jangan mengubah file migrasi `001` s.d. `020` yang sudah ada (checksum SHA-256 diverifikasi oleh `scripts/migrate.mjs` dan `tests/production-readiness.test.mjs`).
2. Jangan menaruh SQL pembersihan data atau perubahan skema di `scripts/vercel-db-setup.mjs`.
3. Semua route di `src/app/api` wajib memeriksa sesi pemilik (kecuali `/api/health`) dan menjaga pemeriksaan origin/CSRF.
4. Referensi Figma Make di `references/design-reference/` harus tetap dikecualikan di `tsconfig.json`, `eslint.config.mjs`, dan `.stylelintrc.json` serta tidak memiliki folder `node_modules` sendiri (dijaga oleh `tests/style-tokens.test.mjs`).
