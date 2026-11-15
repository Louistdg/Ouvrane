import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {openProductionDatabase} from '../scripts/production-db.mjs';
const dir=mkdtempSync(join(tmpdir(),'ouvrane-followup-migration-')),path=join(dir,'synthetic.sqlite');
const migrations=fileURLToPath(new URL('../drizzle/',import.meta.url)),prior=join(dir,'prior-migrations');mkdirSync(prior);
for(const name of readdirSync(migrations))if(name.endsWith('.sql')&&name!=='0066_personal_followup.sql')writeFileSync(join(prior,name),readFileSync(join(migrations,name)));
// Build the genuine current schema, with no credentials or sessions, then
// compare all existing records around the new migration and its reopen.
const initial=openProductionDatabase({databasePath:path,migrationsDirectory:prior});
const db=initial.database;db.exec("INSERT INTO organizations(id,name,created_at,updated_at) VALUES('pf-org','Entreprise de test','2026-10-24','2026-10-24');INSERT INTO profiles(id,first_name,last_name,email,created_at,updated_at) VALUES('pf-boss','Patron','Test','patron@personal-followup.invalid','2026-10-24','2026-10-24');");
assert.equal(db.prepare("SELECT COUNT(*) n FROM local_migrations WHERE name='0066_personal_followup.sql'").get().n,0);
const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'local_migrations' ORDER BY name").all().map(r=>r.name);
const hashRows=current=>{
 const data={};for(const name of names)data[name]=current.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all();
 return createHash('sha256').update(JSON.stringify(data)).digest('hex');
};
const before=hashRows(db);initial.close();
const reopened=openProductionDatabase({databasePath:path,migrationsDirectory:migrations});
assert.equal(reopened.database.prepare("SELECT COUNT(*) n FROM local_migrations WHERE name='0066_personal_followup.sql'").get().n,1);
assert.equal(reopened.database.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
assert.equal(hashRows(reopened.database),before,'All existing business records are unchanged by migration 0066');
for(const name of ['personal_calendar_events','personal_followup_reminders','personal_notification_receipts','personal_message_notifications'])assert.equal(reopened.database.prepare('SELECT COUNT(*) n FROM '+name).get().n,0);
assert.equal(reopened.database.prepare("SELECT name FROM organizations WHERE id='pf-org'").get().name,'Entreprise de test');
reopened.close();
const again=openProductionDatabase({databasePath:path,migrationsDirectory:migrations});assert.equal(again.database.prepare("SELECT COUNT(*) n FROM local_migrations WHERE name='0066_personal_followup.sql'").get().n,1);assert.equal(hashRows(again.database),before);again.close();
console.log(JSON.stringify({status:'PASS',checks:10,syntheticDatabase:path,existingTablesCompared:names.length,realMigrationRunner:true,productionAccess:false},null,2));
