import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync} from 'node:fs';
const db=new DatabaseSync(':memory:');
db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE organizations(id TEXT PRIMARY KEY);CREATE TABLE profiles(id TEXT PRIMARY KEY);CREATE TABLE permissions(code TEXT PRIMARY KEY,description TEXT);INSERT INTO organizations VALUES('org'),('foreign');INSERT INTO profiles VALUES('boss'),('other-editor');`);
for(const file of ['0011_field_operations.sql','0012_stock_locations.sql'])db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
db.exec(`ALTER TABLE field_assignments ADD COLUMN start_time TEXT DEFAULT '07:00';ALTER TABLE field_assignments ADD COLUMN end_time TEXT DEFAULT '16:00';ALTER TABLE field_assignments ADD COLUMN status TEXT DEFAULT 'planned';ALTER TABLE field_assignments ADD COLUMN reason TEXT DEFAULT '';ALTER TABLE field_assignments ADD COLUMN assignment_type TEXT DEFAULT 'team';CREATE TABLE project_tasks(id TEXT PRIMARY KEY,organization_id TEXT,project_id TEXT,status TEXT,materials_json TEXT,archived_at TEXT);CREATE TABLE work_packet_issues(organization_id TEXT,id TEXT,task_id TEXT,project_id TEXT,snapshot_json TEXT,task_guard_json TEXT);`);
const assignment=db.prepare('INSERT INTO field_assignments(id,organization_id,assignment_date,team_id,project_id,people_json,subcontractor,created_by,created_at,updated_by,updated_at,start_time,end_time,status,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
for(const [id,org]of [['A','org'],['B','org'],['foreign-only','foreign']])assignment.run(id,org,'2026-10-20','team-'+id,'project','["person-'+id+'"]','Initial','boss','now','boss','now','07:00','12:00','planned','Original reason');
for(const file of ['0057_task_preparations.sql','0059_task_stock.sql','0060_assignment_assets.sql'])db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
const migration=new URL('../drizzle/0061_planning_replan_cas.sql',import.meta.url);if(existsSync(migration))db.exec(readFileSync(migration,'utf8'));
const migrated=!!db.prepare("SELECT name FROM sqlite_master WHERE name='planning_replan_assignment_guards'").get();
const selected=()=>db.prepare('SELECT a.*,g.guard_json FROM field_assignments a JOIN '+(migrated?'planning_replan_assignment_guards':'task_preparation_assignment_guards')+' g ON g.organization_id=a.organization_id AND g.id=a.id WHERE a.organization_id=? ORDER BY a.id').all('org');
const initial=selected();
const insertCheck=(list,key)=>{if(!migrated)return db.prepare('SELECT 1');return{run:()=>db.prepare('INSERT INTO planning_replan_checks VALUES(?,?,?,?,?,?)').run('org','replan-check:'+key,key,JSON.stringify(list.map(row=>({id:String(row.id),guardJson:row.guard_json}))),'boss','later')}};
function replan(list,key,first=insertCheck(list,key)){
 db.exec('BEGIN');try{first.run();for(const row of list)db.prepare("UPDATE field_assignments SET status='cancelled' WHERE organization_id=? AND id=?").run('org',row.id);for(const row of list)db.prepare('UPDATE field_assignments SET assignment_date=?,project_id=?,team_id=?,reason=?,status=?,updated_by=?,updated_at=? WHERE organization_id=? AND id=?').run('2026-10-21',row.project_id,row.team_id,row.reason,row.status,'boss','later','org',row.id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
}
db.exec("UPDATE field_assignments SET project_id='concurrent-project' WHERE organization_id='org' AND id='A'");
assert.throws(()=>replan(initial,'stale-project'),/planning_replan_stale/,'A concurrent project edit between SELECT and the atomic replan must reject the whole replan');
assert.equal(db.prepare("SELECT project_id FROM field_assignments WHERE organization_id='org' AND id='A'").get().project_id,'concurrent-project','The concurrent edit is never overwritten');
assert.equal(db.prepare("SELECT assignment_date FROM field_assignments WHERE organization_id='org' AND id='B'").get().assignment_date,'2026-10-20','No other selected row is partially replanned');
db.exec("UPDATE field_assignments SET project_id='project' WHERE organization_id='org' AND id='A'");
const {planningReplanCheckStatement}=await import('../worker/planning-replan-guard.js');
const ctx={organizationId:'org',uid:'boss'},env={DB:{prepare(sql){return{bind(...values){return{run:()=>db.prepare(sql).run(...values)}}}}}};
const helper=(list,key)=>planningReplanCheckStatement(env,ctx,list,key,'later');
db.exec(`INSERT INTO stock_locations VALUES('depot','org','Depot','warehouse','active','boss','now','boss','now');
INSERT INTO field_stock_items(id,organization_id,name,quantity,reserved,unit,unit_cost_cents,created_by,created_at,updated_by,updated_at) VALUES('item','org','Reserved material',100,0,'m2',1234,'boss','now','boss','now');
INSERT INTO stock_balances VALUES('org','item','depot',100,'now');`);
for(const id of ['A','B']){
 db.prepare('INSERT INTO project_tasks VALUES(?,?,?,?,?,NULL)').run('task-'+id,'org','project','todo','[{"name":"Material","quantity":20,"unit":"m2"}]');
 const g=db.prepare('SELECT guard_json FROM task_preparation_assignment_guards WHERE organization_id=? AND id=?').get('org',id).guard_json;
 db.prepare('INSERT INTO task_preparations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('org','prep-'+id,'task-'+id,'project',1,id,g,'prep-op-'+id,'{}','boss','now');
}
let reservation=0;
function hold(id){
 const g=db.prepare('SELECT guard_json FROM task_preparation_assignment_guards WHERE organization_id=? AND id=?').get('org',id).guard_json,n=++reservation;
 db.prepare('INSERT INTO task_stock_reservations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('org','hold-'+n,'task-'+id,'project','prep-'+id,id,g,'[{"name":"Material","quantity":20,"unit":"m2"}]',0,'item','depot','m2','Reserved material','Depot',10000,'hold-op-'+n,'{}','boss','now');
}
const remaining=id=>db.prepare('SELECT COALESCE(SUM(remaining_milli),0) quantity FROM task_stock_remaining WHERE organization_id=? AND assignment_id=?').get('org',id).quantity;
const fullState=()=>({assignments:db.prepare('SELECT * FROM field_assignments ORDER BY organization_id,id').all(),stock:db.prepare('SELECT quantity,reserved FROM field_stock_items').all(),events:db.prepare('SELECT * FROM task_stock_events ORDER BY id').all(),checks:db.prepare('SELECT * FROM planning_replan_checks ORDER BY id').all()});
const mutations=[['reason','Concurrent reason'],['subcontractor','Concurrent subcontractor'],['updated_by','other-editor'],['assignment_type','individual'],['project_id','concurrent-project'],['people_json','["different-person"]'],['status','cancelled'],['start_time','08:00'],['end_time','11:00'],['team_id','different-team'],['assignment_date','2026-10-22'],['vehicle_id','legacy-unknown'],['pack_id','legacy-pack']];
for(const [column,value]of mutations){
 const before=db.prepare("SELECT * FROM field_assignments WHERE organization_id='org' AND id='A'").get();if(!remaining('A'))hold('A');if(!remaining('B'))hold('B');
 const captured=selected();db.prepare('UPDATE field_assignments SET '+column+'=? WHERE organization_id=? AND id=?').run(value,'org','A');
 const concurrent=fullState(),statement=helper(captured,'concurrent-'+column);assert.equal(typeof statement.then,'undefined','The helper returns a bound statement synchronously');
 assert.throws(()=>replan(captured,'concurrent-'+column,statement),/planning_replan_stale/,'The SQL check detects a concurrent '+column+' edit');
 assert.deepEqual(fullState(),concurrent,'Rejected '+column+' replan changes neither planning, assertions nor stock events');
 assert.ok(remaining('B')>0,'The untouched crew keeps its real stock reservation');
 db.prepare('UPDATE field_assignments SET '+column+'=? WHERE organization_id=? AND id=?').run(before[column],'org','A');
}
const fresh=selected(),freshState=fullState();
const raw=(value,key)=>({run:()=>db.prepare('INSERT INTO planning_replan_checks VALUES(?,?,?,?,?,?)').run('org','check-'+key,key,typeof value==='string'?value:JSON.stringify(value),'boss','later')});
for(const [name,value]of [
 ['empty',[]],['object',{}],['malformed','not-json'],['scalar',[null]],['numeric-id',[{id:42,guardJson:fresh[0].guard_json}]],['missing-id',[{guardJson:fresh[0].guard_json}]],
 ['missing-row',[{id:'missing',guardJson:fresh[0].guard_json}]],['foreign-row',[{id:'foreign-only',guardJson:db.prepare("SELECT guard_json FROM planning_replan_assignment_guards WHERE organization_id='foreign'").get().guard_json}]],
 ['duplicate',fresh.flatMap(row=>[{id:row.id,guardJson:row.guard_json},{id:row.id,guardJson:row.guard_json}])],['old-guard',initial.map(row=>({id:row.id,guardJson:'{}'}))]
]){assert.throws(()=>replan(fresh,name,raw(value,name)),/planning_replan_stale/,'Invalid '+name+' guard is rejected inside SQL');assert.deepEqual(fullState(),freshState,'Invalid '+name+' assertion leaves the entire database state unchanged')}
assignment.run('deleted','org','2026-10-20','team-deleted','project','["person-deleted"]','Initial','boss','now','boss','now','07:00','12:00','planned','Original reason');
const withDeleted=selected();db.exec("DELETE FROM field_assignments WHERE organization_id='org' AND id='deleted'");const withoutDeleted=fullState();assert.throws(()=>replan(withDeleted,'deleted-row',helper(withDeleted,'deleted-row')),/planning_replan_stale/);assert.deepEqual(fullState(),withoutDeleted);
assert.throws(()=>helper(db.prepare("SELECT a.*,g.guard_json FROM field_assignments a JOIN planning_replan_assignment_guards g ON g.organization_id=a.organization_id AND g.id=a.id WHERE a.organization_id='foreign'").all(),'foreign-helper'),/planning_replan_stale/,'The synchronous helper rejects rows from another organization');
const current=selected();replan(current,'fresh-group',helper(current,'fresh-group'));
assert.deepEqual(db.prepare("SELECT assignment_date,status FROM field_assignments WHERE organization_id='org' ORDER BY id").all().map(row=>({...row})),[{assignment_date:'2026-10-21',status:'planned'},{assignment_date:'2026-10-21',status:'planned'}]);
assert.equal(db.prepare('SELECT COUNT(*) n FROM planning_replan_checks').get().n,1,'Exactly one immutable assertion is recorded for the successful operation');
assert.equal(db.prepare("SELECT reserved FROM field_stock_items WHERE id='item'").get().reserved,0,'A fresh replan applies the existing unused-stock release exactly as before');
assert.equal(db.prepare("SELECT quantity FROM field_stock_items WHERE id='item'").get().quantity,100,'Replanning never consumes physical stock');
const record=db.prepare('SELECT * FROM planning_replan_checks').get();assert.deepEqual(JSON.parse(record.guards_json),current.map(row=>({id:String(row.id),guardJson:row.guard_json})));
assert.throws(()=>db.exec("UPDATE planning_replan_checks SET created_at='changed'"),/planning_replan_immutable/);assert.throws(()=>db.exec('DELETE FROM planning_replan_checks'),/planning_replan_immutable/);
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('PASS planning replan SQL CAS: concurrent project/people/status/reason/subcontractor/time/team/type/author changes, absent/foreign/duplicate guards, atomic stock rollback, synchronous helper, fresh grouped replan and immutable receipt');
db.close();
