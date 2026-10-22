CREATE TABLE plan_sets (
 organization_id TEXT NOT NULL REFERENCES organizations(id),id TEXT NOT NULL,
 visit_id TEXT,project_id TEXT,title TEXT NOT NULL,operation_key TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES profiles(id),created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,operation_key),
 CHECK(visit_id IS NOT NULL OR project_id IS NOT NULL),
 FOREIGN KEY(organization_id,visit_id) REFERENCES quote_site_visits(organization_id,id)
);
CREATE TABLE plan_file_versions (
 organization_id TEXT NOT NULL,id TEXT NOT NULL,plan_id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),
 document_id TEXT NOT NULL REFERENCES secure_documents(id),checksum_sha256 TEXT NOT NULL,change_note TEXT NOT NULL,
 operation_key TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES profiles(id),created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,plan_id,version),UNIQUE(organization_id,operation_key),
 FOREIGN KEY(organization_id,plan_id) REFERENCES plan_sets(organization_id,id)
);
CREATE TRIGGER plan_file_immutable BEFORE UPDATE ON plan_file_versions BEGIN SELECT RAISE(ABORT,'plan_file_immutable'); END;
CREATE TRIGGER plan_file_document_guard BEFORE INSERT ON plan_file_versions BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM secure_documents WHERE id=NEW.document_id AND organization_id=NEW.organization_id AND status='available' AND archived_at IS NULL AND content_type='application/pdf' AND checksum_sha256=NEW.checksum_sha256) THEN RAISE(ABORT,'plan_document_unavailable') END;
END;
CREATE INDEX plan_document_idx ON plan_file_versions(organization_id,document_id);
CREATE TABLE plan_annotation_snapshots (
 organization_id TEXT NOT NULL,id TEXT NOT NULL,plan_version_id TEXT NOT NULL,page_number INTEGER NOT NULL CHECK(page_number>0),version INTEGER NOT NULL CHECK(version>0),
 input_json TEXT NOT NULL,result_json TEXT NOT NULL,operation_key TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES profiles(id),created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,plan_version_id,page_number,version),UNIQUE(organization_id,operation_key),
 FOREIGN KEY(organization_id,plan_version_id) REFERENCES plan_file_versions(organization_id,id)
);
CREATE TRIGGER plan_annotation_immutable BEFORE UPDATE ON plan_annotation_snapshots BEGIN SELECT RAISE(ABORT,'plan_annotation_immutable'); END;
-- Guard the last write as well as the API preview: a new file or page revision invalidates a new measurement.
CREATE TRIGGER measurement_plan_source_guard BEFORE INSERT ON measurement_snapshots
WHEN EXISTS(SELECT 1 FROM json_each(NEW.input_json,'$.planSources'))
BEGIN
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM json_each(NEW.input_json,'$.planSources') j
  WHERE NOT EXISTS(
   SELECT 1 FROM plan_annotation_snapshots a JOIN plan_file_versions v ON v.organization_id=a.organization_id AND v.id=a.plan_version_id
   JOIN secure_documents d ON d.organization_id=v.organization_id AND d.id=v.document_id
   WHERE a.organization_id=NEW.organization_id AND a.id=json_extract(j.value,'$.snapshotId')
    AND d.status='available' AND d.archived_at IS NULL AND d.checksum_sha256=v.checksum_sha256
    AND v.version=(SELECT MAX(version) FROM plan_file_versions WHERE organization_id=v.organization_id AND plan_id=v.plan_id)
    AND a.version=(SELECT MAX(version) FROM plan_annotation_snapshots WHERE organization_id=a.organization_id AND plan_version_id=a.plan_version_id AND page_number=a.page_number)
  )
 ) THEN RAISE(ABORT,'measurement_plan_stale') END;
END;
-- Preserve the request before source quantities are recomputed, for identical retries after later revisions.
ALTER TABLE measurement_snapshots ADD COLUMN request_json TEXT;
CREATE TRIGGER plan_annotation_source_guard BEFORE INSERT ON plan_annotation_snapshots BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM plan_file_versions v JOIN secure_documents d ON d.organization_id=v.organization_id AND d.id=v.document_id
  WHERE v.organization_id=NEW.organization_id AND v.id=NEW.plan_version_id AND d.status='available' AND d.archived_at IS NULL
   AND d.checksum_sha256=v.checksum_sha256
   AND v.version=(SELECT MAX(version) FROM plan_file_versions WHERE organization_id=v.organization_id AND plan_id=v.plan_id)
 ) THEN RAISE(ABORT,'plan_annotation_stale') END;
END;
