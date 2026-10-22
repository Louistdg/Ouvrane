-- Immutable, calculated measurement versions and atomic quote application receipts.
CREATE TABLE measurement_snapshots (
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 id TEXT NOT NULL,
 visit_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0),
 operation_key TEXT NOT NULL,
 input_json TEXT NOT NULL,
 result_json TEXT NOT NULL,
 source_label TEXT NOT NULL,
 source_document_id TEXT,
 created_by TEXT NOT NULL REFERENCES profiles(id),
 created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,visit_id,version),
 UNIQUE(organization_id,operation_key),
 FOREIGN KEY(organization_id,visit_id) REFERENCES quote_site_visits(organization_id,id)
);
CREATE TRIGGER measurement_snapshot_immutable BEFORE UPDATE ON measurement_snapshots
BEGIN SELECT RAISE(ABORT,'measurement_immutable'); END;
CREATE TABLE measurement_quote_links (
 organization_id TEXT NOT NULL,
 measurement_id TEXT NOT NULL,
 quote_id TEXT NOT NULL REFERENCES quotes_server(id),
 expected_lines_json TEXT NOT NULL,
 added_lines_json TEXT NOT NULL,
 new_lines_json TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES profiles(id),
 created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,measurement_id,quote_id),
 FOREIGN KEY(organization_id,measurement_id) REFERENCES measurement_snapshots(organization_id,id)
);
CREATE TRIGGER measurement_quote_guard BEFORE INSERT ON measurement_quote_links
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM quotes_server WHERE organization_id=NEW.organization_id AND id=NEW.quote_id AND status='draft' AND archived_at IS NULL AND lines_json=NEW.expected_lines_json)
 THEN RAISE(ABORT,'measurement_quote_stale') END;
END;
CREATE TRIGGER measurement_quote_apply AFTER INSERT ON measurement_quote_links
BEGIN
 UPDATE quotes_server SET lines_json=NEW.new_lines_json,updated_at=NEW.created_at WHERE organization_id=NEW.organization_id AND id=NEW.quote_id;
END;
