-- 018: two-level categories (parent_id), expense nature (sifat) and a per-owner nature override. Additive: existing
-- categories keep working as roots without a nature, so no report total changes.
-- parent_id and nature may go from NULL to a value exactly once (the seed fills the old 002 entries and the owner may map a
-- custom category under a catalog parent); after that they are locked. Built-in identity (system_key, applies_to) never changes.

ALTER TABLE transaction_categories
  ADD COLUMN IF NOT EXISTS parent_id uuid,
  ADD COLUMN IF NOT EXISTS nature text;
ALTER TABLE transaction_categories ADD CONSTRAINT category_nature_values
  CHECK (nature IS NULL OR (applies_to = 'expense' AND nature IN ('need', 'want', 'obligation', 'social', 'saving')));
ALTER TABLE transaction_categories ADD CONSTRAINT category_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id);
-- A child always has the same kind (income/expense) as its parent.
ALTER TABLE transaction_categories ADD CONSTRAINT category_parent_fk
  FOREIGN KEY (parent_id, applies_to) REFERENCES transaction_categories(id, applies_to) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS transaction_categories_parent ON transaction_categories(parent_id) WHERE parent_id IS NOT NULL;

CREATE OR REPLACE FUNCTION category_hierarchy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent transaction_categories%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_builtin THEN RAISE EXCEPTION 'built-in category cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.is_builtin AND (NEW.system_key IS DISTINCT FROM OLD.system_key OR NEW.applies_to <> OLD.applies_to OR NOT NEW.is_builtin) THEN
      RAISE EXCEPTION 'built-in category identity is immutable';
    END IF;
    IF OLD.applies_to <> NEW.applies_to THEN RAISE EXCEPTION 'category kind is immutable'; END IF;
    IF OLD.parent_id IS NOT NULL AND NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN RAISE EXCEPTION 'category parent is locked once set'; END IF;
    IF OLD.nature IS NOT NULL AND NEW.nature IS DISTINCT FROM OLD.nature THEN RAISE EXCEPTION 'category nature is locked once set'; END IF;
    IF NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN RETURN NEW; END IF;
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO parent FROM transaction_categories WHERE id = NEW.parent_id;
    IF parent.applies_to IS DISTINCT FROM NEW.applies_to THEN RAISE EXCEPTION 'category parent must have the same kind'; END IF;
    IF parent.parent_id IS NOT NULL THEN RAISE EXCEPTION 'categories have at most two levels'; END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM transaction_categories WHERE parent_id = NEW.id) THEN
      RAISE EXCEPTION 'a category with children cannot become a child';
    END IF;
    -- Inherit only when the nature is empty at insert; catalog children bring their own.
    IF TG_OP = 'INSERT' AND NEW.nature IS NULL THEN NEW.nature := parent.nature; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS category_hierarchy_guard ON transaction_categories;
CREATE TRIGGER category_hierarchy_guard BEFORE INSERT OR UPDATE OR DELETE ON transaction_categories
  FOR EACH ROW EXECUTE FUNCTION category_hierarchy_guard();

-- Owner's own nature for any expense category (built-in rows stay untouched).
CREATE TABLE IF NOT EXISTS category_nature_overrides (
  category_id uuid PRIMARY KEY,
  applies_to text NOT NULL DEFAULT 'expense' CHECK (applies_to = 'expense'),
  nature text NOT NULL CHECK (nature IN ('need', 'want', 'obligation', 'social', 'saving')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (category_id, applies_to) REFERENCES transaction_categories(id, applies_to) ON DELETE RESTRICT
);

-- Effective nature = override, else own nature, else the parent's nature. root_id groups a child under its parent.
CREATE OR REPLACE VIEW transaction_category_effective AS
SELECT c.id, c.parent_id, COALESCE(c.parent_id, c.id) AS root_id, c.applies_to,
  o.nature AS nature_override, c.nature AS own_nature,
  COALESCE(o.nature, c.nature, p.nature) AS effective_nature
FROM transaction_categories c
LEFT JOIN transaction_categories p ON p.id = c.parent_id
LEFT JOIN category_nature_overrides o ON o.category_id = c.id;
