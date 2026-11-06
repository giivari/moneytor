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

Hasil terakhir: typecheck dan lint bersih. test:unit 129 lulus, 1 skip. test:ui 142 lulus. Semua tes DB di container 55434 lulus:
credit 7, auth 12, finance 8, investment 50, imports 3, planning 8, automation 8, events 13, composable 22, allocation 36, analytics 16, presentation 6.

Belum selesai, diketahui:
- Transfer top-up cicilan masih memakai jadwal di catatan (bunga bulan 2..N di luar ledger).
- Koreksi pembelian cicilan dari editor mengirim ulang tenor dan bunga per bulan; pengingat planning lama dari pembelian asli tidak ikut diperbarui.
- Catatan kredit yang sudah dikompres tetap membawa bug void sampai dimigrasi manual (lihat REDESIGN-HANDOFF.md).
- Mode render analytics (`MONEYTOR_INSIGHTS_RENDER_TEST=1`, tanpa script) gagal me-resolve `next/link`; kerusakan ini sudah ada sebelumnya.

Langkah berikutnya: terapkan 015 di Neon branch dan tinjau NOTICE; pindahkan top-up cicilan ke tabel jadwal.

## Fase token (langkah 1), 2026-11-06
Keputusan:
- `src/app/tokens.css` satu-satunya `:root` dan satu-satunya tempat hex/rgb, ukuran font, radius, bayangan, tinggi kontrol.
  Skala: font 12/13/14/16/20/24, radius 4/8/12/pill, kontrol 28/32/40 (+ target sentuh 44), ikon 16/20, spasi 4..32.
  Breakpoint tetap: <=390, <=767, <=1023, <=1279 / >=768, >=1024, >=1280.
- Nama token lama (`--type-*`, `--radius-surface`, `--control-height`, ...) menjadi alias skala; override mobile di `body`.
- Netral mengikuti CLAUDE.md (ink #1d2225, line #e1e4e6); warna data memakai versi AA dari interaction.css. Fokus biru.
- Stylelint (`.stylelintrc.json`, dijalankan oleh `npm run lint`): larang hex, warna bernama, rgb(), `!important`, `:root`,
  `user-select`, font/radius/bayangan/weight di luar token, breakpoint di luar daftar. File yang belum dimigrasi ada di
  `ignoreFiles`; hapus dari daftar saat halamannya dimigrasi.
File: `src/app/{tokens,globals,shell,density,typography,interaction,responsive}.css`, `src/app/layout.tsx`, `package.json`,
`tests/home-overview.test.mjs` (asersi token pindah ke tokens.css).
Hasil: typecheck, lint (eslint + stylelint) bersih; test:unit 129 lulus 1 skip; test:ui 142 lulus.
Berikutnya: shell baru (rail 7 modul, header, inspector) dan Beranda.

## Fase shell + Beranda (langkah 2), 2026-11-06 — menunggu persetujuan arah, belum di-commit
Keputusan:
- Shell grid: header (brand, privasi, panduan, "Catat"), rail 7 modul + Pengaturan (224px; 72px ikon-atas-label di 768-1279),
  dock mobile (Beranda, Mutasi, Catat, Aset, Lainnya). Daftar modul tunggal di `components/navigation.ts`.
- Inspector tunggal (`components/inspector.tsx`): kolom ketiga >=1280, drawer + scrim <1280, bottom sheet <=767; Escape,
  fokus kembali ke pemicu. Baris membuka inspector lewat tombol judul; klik baris tidak membuka saat teks sedang diseleksi.
- Beranda: 4 KPI (Kekayaan bersih = netWorthMinor, Dana siap pakai = availableMinor, Tagihan kredit terdekat, Piutang),
  tab Ringkasan / Rincian kalkulasi (`components/page-tabs.tsx`), container query mengikuti lebar halaman (inspector terbuka).
- Domain baru `lib/domain/home-briefing.ts`: netWorthComponents (jumlahnya = summarizeBalances.netWorth), creditBillsDue,
  receivablesSummary. Mutasi terakhir 6 baris (`listActivities(false, 6)`). Konfirmasi otomatisasi dibatasi 3 + tautan.
- `/credit` sementara placeholder. Grafik dashboard memakai viewBox 340 di ponsel agar teks sumbu >= 12px.
File: shell.css, home.css, tokens.css (aksen modul), app-shell, inspector, inspector-facts, navigation, page-tabs, home-card,
home-overview, home-analytics, home-automation-confirmations, quick-add, feature-onboarding, insights-visuals, summary.ts,
app/credit/page.tsx; tes: home-briefing (baru), home-overview (ditulis ulang untuk kontrak baru), list-order.
Hasil: typecheck + lint bersih; test:unit 133 lulus 1 skip; test:ui 134 lulus.
DB lokal: migrasi 015 diterapkan ke moneta_p2_verify (backup .env.local-backups/*before-015*); satu sesi lokal 1 hari untuk screenshot.
Berikutnya (setelah disetujui): Kredit & Talangan, lalu Mutasi, Aset, Investasi, Rencana, Analitik.

## Langkah 3 (per halaman), 2026-11-06
Fondasi bersama: `src/app/ui.css` (kartu, KPI, chip, notice, baris, breakdown, meter; `.page` = container `page`) dan
`components/ui.tsx` (Card, Kpi, Breakdown, Amount, Chip, PageHeading), `components/entity-details.tsx` (detail inspector).
Beranda: "Belanja bulan ini" + selisih pemasukan di header kartu grafik (dari laporan yang sama dengan grafik; snapshot bila
tidak ada laporan), bukan KPI kelima. SVG dashboard disembunyikan dengan ruang tetap sampai hidrasi.

### Kredit & Talangan
- `/credit`: KPI (sisa utang = liabilitiesMinor, tagihan 30 hari = creditDebtMinor, sisa limit, piutang terbuka), tab
  Kredit & PayLater (kartu per fasilitas, diarsipkan terpisah), Cicilan (kontrak dari `credit_installments`), Piutang & talangan.
- Domain `lib/domain/credit-overview.ts` (status, kontrak, total; total diuji sama dengan summarizeBalances).
- Keputusan kecil: tidak ada tombol "Bayar tagihan" per kartu (bayar lewat Catat → Transfer ke akun kredit); status bayar per
  bulan tidak ditampilkan karena diturunkan dari saldo; jadwal lama di catatan (top-up) tidak tampil di tab Cicilan.
- DB lokal tidak punya akun kredit/piutang: screenshot nyata = keadaan kosong; tampilan berisi diperiksa dengan fixture statis.

### Mutasi
- Kepala "Mutasi" (impor, otomatisasi), KPI belanja bulan ini (monthlyExpenses) dan jumlah aktivitas, riwayat dalam satu kartu.
- Rincian transaksi pindah dari dialog ke inspector bersama; Koreksi membuka editor, Batalkan tetap void (reversal) dengan
  idempotency key per transaksi. Filter, urutan, paginasi, ekspor tidak berubah.
- CSS data-presentation, density, forms dimigrasi ke token (keluar dari ignoreFiles). Skrip migrasi memetakan hex ke token
  terdekat (jarak warna Lab); perbedaan > dE 12 dicatat: #557ba0, #284b61, #4b91c1 -> data-cyan/ink-soft.
- Keputusan kecil: `var(--type-*)` diizinkan stylelint karena alias skala.

### Aset
- Kepala "Aset" (ekspor, tambah aset) dan KPI dari snapshot: total aset (totalMinor), dana likuid (liquidMinor), dapat dipakai
  belanja (eligibleMinor), kewajiban kredit (liabilitiesMinor, tautan ke Kredit & Talangan). Daftar aset, kredit, editor tetap.
- finance.css dimigrasi ke token; kartu total lama dihapus; `!important` diganti selektor berulang (spesifisitas setara);
  `user-select: none` pada tombol dihapus. Warna jenuh dipetakan per keluarga (biru→data-blue, hijau→positive, dst.).
- Label "Unrealized" → "Belum terealisasi".

### Investasi
- Kepala "Investasi" (tanpa tautan balik ke Assets; modul sendiri di rail), KPI per mata uang: nilai pasar, laba/rugi belum
  terealisasi, biaya perolehan tersisa, laba/rugi terealisasi (dari investmentSnapshot). Onboarding, posisi, riwayat tetap.
- investments.css bertoken; `.pnl-*` tanpa `!important` (kelas berulang). Label "Unrealized" diterjemahkan.
- Belum: label ekspor (lib/exports) masih memuat "Unrealized P/L" di berkas ekspor; tidak diubah karena format ekspor.
