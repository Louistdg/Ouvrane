-- Operational means are distinct from consumable stock and financial asset payloads.
CREATE TABLE assignment_asset_versions (
 organization_id TEXT NOT NULL,id TEXT NOT NULL,assignment_id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),
 asset_ids_json TEXT NOT NULL CHECK(json_valid(asset_ids_json) AND json_type(asset_ids_json)='array'),assignment_guard_json TEXT NOT NULL,
 operation_key TEXT NOT NULL,request_json TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES profiles(id),created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,assignment_id,version),UNIQUE(organization_id,operation_key),
 FOREIGN KEY(organization_id,assignment_id) REFERENCES field_assignments(organization_id,id)
);
CREATE TABLE asset_availability_blocks (
 organization_id TEXT NOT NULL,id TEXT NOT NULL,asset_id TEXT NOT NULL,starts_at TEXT NOT NULL,ends_at TEXT,
 reason TEXT NOT NULL,source_issue_id TEXT,operation_key TEXT NOT NULL,request_json TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES profiles(id),created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,operation_key),UNIQUE(organization_id,source_issue_id),
 FOREIGN KEY(organization_id,asset_id) REFERENCES field_assets(organization_id,id),CHECK(ends_at IS NULL OR ends_at>starts_at)
);
CREATE INDEX asset_availability_time_idx ON asset_availability_blocks(organization_id,asset_id,starts_at,ends_at);
CREATE TABLE asset_availability_resolutions (
 organization_id TEXT NOT NULL,id TEXT NOT NULL,block_id TEXT NOT NULL,operation_key TEXT NOT NULL,request_json TEXT NOT NULL,note TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES profiles(id),created_at TEXT NOT NULL,PRIMARY KEY(organization_id,id),UNIQUE(organization_id,block_id),UNIQUE(organization_id,operation_key),
 FOREIGN KEY(organization_id,block_id) REFERENCES asset_availability_blocks(organization_id,id)
);
CREATE TABLE assignment_asset_events (
 organization_id TEXT NOT NULL,id TEXT NOT NULL,assignment_id TEXT NOT NULL,asset_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('take','return')),take_id TEXT,
 project_id TEXT NOT NULL,participants_json TEXT NOT NULL CHECK(json_valid(participants_json)),assignment_snapshot_json TEXT NOT NULL,
 assignment_guard_json TEXT NOT NULL,business_date TEXT NOT NULL,operation_key TEXT NOT NULL,request_json TEXT NOT NULL,note TEXT NOT NULL,
 actor_person_id TEXT,created_by TEXT NOT NULL REFERENCES profiles(id),created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,operation_key),UNIQUE(organization_id,take_id),
 FOREIGN KEY(organization_id,assignment_id) REFERENCES field_assignments(organization_id,id),FOREIGN KEY(organization_id,asset_id) REFERENCES field_assets(organization_id,id),
 FOREIGN KEY(organization_id,take_id) REFERENCES assignment_asset_events(organization_id,id),CHECK((kind='take' AND take_id IS NULL) OR (kind='return' AND take_id IS NOT NULL))
);
CREATE INDEX assignment_asset_events_asset_idx ON assignment_asset_events(organization_id,asset_id,kind);
CREATE VIEW assignment_asset_out AS SELECT e.* FROM assignment_asset_events e WHERE e.kind='take' AND NOT EXISTS(SELECT 1 FROM assignment_asset_events r WHERE r.organization_id=e.organization_id AND r.take_id=e.id AND r.kind='return');
CREATE VIEW assignment_asset_links AS
 SELECT organization_id,id assignment_id,vehicle_id asset_id FROM field_assignments WHERE vehicle_id IS NOT NULL AND vehicle_id NOT IN ('','0')
 UNION SELECT organization_id,id,pack_id FROM field_assignments WHERE pack_id IS NOT NULL AND pack_id NOT IN ('','0')
 UNION SELECT v.organization_id,v.assignment_id,CAST(j.value AS TEXT) FROM assignment_asset_versions v,json_each(v.asset_ids_json) j
 WHERE v.version=(SELECT MAX(version) FROM assignment_asset_versions WHERE organization_id=v.organization_id AND assignment_id=v.assignment_id);
CREATE VIEW assignment_asset_resource_details AS
 SELECT l.*,COALESCE(json_extract(f.payload_json,'$.name'),l.asset_id) name,COALESCE(json_extract(f.payload_json,'$.reference'),'') reference,COALESCE(json_extract(f.payload_json,'$.group'),'unknown') kind,
 f.id IS NOT NULL known,f.archived_at IS NOT NULL archived,
 COALESCE(NULLIF(json_extract(f.payload_json,'$.condition'),''),json_extract(f.payload_json,'$.status'),'') asset_condition,
 COALESCE((SELECT json_group_array(json_object('id',id,'startsAt',starts_at,'endsAt',ends_at,'reason',reason,'resolutionId',resolution_id)) FROM (
  SELECT b.*,r.id resolution_id FROM asset_availability_blocks b LEFT JOIN asset_availability_resolutions r ON r.organization_id=b.organization_id AND r.block_id=b.id
  WHERE b.organization_id=l.organization_id AND b.asset_id=l.asset_id AND b.starts_at<a.assignment_date||'T'||COALESCE(a.end_time,'16:00') AND (b.ends_at IS NULL OR b.ends_at>a.assignment_date||'T'||COALESCE(a.start_time,'07:00')) ORDER BY b.starts_at,b.id
  )), '[]') blocks_json
 FROM assignment_asset_links l JOIN field_assignments a ON a.organization_id=l.organization_id AND a.id=l.assignment_id LEFT JOIN field_assets f ON f.organization_id=l.organization_id AND f.id=l.asset_id;
CREATE VIEW assignment_asset_guards AS
 SELECT a.organization_id,a.id assignment_id,json_object(
 'assignment',json_object('id',a.id,'projectId',a.project_id,'teamId',a.team_id,'date',a.assignment_date,'startTime',COALESCE(a.start_time,'07:00'),'endTime',COALESCE(a.end_time,'16:00'),'status',a.status,'peopleJson',a.people_json,'vehicleId',COALESCE(a.vehicle_id,''),'packId',COALESCE(a.pack_id,''),'updatedAt',a.updated_at),
 'version',COALESCE((SELECT MAX(version) FROM assignment_asset_versions v WHERE v.organization_id=a.organization_id AND v.assignment_id=a.id),0),
 'resources',json(COALESCE((SELECT json_group_array(json_object('id',asset_id,'name',name,'kind',kind,'known',known,'archived',archived,'condition',asset_condition,'blocks',json(blocks_json))) FROM (SELECT * FROM assignment_asset_resource_details d WHERE d.organization_id=a.organization_id AND d.assignment_id=a.id ORDER BY asset_id)), '[]'))) guard_json FROM field_assignments a;
CREATE VIEW assignment_asset_conflicts AS
 SELECT x.organization_id,x.assignment_id,x.asset_id,y.assignment_id other_assignment_id FROM assignment_asset_links x
 JOIN field_assets f ON f.organization_id=x.organization_id AND f.id=x.asset_id
 JOIN field_assignments a ON a.organization_id=x.organization_id AND a.id=x.assignment_id
 JOIN assignment_asset_links y ON y.organization_id=x.organization_id AND y.asset_id=x.asset_id AND y.assignment_id<>x.assignment_id
 JOIN field_assignments b ON b.organization_id=y.organization_id AND b.id=y.assignment_id
 WHERE a.status<>'cancelled' AND b.status<>'cancelled' AND a.assignment_date=b.assignment_date AND COALESCE(a.start_time,'07:00')<COALESCE(b.end_time,'16:00') AND COALESCE(b.start_time,'07:00')<COALESCE(a.end_time,'16:00');
CREATE VIEW assignment_asset_unavailable AS
 SELECT d.organization_id,d.assignment_id,d.asset_id FROM assignment_asset_resource_details d JOIN field_assignments a ON a.organization_id=d.organization_id AND a.id=d.assignment_id
 WHERE a.status<>'cancelled' AND d.known AND (d.archived OR d.asset_condition IN ('Immobilisé','Réparation nécessaire','Hors service','Indisponible') OR EXISTS(SELECT 1 FROM json_each(d.blocks_json) b WHERE json_extract(b.value,'$.resolutionId') IS NULL));
CREATE TRIGGER assignment_asset_version_guard BEFORE INSERT ON assignment_asset_versions BEGIN
 SELECT CASE WHEN NEW.version<>(SELECT COALESCE(MAX(version),0)+1 FROM assignment_asset_versions WHERE organization_id=NEW.organization_id AND assignment_id=NEW.assignment_id) OR NOT EXISTS(SELECT 1 FROM field_assignments a JOIN assignment_asset_guards g ON g.organization_id=a.organization_id AND g.assignment_id=a.id WHERE a.organization_id=NEW.organization_id AND a.id=NEW.assignment_id AND a.status<>'cancelled' AND g.guard_json=NEW.assignment_guard_json) THEN RAISE(ABORT,'assignment_asset_stale') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.asset_ids_json) j WHERE j.type<>'text' OR NOT EXISTS(SELECT 1 FROM field_assets f WHERE f.organization_id=NEW.organization_id AND f.id=j.value AND f.archived_at IS NULL)) OR json_array_length(NEW.asset_ids_json)<>(SELECT COUNT(DISTINCT value) FROM json_each(NEW.asset_ids_json)) OR json_array_length(NEW.asset_ids_json)>100 THEN RAISE(ABORT,'assignment_asset_unknown') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM assignment_asset_out o WHERE o.organization_id=NEW.organization_id AND o.assignment_id=NEW.assignment_id AND o.asset_id NOT IN (SELECT value FROM json_each(NEW.asset_ids_json)) AND NOT EXISTS(SELECT 1 FROM field_assignments a WHERE a.organization_id=NEW.organization_id AND a.id=NEW.assignment_id AND (a.vehicle_id=o.asset_id OR a.pack_id=o.asset_id))) THEN RAISE(ABORT,'assignment_asset_out') END;
END;
CREATE TRIGGER assignment_asset_version_apply AFTER INSERT ON assignment_asset_versions BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM assignment_asset_conflicts WHERE organization_id=NEW.organization_id AND assignment_id=NEW.assignment_id) THEN RAISE(ABORT,'assignment_asset_conflict') END;
 -- Replacing extras must remain possible when an unchanged legacy vehicle/pack is broken.
 -- Full assignment availability is still required by legacy edits and publication.
 SELECT CASE WHEN EXISTS(SELECT 1 FROM assignment_asset_unavailable WHERE organization_id=NEW.organization_id AND assignment_id=NEW.assignment_id AND asset_id IN (SELECT CAST(value AS TEXT) FROM json_each(NEW.asset_ids_json))) THEN RAISE(ABORT,'assignment_asset_blocked') END;
END;
CREATE TRIGGER assignment_asset_assignment_insert AFTER INSERT ON field_assignments WHEN NEW.status<>'cancelled' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM assignment_asset_conflicts WHERE organization_id=NEW.organization_id AND assignment_id=NEW.id) THEN RAISE(ABORT,'assignment_asset_conflict') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM assignment_asset_unavailable WHERE organization_id=NEW.organization_id AND assignment_id=NEW.id) THEN RAISE(ABORT,'assignment_asset_blocked') END;
END;
CREATE TRIGGER assignment_asset_assignment_update AFTER UPDATE OF vehicle_id,pack_id,assignment_date,start_time,end_time,status,project_id,organization_id ON field_assignments BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM assignment_asset_conflicts WHERE organization_id=NEW.organization_id AND assignment_id=NEW.id) THEN RAISE(ABORT,'assignment_asset_conflict') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM assignment_asset_unavailable WHERE organization_id=NEW.organization_id AND assignment_id=NEW.id) THEN RAISE(ABORT,'assignment_asset_blocked') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM assignment_asset_out o WHERE o.organization_id=NEW.organization_id AND o.assignment_id=NEW.id AND NOT EXISTS(SELECT 1 FROM assignment_asset_links l WHERE l.organization_id=o.organization_id AND l.assignment_id=o.assignment_id AND l.asset_id=o.asset_id)) THEN RAISE(ABORT,'assignment_asset_out') END;
END;
CREATE TRIGGER assignment_asset_archive BEFORE UPDATE OF archived_at ON field_assets WHEN NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM assignment_asset_links l JOIN field_assignments a ON a.organization_id=l.organization_id AND a.id=l.assignment_id WHERE l.organization_id=OLD.organization_id AND l.asset_id=OLD.id AND a.status<>'cancelled') OR EXISTS(SELECT 1 FROM assignment_asset_out WHERE organization_id=OLD.organization_id AND asset_id=OLD.id) THEN RAISE(ABORT,'assignment_asset_out') END;
END;
CREATE TRIGGER assignment_asset_event_guard BEFORE INSERT ON assignment_asset_events BEGIN
 SELECT CASE WHEN NEW.kind='take' AND (NOT EXISTS(SELECT 1 FROM field_assignments a JOIN assignment_asset_guards g ON g.organization_id=a.organization_id AND g.assignment_id=a.id JOIN assignment_asset_links l ON l.organization_id=a.organization_id AND l.assignment_id=a.id JOIN field_assets f ON f.organization_id=l.organization_id AND f.id=l.asset_id AND f.archived_at IS NULL WHERE a.organization_id=NEW.organization_id AND a.id=NEW.assignment_id AND a.status<>'cancelled' AND a.project_id=NEW.project_id AND a.people_json=NEW.participants_json AND a.assignment_date=NEW.business_date AND l.asset_id=NEW.asset_id AND g.guard_json=NEW.assignment_guard_json) OR EXISTS(SELECT 1 FROM assignment_asset_out WHERE organization_id=NEW.organization_id AND asset_id=NEW.asset_id) OR EXISTS(SELECT 1 FROM assignment_asset_unavailable WHERE organization_id=NEW.organization_id AND assignment_id=NEW.assignment_id AND asset_id=NEW.asset_id)) THEN RAISE(ABORT,'assignment_asset_unavailable') END;
 SELECT CASE WHEN NEW.kind='return' AND NOT EXISTS(SELECT 1 FROM assignment_asset_out t WHERE t.organization_id=NEW.organization_id AND t.id=NEW.take_id AND t.assignment_id=NEW.assignment_id AND t.asset_id=NEW.asset_id AND t.project_id=NEW.project_id AND t.participants_json=NEW.participants_json) THEN RAISE(ABORT,'assignment_asset_return_stale') END;
END;
CREATE TRIGGER assignment_asset_version_update BEFORE UPDATE ON assignment_asset_versions BEGIN SELECT RAISE(ABORT,'assignment_asset_immutable'); END;
CREATE TRIGGER assignment_asset_version_delete BEFORE DELETE ON assignment_asset_versions BEGIN SELECT RAISE(ABORT,'assignment_asset_immutable'); END;
CREATE TRIGGER assignment_asset_event_update BEFORE UPDATE ON assignment_asset_events BEGIN SELECT RAISE(ABORT,'assignment_asset_immutable'); END;
CREATE TRIGGER assignment_asset_event_delete BEFORE DELETE ON assignment_asset_events BEGIN SELECT RAISE(ABORT,'assignment_asset_immutable'); END;
CREATE TRIGGER asset_availability_block_update BEFORE UPDATE ON asset_availability_blocks BEGIN SELECT RAISE(ABORT,'assignment_asset_immutable'); END;
CREATE TRIGGER asset_availability_block_delete BEFORE DELETE ON asset_availability_blocks BEGIN SELECT RAISE(ABORT,'assignment_asset_immutable'); END;
CREATE TRIGGER asset_availability_resolution_update BEFORE UPDATE ON asset_availability_resolutions BEGIN SELECT RAISE(ABORT,'assignment_asset_immutable'); END;
CREATE TRIGGER asset_availability_resolution_delete BEFORE DELETE ON asset_availability_resolutions BEGIN SELECT RAISE(ABORT,'assignment_asset_immutable'); END;
CREATE TRIGGER asset_availability_resolution_guard BEFORE INSERT ON asset_availability_resolutions WHEN EXISTS(SELECT 1 FROM asset_availability_resolutions WHERE organization_id=NEW.organization_id AND block_id=NEW.block_id) BEGIN SELECT RAISE(ABORT,'assignment_asset_stale'); END;
CREATE TRIGGER work_packet_assignment_assets_guard BEFORE INSERT ON work_packet_issues BEGIN
 SELECT CASE WHEN COALESCE(json_extract(NEW.task_guard_json,'$.preparation.assets'),'null')<>COALESCE((SELECT g.guard_json FROM task_preparations p JOIN assignment_asset_guards g ON g.organization_id=p.organization_id AND g.assignment_id=p.assignment_id WHERE p.organization_id=NEW.organization_id AND p.task_id=NEW.task_id ORDER BY p.version DESC LIMIT 1),'null') THEN RAISE(ABORT,'assignment_asset_packet_stale') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM task_preparations p JOIN assignment_asset_unavailable u ON u.organization_id=p.organization_id AND u.assignment_id=p.assignment_id WHERE p.organization_id=NEW.organization_id AND p.task_id=NEW.task_id AND p.version=(SELECT MAX(version) FROM task_preparations WHERE organization_id=p.organization_id AND task_id=p.task_id)) THEN RAISE(ABORT,'assignment_asset_blocked') END;
END;
