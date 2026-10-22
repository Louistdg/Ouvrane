CREATE TABLE work_packet_issues (
 organization_id TEXT NOT NULL REFERENCES organizations(id),id TEXT NOT NULL,
 task_id TEXT NOT NULL REFERENCES project_tasks(id),project_id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),
 response_mode TEXT NOT NULL CHECK(response_mode IN ('none','confirm','reply')),
 snapshot_json TEXT NOT NULL,task_guard_json TEXT NOT NULL,task_people_after_json TEXT NOT NULL,
 operation_key TEXT NOT NULL,request_json TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES profiles(id),created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,task_id,version),UNIQUE(organization_id,operation_key)
);
CREATE INDEX work_packet_project_idx ON work_packet_issues(organization_id,project_id,created_at DESC,id);
CREATE TRIGGER work_packet_issue_immutable BEFORE UPDATE ON work_packet_issues BEGIN SELECT RAISE(ABORT,'work_packet_immutable'); END;
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
  SELECT 1 FROM plan_file_versions v JOIN secure_documents d ON d.organization_id=v.organization_id AND d.id=v.document_id
  WHERE v.organization_id=NEW.organization_id AND v.id=json_extract(NEW.snapshot_json,'$.plan.versionId')
   AND v.version=(SELECT MAX(version) FROM plan_file_versions WHERE organization_id=v.organization_id AND plan_id=v.plan_id)
   AND d.status='available' AND d.archived_at IS NULL AND d.checksum_sha256=json_extract(NEW.snapshot_json,'$.plan.checksum')
   AND COALESCE((SELECT id FROM plan_annotation_snapshots a WHERE a.organization_id=v.organization_id AND a.plan_version_id=v.id AND a.page_number=json_extract(NEW.snapshot_json,'$.plan.pageNumber') ORDER BY a.version DESC LIMIT 1),'')=COALESCE(json_extract(NEW.snapshot_json,'$.plan.annotation.id'),'')
 ) THEN RAISE(ABORT,'work_packet_stale') END;
END;
CREATE TRIGGER work_packet_task_participants AFTER INSERT ON work_packet_issues BEGIN
 UPDATE project_tasks SET people_json=NEW.task_people_after_json,updated_at=NEW.created_at WHERE organization_id=NEW.organization_id AND id=NEW.task_id;
END;
CREATE TABLE work_packet_recipients (
 organization_id TEXT NOT NULL,issue_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES profiles(id),
 PRIMARY KEY(organization_id,issue_id,user_id),FOREIGN KEY(organization_id,issue_id) REFERENCES work_packet_issues(organization_id,id)
);
CREATE INDEX work_packet_recipient_idx ON work_packet_recipients(organization_id,user_id,issue_id);
CREATE TRIGGER work_packet_recipient_immutable BEFORE UPDATE ON work_packet_recipients BEGIN SELECT RAISE(ABORT,'work_packet_immutable'); END;
CREATE TRIGGER work_packet_recipient_active BEFORE INSERT ON work_packet_recipients BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM organization_members WHERE organization_id=NEW.organization_id AND user_id=NEW.user_id AND status='active') THEN RAISE(ABORT,'work_packet_recipient_inactive') END;
END;
CREATE TABLE work_packet_events (
 organization_id TEXT NOT NULL,id TEXT NOT NULL,issue_id TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES profiles(id),
 kind TEXT NOT NULL CHECK(kind IN ('opened','plan_served','plan_viewed','confirmed','replied','question','answer')),
 payload_json TEXT NOT NULL,reply_to_id TEXT,comment_id TEXT REFERENCES project_task_comments(id),operation_key TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,operation_key),
 FOREIGN KEY(organization_id,issue_id) REFERENCES work_packet_issues(organization_id,id),
 FOREIGN KEY(organization_id,reply_to_id) REFERENCES work_packet_events(organization_id,id)
);
CREATE UNIQUE INDEX work_packet_once_idx ON work_packet_events(organization_id,issue_id,actor_id,kind) WHERE kind IN ('opened','plan_served','plan_viewed','confirmed','replied');
CREATE TRIGGER work_packet_event_immutable BEFORE UPDATE ON work_packet_events BEGIN SELECT RAISE(ABORT,'work_packet_immutable'); END;
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
    SELECT 1 FROM plan_file_versions v JOIN secure_documents d ON d.organization_id=v.organization_id AND d.id=v.document_id
    WHERE v.organization_id=i.organization_id AND v.id=json_extract(i.snapshot_json,'$.plan.versionId')
     AND v.version=(SELECT MAX(version) FROM plan_file_versions WHERE organization_id=v.organization_id AND plan_id=v.plan_id)
     AND d.status='available' AND d.archived_at IS NULL AND d.checksum_sha256=json_extract(i.snapshot_json,'$.plan.checksum')
     AND COALESCE((SELECT id FROM plan_annotation_snapshots a WHERE a.organization_id=v.organization_id AND a.plan_version_id=v.id AND a.page_number=json_extract(i.snapshot_json,'$.plan.pageNumber') ORDER BY a.version DESC LIMIT 1),'')=COALESCE(json_extract(i.snapshot_json,'$.plan.annotation.id'),'')
   ))
 ) THEN RAISE(ABORT,'work_packet_response_stale') END;
END;
CREATE INDEX work_packet_event_thread_idx ON work_packet_events(organization_id,issue_id,created_at,id);
CREATE INDEX work_packet_event_reply_idx ON work_packet_events(organization_id,reply_to_id,kind);
