-- Origin of task materials; task creation and this receipt commit in one batch.
CREATE TABLE task_measurement_sources (
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 task_id TEXT NOT NULL REFERENCES project_tasks(id),
 measurement_id TEXT NOT NULL,visit_id TEXT NOT NULL,quote_id TEXT NOT NULL REFERENCES quotes_server(id),project_id TEXT NOT NULL,
 expected_head_version INTEGER NOT NULL CHECK(expected_head_version>0),
 materials_json TEXT NOT NULL,source_json TEXT NOT NULL,
 operation_key TEXT NOT NULL,request_json TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES profiles(id),created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,task_id),UNIQUE(organization_id,created_by,operation_key),
 FOREIGN KEY(organization_id,measurement_id) REFERENCES measurement_snapshots(organization_id,id),
 FOREIGN KEY(organization_id,visit_id) REFERENCES quote_site_visits(organization_id,id)
);
CREATE TRIGGER measurement_task_immutable_update BEFORE UPDATE ON task_measurement_sources BEGIN SELECT RAISE(ABORT,'measurement_task_immutable'); END;
CREATE TRIGGER measurement_task_immutable_delete BEFORE DELETE ON task_measurement_sources BEGIN SELECT RAISE(ABORT,'measurement_task_immutable'); END;
CREATE TRIGGER measurement_task_guard BEFORE INSERT ON task_measurement_sources BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM project_tasks t JOIN measurement_snapshots m ON m.organization_id=t.organization_id AND m.id=NEW.measurement_id
  JOIN quote_site_visits v ON v.organization_id=m.organization_id AND v.id=m.visit_id
  JOIN quotes_server q ON q.organization_id=v.organization_id AND q.id=v.quote_id
  WHERE t.organization_id=NEW.organization_id AND t.id=NEW.task_id AND t.project_id=NEW.project_id AND t.archived_at IS NULL
  AND json(t.materials_json)=json(NEW.materials_json) AND m.visit_id=NEW.visit_id AND v.quote_id=NEW.quote_id
  AND q.project_id=NEW.project_id AND q.archived_at IS NULL
  AND NEW.expected_head_version=(SELECT MAX(version) FROM measurement_snapshots WHERE organization_id=NEW.organization_id AND visit_id=NEW.visit_id)
 ) THEN RAISE(ABORT,'measurement_task_stale') END;
END;
