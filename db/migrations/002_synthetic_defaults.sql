-- Small, fictional defaults. No assets, balances, activities, or owner information.
-- IDR uses whole rupiah (exponent 0) as this application's recording precision.
INSERT INTO currencies (code, display_name, minor_unit_exponent) VALUES
  ('IDR', 'Rupiah Indonesia', 0),
  ('USD', 'US Dollar', 2);

INSERT INTO financial_providers (id, system_key, display_name, classification_name, is_builtin) VALUES
  ('10000000-0000-4000-8000-000000000001', 'demo_bank', 'Bank Contoh', 'Bank', true),
  ('10000000-0000-4000-8000-000000000002', 'demo_wallet', 'Dompet Contoh', 'Dompet digital', true),
  ('10000000-0000-4000-8000-000000000003', 'demo_investment', 'Platform Contoh', 'Investasi', true);

INSERT INTO payment_networks (id, system_key, display_name, is_builtin) VALUES
  ('20000000-0000-4000-8000-000000000001', 'demo_network', 'Jaringan Kartu Contoh', true);

INSERT INTO asset_types (id, system_key, display_name, is_builtin) VALUES
  ('30000000-0000-4000-8000-000000000001', 'bank_account', 'Rekening bank', true),
  ('30000000-0000-4000-8000-000000000002', 'e_wallet', 'Dompet digital', true),
  ('30000000-0000-4000-8000-000000000003', 'physical_cash', 'Tunai', true),
  ('30000000-0000-4000-8000-000000000004', 'investment_account', 'Akun investasi', true);

INSERT INTO asset_groups (id, system_key, display_name, is_builtin) VALUES
  ('40000000-0000-4000-8000-000000000001', 'liquid', 'Likuid', true),
  ('40000000-0000-4000-8000-000000000002', 'reserve', 'Cadangan', true),
  ('40000000-0000-4000-8000-000000000003', 'investment', 'Investasi', true);

INSERT INTO transaction_categories (id, system_key, display_name, applies_to, is_builtin) VALUES
  ('50000000-0000-4000-8000-000000000001', 'food', 'Makanan', 'expense', true),
  ('50000000-0000-4000-8000-000000000002', 'transport', 'Transport', 'expense', true),
  ('50000000-0000-4000-8000-000000000003', 'shopping', 'Belanja', 'expense', true),
  ('50000000-0000-4000-8000-000000000004', 'other_income', 'Pemasukan lain', 'income', true);

INSERT INTO additional_charge_types (id, system_key, display_name, is_builtin) VALUES
  ('60000000-0000-4000-8000-000000000001', 'admin_fee', 'Biaya Admin', true),
  ('60000000-0000-4000-8000-000000000002', 'transfer_fee', 'Biaya Transfer', true),
  ('60000000-0000-4000-8000-000000000003', 'tax', 'Pajak', true),
  ('60000000-0000-4000-8000-000000000004', 'service_fee', 'Biaya Layanan', true),
  ('60000000-0000-4000-8000-000000000005', 'platform_fee', 'Biaya Platform', true);
