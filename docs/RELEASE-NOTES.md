# Catatan Rilis — Redesain & Penyempurnaan Buku Besar

Dokumen ini merangkum perubahan untuk pemilik aplikasi, rincian migrasi skema database, serta evaluasi risiko tersisa. Tidak ada data pribadi, nama host, atau kredensial yang disertakan.

---

## 1. Perubahan Utama untuk Pemilik

- **Desain Baru Fluent 2 (Mode Terang & Gelap)**:
  Antarmuka diperbarui mengadopsi bahasa desain Microsoft Fluent 2 dengan palet warna lembut, sudut komponen lebih presisi (radius 4–8px), bayangan halus, serta kontras warna teks yang memenuhi standar aksesibilitas WCAG AA (rasio $\ge 4.5:1$).
- **Editor Transaksi 3 Langkah yang Lebih Luwes**:
  Editor mendukung jenis transaksi baru: pinjaman (*borrow*), pelunasan (*repay*), pengembalian dana (*refund*), dan penyesuaian (*adjustment*), di samping pemasukan, pengeluaran, dan transfer. Pemisahan tagihan (*split bill*) dapat langsung dicatat dalam satu langkah.
- **Pemisahan Jelas Aset, Utang & Piutang**:
  Akun dikelompokkan ke dalam tiga kelas eksplisit: aset, kewajiban/utang (*liability*), dan piutang (*receivable*). Fasilitas kartu kredit dan PayLater kini menampilkan batas limit, tanggal cetak/jatuh tempo, dan jadwal cicilan terperinci.
- **Laporan & Analitik Pengeluaran yang Tepat**:
  Pengeluaran dikelompokkan berdasarkan kategori induk dan sifatnya (*Kebutuhan*, *Keinginan*, *Kewajiban*, *Sosial*, *Tabungan*). Nilai pengembalian dana (*refund*) diperlakukan sebagai pengurang pengeluaran bersih, bukan pemasukan tiruan. Perpindahan dana internal (investasi, pinjaman, tabungan) dipisahkan dari belanja nyata.
- **Hierarki Katalog Bertingkat & Aman**:
  Kategori kini tersusun dalam dua tingkat (induk dan subkategori/anak/alias). Entri bawaan sistem terkunci dari pengubahan nama atau kunci yang tidak disengaja, namun tetap dapat dinonaktifkan atau disesuaikan sifat pengeluarannya.

---

## 2. Rincian Migrasi Database (015 – 020)

Seluruh migrasi bersifat aditif (tidak menghapus riwayat buku besar yang ada):

| Migrasi | Fokus & Dampak |
|---|---|
| **015_credit_asset_class.sql** | Menambahkan kolom `asset_class` pada aset dan membuat tabel `credit_installments` untuk pelacakan jadwal cicilan. |
| **016_asset_class_split_bill.sql** | Menyesuaikan pembuatan akun talangan pada transaksi *split bill* agar selalu memiliki kelas `receivable`. |
| **017_debt_activities.sql** | Menambahkan jenis aktivitas `borrow`, `repay`, `refund`, dan `adjustment` beserta alasan penyesuaian ke buku besar. |
| **018_catalog_hierarchy.sql** | Menambahkan hierarki dua tingkat (`parent_id`) dan sifat (`nature`) pada kategori, serta tabel penyesuaian sifat per pengguna. |
| **019_catalog_seed.sql** | Memasukkan seed katalog standar (15 induk pengeluaran, 7 induk pemasukan, 29 penyedia terkurasi, 5 jaringan kartu) secara idempoten. |
| **020_reconcile_views.sql** | Memperbarui view rekonsiliasi dan membersihkan entri demo yang tidak lagi dirujuk oleh akun apa pun. |

---

## 3. Risiko Tersisa & Mitigasi

1. **Pemetaan Induk Kategori Kustom Lama**:
   - *Risiko*: Sebelum SQL pemetaan pada `docs/DEPLOY.md` dijalankan, kategori buatan pengguna yang sudah ada akan tetap berstatus induk mandiri.
   - *Mitigasi*: Jalankan prosedur 2 SQL (pratinjau 8 baris, lalu terapkan) pada branch Neon staging sebelum penggabungan ke cabang produksi.
2. **Cache Aset Webpack & Sesi Autentikasi**:
   - *Risiko*: Browser klien yang menyimpan cache bundel lama mungkin perlu memuat ulang (*hard refresh*) untuk menyinkronkan token gaya baru.
   - *Mitigasi*: Pengaturan *Cache-Control: no-store* pada rute dinamis dan penanganan kedaluwarsa sesi secara aman telah terpasang.
3. **Kepatuhan Data & Saldo**:
   - *Mitigasi*: Seluruh rumus kekayaan bersih dan dana siap pakai membaca data agregat kontrak secara terpadu tanpa rekalkulasi di sisi peramban.
