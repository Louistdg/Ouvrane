PRAGMA foreign_keys = ON;

-- Prospectively enforce the commercial identity at the actual write boundary.
-- No existing row, historical workspace document or identifier is rewritten.
-- A legacy project is not guessed from its label or from another tenant's ID.
-- NULL identities remain compatible while no source supplies a known customer.

CREATE TRIGGER IF NOT EXISTS commercial_quote_customer_insert
BEFORE INSERT ON quotes_server
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM projects p
    WHERE p.organization_id=NEW.organization_id
      AND p.id=NEW.project_id
      AND NULLIF(p.customer_id,'') IS NOT NULL
      AND NEW.customer_id IS NOT p.customer_id
  ) THEN RAISE(ABORT,'commercial_customer_mismatch') END;
END;

CREATE TRIGGER IF NOT EXISTS commercial_quote_customer_update
BEFORE UPDATE OF organization_id,id,project_id,customer_id ON quotes_server
WHEN NEW.organization_id IS NOT OLD.organization_id
  OR NEW.id IS NOT OLD.id
  OR NEW.project_id IS NOT OLD.project_id
  OR NEW.customer_id IS NOT OLD.customer_id
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM projects p
    WHERE p.organization_id=NEW.organization_id
      AND p.id=NEW.project_id
      AND NULLIF(p.customer_id,'') IS NOT NULL
      AND NEW.customer_id IS NOT p.customer_id
  ) THEN RAISE(ABORT,'commercial_customer_mismatch') END;

  -- Changing a quote key must not silently leave its visit folders behind.
  SELECT CASE WHEN (
    NEW.organization_id IS NOT OLD.organization_id OR NEW.id IS NOT OLD.id
  ) AND EXISTS (
    SELECT 1 FROM quote_site_visits v
    WHERE v.organization_id=OLD.organization_id AND v.quote_id=OLD.id
  ) THEN RAISE(ABORT,'commercial_quote_link_invalid') END;

  -- A NULL legacy visit inherits the OLD quote's known customer. Checking only
  -- v.customer_id would otherwise permit A -> B/NULL after a visit was linked.
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM quote_site_visits v
    WHERE v.organization_id=OLD.organization_id
      AND v.quote_id=OLD.id
      AND COALESCE(NULLIF(v.customer_id,''),NULLIF(OLD.customer_id,'')) IS NOT NULL
      AND NEW.customer_id IS NOT COALESCE(NULLIF(v.customer_id,''),NULLIF(OLD.customer_id,''))
  ) THEN RAISE(ABORT,'commercial_customer_mismatch') END;
END;

CREATE TRIGGER IF NOT EXISTS commercial_visit_customer_insert
BEFORE INSERT ON quote_site_visits
WHEN NEW.quote_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM quotes_server q
    WHERE q.organization_id=NEW.organization_id
      AND q.id=NEW.quote_id AND q.archived_at IS NULL
  ) THEN RAISE(ABORT,'commercial_quote_link_invalid') END;

  SELECT CASE WHEN NULLIF(NEW.customer_id,'') IS NOT NULL AND EXISTS (
    SELECT 1 FROM quotes_server q
    WHERE q.organization_id=NEW.organization_id
      AND q.id=NEW.quote_id AND q.archived_at IS NULL
      AND NEW.customer_id IS NOT q.customer_id
  ) THEN RAISE(ABORT,'commercial_customer_mismatch') END;
END;

CREATE TRIGGER IF NOT EXISTS commercial_visit_customer_update
BEFORE UPDATE OF organization_id,customer_id,quote_id ON quote_site_visits
WHEN NEW.quote_id IS NOT NULL AND (
  NEW.organization_id IS NOT OLD.organization_id
  OR NEW.customer_id IS NOT OLD.customer_id
  OR NEW.quote_id IS NOT OLD.quote_id
)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM quotes_server q
    WHERE q.organization_id=NEW.organization_id
      AND q.id=NEW.quote_id AND q.archived_at IS NULL
  ) THEN RAISE(ABORT,'commercial_quote_link_invalid') END;

  SELECT CASE WHEN NULLIF(NEW.customer_id,'') IS NOT NULL AND EXISTS (
    SELECT 1 FROM quotes_server q
    WHERE q.organization_id=NEW.organization_id
      AND q.id=NEW.quote_id AND q.archived_at IS NULL
      AND NEW.customer_id IS NOT q.customer_id
  ) THEN RAISE(ABORT,'commercial_customer_mismatch') END;

  -- Retargeting a legacy NULL visit must also respect the identity learned from
  -- its previous quote; no inferred ID is persisted back into the old document.
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM quotes_server target
    WHERE target.organization_id=NEW.organization_id AND target.id=NEW.quote_id
      AND COALESCE(NULLIF(OLD.customer_id,''),(
        SELECT NULLIF(source.customer_id,'') FROM quotes_server source
        WHERE source.organization_id=OLD.organization_id AND source.id=OLD.quote_id
      )) IS NOT NULL
      AND target.customer_id IS NOT COALESCE(NULLIF(OLD.customer_id,''),(
        SELECT NULLIF(source.customer_id,'') FROM quotes_server source
        WHERE source.organization_id=OLD.organization_id AND source.id=OLD.quote_id
      ))
  ) THEN RAISE(ABORT,'commercial_customer_mismatch') END;
END;

CREATE TRIGGER IF NOT EXISTS commercial_project_customer_update
BEFORE UPDATE OF customer_id ON projects
WHEN NEW.customer_id IS NOT OLD.customer_id
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM quotes_server q
    WHERE q.organization_id=OLD.organization_id
      AND q.project_id=OLD.id
      AND NULLIF(q.customer_id,'') IS NOT NULL
      AND NEW.customer_id IS NOT q.customer_id
  ) THEN RAISE(ABORT,'commercial_customer_mismatch') END;
END;
