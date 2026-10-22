PRAGMA foreign_keys = ON;

-- Canonical IDs in legacy JSON workspaces still have a tenant boundary.
-- Existing documents may retain an archived client; new assignments may not.
CREATE TRIGGER commercial_workspace_customer_identity_insert
BEFORE INSERT ON organization_workspace_state
BEGIN
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM json_each(NEW.payload,'$.jobs') j
  LEFT JOIN customers c ON c.organization_id=NEW.organization_id AND c.id=CAST(json_extract(j.value,'$.customerId') AS TEXT)
  WHERE NULLIF(json_extract(j.value,'$.customerId'),'') IS NOT NULL
   AND (c.id IS NULL OR c.archived_at IS NOT NULL)
 ) THEN RAISE(ABORT,'commercial_customer_mismatch') END;
END;

CREATE TRIGGER commercial_workspace_customer_identity_update
BEFORE UPDATE OF payload ON organization_workspace_state
BEGIN
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM json_each(NEW.payload,'$.jobs') j
  LEFT JOIN customers c ON c.organization_id=NEW.organization_id AND c.id=CAST(json_extract(j.value,'$.customerId') AS TEXT)
  LEFT JOIN json_each(OLD.payload,'$.jobs') old ON CAST(json_extract(old.value,'$.id') AS TEXT)=CAST(json_extract(j.value,'$.id') AS TEXT)
  LEFT JOIN commercial_contact_customers old_mapping ON old_mapping.organization_id=OLD.organization_id AND old_mapping.contact_id=CAST(json_extract(old.value,'$.clientId') AS TEXT)
  WHERE NULLIF(json_extract(j.value,'$.customerId'),'') IS NOT NULL
   AND (c.id IS NULL OR (c.archived_at IS NOT NULL
    AND COALESCE(NULLIF(CAST(json_extract(old.value,'$.customerId') AS TEXT),''),old_mapping.customer_id) IS NOT CAST(json_extract(j.value,'$.customerId') AS TEXT)))
 ) THEN RAISE(ABORT,'commercial_customer_mismatch') END;
END;
