-- 019: seed of the built-in catalog, generated from docs/CATALOG.md (single source; tests/catalog-doc.test.mjs guards the document).
-- Idempotent: every INSERT is ON CONFLICT DO NOTHING on system_key and never edits or deletes an existing entry. A built-in name that
-- an owner category already uses (same kind, case-insensitive) gets the suffix " (bawaan)" so the seed never fails and lists stay unambiguous.
-- Mapping the owner's own categories under catalog parents is NOT done here.

-- Roots first, then children (parents must exist to resolve parent_id).
INSERT INTO transaction_categories (id, system_key, display_name, applies_to, is_builtin, parent_id, nature)
SELECT v.id::uuid, v.system_key, CASE WHEN EXISTS (
         SELECT 1 FROM transaction_categories x
         WHERE x.applies_to = v.applies_to AND lower(btrim(x.display_name)) = lower(btrim(v.display_name)))
       THEN v.display_name || ' (bawaan)' ELSE v.display_name END,
       v.applies_to, true, p.id, v.nature
FROM (VALUES
  ('50000000-0000-4000-8000-000000000101', 'housing', 'Tempat tinggal', 'expense', NULL, 'obligation'),
  ('50000000-0000-4000-8000-000000000102', 'communication', 'Komunikasi', 'expense', NULL, 'need'),
  ('50000000-0000-4000-8000-000000000103', 'personal', 'Kebutuhan pribadi', 'expense', NULL, 'need'),
  ('50000000-0000-4000-8000-000000000104', 'family', 'Keluarga & anak', 'expense', NULL, 'need'),
  ('50000000-0000-4000-8000-000000000105', 'health', 'Kesehatan', 'expense', NULL, 'need'),
  ('50000000-0000-4000-8000-000000000106', 'education', 'Pendidikan', 'expense', NULL, 'need'),
  ('50000000-0000-4000-8000-000000000107', 'entertainment', 'Hiburan', 'expense', NULL, 'want'),
  ('50000000-0000-4000-8000-000000000108', 'insurance', 'Asuransi & proteksi', 'expense', NULL, 'obligation'),
  ('50000000-0000-4000-8000-000000000109', 'dues_taxes', 'Pajak & iuran', 'expense', NULL, 'obligation'),
  ('50000000-0000-4000-8000-000000000110', 'finance_fees', 'Biaya keuangan', 'expense', NULL, 'obligation'),
  ('50000000-0000-4000-8000-000000000111', 'social', 'Sosial', 'expense', NULL, 'social'),
  ('50000000-0000-4000-8000-000000000112', 'other_expense', 'Lain-lain', 'expense', NULL, NULL),
  ('50000000-0000-4000-8000-000000000113', 'salary', 'Gaji', 'income', NULL, NULL),
  ('50000000-0000-4000-8000-000000000114', 'business_income', 'Usaha & freelance', 'income', NULL, NULL),
  ('50000000-0000-4000-8000-000000000115', 'investment_income', 'Hasil investasi', 'income', NULL, NULL),
  ('50000000-0000-4000-8000-000000000116', 'gifts_received', 'Pemberian', 'income', NULL, NULL),
  ('50000000-0000-4000-8000-000000000117', 'grants', 'Beasiswa & bantuan', 'income', NULL, NULL),
  ('50000000-0000-4000-8000-000000000118', 'resale_income', 'Penjualan barang bekas', 'income', NULL, NULL)
) AS v(id, system_key, display_name, applies_to, parent_key, nature)
LEFT JOIN transaction_categories p ON p.system_key = v.parent_key
ON CONFLICT (system_key) DO NOTHING;

INSERT INTO transaction_categories (id, system_key, display_name, applies_to, is_builtin, parent_id, nature)
SELECT v.id::uuid, v.system_key, CASE WHEN EXISTS (
         SELECT 1 FROM transaction_categories x
         WHERE x.applies_to = v.applies_to AND lower(btrim(x.display_name)) = lower(btrim(v.display_name)))
       THEN v.display_name || ' (bawaan)' ELSE v.display_name END,
       v.applies_to, true, p.id, v.nature
FROM (VALUES
  ('50000000-0000-4000-8000-000000000119', 'food_groceries', 'Bahan makanan', 'expense', 'food', 'need'),
  ('50000000-0000-4000-8000-000000000120', 'food_dining', 'Makan di luar', 'expense', 'food', 'want'),
  ('50000000-0000-4000-8000-000000000121', 'food_snacks', 'Kopi & jajan', 'expense', 'food', 'want'),
  ('50000000-0000-4000-8000-000000000122', 'food_delivery', 'Pesan antar', 'expense', 'food', 'want'),
  ('50000000-0000-4000-8000-000000000123', 'transport_fuel', 'BBM', 'expense', 'transport', 'need'),
  ('50000000-0000-4000-8000-000000000124', 'transport_public', 'Transportasi umum', 'expense', 'transport', 'need'),
  ('50000000-0000-4000-8000-000000000125', 'transport_ride', 'Ojek & taksi online', 'expense', 'transport', 'want'),
  ('50000000-0000-4000-8000-000000000126', 'transport_toll', 'Tol & parkir', 'expense', 'transport', 'need'),
  ('50000000-0000-4000-8000-000000000127', 'transport_service', 'Servis kendaraan', 'expense', 'transport', 'need'),
  ('50000000-0000-4000-8000-000000000128', 'shopping_clothes', 'Pakaian', 'expense', 'shopping', 'want'),
  ('50000000-0000-4000-8000-000000000129', 'shopping_accessories', 'Sepatu, tas & aksesori', 'expense', 'shopping', 'want'),
  ('50000000-0000-4000-8000-000000000130', 'shopping_electronics', 'Elektronik', 'expense', 'shopping', 'want'),
  ('50000000-0000-4000-8000-000000000131', 'shopping_household', 'Perlengkapan rumah', 'expense', 'shopping', 'need'),
  ('50000000-0000-4000-8000-000000000132', 'housing_rent', 'Sewa & KPR', 'expense', 'housing', 'obligation'),
  ('50000000-0000-4000-8000-000000000133', 'housing_electricity', 'Listrik', 'expense', 'housing', 'obligation'),
  ('50000000-0000-4000-8000-000000000134', 'housing_water', 'Air', 'expense', 'housing', 'obligation'),
  ('50000000-0000-4000-8000-000000000135', 'housing_gas', 'Gas & LPG', 'expense', 'housing', 'need'),
  ('50000000-0000-4000-8000-000000000136', 'housing_dues', 'Iuran lingkungan & keamanan', 'expense', 'housing', 'obligation'),
  ('50000000-0000-4000-8000-000000000137', 'housing_maintenance', 'Perbaikan rumah', 'expense', 'housing', 'need'),
  ('50000000-0000-4000-8000-000000000138', 'comm_mobile', 'Pulsa & paket data', 'expense', 'communication', 'need'),
  ('50000000-0000-4000-8000-000000000139', 'comm_home_internet', 'Internet rumah', 'expense', 'communication', 'need'),
  ('50000000-0000-4000-8000-000000000140', 'personal_hygiene', 'Sabun, skincare & toiletries', 'expense', 'personal', 'need'),
  ('50000000-0000-4000-8000-000000000141', 'personal_grooming', 'Potong rambut & salon', 'expense', 'personal', 'want'),
  ('50000000-0000-4000-8000-000000000142', 'personal_laundry', 'Laundry', 'expense', 'personal', 'need'),
  ('50000000-0000-4000-8000-000000000143', 'family_child', 'Kebutuhan anak', 'expense', 'family', 'need'),
  ('50000000-0000-4000-8000-000000000144', 'family_school', 'Uang sekolah & jajan anak', 'expense', 'family', 'need'),
  ('50000000-0000-4000-8000-000000000145', 'family_helper', 'Gaji ART & pengasuh', 'expense', 'family', 'obligation'),
  ('50000000-0000-4000-8000-000000000146', 'family_pets', 'Hewan peliharaan', 'expense', 'family', 'want'),
  ('50000000-0000-4000-8000-000000000147', 'health_doctor', 'Dokter & obat', 'expense', 'health', 'need'),
  ('50000000-0000-4000-8000-000000000148', 'health_checkup', 'Pemeriksaan & laboratorium', 'expense', 'health', 'need'),
  ('50000000-0000-4000-8000-000000000149', 'health_fitness', 'Olahraga & kebugaran', 'expense', 'health', 'want'),
  ('50000000-0000-4000-8000-000000000150', 'health_supplements', 'Vitamin & suplemen', 'expense', 'health', 'want'),
  ('50000000-0000-4000-8000-000000000151', 'education_tuition', 'Biaya sekolah & kuliah', 'expense', 'education', 'need'),
  ('50000000-0000-4000-8000-000000000152', 'education_courses', 'Kursus & buku', 'expense', 'education', 'want'),
  ('50000000-0000-4000-8000-000000000153', 'education_exam', 'Ujian & sertifikasi', 'expense', 'education', 'need'),
  ('50000000-0000-4000-8000-000000000154', 'education_supplies', 'Alat tulis & perlengkapan belajar', 'expense', 'education', 'need'),
  ('50000000-0000-4000-8000-000000000155', 'entertainment_subscription', 'Langganan digital', 'expense', 'entertainment', 'want'),
  ('50000000-0000-4000-8000-000000000156', 'entertainment_travel', 'Wisata', 'expense', 'entertainment', 'want'),
  ('50000000-0000-4000-8000-000000000157', 'entertainment_hobby', 'Hobi', 'expense', 'entertainment', 'want'),
  ('50000000-0000-4000-8000-000000000158', 'entertainment_games', 'Game & aplikasi', 'expense', 'entertainment', 'want'),
  ('50000000-0000-4000-8000-000000000159', 'entertainment_events', 'Bioskop, konser & acara', 'expense', 'entertainment', 'want'),
  ('50000000-0000-4000-8000-000000000160', 'insurance_health', 'Asuransi kesehatan', 'expense', 'insurance', 'obligation'),
  ('50000000-0000-4000-8000-000000000161', 'insurance_life', 'Asuransi jiwa', 'expense', 'insurance', 'obligation'),
  ('50000000-0000-4000-8000-000000000162', 'insurance_vehicle', 'Asuransi kendaraan', 'expense', 'insurance', 'obligation'),
  ('50000000-0000-4000-8000-000000000163', 'insurance_property', 'Asuransi properti', 'expense', 'insurance', 'obligation'),
  ('50000000-0000-4000-8000-000000000164', 'dues_vehicle_tax', 'Pajak kendaraan & PBB', 'expense', 'dues_taxes', 'obligation'),
  ('50000000-0000-4000-8000-000000000165', 'dues_bpjs', 'BPJS & iuran wajib', 'expense', 'dues_taxes', 'obligation'),
  ('50000000-0000-4000-8000-000000000166', 'dues_income_tax', 'PPh & pajak lain', 'expense', 'dues_taxes', 'obligation'),
  ('50000000-0000-4000-8000-000000000167', 'dues_admin', 'Administrasi & perizinan', 'expense', 'dues_taxes', 'obligation'),
  ('50000000-0000-4000-8000-000000000168', 'fees_bank_admin', 'Biaya admin bulanan bank & kartu', 'expense', 'finance_fees', 'obligation'),
  ('50000000-0000-4000-8000-000000000169', 'fees_card_annual', 'Iuran tahunan kartu', 'expense', 'finance_fees', 'obligation'),
  ('50000000-0000-4000-8000-000000000170', 'fees_interest_penalty', 'Bunga & denda di luar cicilan', 'expense', 'finance_fees', 'obligation'),
  ('50000000-0000-4000-8000-000000000171', 'social_charity', 'Zakat & sedekah', 'expense', 'social', 'social'),
  ('50000000-0000-4000-8000-000000000172', 'social_gifts', 'Hadiah & traktiran', 'expense', 'social', 'social'),
  ('50000000-0000-4000-8000-000000000173', 'social_family', 'Dukungan keluarga', 'expense', 'social', 'social'),
  ('50000000-0000-4000-8000-000000000174', 'social_events', 'Kondangan & sumbangan acara', 'expense', 'social', 'social'),
  ('50000000-0000-4000-8000-000000000175', 'social_community', 'Iuran komunitas & arisan', 'expense', 'social', 'social'),
  ('50000000-0000-4000-8000-000000000176', 'other_unexpected', 'Biaya tak terduga', 'expense', 'other_expense', NULL),
  ('50000000-0000-4000-8000-000000000177', 'other_loss', 'Kehilangan & kerugian', 'expense', 'other_expense', NULL),
  ('50000000-0000-4000-8000-000000000178', 'salary_main', 'Gaji pokok', 'income', 'salary', NULL),
  ('50000000-0000-4000-8000-000000000179', 'salary_overtime', 'Lembur', 'income', 'salary', NULL),
  ('50000000-0000-4000-8000-000000000180', 'salary_bonus', 'Bonus & tunjangan', 'income', 'salary', NULL),
  ('50000000-0000-4000-8000-000000000181', 'salary_thr', 'THR', 'income', 'salary', NULL),
  ('50000000-0000-4000-8000-000000000182', 'salary_honor', 'Honor & uang magang', 'income', 'salary', NULL),
  ('50000000-0000-4000-8000-000000000183', 'business_sales', 'Hasil penjualan usaha', 'income', 'business_income', NULL),
  ('50000000-0000-4000-8000-000000000184', 'business_freelance', 'Jasa freelance', 'income', 'business_income', NULL),
  ('50000000-0000-4000-8000-000000000185', 'investment_interest', 'Bunga', 'income', 'investment_income', NULL),
  ('50000000-0000-4000-8000-000000000186', 'investment_dividend', 'Dividen', 'income', 'investment_income', NULL),
  ('50000000-0000-4000-8000-000000000187', 'investment_coupon', 'Kupon obligasi', 'income', 'investment_income', NULL),
  ('50000000-0000-4000-8000-000000000188', 'investment_rent', 'Sewa properti', 'income', 'investment_income', NULL),
  ('50000000-0000-4000-8000-000000000189', 'investment_profit_share', 'Bagi hasil', 'income', 'investment_income', NULL),
  ('50000000-0000-4000-8000-000000000190', 'gift_allowance', 'Uang saku & kiriman keluarga', 'income', 'gifts_received', NULL),
  ('50000000-0000-4000-8000-000000000191', 'gift_money', 'Hadiah & angpao', 'income', 'gifts_received', NULL),
  ('50000000-0000-4000-8000-000000000192', 'gift_inheritance', 'Warisan & hibah', 'income', 'gifts_received', NULL),
  ('50000000-0000-4000-8000-000000000193', 'grants_scholarship', 'Beasiswa', 'income', 'grants', NULL),
  ('50000000-0000-4000-8000-000000000194', 'grants_social', 'Bantuan sosial', 'income', 'grants', NULL),
  ('50000000-0000-4000-8000-000000000195', 'other_cashback', 'Cashback & reward', 'income', 'other_income', NULL),
  ('50000000-0000-4000-8000-000000000196', 'other_prize', 'Hadiah undian', 'income', 'other_income', NULL)
) AS v(id, system_key, display_name, applies_to, parent_key, nature)
LEFT JOIN transaction_categories p ON p.system_key = v.parent_key
ON CONFLICT (system_key) DO NOTHING;

-- The 002 categories keep their name and identity; they only gain a nature (NULL -> value, allowed once by the 018 guard).
UPDATE transaction_categories c SET nature = v.nature
FROM (VALUES
  ('food', 'need'),
  ('transport', 'need'),
  ('shopping', 'want')
) AS v(system_key, nature)
WHERE c.system_key = v.system_key AND c.is_builtin AND c.nature IS NULL AND v.nature IS NOT NULL;

INSERT INTO asset_types (id, system_key, display_name, is_builtin) VALUES
  ('30000000-0000-4000-8000-000000000005', 'time_deposit', 'Deposito', true),
  ('30000000-0000-4000-8000-000000000006', 'gold', 'Emas', true),
  ('30000000-0000-4000-8000-000000000007', 'prepaid_card', 'Kartu uang elektronik', true),
  ('30000000-0000-4000-8000-000000000008', 'credit_card', 'Kartu kredit', true),
  ('30000000-0000-4000-8000-000000000009', 'paylater', 'PayLater', true),
  ('30000000-0000-4000-8000-000000000010', 'loan', 'Pinjaman', true),
  ('30000000-0000-4000-8000-000000000011', 'receivable', 'Piutang & talangan', true)
ON CONFLICT (system_key) DO NOTHING;

INSERT INTO additional_charge_types (id, system_key, display_name, is_builtin) VALUES
  ('60000000-0000-4000-8000-000000000008', 'cash_withdrawal_fee', 'Biaya tarik tunai', true),
  ('60000000-0000-4000-8000-000000000009', 'stamp_duty', 'Bea materai', true),
  ('60000000-0000-4000-8000-000000000010', 'penalty_fee', 'Denda keterlambatan', true),
  ('60000000-0000-4000-8000-000000000011', 'shipping_fee', 'Ongkos kirim', true),
  ('60000000-0000-4000-8000-000000000012', 'top_up_fee', 'Biaya top-up', true)
ON CONFLICT (system_key) DO NOTHING;

-- Providers and payment networks come from src/lib/domain/provider-marks.ts (key with - replaced by _).
INSERT INTO financial_providers (id, system_key, display_name, classification_name, is_builtin)
SELECT v.id::uuid, v.system_key, v.display_name, v.classification_name, true FROM (VALUES
  ('10000000-0000-4000-8000-000000000100', 'bca', 'Bank Central Asia (BCA)', 'Bank'),
  ('10000000-0000-4000-8000-000000000101', 'bni', 'Bank Negara Indonesia (BNI)', 'Bank'),
  ('10000000-0000-4000-8000-000000000102', 'mandiri', 'Bank Mandiri', 'Bank'),
  ('10000000-0000-4000-8000-000000000103', 'bri', 'Bank Rakyat Indonesia (BRI)', 'Bank'),
  ('10000000-0000-4000-8000-000000000104', 'bsi', 'Bank Syariah Indonesia (BSI)', 'Bank'),
  ('10000000-0000-4000-8000-000000000105', 'jago', 'Bank Jago', 'Bank'),
  ('10000000-0000-4000-8000-000000000106', 'seabank', 'SeaBank', 'Bank'),
  ('10000000-0000-4000-8000-000000000107', 'blu', 'blu by BCA Digital', 'Bank'),
  ('10000000-0000-4000-8000-000000000108', 'gopay', 'GoPay', 'Dompet digital'),
  ('10000000-0000-4000-8000-000000000109', 'ovo', 'OVO', 'Dompet digital'),
  ('10000000-0000-4000-8000-000000000110', 'dana', 'DANA', 'Dompet digital'),
  ('10000000-0000-4000-8000-000000000111', 'shopeepay', 'ShopeePay', 'Dompet digital'),
  ('10000000-0000-4000-8000-000000000112', 'linkaja', 'LinkAja', 'Dompet digital'),
  ('10000000-0000-4000-8000-000000000113', 'mandiri_emoney', 'Mandiri e-Money', 'Dompet digital'),
  ('10000000-0000-4000-8000-000000000114', 'flazz', 'BCA Flazz', 'Dompet digital'),
  ('10000000-0000-4000-8000-000000000115', 'tapcash', 'BNI TapCash', 'Dompet digital'),
  ('10000000-0000-4000-8000-000000000116', 'brizzi', 'BRI Brizzi', 'Dompet digital'),
  ('10000000-0000-4000-8000-000000000117', 'emoney', 'e-Money / Flazz', 'Dompet digital'),
  ('10000000-0000-4000-8000-000000000118', 'spaylater', 'SPayLater (ShopeePayLater)', 'Dompet digital'),
  ('10000000-0000-4000-8000-000000000119', 'gopaylater', 'GoPayLater', 'Dompet digital'),
  ('10000000-0000-4000-8000-000000000120', 'kredivo', 'Kredivo', 'Dompet digital'),
  ('10000000-0000-4000-8000-000000000121', 'akulaku', 'Akulaku PayLater', 'Dompet digital'),
  ('10000000-0000-4000-8000-000000000122', 'indodana', 'Indodana PayLater', 'Dompet digital'),
  ('10000000-0000-4000-8000-000000000123', 'bibit', 'Bibit', 'Investasi'),
  ('10000000-0000-4000-8000-000000000124', 'ajaib', 'Ajaib', 'Investasi'),
  ('10000000-0000-4000-8000-000000000125', 'stockbit', 'Stockbit', 'Investasi'),
  ('10000000-0000-4000-8000-000000000126', 'bareksa', 'Bareksa', 'Investasi'),
  ('10000000-0000-4000-8000-000000000127', 'pluang', 'Pluang', 'Investasi'),
  ('10000000-0000-4000-8000-000000000128', 'pintu', 'Pintu', 'Investasi')
) AS v(id, system_key, display_name, classification_name)
ON CONFLICT (system_key) DO NOTHING;

INSERT INTO payment_networks (id, system_key, display_name, is_builtin) VALUES
  ('20000000-0000-4000-8000-000000000100', 'gpn', 'GPN (Gerbang Pembayaran Nasional)', true),
  ('20000000-0000-4000-8000-000000000101', 'visa', 'Visa', true),
  ('20000000-0000-4000-8000-000000000102', 'mastercard', 'Mastercard', true),
  ('20000000-0000-4000-8000-000000000103', 'qris', 'QRIS', true),
  ('20000000-0000-4000-8000-000000000104', 'jcb', 'JCB', true)
ON CONFLICT (system_key) DO NOTHING;

-- Demo entries from 002 that nothing references are deactivated, never deleted.
UPDATE financial_providers fp SET is_active = false
WHERE fp.system_key IN ('demo_bank', 'demo_wallet', 'demo_investment') AND fp.is_active
  AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.provider_id = fp.id)
  AND NOT EXISTS (SELECT 1 FROM investment_portfolios ip WHERE ip.provider_id = fp.id);
UPDATE payment_networks pn SET is_active = false
WHERE pn.system_key = 'demo_network' AND pn.is_active
  AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.payment_network_id = pn.id);
