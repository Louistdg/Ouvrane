import assert from 'node:assert/strict';
import {resolve,dirname,join} from 'node:path';
import {readdirSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {openProductionDatabase} from '../scripts/production-db.mjs';

// Only the explicit synthetic database emitted by the migration test is used.
// Without an argument, take the most recent one that test left in the temp folder.
const emitted=()=>readdirSync(tmpdir(),{withFileTypes:true}).filter(entry=>entry.isDirectory()&&entry.name.startsWith('ouvrane-followup-migration-')).map(entry=>join(tmpdir(),entry.name,'synthetic.sqlite')).filter(path=>{try{return statSync(path).isFile()}catch{return false}}).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs)[0];
const databasePath=resolve(process.argv[2]||emitted()||'');
assert.match(databasePath,/ouvrane-followup-migration-[^\\/]+[\\/]synthetic\.sqlite$/);
const migrationsDirectory=resolve('drizzle'),prior=join(dirname(databasePath),'prior-migrations');
let storage=openProductionDatabase({databasePath,migrationsDirectory});
assert.equal(storage.database.prepare("SELECT name FROM organizations WHERE id='pf-org'").get().name,'Entreprise de test');
storage.database.prepare(`INSERT INTO personal_calendar_events(id,organization_id,user_id,title,starts_at,ends_at,operation_key,request_json,created_at,updated_at)
VALUES('rollback-check','pf-org','pf-boss','Rendez-vous conservé','2026-10-28T08:00:00.000Z','2026-10-28T09:00:00.000Z','rollback-check','{}','2026-10-24','2026-10-24')`).run();
storage.close();
storage=openProductionDatabase({databasePath,migrationsDirectory:prior});
assert.equal(storage.database.prepare("SELECT title FROM personal_calendar_events WHERE id='rollback-check'").get().title,'Rendez-vous conservé');
assert.equal(storage.database.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
assert.equal(storage.database.prepare("SELECT COUNT(*) n FROM local_migrations WHERE name='0066_personal_followup.sql'").get().n,1);
storage.close();
storage=openProductionDatabase({databasePath,migrationsDirectory});
assert.equal(storage.database.prepare("SELECT COUNT(*) n FROM personal_calendar_events WHERE id='rollback-check'").get().n,1);
assert.equal(storage.database.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
storage.close();
console.log(JSON.stringify({status:'PASS',checks:2,rollback:'Previous migration set opens the database and preserves the private event',republication:'Migration 0066 is not repeated and the private event is preserved',productionAccess:false},null,2));
