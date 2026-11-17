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

Langkah berikutnya: terapkan 015 di Neon branch dan tinjau NOTICE (pemindahan top-up ke tabel jadwal sudah selesai, lihat fase 2026-11-07).

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

### Rencana
- Kepala "Rencana" (jangka kewajiban + ekspor sebagai aksi), KPI per mata uang dari planningPosition: dapat digunakan,
  setelah kewajiban rencana N hari, cadangan aktif, kewajiban belum tercakup (dengan jatuh tempo/tercakup).
- Keputusan kecil: label "Setelah kewajiban rencana" + catatan "belum termasuk tagihan kredit", karena angka ini tidak memuat
  creditDebt (berbeda dengan Dana siap pakai di Beranda). Lebar khusus 1100px dihapus agar sejajar dengan halaman lain.
- planning.css bertoken; duplikat .planning-row-actions digabung.

### Analitik
- Kepala "Analitik"; teks "Planning"/"Transactions" di laporan diganti "Rencana"/"Mutasi". insights.css bertoken.
- Tes diperbarui untuk keputusan skala: breakpoint 700px → 767px, teks sumbu 11px → 12px (minimum konten).
- Bug migrasi diperbaiki: hex beralpha (#5263720b sorotan bar, #181d2075 backdrop dialog keuangan) sempat jadi warna pekat;
  kini --neutral-soft dan --scrim. Skrip migrasi harus memeriksa hex 8 digit secara manual bila dipakai lagi.
- Catatan ops: tiga dev server sempat berbagi .next (aset 404); dimatikan, .next dihapus, satu server dijalankan ulang.

## Fase penyelesaian (6 butir), 2026-11-07
Keputusan:
- Dana siap pakai: satu definisi. `availableFunds` (domain/planning) + `creditDebtThrough` (domain/net-worth) dipakai `financeSnapshot` dan Rencana.
  Rencana menerima tagihan kredit per jangka (7/30/90) dari server dan mengabaikan pengingat tagihan kredit di rencana (sudah ada di tagihan).
  Tes: `tests/available-funds.test.mjs` (Beranda dan Rencana sama; 30 hari = angka Beranda).
- CSS: 8 file terakhir bertoken, `ignoreFiles` stylelint kosong (`tests/style-tokens.test.mjs`). Pembanding piksel sebelum/sesudah 14 halaman x 2
  ukuran (sampel diperiksa mata: Otomatisasi, Katalog, Login): selisih penyesuaian skala (radius/ukuran font/bayangan); tiga transparansi yang diratakan migrasi (backdrop dialog x2, sorotan
  onboarding) diperbaiki. `!important` onboarding dihapus dengan ambang mobile komponen 640 -> 767px. Stylelint kini hanya melarang `user-select: none`.
- Kredit: tombol "Bayar tagihan" di kartu aktif yang punya tagihan -> editor Transfer (tujuan = akun kredit, jumlah = tagihan terdekat, sumber =
  akun non-kredit yang dapat dipakai, `pickTransferSource`). Ekspor: label "Laba/rugi belum terealisasi".
- Editor transaksi tiga langkah (Jenis, Akun & nominal, Opsi lanjutan); stepper bisa diklik; maju dari langkah 2 memvalidasi isian wajib; simpan
  tersedia di langkah 2 dan 3. `QuickAdd kind` membuka langkah 2 dengan jenis terpilih (belum dipakai di halaman mana pun).
- Top-up cicilan -> tabel jadwal TANPA migrasi baru: `credit_installments` tidak membatasi jenis aktivitas, dan transfer membawa biaya
  `transfer_fee` sebesar bunga semua bulan. Posting baru: ledger = pokok + seluruh bunga, baris per bulan. Top-up lama di catatan kredit tetap
  terbaca (cabang legacy `scheduleCreditCharge` dipertahankan beserta tesnya). Koreksi top-up memulihkan tenor dan biaya milik pemilik.
File: domain/{planning,net-worth,credit-purchase,credit-overview,transaction-preset}.ts, finance/summary.ts, components/{planning-manager,
transaction-editor,quick-add,pay-bill-button,credit-overview}.tsx, app/{forms,credit/credit}.css, .stylelintrc.json, exports/service.ts.
Hasil: typecheck, lint (eslint + stylelint) bersih; test:unit 146 lulus 1 skip; test:ui 149 lulus; DB container 55434: credit 8, finance 8, planning 8.
Belum: wordmark halaman login masih berpendar warna (visual.css lama); belum ada tombol "Catat transfer" per halaman yang memakai `QuickAdd kind`;
koreksi top-up lama (tanpa baris jadwal) tidak menjadwal ulang.

## Audit 360 (2026-11-14) — eksekusi lima batch
Keputusan: K8 bucket gagal-saja per hash IP harian; K5 soft-delete + migrasi 021; T7 filter regex investasi dihapus; T15 TIDAK diubah (lihat bawah).
Migrasi baru: 021 (guard rencana), 022 (rate limit per klien), 023 (idempotensi asset-create). Rincian: docs/AUDIT-2026-11-14.md, docs/CONTRACT.md.
File utama: db/migrations/02[1-3]*, lib/{db/pool,db/required-migration,auth/store,planning/repository,imports/{parser,service},exports/{service,format},
finance/{service,format},domain/{credit,asset-terms,net-worth},repositories/{assets,lifecycle},automation/reconcile,http/*}, api/{auth,finance,health,imports,exports,automation},
components/{inspector,finance-feedback,finance-form-hooks,transaction-editor,assets-manager,credit-overview,automation-builder,planning-manager,
investment-manager,transactions-view,global-search,theme-toggle,import-workspace}, app/{layout,*.css (sapuan selector yatim)}, 4 komponen yatim dihapus.
Hasil: typecheck + lint bersih; test:unit 167 lulus; test:ui 156 lulus; DB (disposable 55433): planning, finance, import, analytics, allocation,
automation, composable, income-event, presentation lulus; auth-db (schema terisolasi) 12 lulus; DB 55434: credit+split-bill+debt 27 lulus.
Dua tes DB yang gagal sudah dibereskan di sesi penutup (keduanya masalah tes: env .env.local bocor ke tes investasi; tes lifecycle usang soal arsip kategori bawaan).
Sesi penutup: konflik CSS .page-heading-actions/.finance-dialog dipusatkan; spinner non-tombol dihapus; ARIA pencarian + fokus Inspector; "type":"module" menghapus warning Node.
Hasil akhir: tsc/lint/test:unit 168/test:ui 156 bersih, semua tes DB lulus (55433 170, auth 12, 55434 47), next build sukses.
Langkah berikutnya: keputusan Beranda vs income event (home-overview.test melarang reconcile penuh di Beranda); idempotensi portfolio/instrument/type-create;
konflik CSS .page-heading-actions/.finance-dialog; skrip user-migrate; peringatan MODULE_TYPELESS_PACKAGE_JSON.

## Harga pasar otomatis multi-aset + cron (2026-11-15)
Keputusan: adapter `reksadana` (risanb.com, NAB terbaru dari `history.nav` + `nav` per dana), `yahoo` (chart v8, harga dibulatkan ke `priceHint`, mata uang subunit GBp/ZAc/ILA ditolak), `gold` (GC=F x USDIDR=X / 31,1034768, bigint, 6 desimal).
Cron `/api/cron/refresh-prices` memakai `refreshAllMarketPrices` (tanpa sesi, dijaga CRON_SECRET timing-safe, kunci idempotensi deterministik -> updated/skipped/failed). Pengecualian sesi dicatat di CLAUDE.md dan ARCHITECTURE.md.
File: lib/investments/{providers,service,cron-auth}.ts, api/cron/refresh-prices/route.ts, vercel.json, .env.example, tests/{investment-domain,investment-db}.test.mjs, docs/{ARCHITECTURE,DEPLOY,CONTRACT}.md, placeholder di components/investment-manager.tsx (atas permintaan pemilik).
Langkah berikutnya: setel CRON_SECRET + MONETA_PRICE_PROVIDER=composite di Vercel; isi referensi harga tiap instrumen; pantau log cron pertama (Yahoo tak resmi, bisa 429).

## Catatan otomatisasi + pelunasan piutang atomik (2026-11-17)
Keputusan: lingkup sesi ini backend+frontend (pengecualian batas CLAUDE.md untuk dua fitur ini). Idempotensi settle-receivable lewat migrasi 024 (tabel append-only, pola split_bill_operations); REQUIRED_MIGRATION -> 024, produksi wajib db:migrate sebelum deploy.
Catatan: transaksi dari aturan otomatisasi tanpa catatan memakai nama aturan (helper automationNote); fallback tampilan riwayat lama: note || recurringRuleName || jenis. income-events.ts belum diubah (instance tak membawa title).
Settle: planReceivableSettlement (domain murni) -> pas / lebih bayar (transfer sisa + income selisih) / kurang parsial / kurang tutup lunas (expense selisih dari piutang); kategori other_income/other_expense bila aktif. Dialog SettleReceivableDialog baru menggantikan yang lama di assets-manager (bug kunci idempotensi + biaya dibebankan ke piutang).
File: db/migrations/024, lib/domain/receivable-settlement.ts, lib/finance/receivable-settlement-service.ts, api/finance/[operation]/route.ts, lib/automation/{service,composable-service,composable-domain}.ts, components/{settle-receivable-dialog,pay-bill-button,assets-manager,transactions-view,home-overview,entity-details}.tsx, docs/CONTRACT.md, tests/{receivable-settlement-domain,receivable-settlement-db,home-overview,credit-page,automation-db}.
Hasil: tsc/lint bersih, test:unit 175 lulus (4 skip), test:ui 157, DB 55434: settle 7, split-bill 8, automation 8, composable 22; next build sukses.
Langkah berikutnya: jalankan db:migrate 024 di Neon (oleh pemilik) sebelum deploy; pertimbangkan income-events.ts dan Beranda bila ingin nama aturan juga di sana.
## Audit performa, Batch 2: quick win jalur baca (2026-11-17)
Keputusan: latensi didominasi gelombang query berurutan x RTT Vercel->Neon (Neon Singapura; Function default iad1). `vercel.json` kini `"regions": ["sin1"]`. Reconcile Beranda memakai pre-check murah tanpa throttle waktu (perilaku auto-post identik).
Perubahan: (1) `lib/db/readiness.ts` (`tablesReady`/`tableFlags`): cek `to_regclass` di-cache per proses, hanya hasil "ada" (pola `opening-capability`); dipakai di automation/{service,income-events,allocation-service,review-service}, finance/service, imports/service, planning/repository. (2) `inReadOnlyTransaction` di `db/pool.ts`: `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` satu round-trip (menggantikan BEGIN + SET TRANSACTION) di summary, analytics (2), investments/read, planning/repository. (3) `financeSnapshot`: transaksi snapshot berjalan bersamaan dengan `listActivities(false, 6)` dan `readPendingAutomations`, tidak lagi menunggu (barrier). (4) `reconcileAutomation`: hanya aturan dengan `materialized_through < materializationHorizon(now)` (ekuivalen `catchUpWindow != null`, dites di automation-domain.test.mjs), jadi steady state tanpa transaksi + row lock per aturan. (5) Migrasi 025_read_path_indexes.sql: `activity_charges(activity_id)`, `financial_activities(refund_of_activity_id)` parsial, `ledger_movements(asset_id) INCLUDE (amount_minor)`; REQUIRED_MIGRATION -> 025.
Sengaja TIDAK di-cache: `generalAutomationReady` (composable-service.ts). Di dalam transaksi `readGeneralAutomation`, `readAllocationSummaries`/`readAutomationReviewContexts` memanggil `requireOwnerSession()` yang bisa meminta koneksi pool kedua saat satu koneksi sudah ditahan. Tanpa query `to_regclass` yang menyebar waktu, 7 snapshot paralel menghabiskan pool (investment-db "concurrent wealth snapshots" gagal). Perbaikan sebenarnya (jangan meminta koneksi kedua saat memegang satu) masuk Batch 3. `import-filter.ts` juga tidak di-cache (modul daun, dites tanpa loader alias).
Hasil: tsc/lint bersih; test:unit 176 lulus (4 skip); test:ui 157; DB 55433+55434: allocation 36, analytics 16, composable 22, finance 8, presentation 6, automation 8, import 3, investment 51, planning 8, income-event 13, reconcile 5, catalog-readonly 3, credit 9, debt 10, settle 7, split-bill 8, user-migrate 7, catalog 5; auth-db 12.
Langkah berikutnya: pemilik menjalankan `db:migrate` 025 di Neon SEBELUM deploy (health melapor "incomplete" bila belum); ukur ulang di Vercel Logs; lalu Batch 3 (pre-check `reconcileGeneralAutomation`, N+1 `readVersion`, hazard koneksi kedua di atas).
## Audit performa, Batch 3: struktural jalur baca (2026-11-17)
Keputusan: pekerjaan reconcile umum didahului satu query EXISTS baca-saja tanpa lock; N+1 dibatch; hazard "koneksi kedua saat memegang satu" ditutup di sumbernya, lalu cache `generalAutomationReady` yang dibatalkan di Batch 2 diaktifkan lagi.
Perubahan: (1) `composable-service.ts`: SQL pekerjaan (changed/transaction sources/time rules/automatic/due upcoming) jadi builder bersama, dipakai eksekusi (dengan FOR UPDATE) dan `hasGeneralAutomationWork()` (EXISTS tanpa lock); `reconcileGeneralAutomation` keluar lebih awal bila tidak ada pekerjaan (steady state ~3 query tanpa transaksi/advisory lock, sebelumnya 11). Retry instance `failed` otomatis tetap (perilaku lama, tercakup `automaticInstancesSql`). (2) `readVersions` memuat N versi aturan dalam 4 query (sebelumnya 4 per aturan); `readVersion` tinggal pembungkus. Dipakai readGeneralAutomation, discoverTransactions, discoverTime. (3) `allocation-service.ts`: `summaries()` 3 query untuk N assessment (sebelumnya 3 per assessment); `summary()` tetap untuk jalur tunggal. (4) `readAllocationSummaries`/`readAutomationReviewContexts` tidak memanggil `requireOwnerSession()` bila pemanggil sudah memegang klien (sudah terotorisasi), sehingga tidak meminta koneksi pool kedua. (5) `listActivities`: charges + termin cicilan + readiness paralel, lalu 4 query asal-usul (lineage) paralel: 8 gelombang -> 3 (semua `database().query` pendek, tidak menahan koneksi).
Sengaja TIDAK dikerjakan: pushdown filter proyeksi review (`review-query.ts`): hash `revision` dipakai perintah review stale-safe, risiko tinggi untuk untung kecil di ukuran data pribadi. `import-filter.ts` tetap tanpa cache (modul daun tanpa loader alias).
Tes: composable-db +1 (pre-check false saat idle, true saat ada sumber baru, false setelah dikuras).
Hasil: tsc/lint bersih; test:unit 176 lulus (4 skip); test:ui 157; semua 18 tes DB lulus (composable 23, investment 51, allocation 36, income-event 13, dst).
Langkah berikutnya: ukur di Vercel Logs sesudah sin1 + migrasi 025; Batch 4 (bentuk data: batasi riwayat harga/trade `investmentSnapshot`, tulis ke docs/CONTRACT.md lalu berhenti); rekomendasi frontend dicatat terpisah.
## Audit performa, Batch 5: navigasi tanpa loading (2026-11-17)
Keputusan: lingkup sesi ini mencakup frontend (pengecualian batas CLAUDE.md, disetujui pemilik). Setelah sin1 + Batch 2/3, RSC 60-200 ms; sisa rasa loading berasal dari navigasi client. Jendela cache client disetujui: 30 dtk kunjungan, 60 dtk prefetch.
Perubahan: (1) next.config.ts `experimental.staleTimes {dynamic:30, static:60}`; router.refresh() setelah mutasi tetap mengosongkan cache. (2) AppLink: `unstable_dynamicOnHover` (prefetch penuh saat hover/sentuh; prefetch viewport tetap parsial; prefetch={false} tetap mematikan). Tipe publik next/link (Pages Router) belum memuat prop ini; runtime App Router memakai next/dist/client/app-dir/link yang mendukungnya, jadi diteruskan lewat cast terdokumentasi. (3) useListRequest: bila `initial` cocok dengan kunci aktif, data server dipakai langsung tanpa GET ulang (mount /transactions dan setelah router.refresh()); filter, paging, dan retry tetap fetch. (4) vercel.json: Cache-Control 7 hari + SWR untuk /brands/* dan /icon-*.png (menghapus 304 berulang).
File: next.config.ts, vercel.json, src/components/{app-link.tsx,use-list-request.ts}, tests/list-loading.test.mjs (indeks request disesuaikan, +1 tes refresh tanpa request).
Hasil: tsc/lint bersih; test:unit 176 lulus (4 skip); test:ui 158; next build sukses. Uji manual hover-prefetch belum dilakukan (nonaktif di dev; cek di produksi).
Langkah berikutnya: verifikasi di DevTools produksi (hover memicu ?_rsc penuh, klik tanpa request/skeleton, tidak ada GET activities saat buka /transactions, logo dari disk cache). Batch 4 (bentuk data investasi) masih ditunda.
## Audit performa, Batch 4: riwayat harga investasi dibatasi (2026-11-17)
Keputusan: `investmentSnapshot` default hanya mengirim harga terkini per instrumen (DISTINCT ON berindeks, `as_of <= now()`), karena cron harga harian membuat riwayat penuh tumbuh tanpa batas dan tidak ada komponen yang membacanya (UI memakai `holdings[].price`). Riwayat penuh lewat `{ priceHistory: true }`, hanya untuk backup JSON, jadi isi backup tidak berubah. `trades` tidak dibatasi: void/superseded dipakai toggle riwayat `InvestmentManager`, dan tumbuhnya hanya dari input manual.
File: lib/investments/read.ts, lib/exports/service.ts (backup memakai priceHistory), docs/CONTRACT.md, tests/{investment-db.test.mjs (+asersi harga terkini), lifecycle-cases.mjs (audit koreksi memakai riwayat penuh)}.
Hasil: tsc/lint bersih; test:unit 176 lulus (4 skip); test:ui 158; semua 18 tes DB lulus (investment 51); next build sukses.
Langkah berikutnya: commit/push atas permintaan pemilik; cek ukuran `?_rsc` /assets/investments di produksi.
