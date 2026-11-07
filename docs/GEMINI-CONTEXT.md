# Konteks proyek moneytor untuk pengerjaan frontend

Dokumen ini merangkum apa yang sudah dikerjakan di backend dan kenapa, supaya frontend dikerjakan dengan pemahaman yang sama.
Dokumen ini bukan pengganti `CLAUDE.md`, `docs/CONTRACT.md`, dan `docs/FRONTEND.md`. Bentuk data yang berlaku ada di CONTRACT.md.

## 1. Aplikasi

moneytor adalah aplikasi keuangan pribadi untuk satu pemilik. Next.js 15 (App Router), React 19, TypeScript, PostgreSQL (`pg`), login passkey (WebAuthn), dijalankan di Vercel dengan database Neon.
Uang disimpan sebagai `bigint` satuan terkecil (IDR eksponen 0). Bahasa antarmuka: Indonesia.

## 2. Mengapa direvisi

Audit menemukan kelemahan logika, bukan tampilan:

- Kredit dan piutang dikenali dari nama akun (regex) dan tag `[CREDIT:...]` di catatan akun. Rapuh dan bisa kehilangan data.
- Pembelian cicilan hanya mencatat cicilan pertama sebagai pengeluaran, jadi pengeluaran terlalu kecil di awal.
- Kekayaan bersih bukan aset dikurangi kewajiban, dan "dana siap pakai" punya beberapa definisi berbeda.
- Split bill dikirim sebagai dua permintaan terpisah dari klien, dan piutang menumpuk di satu akun gabungan.
- Tidak ada jenis aktivitas untuk meminjam, melunasi, refund, atau koreksi utang awal.
- Angka yang sama (pengeluaran, saldo) dihitung di banyak tempat dengan definisi berbeda.

Ledger bersifat **single-entry** (satu baris pergerakan per akun), append-only. README lama menyebut "double-entry"; itu salah dan kata itu tidak boleh muncul di teks mana pun.

## 3. Prinsip uang (patokan semua layar)

Patokannya **kekayaan bersih**. Yang mengubah kekayaan bersih adalah pemasukan dan pengeluaran sungguhan. Yang hanya memindahkan uang bukan keduanya:

- Menabung, berinvestasi, transfer antar akun, meminjam, melunasi pokok utang, piutang, dan pelunasan tagihan kartu: **uang berpindah**, bukan pemasukan atau pengeluaran.
- Pengeluaran = pokok pengeluaran + semua biaya (biaya transfer, bunga pelunasan, bunga cicilan) − refund.
- Refund mengurangi pengeluaran asalnya **pada tanggal refund**, memakai kategori dan akun dari pengeluaran asal. Refund bukan pemasukan.
- Pembelian dengan kartu atau cicilan dihitung pengeluaran penuh saat pembelian. Pembayaran tagihan kartu tidak dihitung lagi.
- Kekayaan bersih = aset − kewajiban + piutang (piutang termasuk aset).
- Pengelompokan bulan memakai zona **Asia/Jakarta**.

## 4. Yang sudah ada di backend (jangan diimplementasikan ulang)

**Jenis aktivitas:** `expense`, `income`, `transfer`, dan baru: `borrow`, `repay`, `refund`, `adjustment`.
Status: posted, voided, superseded. Mengedit membuat aktivitas baru (`replaces_activity_id`) dan yang lama menjadi superseded. Void ditolak bila masih ada refund aktif atas pengeluaran itu. Total refund tidak boleh melebihi pengeluaran asalnya.

**Akun:** punya `asset_class`: `asset`, `liability`, `receivable`. Kartu kredit/PayLater/pinjaman umumnya `liability`. Cicilan disimpan di tabel `credit_installments` (bukan lagi di catatan akun).

**Katalog bawaan** (seed dari `docs/CATALOG.md`): kategori dua tingkat (induk dan anak).
- Pengeluaran: 15 induk, 59 anak. Pemasukan: 7 induk, 19 anak.
- Setiap kategori pengeluaran punya **sifat**: `need`, `want`, `obligation`, `social`, `saving`.
- **Sifat efektif** = override pengguna, lalu sifat kategori sendiri, lalu sifat induk. Pengguna bisa mengganti sifat suatu kategori untuk dirinya sendiri (operasi `category-nature`) tanpa mengubah entri bawaan.
- Entri bawaan tidak bisa diubah nama, induk, atau dihapus. Pengguna boleh menambah anak, menonaktifkan entri bawaan, dan menambah alias.
- Menabung dan investasi tidak punya kategori pengeluaran (itu transfer atau transaksi investasi).
- `parent_id` dan `nature` hanya bisa berubah dari kosong ke nilai; setelah itu terkunci.

**Angka (satu sumber):** analitik, daftar item pengeluaran, detail akun, ringkasan bulanan, saldo, dan anggaran semua memakai definisi yang sama (view `spending_effects`). `netWorthMinor` dan `availableFunds` punya satu definisi.
Pengeluaran bersih per kategori atau bulan **boleh negatif** (refund bulan berikutnya). Backend tidak memotongnya.

**Analitik baru:** `byCategoryParent` (per induk), `byNature` (per sifat efektif), item pengeluaran dengan `refundedMinor` dan `netMinor`, `activitySummary` di detail akun (dengan `expenseMinor`, `refundMinor`).

**Otomasi:** aturan pemasukan/pengeluaran berulang dievaluasi saat aplikasi dibuka (kejar sampai 186 hari). Frekuensi: harian, hari kerja, mingguan, tanggal bulanan, akhir bulan.

## 5. Aturan untuk frontend

- Frontend hanya menampilkan. Jangan menghitung ulang saldo, kekayaan bersih, pengeluaran, atau sifat efektif.
- Jangan menebak field. Pakai yang ada di `docs/CONTRACT.md`. Bila butuh data yang belum ada, catat di `docs/BACKEND-REQUESTS.md`.
- Batasi tampilan angka negatif di 0 untuk "terpakai" per kategori atau anggaran, dan tampilkan refund sebagai pengurang yang terpisah.
- Bedakan secara visual: pemasukan/pengeluaran sungguhan vs "uang berpindah" (transfer, tabungan, investasi, pinjaman, pelunasan pokok).
- Entri bawaan katalog tampil terkunci (tidak bisa diubah nama atau induknya). Yang boleh: nonaktifkan, tambah anak, tambah alias, ganti sifat per pengguna.
- Split bill tidak boleh lagi membuat akun piutang tanpa kelas akun.
- Satu permintaan klien = satu operasi backend; jangan memecah operasi bisnis menjadi beberapa permintaan dari klien.
- Jangan memakai kata "double-entry" di teks apa pun.

## 6. Data pengguna

Data lama pengguna sudah diproses di salinan lokal untuk keperluan uji: klasifikasi kelas akun, pemetaan kategori ke induk katalog, dan penonaktifan satu kategori kembar. Saldo, kekayaan bersih, dan total bulanan identik sebelum dan sesudah.
Data produksi belum disentuh. Penerapan ke produksi dilakukan nanti oleh backend lewat prosedur di `docs/DEPLOY.md`, setelah frontend lolos uji.
Beberapa transaksi lama mungkin dikategorikan tidak tepat (misalnya uang teman yang mengganti talangan tercatat sebagai pemasukan). Itu dikoreksi pemilik satu per satu lewat aplikasi; UI perlu memudahkan koreksi itu (edit kategori atau jenis dan lihat riwayat versi).

## 7. Status cabang dan batas kerja

- Cabang backend terpadu: `backend/integrated` (di dalamnya asset-class, debt-activities, catalog, reconcile, userdata). Frontend dikerjakan di `frontend/redesign`.
- Belum ada push. **Jangan merge ke `main`** sebelum frontend selesai dan lolos tes di preview, karena `main` otomatis di-deploy ke produksi.
- Tipe `ActivityKind` di frontend masih tiga jenis lama. Melebarkan tipe ini adalah pekerjaan pertama frontend (daftar komponen terdampak ada di `docs/FRONTEND.md`).
- Dilarang mengubah: `db/`, `scripts/`, `src/lib/**` (selain pelebaran tipe di atas), migrasi, tes backend, `docs/CONTRACT.md`.

## 8. Cara kerja yang diminta pemilik

Hemat kuota, cepat, tidak berputar-putar. Satu fase pada satu waktu, maksimal dua percobaan per kegagalan, laporan singkat, dan tes yang relevan saja (typecheck, lint, test:ui).
