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
  mis. `MONEYTOR_P3_DB_TEST` dan port 55433/55434). JANGAN arahkan `DATABASE_URL` ke database produksi atau Neon milik pemilik.
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

## Jebakan logika yang sudah diketahui (jangan diperluas)

- Klasifikasi kredit/piutang saat ini lewat regex nama akun (`CREDIT_NAME_RE`, `isReceivableAsset`) dan tag `[CREDIT:...]`/`[ACCT:...]` di `assets.note`.
  Ini salah untuk "Piutang Pinjaman ke Budi", "Dana Kredit Mahasiswa", "Dana Cicilan Motor", dan tidak mengenali "Hutang"/"KPR". Rencana: kolom
  `asset_class` + tabel jadwal cicilan. Jangan menambah regex atau tag baru; jangan membangun UI baru yang bergantung padanya tanpa memberi tahu pemilik.
- Kelebihan bayar akun kredit hilang dari kekayaan bersih dan UI menampilkan "Lunas". Net worth tidak memuat cicilan bulan ke-3 dst.
- Docs menyebut ledger "double-entry", padahal single-entry (satu pergerakan di sisi aset). Jangan menulis "double-entry" di kode atau teks baru.
- Belum ada kurs, bruto->neto gaji, dividen/kupon/XIRR; pajak bunga default flat 20% tanpa pengecualian Rp7,5 jt.
- Terkonfirmasi dari kode, belum diuji ujung ke ujung: pembelian cicilan hanya membukukan cicilan pertama sebagai expense
  (`transaction-editor.tsx` memposting `firstMonthTotalMinor`; cicilan 2..N di luar ledger lewat `scheduleCreditCharge`).
  Tulis tes sebelum mengubah perilakunya.
- Akun yang cocok sebagai kredit sekaligus piutang (mis. "Piutang Pinjaman ke Budi") hilang dari aset DAN utang: `financeSnapshot`
  memeriksa `isCreditAsset` lebih dulu sehingga saldo tidak masuk total aset, sementara saldo positif memberi `totalUnpaid = 0`.
- Void pembelian cicilan yang catatan kreditnya sudah dikompres `fitCreditNote` (langkah terakhir: gabung per bulan, `ref` hilang)
  meninggalkan cicilan masa depan sebagai utang: `releaseCreditCharge` tidak menemukan pemiliknya dan jalur cadangan hanya
  menangani `LEGACY_DEFERRED_REF` non-off-ledger, jadi mengembalikan `null`.

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
