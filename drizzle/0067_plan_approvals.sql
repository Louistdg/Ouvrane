-- Lot III: separate plan import/revision from explicit terrain approval.
-- Existing latest revisions are seeded as approved to preserve current issued packets.
CREATE TABLE plan_version_approvals (
  organization_id TEXT NOT NULL,
  id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  plan_version_id TEXT NOT NULL,
  note TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  approved_by TEXT NOT NULL REFERENCES profiles(id),
  approved_at TEXT NOT NULL,
  PRIMARY KEY(organization_id,id),
  UNIQUE(organization_id,plan_version_id),
  UNIQUE(organization_id,operation_key),
  FOREIGN KEY(organization_id,plan_id) REFERENCES plan_sets(organization_id,id),
  FOREIGN KEY(organization_id,plan_version_id) REFERENCES plan_file_versions(organization_id,id)
);

CREATE INDEX plan_version_approval_plan_idx
ON plan_version_approvals(organization_id,plan_id,approved_at,plan_version_id);

CREATE TRIGGER plan_version_approval_validate
BEFORE INSERT ON plan_version_approvals
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM plan_file_versions v
    WHERE v.organization_id=NEW.organization_id
      AND v.id=NEW.plan_version_id
      AND v.plan_id=NEW.plan_id
  ) THEN RAISE(ABORT,'plan_approval_version_invalid') END;
  SELECT CASE WHEN (
    SELECT v.version FROM plan_file_versions v
    WHERE v.organization_id=NEW.organization_id AND v.id=NEW.plan_version_id
  ) <> (
    SELECT MAX(v2.version) FROM plan_file_versions v2
    WHERE v2.organization_id=NEW.organization_id AND v2.plan_id=NEW.plan_id
  ) THEN RAISE(ABORT,'plan_approval_not_latest') END;
END;

CREATE TRIGGER plan_version_approval_immutable_update
BEFORE UPDATE ON plan_version_approvals
BEGIN
  SELECT RAISE(ABORT,'plan_approval_immutable');
END;

CREATE TRIGGER plan_version_approval_immutable_delete
BEFORE DELETE ON plan_version_approvals
BEGIN
  SELECT RAISE(ABORT,'plan_approval_immutable');
END;

INSERT OR IGNORE INTO plan_version_approvals(
  organization_id,id,plan_id,plan_version_id,note,operation_key,approved_by,approved_at
)
SELECT
  v.organization_id,
  'legacy-plan-approval-' || v.id,
  v.plan_id,
  v.id,
  'Migration 0067 · révision terrain existante préservée',
  'legacy-plan-approval:' || v.id,
  v.created_by,
  v.created_at
FROM plan_file_versions v
WHERE v.version=(
  SELECT MAX(v2.version)
  FROM plan_file_versions v2
  WHERE v2.organization_id=v.organization_id AND v2.plan_id=v.plan_id
);

DROP TRIGGER IF EXISTS work_packet_issue_guard;
CREATE TRIGGER work_packet_issue_guard BEFORE INSERT ON work_packet_issues BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM project_tasks t WHERE t.organization_id=NEW.organization_id AND t.id=NEW.task_id AND t.project_id=NEW.project_id AND t.archived_at IS NULL AND t.status<>'done'
   AND t.title=json_extract(NEW.task_guard_json,'$.title') AND t.description=json_extract(NEW.task_guard_json,'$.description')
   AND t.status=json_extract(NEW.task_guard_json,'$.status') AND t.priority=json_extract(NEW.task_guard_json,'$.priority')
   AND COALESCE(t.assigned_to,'')=json_extract(NEW.task_guard_json,'$.assignedTo')
   AND COALESCE(t.due_at,'')=json_extract(NEW.task_guard_json,'$.dueAt')
   AND t.checklist_json=json_extract(NEW.task_guard_json,'$.checklistJson') AND t.materials_json=json_extract(NEW.task_guard_json,'$.materialsJson')
   AND t.people_json=json_extract(NEW.task_guard_json,'$.peopleJson') AND t.updated_at=json_extract(NEW.task_guard_json,'$.updatedAt')
 ) OR NEW.version<>(SELECT COALESCE(MAX(version),0)+1 FROM work_packet_issues WHERE organization_id=NEW.organization_id AND task_id=NEW.task_id)
 THEN RAISE(ABORT,'work_packet_stale') END;
 SELECT CASE WHEN json_extract(NEW.snapshot_json,'$.plan') IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM plan_file_versions v
  JOIN plan_version_approvals ap ON ap.organization_id=v.organization_id AND ap.plan_version_id=v.id AND ap.plan_id=v.plan_id
  JOIN secure_documents d ON d.organization_id=v.organization_id AND d.id=v.document_id
  WHERE v.organization_id=NEW.organization_id AND v.id=json_extract(NEW.snapshot_json,'$.plan.versionId')
   AND v.version=(
    SELECT MAX(v2.version) FROM plan_file_versions v2
    JOIN plan_version_approvals ap2 ON ap2.organization_id=v2.organization_id AND ap2.plan_version_id=v2.id AND ap2.plan_id=v2.plan_id
    WHERE v2.organization_id=v.organization_id AND v2.plan_id=v.plan_id
   )
   AND d.status='available' AND d.archived_at IS NULL AND d.checksum_sha256=json_extract(NEW.snapshot_json,'$.plan.checksum')
   AND COALESCE((SELECT id FROM plan_annotation_snapshots a WHERE a.organization_id=v.organization_id AND a.plan_version_id=v.id AND a.page_number=json_extract(NEW.snapshot_json,'$.plan.pageNumber') ORDER BY a.version DESC LIMIT 1),'')=COALESCE(json_extract(NEW.snapshot_json,'$.plan.annotation.id'),'')
 ) THEN RAISE(ABORT,'work_packet_stale') END;
END;

DROP TRIGGER IF EXISTS work_packet_response_guard;
CREATE TRIGGER work_packet_response_guard BEFORE INSERT ON work_packet_events WHEN NEW.kind IN ('opened','plan_served','plan_viewed','confirmed','replied') BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM work_packet_issues i JOIN work_packet_recipients r ON r.organization_id=i.organization_id AND r.issue_id=i.id AND r.user_id=NEW.actor_id
  JOIN organization_members m ON m.organization_id=r.organization_id AND m.user_id=r.user_id AND m.status='active'
  WHERE i.organization_id=NEW.organization_id AND i.id=NEW.issue_id
   AND i.version=(SELECT MAX(version) FROM work_packet_issues WHERE organization_id=i.organization_id AND task_id=i.task_id)
   AND (NEW.kind IN ('opened','plan_served','plan_viewed') OR NEW.kind='confirmed' AND i.response_mode='confirm' OR NEW.kind='replied' AND i.response_mode='reply')
   AND (NEW.kind NOT IN ('confirmed','replied') OR EXISTS(SELECT 1 FROM work_packet_events e WHERE e.organization_id=i.organization_id AND e.issue_id=i.id AND e.actor_id=NEW.actor_id AND e.kind='opened'))
   AND (NEW.kind<>'plan_viewed' OR EXISTS(SELECT 1 FROM work_packet_events e WHERE e.organization_id=i.organization_id AND e.issue_id=i.id AND e.actor_id=NEW.actor_id AND e.kind='plan_served'))
   AND (NEW.kind NOT IN ('confirmed','replied') OR json_extract(i.snapshot_json,'$.plan') IS NULL OR EXISTS(SELECT 1 FROM work_packet_events e WHERE e.organization_id=i.organization_id AND e.issue_id=i.id AND e.actor_id=NEW.actor_id AND e.kind='plan_viewed'))
   AND (json_extract(i.snapshot_json,'$.plan') IS NULL OR EXISTS(
    SELECT 1 FROM plan_file_versions v
    JOIN plan_version_approvals ap ON ap.organization_id=v.organization_id AND ap.plan_version_id=v.id AND ap.plan_id=v.plan_id
    JOIN secure_documents d ON d.organization_id=v.organization_id AND d.id=v.document_id
    WHERE v.organization_id=i.organization_id AND v.id=json_extract(i.snapshot_json,'$.plan.versionId')
     AND v.version=(
      SELECT MAX(v2.version) FROM plan_file_versions v2
      JOIN plan_version_approvals ap2 ON ap2.organization_id=v2.organization_id AND ap2.plan_version_id=v2.id AND ap2.plan_id=v2.plan_id
      WHERE v2.organization_id=v.organization_id AND v2.plan_id=v.plan_id
     )
     AND d.status='available' AND d.archived_at IS NULL AND d.checksum_sha256=json_extract(i.snapshot_json,'$.plan.checksum')
     AND COALESCE((SELECT id FROM plan_annotation_snapshots a WHERE a.organization_id=v.organization_id AND a.plan_version_id=v.id AND a.page_number=json_extract(i.snapshot_json,'$.plan.pageNumber') ORDER BY a.version DESC LIMIT 1),'')=COALESCE(json_extract(i.snapshot_json,'$.plan.annotation.id'),'')
   ))
 ) THEN RAISE(ABORT,'work_packet_response_stale') END;
END;
