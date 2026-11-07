# Katalog bawaan (DRAF 2, menunggu persetujuan pemilik)

Sumber tunggal isi migrasi seed 019. Seed tidak boleh berisi entri yang tidak ada di sini (dijaga `tests/catalog-doc.test.mjs`).
Aturan: `system_key` unik dan tidak pernah diubah; entri yang sudah ada di migrasi 002 memakai `system_key` yang sama dan nama lamanya tetap.
Pengguna hanya boleh menambah anak kategori, menonaktifkan entri bawaan, menambah alias, dan mengganti sifat suatu kategori untuk dirinya sendiri (override per pengguna; entri bawaan tidak diubah).
Sifat: `need` kebutuhan, `want` keinginan, `obligation` kewajiban, `social` sosial, `saving` tabungan (dipakai target dan alokasi di Rencana, bukan kategori pengeluaran).
Anak mewarisi sifat induk kecuali dinyatakan lain. `-` berarti tanpa sifat.
Menabung dan berinvestasi adalah transfer atau transaksi investasi, bukan pengeluaran, sehingga tidak ada kategori pengeluaran untuk keduanya.

## Kategori pengeluaran

Induk (tingkat 1). `*` = sudah ada di 002 (nama tetap).

| system_key | Nama | Sifat |
|---|---|---|
| food * | Makanan | need |
| transport * | Transport | need |
| shopping * | Belanja | want |
| housing | Tempat tinggal | obligation |
| communication | Komunikasi | need |
| personal | Kebutuhan pribadi | need |
| family | Keluarga & anak | need |
| health | Kesehatan | need |
| education | Pendidikan | need |
| entertainment | Hiburan | want |
| insurance | Asuransi & proteksi | obligation |
| dues_taxes | Pajak & iuran | obligation |
| finance_fees | Biaya keuangan | obligation |
| social | Sosial | social |
| other_expense | Lain-lain | - |

Anak (tingkat 2): `induk | system_key | nama | sifat`.

| Induk | system_key | Nama | Sifat |
|---|---|---|---|
| food | food_groceries | Bahan makanan | need |
| food | food_dining | Makan di luar | want |
| food | food_snacks | Kopi & jajan | want |
| food | food_delivery | Pesan antar | want |
| transport | transport_fuel | BBM | need |
| transport | transport_public | Transportasi umum | need |
| transport | transport_ride | Ojek & taksi online | want |
| transport | transport_toll | Tol & parkir | need |
| transport | transport_service | Servis kendaraan | need |
| shopping | shopping_clothes | Pakaian | want |
| shopping | shopping_accessories | Sepatu, tas & aksesori | want |
| shopping | shopping_electronics | Elektronik | want |
| shopping | shopping_household | Perlengkapan rumah | need |
| housing | housing_rent | Sewa & KPR | obligation |
| housing | housing_electricity | Listrik | obligation |
| housing | housing_water | Air | obligation |
| housing | housing_gas | Gas & LPG | need |
| housing | housing_dues | Iuran lingkungan & keamanan | obligation |
| housing | housing_maintenance | Perbaikan rumah | need |
| communication | comm_mobile | Pulsa & paket data | need |
| communication | comm_home_internet | Internet rumah | need |
| personal | personal_hygiene | Sabun, skincare & toiletries | need |
| personal | personal_grooming | Potong rambut & salon | want |
| personal | personal_laundry | Laundry | need |
| family | family_child | Kebutuhan anak | need |
| family | family_school | Uang sekolah & jajan anak | need |
| family | family_helper | Gaji ART & pengasuh | obligation |
| family | family_pets | Hewan peliharaan | want |
| health | health_doctor | Dokter & obat | need |
| health | health_checkup | Pemeriksaan & laboratorium | need |
| health | health_fitness | Olahraga & kebugaran | want |
| health | health_supplements | Vitamin & suplemen | want |
| education | education_tuition | Biaya sekolah & kuliah | need |
| education | education_courses | Kursus & buku | want |
| education | education_exam | Ujian & sertifikasi | need |
| education | education_supplies | Alat tulis & perlengkapan belajar | need |
| entertainment | entertainment_subscription | Langganan digital | want |
| entertainment | entertainment_travel | Wisata | want |
| entertainment | entertainment_hobby | Hobi | want |
| entertainment | entertainment_games | Game & aplikasi | want |
| entertainment | entertainment_events | Bioskop, konser & acara | want |
| insurance | insurance_health | Asuransi kesehatan | obligation |
| insurance | insurance_life | Asuransi jiwa | obligation |
| insurance | insurance_vehicle | Asuransi kendaraan | obligation |
| insurance | insurance_property | Asuransi properti | obligation |
| dues_taxes | dues_vehicle_tax | Pajak kendaraan & PBB | obligation |
| dues_taxes | dues_bpjs | BPJS & iuran wajib | obligation |
| dues_taxes | dues_income_tax | PPh & pajak lain | obligation |
| dues_taxes | dues_admin | Administrasi & perizinan | obligation |
| finance_fees | fees_bank_admin | Biaya admin bulanan bank & kartu | obligation |
| finance_fees | fees_card_annual | Iuran tahunan kartu | obligation |
| finance_fees | fees_interest_penalty | Bunga & denda di luar cicilan | obligation |
| social | social_charity | Zakat & sedekah | social |
| social | social_gifts | Hadiah & traktiran | social |
| social | social_family | Dukungan keluarga | social |
| social | social_events | Kondangan & sumbangan acara | social |
| social | social_community | Iuran komunitas & arisan | social |
| other_expense | other_unexpected | Biaya tak terduga | - |
| other_expense | other_loss | Kehilangan & kerugian | - |

## Kategori pemasukan

Tanpa sifat.

| Induk | system_key | Nama |
|---|---|---|
| - | salary | Gaji |
| salary | salary_main | Gaji pokok |
| salary | salary_overtime | Lembur |
| salary | salary_bonus | Bonus & tunjangan |
| salary | salary_thr | THR |
| salary | salary_honor | Honor & uang magang |
| - | business_income | Usaha & freelance |
| business_income | business_sales | Hasil penjualan usaha |
| business_income | business_freelance | Jasa freelance |
| - | investment_income | Hasil investasi |
| investment_income | investment_interest | Bunga |
| investment_income | investment_dividend | Dividen |
| investment_income | investment_coupon | Kupon obligasi |
| investment_income | investment_rent | Sewa properti |
| investment_income | investment_profit_share | Bagi hasil |
| - | gifts_received | Pemberian |
| gifts_received | gift_allowance | Uang saku & kiriman keluarga |
| gifts_received | gift_money | Hadiah & angpao |
| gifts_received | gift_inheritance | Warisan & hibah |
| - | grants | Beasiswa & bantuan |
| grants | grants_scholarship | Beasiswa |
| grants | grants_social | Bantuan sosial |
| - | resale_income | Penjualan barang bekas |
| - | other_income * | Pemasukan lain |
| other_income | other_cashback | Cashback & reward |
| other_income | other_prize | Hadiah undian |

## Jenis aset

`asset_class` adalah saran awal di formulir; kelas akun tetap dipilih per akun.

| system_key | Nama | asset_class saran |
|---|---|---|
| bank_account * | Rekening bank | asset |
| e_wallet * | Dompet digital | asset |
| physical_cash * | Tunai | asset |
| investment_account * | Akun investasi | asset |
| time_deposit | Deposito | asset |
| gold | Emas | asset |
| prepaid_card | Kartu uang elektronik | asset |
| credit_card | Kartu kredit | liability |
| paylater | PayLater | liability |
| loan | Pinjaman | liability |
| receivable | Piutang & talangan | receivable |

## Jenis biaya

| system_key | Nama |
|---|---|
| admin_fee * | Biaya Admin |
| transfer_fee * | Biaya Transfer |
| tax * | Pajak |
| service_fee * | Biaya Layanan |
| platform_fee * | Biaya Platform |
| installment_interest * | Bunga cicilan (015) |
| loan_interest * | Bunga pinjaman (017) |
| cash_withdrawal_fee | Biaya tarik tunai |
| stamp_duty | Bea materai |
| penalty_fee | Denda keterlambatan |
| shipping_fee | Ongkos kirim |
| top_up_fee | Biaya top-up |

## Penyedia dan jaringan pembayaran

Tidak didaftar ulang di sini: sumbernya `CURATED_PROVIDERS` dan `CURATED_PAYMENT_NETWORKS` di `src/lib/domain/provider-marks.ts`
(29 penyedia: bank, dompet digital/PayLater, investasi; 5 jaringan). Seed memakai `key` preset dengan `-` diganti `_` sebagai `system_key`,
`displayName` sebagai nama, dan `classification` sebagai klasifikasi. Entri demo 002 (`demo_bank`, `demo_wallet`, `demo_investment`, `demo_network`)
dinonaktifkan bila tidak terpakai.