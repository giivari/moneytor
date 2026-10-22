# Catatan Perkembangan Fitur (Changelog)

Dokumen ini merangkum perkembangan fitur **moneytor** secara umum dari tahap awal pengembangan hingga versi siap pakai (*production-ready*).

---

## Tahap 7 — Kesiapan Produksi, Ekspor Multi-Format & Impor Data
- **Ekspor Laporan Multi-Format**: Penambahan tombol ekspor langsung pada tabel Transaksi, Aset, Investasi, dan Perencanaan, serta halaman pusat ekspor (`/settings/data`) yang mendukung format **PDF e-Statement (`.pdf`)**, **Excel Workbook (`.xlsx`)**, **CSV (`.csv`)**, dan **Snapshot JSON**.
- **Impor Riwayat Transaksi**: Penambahan alur impor file `.csv` dan buku kerja Excel (`.xlsx`) dengan fitur pemetaan akun/kategori, penyaringan baris, dan deteksi duplikasi otomatis.
- **Identitas Penyedia Layanan Keuangan**: Penambahan katalog preset institusi keuangan dan jaringan pembayaran populer di Indonesia untuk mempermudah pembuatan akun aset baru.
- **Optimalisasi Deployment Cloud**: Penambahan endpoint pemeriksaan kesehatan sistem (`/api/health`), penyensoran data sensitif pada log, peningkatan *security headers*, serta skrip otomatis untuk penyiapan database kosong di Vercel.

## Tahap 6 — Analitik Keuangan (*Insights*) & Penyempurnaan Tampilan *Home*
- **Laporan & Grafik Analitik**: Penyajian perbandingan pemasukan, pengeluaran, dan selisih bersih antar-periode beserta rincian pengeluaran per kategori, rekening, dan biaya tambahan.
- **Dasbor *Home* Responsif**: Penyempurnaan tata letak halaman utama agar menampilkan metrik terpenting, grafik tren 6 bulan, ringkasan investasi/rekening, dan aktivitas terbaru secara proporsional di desktop maupun layar ponsel.

## Tahap 5 — Perencanaan Keuangan (*Planning*) & Otomatisasi Transaksi
- **Modul Perencanaan**: Pengelolaan anggaran pengeluaran (*budgets*), target tabungan (*goals*), penyisihan dana cadangan (*reserves*), dan jadwal kewajiban jatuh tempo (*obligations*) dalam rentang 7, 30, dan 90 hari.
- **Otomatisasi & Alokasi**: Penambahan fitur jadwal transaksi berulang otomatis maupun berbasis konfirmasi, serta aturan alokasi otomatis berbasis persentase dari pemasukan yang tercatat.

## Tahap 4 — Portofolio & Instrumen Investasi
- **Pencatatan Investasi**: Dukungan multi-portofolio dan multi-mata uang untuk mencatat kepemilikan unit instrumen, transaksi beli/jual (*buy/sell*), serta penyelesaian kas dari/ke rekening aset.
- **Valuasi & Harga Pasar**: Perhitungan harga perolehan rata-rata (*weighted-average cost basis*), laba/rugi belum terealisasi, riwayat koreksi harga manual, serta dukungan konektor harga pasar.

## Tahap 3 — Manajemen Aset & Buku Besar Transaksi
- **Siklus Hidup Aset & Rekening**: Pembuatan, pengubahan, pengarsipan, pemulihan, dan rekonsiliasi koreksi saldo awal rekening.
- **Pencatatan Transaksi**: Implementasi transaksi Pemasukan, Pengeluaran, dan Transfer antar-rekening lengkap dengan rincian biaya tambahan, fitur koreksi transaksi, dan pembatalan (*void*) dengan jurnal pembalik otomatis.

## Tahap 2 — Keamanan & Autentikasi Passkey
- **Autentikasi Tanpa Kata Sandi**: Implementasi pendaftaran pemilik tunggal (*single-owner*), login menggunakan **WebAuthn Passkeys**, pengelolaan daftar perangkat/sesi aktif, dan kode pemulihan darurat (*recovery codes*).

## Tahap 1 — Fondasi Domain & Basis Data
- **Arsitektur Dasar**: Perancangan antarmuka navigasi utama, aturan perhitungan nilai uang presisi tinggi (`bigint`), serta skema migrasi database PostgreSQL untuk buku besar keuangan.

