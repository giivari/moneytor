# UI dan gaya (Edisi Fluent 2 Financial Workbook — Acuan Figma Make)

Dipindahkan dari `CLAUDE.md` dan diperbarui sesuai prototipe Figma Make (`references/design-reference/` & `DESIGN_SYSTEM.md`). Berlaku untuk seluruh pekerjaan frontend (`src/components/**`, `src/app/**/*.css`, `**/page.tsx`, dan tes UI di `tests/*.test.mjs`).

## 1. Filosofi Visual & Tema Default (Fluent 2 Light Workbook)
- **Tema Default Wajib Terang (`color-scheme: light`):** Bingkai luar aplikasi (*Top App Bar* dan *Left Icon Rail*) menggunakan permukaan *Fluent Mica* sejuk (`--shell-bg: #eef2f6`), latar kanvas kerja menggunakan `#f3f5f8` (`--bg`), dan permukaan kartu/tabel/modal menggunakan putih bersih (`--surface: #ffffff`).
- **Jangan Paksa Auto-Dark Mode dari OS:** `src/app/tokens.css` tidak boleh memakai `@media (prefers-color-scheme: dark)` untuk memaksa mode gelap otomatis; tema gelap hanya aktif bila atribut `html[data-theme="dark"]` dipilih secara eksplisit.
- **Hirarki Tipografi & Warna Angka (*Editorial Charcoal*):**
  - Font utama menggunakan `'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif` (dan monospace untuk kode referensi/akhiran rekening).
  - Seluruh nominal saldo utama dan kartu KPI wajib menggunakan warna **Hitam Arang Tegas (`--ink: #1f2328`)** dengan `font-variant-numeric: tabular-nums` (`FinancialAmount`), bukan banjir warna hijau/merah.
  - Warna semantik Microsoft Office hanya dipakai secara terukur pada *pill badge*, ikon kotak KPI, dan mutasi masuk/keluar:
    - **Primary / Focus (Office Blue):** `--primary: #0f6cbd` (latar lembut `--info-light: #ebf3fc`)
    - **Positive / Inflow / Lunas (Excel Green):** `--positive: #107c41` (latar lembut `--positive-light: #e6f4ea`)
    - **Negative / Outflow / Due (Outlook Red):** `--negative: #c50f1f` (latar lembut `--negative-light: #fde7e9`)
    - **Warning / Cutoff / Reserve (Office Amber):** `--warning: #9e3600` (latar lembut `--warning-light: #fff4ce`)
    - **Investment / Portfolio (OneNote Purple):** `--data-violet: #5c2e91` (latar lembut `--data-violet-soft: #f3ebf9`)

## 2. Arsitektur Ruang 4 Lapis & Navigasi
1. **Lapis 1 — Top Application Bar (`--header-height: 48px`, `bg: var(--shell-bg)`):**
   - **Kiri:** Identitas logo kotak biru `M` (`#0f6cbd`) + teks `moneytor`.
   - **Tengah:** **Kotak Pencarian Global Instan (`max-width: 440px`, tinggi `32px`, latar `#ffffff`)** untuk mencari transaksi, rekening, fasilitas kredit, atau piutang split bill dan langsung membukanya di panel Inspector kanan.
   - **Kanan:** Tombol `Privasi Rp` (`PrivacyAmountToggle`), tombol `Panduan` (`FeatureOnboarding`), dan **Tombol Split Primer Biru ala New Outlook (`[+ Transaksi baru | ▾]`)** yang membuka modal transaksi atau memilih langsung 1 dari 5 skenario transaksi.
2. **Lapis 2 — Far-Left Icon Rail (`--rail-width: 62px`, `bg: var(--shell-bg)`):**
   - Navigasi vertikal ramping `62px` di seluruh layar desktop (`>= 768px`) dengan **Ikon di atas Label pendek** untuk 7 modul utama (`Beranda`, `Mutasi`, `Aset`, `Kredit`, `Investasi`, `Rencana`, `Analitik`) + `Setelan` di bagian bawah.
   - Modul aktif memiliki latar putih (`#ffffff`), teks & ikon biru (`#0f6cbd`), dan garis vertikal biru `3px` di tepi kiri.
   - Pada layar ponsel (`<= 767px`), rail kiri digantikan oleh **Bottom Navigation Dock** 5 item (`Beranda`, `Mutasi`, tombol tengah `+ Catat`, `Aset`, `Lainnya`).
3. **Lapis 3 — Main Workspace + Underline Pivot Tabs + Collapsible Section Groups + Excel Status Bar:**
   - Setiap halaman menggunakan **Fluent 2 Underline Pivot Tabs** (`flex-wrap: wrap`, tanpa scroll horizontal) di bagian kepala halaman.
   - Halaman `Aset`, `Kredit & Talangan`, dan `Rencana` memiliki tab default **`Semua`** yang mengelompokkan item ke dalam **Collapsible Section Groups ala New Outlook** (header grup lipat `#f8fafc` dengan chevron di kiri dan subtotal di kanan).
   - Di bagian paling bawah setiap halaman wajib menempel **Excel-Style Status Bar (`height: 32px`, `<ExcelStatusBar />`)** yang menampilkan jumlah baris, Total Masuk, Total Keluar, Selisih Bersih, dan indikator `Kalkulasi Real-Time` dari data nyata halaman tersebut.
4. **Lapis 4 — Right Task Pane / Inspector Drawer (`--inspector-width: 420px`):**
   - Mengeklik baris transaksi, rekening, fasilitas kredit, kontrak cicilan, atau piutang akan membuka panel rincian di sisi kanan layar (atau *Bottom Sheet* di layar ponsel) tanpa menutup tabel utama. Tombol aksi sekunder (seperti `Koreksi`, `Catat Refund`, `Batalkan`, `Ubah Rekening`, `Koreksi Saldo Awal`) ditempatkan dengan rapi di dalam Inspector ini, bukan ditumpuk di setiap baris tabel.

## 3. Modal Transaksi 5-Skenario (`transaction-editor.tsx`)
- Menggantikan stepper 3-langkah lama menjadi **Modal 5-Tab Skenario Satu Layar** (mendukung toggle **Mode Dialog Tengah** dan **Mode Slide-Over Kanan**):
  1. **Tab 1 — `Pengeluaran`:** Mendukung deteksi otomatis akun kredit/PayLater (`assetClass === "liability"`) yang memunculkan boks **Skema Kredit Otomatis** (tenor `1x–12x`, siklus tagihan, bunga cicilan) dan biaya tambahan (`OptionalChargesEditor`).
  2. **Tab 2 — `Top-Up & Transfer`:** Dilengkapi **Kalkulator Biaya Admin 3 Mode** (*Tambah di luar nominal / Add-on*, *Potong di dalam / Deducted*, *Biaya Ganda Sumber + Tujuan*) beserta boks pratinjau arus kas keluar vs masuk bersih.
  3. **Tab 3 — `Split Bill / Talangan`:** Memilih metode **`Bagi Rata`** atau **`Per Orang / Proporsional`**, memisahkan porsi pribadi dari porsi talangan teman, dan mengirimkannya lewat operasi atomik `POST /api/finance/split-bill`.
  4. **Tab 4 — `Pemasukan & Refund`:** Membedakan *Penghasilan Aktif*, *Penghasilan Pasif (Bunga/Dividen)*, dan *Refund Batal Belanja / Cashback* (`kind: "refund"` dengan `refundOfActivityId` yang langsung mengurangi pengeluaran kategori asal).
  5. **Tab 5 — `Bayar Tagihan / Terima Ganti`:** Pintasan 1 klik untuk melunasi tagihan fasilitas kredit (`transfer` / `repay`), menerima pelunasan talangan dari akun `receivable`, mencatat pinjaman cair (`borrow`), atau penyesuaian saldo (`adjustment`).

## 4. Disiplin Token, Stylelint & Pembaruan Tes UI
- Satu `src/app/tokens.css` (satu `:root`) dan seluruh CSS di `src/` wajib lolos `npm run lint` (`.stylelintrc.json` + `tests/style-tokens.test.mjs`). Jangan menulis hex mentah, `!important`, atau `user-select: none` di file CSS komponen; daftarkan semua token yang dibutuhkan di `src/app/tokens.css`.
- Angka di layar selalu berasal dari `financeSnapshot`, laporan analitik, atau fungsi domain (`bigint` minor unit), bukan angka literal/mock.
- **Wewenang Pembaruan Tes UI (`npm run test:ui`):** Saat merombak komponen di `src/components/**` agar sesuai dengan desain Figma Make, perbarui juga asersi di `tests/home-overview.test.mjs`, `tests/transaction-editor-steps.test.mjs`, `tests/credit-page.test.mjs`, `tests/insights-presentation.test.mjs`, dan tes UI terkait agar menguji struktur komponen baru.

# Pekerjaan frontend dari perubahan backend (Gemini / Antigravity)

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
   - Editor 5-Tab Skenario: dukung penuh jenis baru `borrow`, `repay`, `refund`, `adjustment` (`opening_debt` / `reconciliation`) lewat `POST /api/finance/post` (`kind`, `refundOfActivityId`, `adjustmentReason`, `charges[]` jenis `loan_interest`, `creditCycle`/`creditInstallments` untuk `borrow`); split bill memakai `POST /api/finance/split-bill` (satu permintaan, `receivableCreated`).
   - Halaman Buku Mutasi (`/transactions`): satukan 4 tab pivot (`Semua Mutasi`, `Otomatisasi & Jadwal`, `Impor CSV / Excel`, `Riwayat Koreksi & Void`), tampilkan label/ikon untuk ketujuh jenis aktivitas; `refund` dan `adjustment` tidak tampil sebagai pemasukan/pengeluaran biasa; kategori `refund` mengikuti pengeluaran asal; tampilkan `refundedMinor`/`netMinor` pada pengeluaran yang di-refund; pisahkan kolom `Nominal Pokok`, `Biaya Admin`, dan `Total Mutasi` di tabel desktop; sertakan `ExcelStatusBar` di bawah. `monthlyExpenses` boleh negatif: batasi tampilan di 0.
2. **Akun dan kredit** (`/assets`, `/credit`, `assets-manager.tsx`, `credit-overview.tsx`)
   - `assetClass` eksplisit di formulir; ubah kelas lewat `POST /api/finance/asset-class-change` (ditolak bila ada jadwal `scheduled`, pesan di `error`).
   - Gunakan tab pivot (`Semua` sebagai default) dengan *Collapsible Section Groups* ala New Outlook dan `ExcelStatusBar`.
   - `creditInstallments` (jadwal per bulan) ditampilkan sebagai tabel kontrak cicilan (`Pokok/bln`, `Bunga/bln`, `Tagihan/bln`, `Sisa Kewajiban`), dilengkapi tombol "Bayar tagihan"; detail akun dari `GET /api/finance/asset-detail` di Inspector memakai `activitySummary.expenseMinor` (bersih, boleh negatif), `refundMinor`, `transferOutMinor` (pokok saja).
3. **Piutang dan utang** (`/credit` bagian Talangan, Beranda)
   - Piutang = akun `receivable`; hasil split bill; pinjaman: `borrow` dari akun `liability`, `repay` dengan bunga sebagai biaya, utang awal (`adjustment` `opening_debt`) tanpa saldo awal negatif. `balanceMinor` `liability` negatif.
4. **Laporan & Analitik** (`/insights`, `home-analytics.tsx`, `insights-*.tsx`)
   - Tambahkan sakelar `Mode Konsumsi Murni` vs `Mode Arus Kas Riil`, 3 tab pivot (`Ikhtisar & Tren`, `Distribusi Kategori & Akun`, `Audit Biaya Admin, Pajak & Bunga Kredit`), kartu *Jembatan Rekonsiliasi*, serta `ExcelStatusBar`.
   - Gunakan `byCategoryParent` dan `byNature` (kelompok per induk dan per sifat; `key` `none` = tanpa sifat); `spendingItems[]` (refund negatif) dan `expenseItems[].refundedMinor/netMinor`; kolom `debtBorrowedMinor`, `debtRepaidMinor`, `adjustmentInMinor/OutMinor`, `refundCount` terpisah dari pemasukan/pengeluaran.
   - Nilai pengeluaran bersih per kategori/bulan boleh negatif: batasi tampilan di 0 di frontend. `netWorthMinor` dan `availableMinor` dari `financeSnapshot` (satu sumber; jangan hitung ulang).
5. **Katalog** (`/settings/catalogs/[catalog]`, `catalog-manager.tsx`, `inline-catalog-select.tsx`)
   - Kategori dua tingkat (`parentId`), sifat (`nature`, `natureOverride`, `effectiveNature`), buat anak lewat `catalog-create` (`parentId`), ubah sifat lewat `POST /api/finance/category-nature`; jenis aset/biaya bawaan baru; penyedia/jaringan bawaan dari katalog (29 penyedia, 5 jaringan).
