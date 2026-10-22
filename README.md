# moneytor — Personal Finance Monitor

**moneytor** adalah aplikasi web pemantauan dan pencatatan keuangan pribadi (*single-owner*) yang dirancang untuk memberikan gambaran menyeluruh atas posisi aset, dana likuid, dana siap pakai (*spendable*), komitmen anggaran, portofolio investasi, hingga analitik arus kas secara akurat dan privat.

Aplikasi ini dibangun menggunakan **Next.js (App Router)**, **React**, **TypeScript**, dan **PostgreSQL**, dengan sistem pencatatan buku besar (*double-entry ledger*) berbasis bilangan bulat eksak (`bigint`) serta autentikasi modern tanpa kata sandi menggunakan **WebAuthn Passkeys**.

---

## Fitur Utama

### 1. Ringkasan Posisi Keuangan (*Home Overview*)
- Menampilkan posisi kas dan kekayaan bersih secara langsung: total aset tercatat, dana likuid, dana yang siap digunakan (*spendable* setelah dikurangi cadangan & kewajiban), serta pengeluaran bulan berjalan.
- Visualisasi tren arus kas dan daftar aktivitas transaksi terbaru yang adaptif untuk layar desktop maupun *mobile*.

### 2. Pencatatan Transaksi & Otomatisasi
- Mendukung pencatatan **Pemasukan (*Income*)**, **Pengeluaran (*Expense*)**, dan **Transfer Antar-Rekening (*Transfer*)**.
- Memisahkan nominal pokok transaksi dengan rincian biaya tambahan (seperti biaya admin bank, pajak, atau biaya layanan).
- Menjaga keutuhan riwayat pencatatan (*audit trail*) melalui mekanisme koreksi (*supersede*) dan pembatalan (*void*) tanpa menghapus jejak mutasi secara paksa.
- Mendukung **Otomatisasi Transaksi Terjadwal** (tagihan/pemasukan rutin) serta **Aturan Alokasi Otomatis** berbasis persentase saat pemasukan baru tercatat.

### 3. Manajemen Aset & Portofolio Investasi
- Mengelola berbagai jenis akun penyimpanan nilai: rekening bank, dompet digital (*e-wallet*), kas tunai, dan akun sekuritas/investasi.
- Rekonsiliasi saldo awal (*opening balance*) secara transparan tanpa merusak riwayat transaksi yang sudah berjalan.
- Pelacakan portofolio investasi multi-mata uang (pembelian, penjualan, kepemilikan unit, perhitungan harga perolehan rata-rata / *weighted-average cost basis*, serta pembaruan harga pasar manual maupun otomatis).

### 4. Perencanaan Keuangan (*Planning*)
- **Anggaran (*Budgets*)**: Batas pengeluaran berkala per kategori atau keseluruhan.
- **Target Tabungan (*Goals*) & Dana Cadangan (*Reserves*)**: Penyisihan dana untuk tujuan tertentu yang otomatis diperhitungkan agar tidak terpakai dalam saldo *spendable*.
- **Kewajiban (*Obligations*)**: Pengingat dan perhitungan tagihan atau komitmen pembayaran dalam jangka waktu 7, 30, hingga 90 hari ke depan.

### 5. Analitik & Wawasan (*Insights*)
- Perbandingan pemasukan, pengeluaran pokok, biaya tambahan, dan arus kas bersih antar-periode (bulanan, tahunan, maupun rentang tanggal khusus).
- Rincian distribusi pengeluaran berdasarkan kategori, rekening sumber, dan asal pencatatan (manual vs otomatisasi).

### 6. Impor & Ekspor Multi-Format
- **Impor Transaksi**: Mendukung unggahan riwayat mutasi dari file **CSV (`.csv`)** maupun **Excel (`.xlsx`)** lengkap dengan pemetaan akun/kategori dan deteksi duplikasi otomatis sebelum disimpan.
- **Ekspor Laporan & Mutasi**: Tersedia di setiap tabel utama dan melalui menu pengaturan untuk mengunduh laporan dalam format:
  - **PDF e-Statement (`.pdf`)** bergaya laporan mutasi perbankan siap cetak.
  - **Excel Workbook (`.xlsx`)** dengan kolom terformat.
  - **Tabel CSV (`.csv`)** dan **Cadangan Penuh Sistem (`.json`)**.

### 7. Keamanan & Privasi (*Single-Owner Security*)
- Menggunakan **WebAuthn Passkeys** (Windows Hello, Touch ID, Face ID, atau kunci keamanan perangkat) untuk akses masuk tanpa kata sandi.
- Dilengkapi manajemen sesi perangkat aktif dan **Kode Pemulihan (*Recovery Codes*)** sekali pakai.

---

## Teknologi yang Digunakan

- **Frontend & Framework**: Next.js 15 (App Router), React 19, TypeScript, CSS Modules / Custom Tokens, Phosphor Icons.
- **Database & Penyimpanan**: PostgreSQL (`pg`) dengan skema migrasi terurut dan pengujian integritas transaksi.
- **Keamanan**: `@simplewebauthn/server` & `@simplewebauthn/browser`, sesi terenkripsi `SHA-256` dengan cookie `HttpOnly` / `SameSite=Strict`.

---

## Ringkasan Tahapan Pengembangan

Pengembangan aplikasi ini dilakukan secara bertahap dengan fokus pada ketepatan perhitungan keuangan dan kenyamanan antarmuka:

1. **Fondasi Buku Besar & Struktur Data**: Perancangan skema database PostgreSQL, sistem nilai uang presisi tinggi (`bigint`), serta katalog kategori, penyedia layanan keuangan, dan jenis aset yang fleksibel.
2. **Keamanan & Autentikasi Pemilik**: Implementasi akses privat menggunakan Passkey WebAuthn, pengelolaan sesi perangkat, dan mekanisme kode pemulihan akun.
3. **Manajemen Aset & Siklus Hidup Transaksi**: Pembuatan alur pencatatan pemasukan, pengeluaran, transfer, biaya tambahan, serta fitur koreksi saldo awal dan pembatalan transaksi yang aman.
4. **Modul Portofolio Investasi**: Penambahan pencatatan instrumen investasi, transaksi beli/jual, perhitungan *cost basis*, serta integrasi pembaruan harga pasar.
5. **Perencanaan & Otomatisasi Keuangan**: Pengembangan fitur anggaran, dana cadangan, jadwal kewajiban, serta mesin otomatisasi transaksi rutin dan alokasi pemasukan.
6. **Analitik Keuangan & Antarmuka Responsif**: Penyempurnaan halaman *Insights* dan *Home* agar informatif dan nyaman diakses baik di layar komputer maupun ponsel.
7. **Fitur Impor, Ekspor & Kesiapan Produksi**: Penambahan fasilitas impor data dari CSV/Excel, ekspor laporan ke format PDF *e-Statement*/Excel/CSV, serta optimalisasi performa dan keamanan untuk *deployment* cloud.

Penjelasan lebih lanjut mengenai arsitektur dan riwayat rilis dapat dilihat pada:
- [Gambaran Umum Arsitektur (`docs/ARCHITECTURE.md`)](docs/ARCHITECTURE.md)
- [Catatan Perkembangan Fitur (`docs/CHANGELOG.md`)](docs/CHANGELOG.md)

---

## Cara Menjalankan di Lokal

1. **Instalasi Dependensi**
   ```bash
   npm install
   ```

2. **Konfigurasi Environment**
   Salin file `.env.example` menjadi `.env.local`, lalu sesuaikan koneksi PostgreSQL dan origin lokal:
   ```env
   DATABASE_URL=postgresql://user:password@localhost:5432/moneytor
   MONETA_ORIGIN=http://localhost:3000
   MONETA_RP_ID=localhost
   MONETA_BOOTSTRAP_SECRET=<string-acak-43-karakter-untuk-pendaftaran-awal>
   ```
   Untuk membuat nilai `MONETA_BOOTSTRAP_SECRET` secara acak:
   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

3. **Menjalankan Migrasi Database**
   ```bash
   npm run db:setup:cloud
   ```

4. **Menjalankan Server Pengembangan**
   ```bash
   npm run dev
   ```
   Buka `http://localhost:3000/unlock` untuk mendaftarkan Passkey pertama Anda. Setelah Passkey terdaftar, Anda dapat menghapus nilai `MONETA_BOOTSTRAP_SECRET` dari konfigurasi.

---

## Panduan Deployment ke Vercel (Gratis)

Aplikasi ini siap di-*deploy* langsung ke **Vercel** dengan database PostgreSQL gratis (seperti **Neon Serverless Postgres** atau **Supabase**):

1. Hubungkan repositori GitHub ini ke proyek baru di [Vercel](https://vercel.com).
2. Pada tab **Storage** di dashboard Vercel, tambahkan database **Neon Postgres (Free Tier)** sehingga variabel `DATABASE_URL` / `POSTGRES_URL` terpasang otomatis.
3. Pada menu **Settings $\rightarrow$ Environment Variables** di Vercel, tambahkan:
   - `MONETA_ORIGIN` = `https://nama-domain-anda.vercel.app`
   - `MONETA_RP_ID` = `nama-domain-anda.vercel.app`
   - `MONETA_BOOTSTRAP_SECRET` = `<secret-acak-43-karakter>`
4. Klik **Deploy**. Skrip `vercel-build` akan otomatis menyiapkan seluruh tabel pada database kosong dan mem-*build* aplikasi hingga siap digunakan.
