-- A task points at the existing schedule. Editions preserve the planning seen at issue time.
CREATE VIEW task_preparation_assignment_guards AS
 SELECT organization_id,id,project_id,status,
 json_object('id',id,'projectId',project_id,'date',assignment_date,'teamId',team_id,
 'peopleJson',people_json,'startTime',COALESCE(start_time,'07:00'),'endTime',COALESCE(end_time,'16:00'),
 'status',status,'vehicleId',COALESCE(vehicle_id,''),'packId',COALESCE(pack_id,''),'updatedAt',updated_at) guard_json
 FROM field_assignments;
CREATE TABLE task_preparations (
 organization_id TEXT NOT NULL REFERENCES organizations(id),id TEXT NOT NULL,
 task_id TEXT NOT NULL REFERENCES project_tasks(id),project_id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),
 assignment_id TEXT,assignment_guard_json TEXT NOT NULL,operation_key TEXT NOT NULL,request_json TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES profiles(id),created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,task_id,version),UNIQUE(organization_id,operation_key),
 FOREIGN KEY(organization_id,assignment_id) REFERENCES field_assignments(organization_id,id)
);
CREATE INDEX task_preparation_task_idx ON task_preparations(organization_id,task_id,version DESC);
CREATE TRIGGER task_preparation_immutable_update BEFORE UPDATE ON task_preparations BEGIN SELECT RAISE(ABORT,'preparation_immutable'); END;
CREATE TRIGGER task_preparation_immutable_delete BEFORE DELETE ON task_preparations BEGIN SELECT RAISE(ABORT,'preparation_immutable'); END;
CREATE TRIGGER task_preparation_guard BEFORE INSERT ON task_preparations BEGIN
 SELECT CASE WHEN NEW.version<>(SELECT COALESCE(MAX(version),0)+1 FROM task_preparations WHERE organization_id=NEW.organization_id AND task_id=NEW.task_id)
 OR NOT EXISTS(SELECT 1 FROM project_tasks WHERE organization_id=NEW.organization_id AND id=NEW.task_id AND project_id=NEW.project_id AND archived_at IS NULL AND status<>'done')
 THEN RAISE(ABORT,'preparation_stale') END;
 SELECT CASE WHEN NEW.assignment_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM task_preparation_assignment_guards a WHERE a.organization_id=NEW.organization_id AND a.id=NEW.assignment_id
 AND a.project_id=NEW.project_id AND a.status<>'cancelled' AND json(a.guard_json)=json(NEW.assignment_guard_json)
 ) OR NEW.assignment_id IS NULL AND json(NEW.assignment_guard_json)<>'null'
 THEN RAISE(ABORT,'preparation_assignment_stale') END;
END;
-- The final transactional write must match both the link and the live assignment.
CREATE TRIGGER work_packet_preparation_guard BEFORE INSERT ON work_packet_issues BEGIN
 SELECT CASE WHEN COALESCE(json_extract(NEW.task_guard_json,'$.preparation.bindingId'),'')<>COALESCE((SELECT id FROM task_preparations WHERE organization_id=NEW.organization_id AND task_id=NEW.task_id ORDER BY version DESC LIMIT 1),'')
 THEN RAISE(ABORT,'work_packet_preparation_stale') END;
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM task_preparations p WHERE p.organization_id=NEW.organization_id AND p.task_id=NEW.task_id
 AND p.version=(SELECT MAX(version) FROM task_preparations WHERE organization_id=p.organization_id AND task_id=p.task_id)
 AND p.assignment_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM task_preparation_assignment_guards a WHERE a.organization_id=p.organization_id AND a.id=p.assignment_id
  AND a.project_id=NEW.project_id AND a.status<>'cancelled'
  AND json(a.guard_json)=json_extract(NEW.task_guard_json,'$.preparation.assignment')
 )) THEN RAISE(ABORT,'work_packet_preparation_stale') END;
END;
