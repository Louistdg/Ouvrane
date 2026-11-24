-- Private, immutable 3D model revisions; separate from PDF/document storage.
CREATE TABLE project_models (
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
 latest_version INTEGER NOT NULL DEFAULT 0 CHECK(latest_version BETWEEN 0 AND 50),
 created_by TEXT NOT NULL REFERENCES profiles(id),
 created_at TEXT NOT NULL,
 archived_at TEXT,
 archived_by TEXT REFERENCES profiles(id),
 PRIMARY KEY(organization_id,id)
);
CREATE INDEX project_models_project_idx ON project_models(organization_id,project_id,archived_at,created_at);

CREATE TABLE project_model_versions (
 organization_id TEXT NOT NULL,
 id TEXT NOT NULL,
 model_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 50),
 filename TEXT NOT NULL,
 source_bytes INTEGER NOT NULL CHECK(source_bytes BETWEEN 1 AND 1800000),
 preview_bytes INTEGER NOT NULL CHECK(preview_bytes BETWEEN 20 AND 8388608),
 metadata_bytes INTEGER NOT NULL CHECK(metadata_bytes BETWEEN 1 AND 524288),
 source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
 preview_sha256 TEXT NOT NULL CHECK(length(preview_sha256)=64),
 metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
 operation_key TEXT NOT NULL,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 created_by TEXT NOT NULL REFERENCES profiles(id),
 created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,id),
 UNIQUE(organization_id,model_id,version),
 UNIQUE(organization_id,operation_key),
 FOREIGN KEY(organization_id,model_id) REFERENCES project_models(organization_id,id)
);
CREATE TABLE project_model_chunks (
 organization_id TEXT NOT NULL,
 version_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('source','preview')),
 chunk_index INTEGER NOT NULL CHECK(chunk_index>=0),
 content BLOB NOT NULL CHECK(typeof(content)='blob' AND length(content) BETWEEN 1 AND 262144),
 PRIMARY KEY(organization_id,version_id,kind,chunk_index),
 FOREIGN KEY(organization_id,version_id) REFERENCES project_model_versions(organization_id,id)
);
CREATE TABLE project_model_guards(id TEXT PRIMARY KEY,valid INTEGER NOT NULL CHECK(valid=1));

CREATE TRIGGER project_model_versions_no_update BEFORE UPDATE ON project_model_versions BEGIN
 SELECT RAISE(ABORT,'project_model_version_immutable');
END;
CREATE TRIGGER project_model_chunks_no_update BEFORE UPDATE ON project_model_chunks BEGIN
 SELECT RAISE(ABORT,'project_model_chunk_immutable');
END;
CREATE TRIGGER project_model_versions_no_delete BEFORE DELETE ON project_model_versions BEGIN
 SELECT RAISE(ABORT,'project_model_version_immutable');
END;
CREATE TRIGGER project_model_chunks_no_delete BEFORE DELETE ON project_model_chunks BEGIN
 SELECT RAISE(ABORT,'project_model_chunk_immutable');
END;
