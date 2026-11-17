-- 025: indeks jalur baca (tanpa mengubah data/perilaku). Additive only, idempotent.
-- activity_charges(activity_id): activityTotals (LATERAL sum per aktivitas), listActivities, view spending_effects dan analitik
--   menggabungkan charge per aktivitas; sebelumnya hanya ada indeks parsial untuk transfer/repay.
-- financial_activities(refund_of_activity_id): refunded_in_chain() dan query refund mencari anak per induk; parsial karena
--   hanya baris refund yang punya nilai (constraint 017: kind='refund' <=> refund_of_activity_id IS NOT NULL).
-- ledger_movements(asset_id) INCLUDE (amount_minor): saldo per aset (SUM seluruh ledger) dapat dijawab index-only scan.

CREATE INDEX IF NOT EXISTS activity_charges_activity_idx ON activity_charges (activity_id);
CREATE INDEX IF NOT EXISTS financial_activities_refund_of_idx ON financial_activities (refund_of_activity_id)
  WHERE refund_of_activity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ledger_movements_asset_amount_idx ON ledger_movements (asset_id) INCLUDE (amount_minor);
