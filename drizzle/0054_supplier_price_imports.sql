CREATE TABLE supplier_price_imports (
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 id TEXT NOT NULL,
 supplier_id TEXT NOT NULL,
 version INTEGER NOT NULL,
 valid_from TEXT NOT NULL,
 filename TEXT NOT NULL,
 checksum_sha256 TEXT NOT NULL,
 original_bytes BLOB NOT NULL,
 mapping_json TEXT NOT NULL,
 rows_json TEXT NOT NULL,
 operation_key TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES profiles(id),
 created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,supplier_id,version),
 UNIQUE(organization_id,operation_key)
);
CREATE INDEX supplier_price_imports_lookup ON supplier_price_imports(organization_id,supplier_id,valid_from,version);
CREATE TRIGGER supplier_price_import_immutable BEFORE UPDATE ON supplier_price_imports
BEGIN SELECT RAISE(ABORT,'supplier_price_import_immutable'); END;
