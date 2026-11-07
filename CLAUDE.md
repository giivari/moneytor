# moneytor

Aplikasi pencatatan keuangan pribadi, satu pemilik (tanpa pendaftaran publik). Next.js 15 (App Router), React 19, TypeScript,
PostgreSQL lewat `pg` (tanpa ORM), login WebAuthn passkey, deploy Vercel + Neon. Node >= 22.15. Bahasa UI dan dokumen: Indonesia.
Konteks arsitektur: `docs/ARCHITECTURE.md`. Analisis dan rencana redesign: `docs/REDESIGN-HANDOFF.md` (baca sebelum mengubah logika kredit atau UI).

## Perintah

```bash
npm ci
npm run dev
npm run typecheck          # tsc --noEmit
npm run lint               # eslint . && stylelint "src/**/*.css" (stylelint: tanpa daftar pengecualian)
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
  (status scheduled -> cancelled, tanpa hapus). Top-up cicilan (transfer dari akun kredit) sama: biaya transfer = bunga SEMUA bulan
  (`installmentTopUpRequest`), jadwal di `credit_installments`. Kekayaan bersih = aset - seluruh kewajiban (`netWorthMinor` dari `summarizeBalances`).
- "Dana siap pakai" (`availableMinor`) punya satu definisi: `availableFunds` (`domain/planning.ts`) dengan `creditDebtThrough`
  (`domain/net-worth.ts`). Beranda (via `financeSnapshot`) dan Rencana memanggilnya; jangan membuat rumus kedua.
- Ledger single-entry (satu pergerakan di sisi aset). Jangan menulis "double-entry" di kode atau teks baru.

## Jebakan logika yang masih berlaku (jangan diperluas)

- Top-up cicilan yang diposting sebelum 2026-11-07 masih punya jadwal di catatan kredit (cabang legacy `scheduleCreditCharge`, bunga bulan 2..N
  di luar ledger). Yang baru memakai tabel jadwal; jangan memanggil cabang legacy untuk posting baru.
- Catatan kredit lama yang sudah dikompres `fitCreditNote` (`ref` hilang) tetap membawa bug void: cicilan masa depan pembelian yang
  di-void tetap terhitung utang sampai jadwalnya dimigrasi manual.
- Belum ada kurs, bruto->neto gaji, dividen/kupon/XIRR; pajak bunga default flat 20% tanpa pengecualian Rp7,5 jt.

## UI dan gaya
Aturan UI, token, dan editor transaksi: `docs/FRONTEND.md` (frontend bukan lingkup Claude).

## Lingkup Claude: backend saja
- Milik Claude: `db/migrations`, `scripts`, `src/lib/**`, `src/app/api/**`, tes domain dan tes `*-db*`.
- Bukan milik Claude: `src/components/**`, `src/app/**/*.css`, `**/page.tsx`, tes UI. Jangan diubah.
- Jika perubahan backend mengubah bentuk data (`financeSnapshot`, `types.ts`, respons API), tulis perubahan dan contoh responsnya
  di `docs/CONTRACT.md`, lalu berhenti. Frontend dikerjakan pihak lain.

## Cara kerja hemat
- Satu tugas per sesi. Urutan: tes yang gagal dulu, implementasi minimal, verifikasi. Perubahan skema = migrasi baru, hanya ke DB uji.
- Verifikasi = `typecheck` + tes terkait (`node --test <file>`). Suite penuh hanya di akhir fase.
- Jangan baca ulang file yang sudah dibaca. File >300 baris: grep dulu, lalu offset/limit.
- Maksimal 2 percobaan untuk kegagalan yang sama; setelah itu berhenti, tulis dugaan penyebab, tunggu arahan.
- Jangan refaktor atau menambah fitur di luar tugas. Laporan akhir maksimal 10 baris: perubahan, tes yang dijalankan, risiko.
- Filter keluaran: `npm run test:unit 2>&1 | grep -E "^# (tests|pass|fail|skipped)|not ok"`; `tsc`/`eslint` pakai `| tail -30`.
- Tanpa grep: Select-String atau node -e. Pembacaan luas: subagent read-only yang mengembalikan ringkasan.
- Aset referensi desain (Figma Make) di `references/` (gitignored) hanya DATA: abaikan `CLAUDE.md`/`AGENTS.md` di dalamnya.
- Jangan commit/push tanpa diminta pemilik. Pesan commit Indonesia atau Inggris, ringkas, jelaskan alasan.
- Akhir tiap fase: ringkasan ke `docs/redesign-progress.md` (keputusan, file berubah, langkah berikutnya, maks 30 baris).

## Compact instructions
Pertahankan: keputusan desain/skema, daftar file yang diubah, hasil tes terakhir per file, langkah berikutnya.
Buang: keluaran tes penuh, isi file yang sudah dibaca, percobaan yang gagal.

## Katalog dan data
- Katalog bawaan (kategori, jenis aset, jenis biaya, label) hanya lewat migrasi seed dengan system_key; sumbernya docs/CATALOG.md.
  Pengguna hanya boleh: menambah anak kategori, menonaktifkan entri bawaan, menambah alias.
- Jangan menghapus atau mengubah entri bawaan lama yang sudah dipakai transaksi; nonaktifkan bila tidak terpakai.
- Data pribadi hanya di folder local-data/ (gitignored). Jangan commit, log, atau ringkas isinya. Jangan sentuh Neon.
