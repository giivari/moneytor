-- Memulihkan guard riwayat Planning dari migrasi 007. Versi runtime/setup lama mengganti fungsi ini
-- sehingga DELETE lolos; mulai sekarang DELETE selalu ditolak dan penghapusan = arsip/batal (soft-delete).
CREATE OR REPLACE FUNCTION guard_planning_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Planning history cannot be deleted'; END IF;
  IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.currency_code<>OLD.currency_code OR NEW.kind<>OLD.kind) THEN
    RAISE EXCEPTION 'Planning identity, currency and kind are immutable';
  END IF;
  IF TG_TABLE_NAME='planning_budgets' THEN
    IF NEW.category_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM transaction_categories WHERE id=NEW.category_id AND applies_to='expense'
    ) THEN RAISE EXCEPTION 'Budget category must apply to expenses'; END IF;
  END IF;
  RETURN NEW;
END $$;
