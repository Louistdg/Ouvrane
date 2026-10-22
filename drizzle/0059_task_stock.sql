-- Keep the historical unlocated reserved amount. New reservations are an immutable ledger.
CREATE TABLE stock_reserved_baselines (
 organization_id TEXT NOT NULL,stock_item_id TEXT NOT NULL,reserved REAL NOT NULL,
 PRIMARY KEY(organization_id,stock_item_id),FOREIGN KEY(organization_id,stock_item_id) REFERENCES field_stock_items(organization_id,id)
);
INSERT INTO stock_reserved_baselines SELECT organization_id,id,reserved FROM field_stock_items;
CREATE TRIGGER stock_reserved_baseline_insert AFTER INSERT ON field_stock_items BEGIN
 INSERT INTO stock_reserved_baselines VALUES(NEW.organization_id,NEW.id,NEW.reserved);
END;
CREATE TRIGGER stock_reserved_baseline_update BEFORE UPDATE ON stock_reserved_baselines BEGIN SELECT RAISE(ABORT,'task_stock_immutable'); END;
CREATE TRIGGER stock_reserved_baseline_delete BEFORE DELETE ON stock_reserved_baselines BEGIN SELECT RAISE(ABORT,'task_stock_immutable'); END;
CREATE TABLE task_stock_reservations (
 organization_id TEXT NOT NULL,id TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES project_tasks(id),project_id TEXT NOT NULL,
 preparation_id TEXT NOT NULL,assignment_id TEXT NOT NULL,assignment_guard_json TEXT NOT NULL,materials_json TEXT NOT NULL,
 material_index INTEGER NOT NULL CHECK(material_index>=0 AND material_index<60),stock_item_id TEXT NOT NULL,location_id TEXT NOT NULL,
 unit TEXT NOT NULL,item_name TEXT NOT NULL,location_name TEXT NOT NULL,
 quantity_milli INTEGER NOT NULL CHECK(typeof(quantity_milli)='integer' AND quantity_milli>0 AND quantity_milli<=1000000000000000),
 operation_key TEXT NOT NULL,request_json TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES profiles(id),created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,operation_key),
 FOREIGN KEY(organization_id,preparation_id) REFERENCES task_preparations(organization_id,id),
 FOREIGN KEY(organization_id,assignment_id) REFERENCES field_assignments(organization_id,id),
 FOREIGN KEY(organization_id,stock_item_id) REFERENCES field_stock_items(organization_id,id),
 FOREIGN KEY(organization_id,location_id) REFERENCES stock_locations(organization_id,id)
);
CREATE INDEX task_stock_task_idx ON task_stock_reservations(organization_id,task_id,created_at);
CREATE INDEX task_stock_item_idx ON task_stock_reservations(organization_id,stock_item_id,location_id);
ALTER TABLE field_stock_movements ADD COLUMN task_reservation_id TEXT;
ALTER TABLE field_stock_movements ADD COLUMN task_reservation_expected_milli INTEGER;
CREATE TABLE task_stock_events (
 organization_id TEXT NOT NULL,id TEXT NOT NULL,reservation_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('release','consume')),
 quantity_milli INTEGER NOT NULL CHECK(typeof(quantity_milli)='integer' AND quantity_milli>0),expected_remaining_milli INTEGER NOT NULL,
 movement_id TEXT UNIQUE,operation_key TEXT NOT NULL,request_json TEXT NOT NULL,note TEXT NOT NULL,
 created_by TEXT REFERENCES profiles(id),created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,operation_key),
 FOREIGN KEY(organization_id,reservation_id) REFERENCES task_stock_reservations(organization_id,id),
 FOREIGN KEY(movement_id) REFERENCES field_stock_movements(id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((kind='consume' AND movement_id IS NOT NULL AND created_by IS NOT NULL) OR (kind='release' AND movement_id IS NULL))
);
CREATE INDEX task_stock_event_reservation_idx ON task_stock_events(organization_id,reservation_id);
CREATE VIEW task_stock_remaining AS
 SELECT r.*,r.quantity_milli-COALESCE((SELECT SUM(e.quantity_milli) FROM task_stock_events e WHERE e.organization_id=r.organization_id AND e.reservation_id=r.id),0) remaining_milli,
 COALESCE((SELECT SUM(e.quantity_milli) FROM task_stock_events e WHERE e.organization_id=r.organization_id AND e.reservation_id=r.id AND e.kind='consume'),0) consumed_milli
 FROM task_stock_reservations r;
CREATE TRIGGER task_stock_reservation_update BEFORE UPDATE ON task_stock_reservations BEGIN SELECT RAISE(ABORT,'task_stock_immutable'); END;
CREATE TRIGGER task_stock_reservation_delete BEFORE DELETE ON task_stock_reservations BEGIN SELECT RAISE(ABORT,'task_stock_immutable'); END;
CREATE TRIGGER task_stock_event_update BEFORE UPDATE ON task_stock_events BEGIN SELECT RAISE(ABORT,'task_stock_immutable'); END;
CREATE TRIGGER task_stock_event_delete BEFORE DELETE ON task_stock_events BEGIN SELECT RAISE(ABORT,'task_stock_immutable'); END;
CREATE TRIGGER task_stock_movement_update BEFORE UPDATE ON field_stock_movements WHEN OLD.task_reservation_id IS NOT NULL OR NEW.task_reservation_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'task_stock_immutable'); END;
CREATE TRIGGER task_stock_movement_delete BEFORE DELETE ON field_stock_movements WHEN OLD.task_reservation_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'task_stock_immutable'); END;
CREATE TRIGGER task_stock_reservation_guard BEFORE INSERT ON task_stock_reservations BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM project_tasks t JOIN task_preparations p ON p.organization_id=t.organization_id AND p.task_id=t.id
  JOIN task_preparation_assignment_guards a ON a.organization_id=p.organization_id AND a.id=p.assignment_id
  WHERE t.organization_id=NEW.organization_id AND t.id=NEW.task_id AND t.project_id=NEW.project_id AND t.status<>'done' AND t.archived_at IS NULL
  AND t.materials_json=NEW.materials_json AND json_extract(t.materials_json,'$['||NEW.material_index||'].quantity')>0
  AND p.id=NEW.preparation_id AND p.version=(SELECT MAX(version) FROM task_preparations WHERE organization_id=p.organization_id AND task_id=p.task_id)
  AND a.id=NEW.assignment_id AND a.status<>'cancelled' AND a.project_id=NEW.project_id AND json(a.guard_json)=json(NEW.assignment_guard_json)
 ) THEN RAISE(ABORT,'task_stock_stale') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM field_stock_items i JOIN stock_locations l ON l.organization_id=i.organization_id AND l.id=NEW.location_id
  WHERE i.organization_id=NEW.organization_id AND i.id=NEW.stock_item_id AND i.archived_at IS NULL AND l.status='active'
  AND NEW.unit=CASE lower(trim(i.unit)) WHEN 'm²' THEN 'm2' WHEN 'pièce' THEN 'pc' WHEN 'pièces' THEN 'pc' ELSE lower(trim(i.unit)) END
  AND NEW.unit=CASE lower(trim(json_extract(NEW.materials_json,'$['||NEW.material_index||'].unit'))) WHEN 'm²' THEN 'm2' WHEN 'pièce' THEN 'pc' WHEN 'pièces' THEN 'pc' ELSE lower(trim(json_extract(NEW.materials_json,'$['||NEW.material_index||'].unit'))) END
 ) OR NEW.unit='' OR (NEW.unit='pc' AND NEW.quantity_milli%1000<>0) THEN RAISE(ABORT,'task_stock_unit') END;
 SELECT CASE WHEN NEW.quantity_milli>1000*(SELECT quantity-reserved FROM field_stock_items WHERE organization_id=NEW.organization_id AND id=NEW.stock_item_id)+0.00001
 OR NEW.quantity_milli>1000*COALESCE((SELECT quantity FROM stock_balances WHERE organization_id=NEW.organization_id AND stock_item_id=NEW.stock_item_id AND location_id=NEW.location_id),0)-COALESCE((SELECT SUM(remaining_milli) FROM task_stock_remaining WHERE organization_id=NEW.organization_id AND stock_item_id=NEW.stock_item_id AND location_id=NEW.location_id),0)+0.00001
 THEN RAISE(ABORT,'task_stock_insufficient') END;
 SELECT CASE WHEN NEW.quantity_milli+COALESCE((SELECT SUM(remaining_milli+consumed_milli) FROM task_stock_remaining WHERE organization_id=NEW.organization_id AND task_id=NEW.task_id AND material_index=NEW.material_index),0)>1000*json_extract(NEW.materials_json,'$['||NEW.material_index||'].quantity')+0.00001
 THEN RAISE(ABORT,'task_stock_need_exceeded') END;
END;
CREATE TRIGGER task_stock_event_guard BEFORE INSERT ON task_stock_events BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM task_stock_remaining WHERE organization_id=NEW.organization_id AND id=NEW.reservation_id AND remaining_milli=NEW.expected_remaining_milli AND remaining_milli>=NEW.quantity_milli)
 THEN RAISE(ABORT,'task_stock_event_stale') END;
 SELECT CASE WHEN NEW.kind='consume' AND NOT EXISTS(
  SELECT 1 FROM task_stock_remaining r JOIN project_tasks t ON t.organization_id=r.organization_id AND t.id=r.task_id
  JOIN task_preparations p ON p.organization_id=r.organization_id AND p.id=r.preparation_id
  JOIN task_preparation_assignment_guards a ON a.organization_id=r.organization_id AND a.id=r.assignment_id
  WHERE r.organization_id=NEW.organization_id AND r.id=NEW.reservation_id AND t.project_id=r.project_id AND t.archived_at IS NULL AND t.status<>'done'
  AND t.materials_json=r.materials_json AND p.id=(SELECT id FROM task_preparations WHERE organization_id=r.organization_id AND task_id=r.task_id ORDER BY version DESC LIMIT 1)
  AND a.status<>'cancelled' AND a.project_id=r.project_id AND json(a.guard_json)=json(r.assignment_guard_json)
 ) THEN RAISE(ABORT,'task_stock_event_stale') END;
END;
CREATE TRIGGER task_stock_reservation_apply AFTER INSERT ON task_stock_reservations BEGIN
 UPDATE field_stock_items SET reserved=(SELECT reserved FROM stock_reserved_baselines WHERE organization_id=NEW.organization_id AND stock_item_id=NEW.stock_item_id)+(SELECT SUM(remaining_milli)/1000.0 FROM task_stock_remaining WHERE organization_id=NEW.organization_id AND stock_item_id=NEW.stock_item_id),updated_by=NEW.created_by,updated_at=NEW.created_at WHERE organization_id=NEW.organization_id AND id=NEW.stock_item_id;
END;
CREATE TRIGGER task_stock_event_apply AFTER INSERT ON task_stock_events BEGIN
 UPDATE field_stock_items SET reserved=(SELECT reserved FROM stock_reserved_baselines WHERE organization_id=NEW.organization_id AND stock_item_id=field_stock_items.id)+COALESCE((SELECT SUM(remaining_milli)/1000.0 FROM task_stock_remaining WHERE organization_id=NEW.organization_id AND stock_item_id=field_stock_items.id),0),updated_by=COALESCE(NEW.created_by,updated_by),updated_at=NEW.created_at
 WHERE organization_id=NEW.organization_id AND id=(SELECT stock_item_id FROM task_stock_reservations WHERE organization_id=NEW.organization_id AND id=NEW.reservation_id);
END;
-- This single BEFORE trigger frees the consumed portion, then protects the rest.
CREATE TRIGGER task_stock_movement_guard BEFORE INSERT ON field_stock_movements BEGIN
 SELECT CASE WHEN NEW.source_location_id IS NOT NULL AND NEW.quantity>COALESCE((SELECT quantity FROM stock_balances WHERE organization_id=NEW.organization_id AND stock_item_id=NEW.stock_item_id AND location_id=NEW.source_location_id),0) THEN RAISE(ABORT,'stock_insufficient') END;
 SELECT CASE WHEN NEW.task_reservation_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM task_stock_reservations r WHERE r.organization_id=NEW.organization_id AND r.id=NEW.task_reservation_id AND r.stock_item_id=NEW.stock_item_id AND r.location_id=NEW.source_location_id AND r.project_id=NEW.project_id
 AND NEW.movement_type='sortie chantier' AND NEW.destination_location_id IS NULL AND NEW.idempotency_key IS NOT NULL AND NEW.task_reservation_expected_milli IS NOT NULL
 AND abs(NEW.quantity*1000-round(NEW.quantity*1000))<0.00001 AND (r.unit<>'pc' OR NEW.quantity=round(NEW.quantity))
 ) THEN RAISE(ABORT,'task_stock_stale') END;
 SELECT CASE WHEN NEW.task_reservation_id IS NOT NULL AND NEW.unit_cost_cents<>(SELECT unit_cost_cents FROM field_stock_items WHERE organization_id=NEW.organization_id AND id=NEW.stock_item_id) THEN RAISE(ABORT,'task_stock_cost_stale') END;
 INSERT INTO task_stock_events(organization_id,id,reservation_id,kind,quantity_milli,expected_remaining_milli,movement_id,operation_key,request_json,note,created_by,created_at)
 SELECT NEW.organization_id,'consume:'||NEW.id,NEW.task_reservation_id,'consume',CAST(round(NEW.quantity*1000) AS INTEGER),NEW.task_reservation_expected_milli,NEW.id,NEW.idempotency_key,'{}',NEW.reason,NEW.created_by,NEW.created_at WHERE NEW.task_reservation_id IS NOT NULL;
 SELECT CASE WHEN NEW.source_location_id IS NOT NULL AND (
 NEW.quantity>COALESCE((SELECT quantity FROM stock_balances WHERE organization_id=NEW.organization_id AND stock_item_id=NEW.stock_item_id AND location_id=NEW.source_location_id),0)-COALESCE((SELECT SUM(remaining_milli)/1000.0 FROM task_stock_remaining WHERE organization_id=NEW.organization_id AND stock_item_id=NEW.stock_item_id AND location_id=NEW.source_location_id),0)+0.00000001
 OR NEW.destination_location_id IS NULL AND NEW.quantity>(SELECT quantity-reserved FROM field_stock_items WHERE organization_id=NEW.organization_id AND id=NEW.stock_item_id)+0.00000001
 ) THEN RAISE(ABORT,'task_stock_reserved') END;
END;
CREATE TRIGGER task_stock_projection_guard BEFORE UPDATE ON field_stock_items BEGIN
 SELECT CASE WHEN abs(NEW.reserved-((SELECT reserved FROM stock_reserved_baselines WHERE organization_id=OLD.organization_id AND stock_item_id=OLD.id)+COALESCE((SELECT SUM(remaining_milli)/1000.0 FROM task_stock_remaining WHERE organization_id=OLD.organization_id AND stock_item_id=OLD.id),0)))>0.00000001
 OR (NEW.quantity<OLD.quantity AND NEW.quantity+0.00000001<NEW.reserved)
 OR ((NEW.unit<>OLD.unit OR NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL) AND OLD.reserved>0)
 THEN RAISE(ABORT,'task_stock_reserved') END;
END;
CREATE TRIGGER task_stock_location_guard BEFORE UPDATE OF status ON stock_locations WHEN NEW.status<>'active' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM task_stock_remaining WHERE organization_id=OLD.organization_id AND location_id=OLD.id AND remaining_milli>0) THEN RAISE(ABORT,'task_stock_reserved') END;
END;
-- Keep a consumed line's identity and unit, and never lower its need below actual usage.
CREATE TRIGGER task_stock_material_history BEFORE UPDATE OF materials_json ON project_tasks BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM task_stock_remaining r WHERE r.organization_id=OLD.organization_id AND r.task_id=OLD.id AND r.consumed_milli>0 AND (
 COALESCE(json_extract(NEW.materials_json,'$['||r.material_index||'].name'),'')<>COALESCE(json_extract(r.materials_json,'$['||r.material_index||'].name'),'')
 OR COALESCE(json_extract(NEW.materials_json,'$['||r.material_index||'].unit'),'')<>COALESCE(json_extract(r.materials_json,'$['||r.material_index||'].unit'),'')
 OR COALESCE(json_extract(NEW.materials_json,'$['||r.material_index||'].quantity'),0)*1000+0.00001<(SELECT SUM(consumed_milli) FROM task_stock_remaining WHERE organization_id=r.organization_id AND task_id=r.task_id AND material_index=r.material_index)
 )) THEN RAISE(ABORT,'task_stock_material_history') END;
END;
CREATE TRIGGER task_stock_task_changed AFTER UPDATE ON project_tasks
 WHEN NEW.materials_json<>OLD.materials_json OR NEW.status='done' OR NEW.archived_at IS NOT OLD.archived_at OR NEW.project_id<>OLD.project_id BEGIN
 INSERT INTO task_stock_events SELECT r.organization_id,'release:task:'||r.id,r.id,'release',r.remaining_milli,r.remaining_milli,NULL,'release:task:'||r.id,'{}','Tâche modifiée ou clôturée',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM task_stock_remaining r WHERE r.organization_id=NEW.organization_id AND r.task_id=NEW.id AND r.remaining_milli>0;
END;
CREATE TRIGGER task_stock_preparation_changed AFTER INSERT ON task_preparations BEGIN
 INSERT INTO task_stock_events SELECT r.organization_id,'release:preparation:'||r.id,r.id,'release',r.remaining_milli,r.remaining_milli,NULL,'release:preparation:'||r.id,'{}','Préparation modifiée',NEW.created_by,NEW.created_at FROM task_stock_remaining r WHERE r.organization_id=NEW.organization_id AND r.task_id=NEW.task_id AND r.preparation_id<>NEW.id AND r.remaining_milli>0;
END;
CREATE TRIGGER task_stock_assignment_changed AFTER UPDATE ON field_assignments WHEN NEW.updated_at<>OLD.updated_at OR NEW.status<>OLD.status OR NEW.project_id<>OLD.project_id OR NEW.assignment_date<>OLD.assignment_date OR NEW.people_json<>OLD.people_json OR NEW.team_id<>OLD.team_id OR NEW.start_time IS NOT OLD.start_time OR NEW.end_time IS NOT OLD.end_time OR NEW.vehicle_id IS NOT OLD.vehicle_id OR NEW.pack_id IS NOT OLD.pack_id BEGIN
 INSERT INTO task_stock_events SELECT r.organization_id,'release:assignment:'||r.id,r.id,'release',r.remaining_milli,r.remaining_milli,NULL,'release:assignment:'||r.id,'{}','Affectation modifiée ou annulée',NULL,NEW.updated_at FROM task_stock_remaining r WHERE r.organization_id=NEW.organization_id AND r.assignment_id=NEW.id AND r.remaining_milli>0;
END;
CREATE TRIGGER work_packet_task_stock_guard BEFORE INSERT ON work_packet_issues BEGIN
 SELECT CASE WHEN COALESCE(json_extract(NEW.task_guard_json,'$.stock'),'[]')<>(SELECT json_group_array(json_object('id',id,'remainingMilli',remaining_milli)) FROM (SELECT id,remaining_milli FROM task_stock_remaining WHERE organization_id=NEW.organization_id AND task_id=NEW.task_id AND remaining_milli>0 ORDER BY id))
 THEN RAISE(ABORT,'task_stock_packet_stale') END;
END;
