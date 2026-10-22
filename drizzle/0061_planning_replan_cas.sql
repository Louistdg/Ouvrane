-- Replanning compares the exact server snapshot before its first intermediate write.
-- Keep the preparation guard unchanged: stock and frozen work packets still consume it.
CREATE VIEW planning_replan_assignment_guards AS
 SELECT a.organization_id,a.id,json_set(g.guard_json,
  '$.reason',COALESCE(a.reason,''),
  '$.subcontractor',COALESCE(a.subcontractor,''),
  '$.assignmentType',COALESCE(a.assignment_type,'team'),
  '$.updatedBy',a.updated_by) guard_json
 FROM field_assignments a JOIN task_preparation_assignment_guards g ON g.organization_id=a.organization_id AND g.id=a.id;
CREATE TABLE planning_replan_checks (
 organization_id TEXT NOT NULL REFERENCES organizations(id),id TEXT NOT NULL,operation_key TEXT NOT NULL,
 guards_json TEXT NOT NULL CHECK(json_valid(guards_json)),created_by TEXT NOT NULL REFERENCES profiles(id),created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,operation_key)
);
CREATE TRIGGER planning_replan_check_guard BEFORE INSERT ON planning_replan_checks BEGIN
 SELECT CASE WHEN NOT json_valid(NEW.guards_json) THEN RAISE(ABORT,'planning_replan_stale') END;
 SELECT CASE WHEN json_type(NEW.guards_json)<>'array' OR json_array_length(NEW.guards_json)=0 THEN RAISE(ABORT,'planning_replan_stale') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.guards_json) j WHERE j.type<>'object') THEN RAISE(ABORT,'planning_replan_stale') END;
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM json_each(NEW.guards_json) j WHERE COALESCE(json_type(j.value,'$.id'),'')<>'text'
   OR COALESCE(json_extract(j.value,'$.id'),'')='' OR COALESCE(json_type(j.value,'$.guardJson'),'')<>'text'
   OR NOT EXISTS(SELECT 1 FROM planning_replan_assignment_guards g WHERE g.organization_id=NEW.organization_id AND g.id=json_extract(j.value,'$.id') AND g.guard_json=json_extract(j.value,'$.guardJson'))
 ) OR json_array_length(NEW.guards_json)<>(SELECT COUNT(DISTINCT json_extract(j.value,'$.id')) FROM json_each(NEW.guards_json) j)
 THEN RAISE(ABORT,'planning_replan_stale') END;
END;
CREATE TRIGGER planning_replan_check_update BEFORE UPDATE ON planning_replan_checks BEGIN SELECT RAISE(ABORT,'planning_replan_immutable'); END;
CREATE TRIGGER planning_replan_check_delete BEFORE DELETE ON planning_replan_checks BEGIN SELECT RAISE(ABORT,'planning_replan_immutable'); END;
