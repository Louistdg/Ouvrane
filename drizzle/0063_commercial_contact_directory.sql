PRAGMA foreign_keys = ON;

-- Explicit contact identities. No import, name matching or workspace rewrite
-- occurs during migration. Historical IDs remain in their original documents.
CREATE TABLE commercial_directories (
 organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id),
 created_by TEXT NOT NULL REFERENCES profiles(id),
 created_at TEXT NOT NULL
);
CREATE TABLE commercial_contact_customers (
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 contact_id TEXT NOT NULL CHECK(length(contact_id) BETWEEN 1 AND 180),
 customer_id TEXT NOT NULL REFERENCES customers(id),
 source_json TEXT NOT NULL CHECK(json_valid(source_json)),
 source_version INTEGER NOT NULL CHECK(source_version>=1),
 workspace_revision INTEGER NOT NULL CHECK(workspace_revision>=0),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,contact_id),
 UNIQUE(organization_id,customer_id)
);
CREATE TRIGGER commercial_contact_customer_tenant
BEFORE INSERT ON commercial_contact_customers
WHEN NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=NEW.customer_id AND c.organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'commercial_contact_tenant_mismatch'); END;
CREATE TRIGGER commercial_contact_identity_immutable
BEFORE UPDATE OF organization_id,contact_id,customer_id ON commercial_contact_customers
WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.contact_id IS NOT OLD.contact_id OR NEW.customer_id IS NOT OLD.customer_id
BEGIN SELECT RAISE(ABORT,'commercial_contact_identity_immutable'); END;
CREATE TRIGGER commercial_contact_customer_identity_immutable
BEFORE UPDATE OF organization_id,id ON customers
WHEN (NEW.organization_id IS NOT OLD.organization_id OR NEW.id IS NOT OLD.id)
 AND EXISTS(SELECT 1 FROM commercial_contact_customers m WHERE m.organization_id=OLD.organization_id AND m.customer_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'commercial_contact_identity_immutable'); END;
CREATE TRIGGER commercial_contact_existing_quote_customer
BEFORE INSERT ON commercial_contact_customers
BEGIN
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM organization_workspace_state ws,json_each(ws.payload,'$.jobs') j
  JOIN quotes_server q ON q.organization_id=ws.organization_id AND q.project_id=CAST(json_extract(j.value,'$.id') AS TEXT)
  WHERE ws.organization_id=NEW.organization_id AND CAST(json_extract(j.value,'$.clientId') AS TEXT)=NEW.contact_id
   AND NULLIF(q.customer_id,'') IS NOT NULL AND q.customer_id IS NOT NEW.customer_id
 ) THEN RAISE(ABORT,'commercial_customer_mismatch') END;
END;

CREATE TABLE commercial_directory_operations (
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 operation_key TEXT NOT NULL,
 request_json TEXT NOT NULL CHECK(json_valid(request_json)),
 response_json TEXT NOT NULL CHECK(json_valid(response_json)),
 created_by TEXT NOT NULL REFERENCES profiles(id),
 created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,operation_key)
);

-- The assertion is executed FIRST in the same DB.batch transaction as all
-- workspace, customer, mapping and audit writes. A zero-row CAS update alone
-- would not roll back the following statements.
CREATE TABLE commercial_directory_write_guards (
 operation_id TEXT PRIMARY KEY NOT NULL,
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 expected_revision INTEGER NOT NULL CHECK(expected_revision>=0)
);
CREATE TRIGGER commercial_directory_revision_guard
BEFORE INSERT ON commercial_directory_write_guards
WHEN COALESCE((SELECT revision FROM organization_workspace_state WHERE organization_id=NEW.organization_id),0)<>NEW.expected_revision
BEGIN SELECT RAISE(ABORT,'commercial_directory_revision_conflict'); END;

-- Legacy jobs stay in the workspace. Resolve their client by explicit contact
-- ID at the SQL write boundary too, so an interleaving quote cannot bypass the
-- JavaScript read/check. No name, email or label participates in this join.
CREATE TRIGGER commercial_quote_legacy_customer_insert
BEFORE INSERT ON quotes_server
BEGIN
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM organization_workspace_state ws,json_each(ws.payload,'$.jobs') j
  LEFT JOIN commercial_contact_customers m ON m.organization_id=ws.organization_id AND m.contact_id=CAST(json_extract(j.value,'$.clientId') AS TEXT)
  WHERE ws.organization_id=NEW.organization_id AND CAST(json_extract(j.value,'$.id') AS TEXT)=NEW.project_id
   AND COALESCE(NULLIF(json_extract(j.value,'$.customerId'),''),m.customer_id) IS NOT NULL
   AND NEW.customer_id IS NOT COALESCE(NULLIF(json_extract(j.value,'$.customerId'),''),m.customer_id)
 ) THEN RAISE(ABORT,'commercial_customer_mismatch') END;
END;
CREATE TRIGGER commercial_quote_legacy_customer_update
BEFORE UPDATE OF organization_id,project_id,customer_id ON quotes_server
WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.project_id IS NOT OLD.project_id OR NEW.customer_id IS NOT OLD.customer_id
BEGIN
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM organization_workspace_state ws,json_each(ws.payload,'$.jobs') j
  LEFT JOIN commercial_contact_customers m ON m.organization_id=ws.organization_id AND m.contact_id=CAST(json_extract(j.value,'$.clientId') AS TEXT)
  WHERE ws.organization_id=NEW.organization_id AND CAST(json_extract(j.value,'$.id') AS TEXT)=NEW.project_id
   AND COALESCE(NULLIF(json_extract(j.value,'$.customerId'),''),m.customer_id) IS NOT NULL
   AND NEW.customer_id IS NOT COALESCE(NULLIF(json_extract(j.value,'$.customerId'),''),m.customer_id)
 ) THEN RAISE(ABORT,'commercial_customer_mismatch') END;
END;
CREATE TRIGGER commercial_workspace_customer_update
BEFORE UPDATE OF payload ON organization_workspace_state
BEGIN
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM json_each(OLD.payload,'$.jobs') old
  WHERE NOT EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.jobs') j WHERE CAST(json_extract(j.value,'$.id') AS TEXT)=CAST(json_extract(old.value,'$.id') AS TEXT))
   AND EXISTS(SELECT 1 FROM quotes_server q WHERE q.organization_id=OLD.organization_id AND q.project_id=CAST(json_extract(old.value,'$.id') AS TEXT))
 ) THEN RAISE(ABORT,'commercial_project_link_invalid') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM commercial_contact_customers m WHERE m.organization_id=NEW.organization_id
   AND NOT EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.contacts') c WHERE CAST(json_extract(c.value,'$.id') AS TEXT)=m.contact_id)
 ) THEN RAISE(ABORT,'commercial_contact_source_missing') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM json_each(NEW.payload,'$.jobs') j
  LEFT JOIN commercial_contact_customers m ON m.organization_id=NEW.organization_id AND m.contact_id=CAST(json_extract(j.value,'$.clientId') AS TEXT)
  LEFT JOIN json_each(OLD.payload,'$.jobs') old ON CAST(json_extract(old.value,'$.id') AS TEXT)=CAST(json_extract(j.value,'$.id') AS TEXT)
  WHERE (json_extract(old.value,'$.clientId') IS NOT json_extract(j.value,'$.clientId') OR json_extract(old.value,'$.customerId') IS NOT json_extract(j.value,'$.customerId'))
   AND (
    (m.customer_id IS NOT NULL AND NULLIF(json_extract(j.value,'$.customerId'),'') IS NOT NULL AND json_extract(j.value,'$.customerId') IS NOT m.customer_id)
    OR EXISTS(SELECT 1 FROM quotes_server q WHERE q.organization_id=NEW.organization_id AND q.project_id=CAST(json_extract(j.value,'$.id') AS TEXT)
      AND (COALESCE(NULLIF(json_extract(j.value,'$.customerId'),''),m.customer_id) IS NOT NULL OR NULLIF(q.customer_id,'') IS NOT NULL)
      AND q.customer_id IS NOT COALESCE(NULLIF(json_extract(j.value,'$.customerId'),''),m.customer_id))
   )
 ) THEN RAISE(ABORT,'commercial_customer_mismatch') END;
END;
