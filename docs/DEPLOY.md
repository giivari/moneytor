# Prosedur Penerapan Produksi (Neon & Vercel)

Dokumen ini tidak memuat host, URL, atau kata sandi. Dijalankan oleh pemilik.

## 1. Otomasi Migrasi di Vercel
Perintah `vercel-build` otomatis menjalankan migrasi skema database yang belum
diterapkan bila variabel `DATABASE_URL` disetel pada environment build Vercel.

## 2. Urutan Penerapan
1. **Branch Staging**: Buat branch Neon baru dari produksi (mis. `staging-redesign`).
2. **Konfigurasi Preview**: Pasang `DATABASE_URL` Preview Vercel ke branch staging (bukan produksi).
3. **Push Cabang Fitur**: Push branch memicu build preview dan migrasi 015–020 otomatis ke staging.
4. **SQL Pemetaan Staging**: Eksekusi `local-data/mapping.sql` secara manual ke staging.
5. **Uji Preview**: Verifikasi Beranda, Mutasi, Aset, Kredit, Analitik, dan Katalog pada branch staging.
6. **Cadangan Produksi**: Buat branch Neon cadangan dari produksi tepat sebelum merge ke `main`.
7. **Merge ke Main**: Penggabungan ke `main` memicu build dan migrasi produksi otomatis di Vercel.
8. **SQL Pemetaan Produksi**: Jalankan manual `local-data/mapping.sql` sesudah build produksi sukses.
9. **Pembersihan**: Hapus branch staging pengujian setelah produksi terverifikasi.

## 3. Aturan Pemetaan Kategori (`local-data/mapping.sql`)
Kueri pemetaan tersimpan di `local-data/mapping.sql` (lokal, diabaikan git):
1. **Pratinjau Wajib 8 Baris**: Bagian pratinjau wajib menghasilkan tepat 8 baris sebelum update.
2. **Urutan Eksekusi**: Penerapan hanya boleh dijalankan setelah migrasi 015–020 selesai.
3. **Integritas Relasi**: Nilai `parent_id` terkunci setelah terisi agar hierarki katalog konsisten.
