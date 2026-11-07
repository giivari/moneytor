# Penerapan data pengguna ke Neon (rancangan, belum dijalankan)

Dokumen ini tidak memuat host, URL, kata sandi, atau data apa pun. Neon tidak pernah disentuh dari sesi pengembangan; langkah di bawah dijalankan pemilik.

## Mode produksi `scripts/user-migrate.mjs` (rancangan)
- Pilihan eksplisit `--target=neon` (default `--target=local` = perilaku sekarang: hanya `127.0.0.1:55435`, DB `moneytor_prod_copy`).
- Host Neon tidak ada di kode. Host yang diizinkan didaftarkan lewat variabel lingkungan `MONEYTOR_USER_MIGRATE_ALLOWED_HOSTS` (daftar host persis, dipisah koma,
  tanpa wildcard). Skrip menolak bila variabel kosong, host di `DATABASE_URL` tidak ada di daftar, atau host adalah `127.0.0.1` pada mode neon. `sslmode=require` wajib.
- Default tetap dry-run (transaksi lalu ROLLBACK). `--apply` wajib `--confirm-db=<nama database dari DATABASE_URL>` yang cocok persis; tanpa itu skrip berhenti sebelum membuka koneksi.
- Pengaman yang sama dengan salinan lokal: satu transaksi; snapshot saldo per akun, kekayaan bersih, dan total pengeluaran/pemasukan per bulan (WIB) sebelum dan sesudah harus
  identik (ditambah perubahan terencana dari utang awal); jika beda -> ROLLBACK dan exit 1. `parent_id` hanya NULL -> nilai; tanpa void+replace; idempoten.
- Berkas masukan sama seperti lokal: `local-data/category-map.csv`, `local-data/opening-debts.csv`. Skrip tidak mencetak URL, nama akun, catatan, atau nominal; laporan per akun hanya ke `local-data/`.
- Sebelum `--apply`, skrip mensyaratkan dry-run yang baru: dry-run menulis `local-data/.user-migrate-dryrun` (hash CSV + nama database + waktu, berlaku 30 menit); `--apply` menolak bila hash/DB tidak cocok.
- Kriteria selesai implementasi (nanti, tugas terpisah): tes fixture di 55434 untuk setiap penolakan di atas (host tak terdaftar, tanpa confirm, hash berbeda).

## Urutan produksi
1. Hentikan penulisan (jangan mencatat transaksi) selama jendela perubahan; buat cadangan `pg_dump` produksi saat itu juga ke `local-data/` (tidak di-commit).
2. Buat **branch Neon baru dari produksi saat itu juga**. Branch lama kedaluwarsa dan tidak dipakai ulang.
3. Terapkan migrasi 015-020 ke branch: `node scripts/migrate.mjs --apply --confirm-db=<nama db>` dengan `DATABASE_URL` branch. Migrasi 015 menulis NOTICE klasifikasi; periksa hasilnya.
4. Jalankan `scripts/user-migrate.mjs --target=neon` sebagai dry-run pada branch, tinjau ringkasan (hitungan dan "identik"), lalu `--apply --confirm-db=...`; ulangi dry-run (harus 0 perubahan).
5. Uji aplikasi terhadap branch: jalankan build dan aplikasi dengan `DATABASE_URL` branch (bukan tes `*-db`, yang hanya untuk DB uji lokal). Periksa Beranda, Mutasi, Aset, Kredit, Analitik, dan impor/ekspor; bandingkan
   kekayaan bersih, saldo, dan total bulan dengan angka dry-run. Jika ada selisih, hentikan; branch dibuang tanpa dampak ke produksi.
6. Terapkan ke `main`: ulangi langkah 3-4 pada `main` dengan berkas CSV yang sama (bukan menjadikan branch sebagai produksi, karena data produksi bisa berubah sejak branch dibuat). Migrasi 015-020 aditif,
   sehingga kode lama tetap jalan; deploy kode baru Vercel setelah migrasi `main` selesai dan dry-run ulang menunjukkan 0 perubahan.
7. Setelah verifikasi di `main`, hapus branch uji dan lepas daftar host dari lingkungan.
