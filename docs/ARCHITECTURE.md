# Gambaran Umum Arsitektur — moneytor

Dokumen ini menjelaskan struktur dan prinsip kerja utama dari aplikasi **moneytor** secara umum.

---

## 1. Prinsip Desain Utama

- **Privasi Pemilik Tunggal (*Single-Owner*)**: Aplikasi dirancang khusus untuk satu pemilik data tanpa halaman pendaftaran publik. Seluruh halaman dan endpoint API dilindungi oleh validasi sesi di sisi server.
- **Akurasi Nilai Uang (`bigint`)**: Seluruh nominal keuangan disimpan di PostgreSQL sebagai `BIGINT` dalam satuan terkecil mata uang (*minor units*) dan dihitung menggunakan tipe `bigint` di TypeScript untuk mencegah kesalahan pembulatan angka desimal (*floating-point error*).
- **Buku Besar *Append-Only* (*Double-Entry Ledger*)**: Saldo rekening tidak diubah secara sembarangan melalui kolom angka biasa, melainkan dihitung dari proyeksi **Saldo Awal (*Opening Balance*)** ditambah seluruh pergerakan masuk/keluar pada tabel **`ledger_movements`**. Koreksi atau pembatalan transaksi menghasilkan jurnal pembalik (*reversal*) sehingga riwayat perubahan selalu terjaga.
- **Antarmuka Responsif Desktop & Mobile**: Tata letak beradaptasi secara otomatis—menampilkan tabel dan grafik berdampingan di layar desktop, serta tampilan kartu ringkas dengan navigasi bawah (*bottom dock*) di layar ponsel.

---

## 2. Struktur Direktori Proyek

```text
├── db/
│   └── migrations/       # Skema SQL berurutan (001 s/d 014)
├── docs/                 # Dokumentasi umum arsitektur & catatan rilis
├── scripts/              # Utilitas migrasi database, kesiapan produksi & setup cloud
├── src/
│   ├── app/              # Halaman & API Route Next.js App Router
│   ├── components/       # Komponen antarmuka pengguna (React Client & Server Components)
│   └── lib/
│       ├── analytics/    # Perhitungan laporan & tren periode keuangan
│       ├── auth/         # Autentikasi WebAuthn Passkey, sesi, & kode pemulihan
│       ├── automation/   # Mesin transaksi berulang & alokasi otomatis
│       ├── db/           # Pengelolaan koneksi pool PostgreSQL
│       ├── domain/       # Aturan bisnis murni & perhitungan uang (bigint)
│       ├── exports/      # Generator laporan PDF e-Statement, Excel (.xlsx), CSV, & JSON
│       ├── finance/      # Layanan transaksi pemasukan, pengeluaran, & transfer
│       ├── imports/      # Parser CSV/Excel, pemetaan akun, & deteksi duplikasi
│       ├── investments/  # Portofolio investasi, perhitungan cost basis, & kuotasi harga
│       ├── ops/          # Validasi kesiapan produksi, health check, & sensor log
│       ├── planning/     # Logika anggaran, target tabungan, cadangan, & kewajiban
│       └── repositories/ # Akses query database terparameterisasi
└── tests/                # Pengujian unit, domain keuangan, dan komponen UI
```

---

## 3. Alur Data & Keamanan

1. **Autentikasi & Sesi**:
   - Saat aplikasi pertama kali dijalankan pada database kosong, pemilik membuka halaman `/unlock` dan memasukkan `MONETA_BOOTSTRAP_SECRET` untuk mendaftarkan **Passkey** perangkat pertama serta menerima 8 kode pemulihan (*recovery codes*).
   - Setelah tahap inisialisasi selesai, akses masuk selanjutnya cukup menggunakan Passkey (biometrik/PIN perangkat). Token sesi disimpan dalam bentuk *hash* `SHA-256` di database.

2. **Pencatatan & Rekonsiliasi**:
   - Setiap mutasi transaksi maupun investasi dijalankan di dalam transaksi database (`BEGIN ... COMMIT`) dengan kunci idempotensi (*idempotency key*) agar tidak terjadi pencatatan ganda saat koneksi jaringan lambat.
   - Aturan otomatisasi terjadwal dievaluasi secara deterministik ketika pemilik membuka aplikasi, sehingga tidak memerlukan layanan *background worker* berbayar.

3. **Impor & Ekspor**:
   - Proses impor membaca file `.csv` atau `.xlsx` ke tahap pratinjau (*staging*) terlebih dahulu agar pengguna dapat memeriksa pemetaan akun dan meninjau indikasi transaksi duplikat sebelum disimpan ke buku besar.
   - Proses ekspor menghasilkan dokumen laporan mandiri (`.pdf`, `.xlsx`, `.csv`, `.json`) langsung dari data terbaru tanpa bergantung pada layanan pihak ketiga.


4. **Harga Pasar Otomatis (Cron)**:
   - `vercel.json` menjadwalkan `GET /api/cron/refresh-prices` setiap hari pukul 00:00 UTC (07:00 WIB), sesudah NAB reksa dana Indonesia terbit.
   - Route ini satu-satunya selain `/api/health` yang tidak memeriksa sesi passkey, karena Vercel Cron tidak punya sesi. Otorisasinya `Authorization: Bearer <CRON_SECRET>` (perbandingan timing-safe; 503 bila `CRON_SECRET` belum disetel, 401 bila salah). Fungsi `refreshAllMarketPrices` memeriksa ulang rahasia itu.
   - Hanya menambah titik harga (`investment_price_points`); ledger tidak disentuh. Kuotasi identik memakai kunci idempotensi deterministik, jadi pengiriman ulang tidak membuat harga ganda. Satu instrumen yang gagal dicatat di `failed` tanpa menghentikan batch.
   - Adapter di `src/lib/investments/providers.ts` (dipilih lewat prefix `priceSymbol` saat `MONETA_PRICE_PROVIDER=composite`): `reksadana:RD1669`, `yahoo:BBCA.JK`, `gold:gram` (atau `gold:IDR`/`gold:USD`), `coingecko:bitcoin`, `twelvedata:`, `alphavantage:`, `http:`. Harga emas memakai futures COMEX `GC=F` sebagai proksi spot, dikonversi ke gram (31,1034768 g per troy ounce) dan ke IDR memakai `USDIDR=X`. Yahoo adalah endpoint tidak resmi dan bisa membatasi permintaan.
