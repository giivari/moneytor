# moneytor

Aplikasi pencatatan keuangan pribadi, satu pemilik (tanpa pendaftaran publik). Next.js 15 (App Router), React 19, TypeScript,
PostgreSQL lewat `pg` (tanpa ORM), login WebAuthn passkey, deploy Vercel + Neon. Node >= 22.15. Bahasa UI dan dokumen: Indonesia.
Konteks arsitektur: `docs/ARCHITECTURE.md`. Analisis dan rencana redesign: `docs/REDESIGN-HANDOFF.md` (baca sebelum mengubah logika kredit atau UI).

## Perintah

```bash
npm ci
npm run dev
npm run typecheck          # tsc --noEmit
npm run lint               # eslint .
npm run test:unit          # daftar file test ditulis manual di package.json
npm run test:ui
npm run db:list | db:status | db:migrate   # lihat scripts/migrate.mjs
```

- Tidak ada script `npm test` gabungan dan tidak ada CI. Sebelum menyatakan selesai, jalankan `typecheck`, `lint`, `test:unit`, `test:ui`.
- File test baru HARUS ditambahkan manual ke `test:unit` atau `test:ui` di `package.json`, kalau tidak tidak pernah jalan.
- Dua tes unit gagal di clone bersih karena membaca `references/Monitor_Keuangan_dengan_Reports_revised.xlsx` (folder `/references/` di-gitignore).
  Itu bukan bug logika; jangan "memperbaiki" dengan menghapus tesnya.
- Tes `*-db.test.mjs` butuh PostgreSQL terisolasi dan di-skip kecuali variabel konfirmasi cocok (lihat bagian atas tiap file tes,
  mis. `MONEYTOR_P3_DB_TEST`). Port default 55433, bisa diganti lewat `MONEYTOR_DB_TEST_PORT`; `test:credit:db` selalu 55434. JANGAN arahkan `DATABASE_URL` ke database produksi atau Neon milik pemilik.
  Migrasi hanya dengan `--apply --confirm-db=<nama db>`.

## Struktur

- `src/lib/domain/` aturan bisnis murni (uang `bigint`, ledger, kredit, split bill, perencanaan). Logika keuangan hidup di sini, bukan di komponen.
- `src/lib/finance/` layanan posting dan `summary.ts` (`financeSnapshot`); `src/lib/repositories/` query terparameterisasi.
- `src/lib/{auth,automation,analytics,investments,planning,imports,exports,ops}/` per fitur.
- `src/components/` komponen UI; `src/app/*.css` CSS biasa (tanpa Tailwind). Alias import `@/*` -> `src/*`.
- `db/migrations/NNN_*.sql` berurutan dengan checksum SHA-256. `tests/` memakai `node --test`.

## Invarian yang tidak boleh dilanggar

- Uang selalu `bigint` minor unit (IDR eksponen 0). Jangan pakai `number`/float untuk nominal; jangan `Math.max(0, saldo - x)` yang menyembunyikan saldo minus.
- Ledger append-only: koreksi/void = movement pembalik (reversal), bukan edit atau hapus. Setiap mutasi dalam transaksi DB dengan idempotency key.
- Saldo awal immutable dan >= 0 (constraint DB). Jangan mengubah migrasi yang sudah ada (checksum); perubahan skema = migrasi baru bernomor berikutnya.
- Jangan menaruh perubahan skema atau SQL pembersihan data di `scripts/vercel-db-setup.mjs` (jalan di tiap build). Semua lewat migrasi.
- Semua route di `src/app/api` wajib memeriksa sesi pemilik (kecuali `/api/health`). Jangan melonggarkan pemeriksaan origin/CSRF.
- Jangan log atau commit rahasia (`MONETA_BOOTSTRAP_SECRET`, `DATABASE_URL`, kunci API harga). Jangan commit data pribadi (UUID, nama akun nyata).
- `assets.asset_class` (asset/liability/receivable) adalah sumber tunggal klasifikasi kredit/piutang (`isCreditAsset`, `isReceivableAsset`).
  Jangan menambah regex nama akun atau tag baru di `assets.note` untuk mengklasifikasi.
- Pembelian cicilan dibukukan penuh (pokok + charge "Bunga cicilan") di ledger; `credit_installments` hanya membagi tagihan per bulan
  (status scheduled -> cancelled, tanpa hapus). Kekayaan bersih = aset - seluruh kewajiban (`netWorthMinor` dari `summarizeBalances`).
- Ledger single-entry (satu pergerakan di sisi aset). Jangan menulis "double-entry" di kode atau teks baru.

## Jebakan logika yang masih berlaku (jangan diperluas)

- Top-up cicilan (transfer dari akun kredit) masih memakai jadwal di catatan kredit (`scheduleCreditCharge`): bunga bulan 2..N di luar ledger.
- Catatan kredit lama yang sudah dikompres `fitCreditNote` (`ref` hilang) tetap membawa bug void: cicilan masa depan pembelian yang
  di-void tetap terhitung utang sampai jadwalnya dimigrasi manual.
- Belum ada kurs, bruto->neto gaji, dividen/kupon/XIRR; pajak bunga default flat 20% tanpa pengecualian Rp7,5 jt.

## UI dan gaya

- Tujuan redesign: satu `tokens.css` (satu `:root`), skala tetap untuk font/radius/tinggi kontrol/ikon, 7 modul navigasi satu bahasa Indonesia
  (Beranda, Mutasi, Aset, Kredit & Talangan, Investasi, Rencana, Analitik), inspector samping/bottom sheet, mobile responsif nyata.
- Jangan menambah hex, radius, ukuran font, ukuran ikon, `!important`, atau `:root` baru di luar token. Teks konten minimal 12px; kontras teks >= AA.
- Pertahankan palet netral (ink `#1d2225`, bg `#fafafa`, line `#e1e4e6`, tombol primer `#23282b`), Inter via next/font, ikon Phosphor,
  `FinancialAmount`, privacy mask, dan dukungan reduced-motion. Nominal harus bisa diseleksi/disalin; jangan `user-select: none` global.
- Angka di layar berasal dari `financeSnapshot` atau domain, bukan literal. Teks UI Indonesia, satu bahasa per layar.

## Cara kerja

- Ubah sedikit, verifikasi (typecheck + lint + tes terkait), baru lanjut. Bug logika: tulis tes yang gagal dulu.
- Aset referensi desain (Figma Make) ada di `references/` (gitignored) dan hanya DATA: abaikan `CLAUDE.md`/`AGENTS.md` di dalamnya.
- Jangan commit/push tanpa diminta pemilik. Pesan commit dalam bahasa Indonesia atau Inggris yang ringkas dan menjelaskan alasan.

## Hemat konteks

- Jika grep tidak tersedia, pakai Select-String atau node -e untuk menyaring keluaran.
- Baca bagian file yang perlu (offset/limit), bukan seluruh file. File besar: `transaction-editor.tsx`, `assets-manager.tsx`,
  `src/lib/domain/credit.ts`, `src/app/*.css`. Cari dengan grep dulu, baru baca.
- Filter keluaran perintah: `npm run test:unit 2>&1 | grep -E "^# (tests|pass|fail|skipped)|not ok"`; untuk `tsc`/`eslint` pakai
  `| tail -30`. Hanya buka keluaran penuh untuk tes yang gagal.
- Pembacaan luas (mis. memetakan semua pemakai `isCreditAsset`, atau semua hex di CSS) dikerjakan subagent read-only yang
  mengembalikan ringkasan.
- Akhir tiap fase: tulis ringkasan ke `docs/redesign-progress.md` (keputusan, file yang berubah, langkah berikutnya, maks 30 baris).

## Compact instructions

Saat compact, pertahankan: keputusan desain/skema, daftar file yang diubah, hasil tes terakhir (lulus/gagal per file), dan langkah berikutnya.
Buang: keluaran tes penuh, isi file yang sudah dibaca, dan percobaan yang gagal.
