import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync,readdirSync} from 'node:fs';

// Actual migrations and SQLite only. Never open the candidate or a live database.
const db=new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
const migrations=new URL('../drizzle/',import.meta.url);
for(const name of readdirSync(migrations).filter(name=>/^\d+.*\.sql$/.test(name)&&name<'0062').sort()){
  db.exec(readFileSync(new URL(name,migrations),'utf8'));
}
db.exec(`INSERT INTO organizations(id,name,created_at,updated_at) VALUES('org','Test organization','before','before'),('foreign','Foreign organization','before','before');
INSERT INTO profiles(id,created_at,updated_at) VALUES('actor','before','before');`);
for(const [customer,org]of [['a','org'],['b','org'],['other','foreign']]){
  db.prepare('INSERT INTO customers(id,organization_id,type,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(customer,org,'company','Same customer label','before','before');
}
const project=(id,customer=null,org='org')=>db.prepare('INSERT INTO projects(id,organization_id,customer_id,name,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,org,customer,'Same project label','active','before','before');
const quote=(id,{customer=null,projectId=null,org='org',archived=null}={})=>db.prepare('INSERT INTO quotes_server(id,organization_id,project_id,customer_id,reference,title,client_name,issue_date,valid_until,lines_json,created_by,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,org,projectId,customer,'REF-'+id,'Recorded work','Same customer label','2026-10-21','2026-11-21','[{"label":"Original zero quantity","qty":0,"price":12,"vatRate":6,"source":{"untouched":true}}]','actor','before','before',archived);
const visit=(id,{customer=null,quoteId=null,org='org'}={})=>db.prepare('INSERT INTO quote_site_visits(id,organization_id,customer_id,place,quote_id,operation_key,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,org,customer,'Recorded visit',quoteId,'operation-'+id,'actor','before','before');
const audit=id=>db.prepare('INSERT INTO audit_logs(id,organization_id,user_id,action,entity_type,entity_id,created_at) VALUES(?,?,?,?,?,?,?)').run(id,'org','actor','test.identity','quote',id,'after');
const snapshot=()=>Object.fromEntries(['customers','projects','quotes_server','quote_site_visits','organization_workspace_state','audit_logs'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
function batch(operations){
  db.exec('BEGIN IMMEDIATE');
  try{for(const operation of operations)operation();db.exec('COMMIT');}
  catch(error){db.exec('ROLLBACK');throw error;}
}
const mismatch=/commercial_customer_mismatch/;
const invalidLink=/commercial_quote_link_invalid/;
let checks=0;
function accepts(label,operation){operation();checks++;}
function rejects(label,operation,message=mismatch){
  const before=snapshot();
  assert.throws(operation,message,label);
  assert.deepEqual(snapshot(),before,label+' must leave every commercial row and audit unchanged');
  checks++;
}

project('project-a','a');project('project-b','b');project('project-unset');project('foreign-project','other','foreign');
quote('unlinked-a',{customer:'a'});quote('unlinked-b',{customer:'b'});quote('unlinked-null');
quote('archived-a',{customer:'a',archived:'archived'});quote('foreign-quote',{customer:'other',org:'foreign'});
quote('legacy-null',{projectId:'legacy-project'});visit('legacy-null-visit',{quoteId:'legacy-null'});
quote('legacy-project-now-known',{projectId:'project-a'});
quote('known-source',{customer:'a'});visit('known-source-visit',{customer:'a',quoteId:'known-source'});
quote('fallback-source',{customer:'a'});visit('fallback-source-visit',{quoteId:'fallback-source'});
const legacyPayload=JSON.stringify({version:3,quotes:[{id:'historical',client:'legacy-contact',lines:[{qty:0,vatRate:6,opaque:'preserve'}]}]});
db.prepare('INSERT INTO organization_workspace_state(organization_id,payload,revision,created_at,updated_at) VALUES(?,?,?,?,?)').run('org',legacyPayload,12,'before','before');
const beforeMigration=snapshot();
const migration=new URL('0062_commercial_client_identity_guards.sql',migrations);
if(existsSync(migration))db.exec(readFileSync(migration,'utf8'));
assert.deepEqual(snapshot(),beforeMigration,'Installing guards must not repair, relabel or rewrite any pre-existing row');

// This assertion must fail without 0062, rather than failing on a missing file.
rejects('Different IDs are different customers even when their labels are identical',()=>quote('wrong-project-customer',{customer:'b',projectId:'project-a'}));
rejects('A new quote cannot erase a customer fixed by its SQL project',()=>quote('missing-project-customer',{projectId:'project-a'}));
accepts('Matching project and quote customer',()=>quote('project-quote',{customer:'a',projectId:'project-a'}));
rejects('Updating the quote customer conflicts with its project',()=>db.prepare("UPDATE quotes_server SET customer_id='b' WHERE id='project-quote'").run());
rejects('Clearing the quote customer conflicts with its project',()=>db.prepare("UPDATE quotes_server SET customer_id=NULL WHERE id='project-quote'").run());
rejects('Moving a quote to another known customer project',()=>db.prepare("UPDATE quotes_server SET project_id='project-b' WHERE id='project-quote'").run());
accepts('A legacy project absent from relational projects remains valid',()=>quote('legacy-compatible',{projectId:'legacy-project'}));
accepts('Only an own-organization SQL project supplies an identity',()=>quote('foreign-project-is-not-own-sql',{projectId:'foreign-project'}));
accepts('A SQL project with no customer does not invent one',()=>quote('unknown-project-compatible',{projectId:'project-unset'}));

rejects('A visit cannot be linked to another customer quote',()=>visit('wrong-visit',{customer:'a',quoteId:'unlinked-b'}));
rejects('A known visit customer cannot be linked to an unknown quote customer',()=>visit('missing-quote-customer',{customer:'a',quoteId:'unlinked-null'}));
for(const [label,quoteId]of [['absent','missing-quote'],['archived','archived-a'],['foreign','foreign-quote'],['empty','']]){
  rejects('A visit target must be an active quote in the same organization: '+label,()=>visit('invalid-'+label,{customer:'a',quoteId}),invalidLink);
}
accepts('An unknown legacy visit may be linked to an unknown quote',()=>visit('unknown-compatible',{quoteId:'unlinked-null'}));
accepts('An unknown legacy visit may inherit the known quote identity',()=>visit('unknown-to-known',{quoteId:'unlinked-a'}));
visit('update-target',{customer:'a'});
rejects('An update cannot attach a known visit to another customer',()=>db.prepare("UPDATE quote_site_visits SET quote_id='unlinked-b' WHERE id='update-target'").run());
rejects('An update cannot attach a visit to a foreign quote',()=>db.prepare("UPDATE quote_site_visits SET quote_id='foreign-quote' WHERE id='update-target'").run(),invalidLink);
accepts('A matching visit update is accepted',()=>db.prepare("UPDATE quote_site_visits SET quote_id='unlinked-a' WHERE id='update-target'").run());
rejects('Editing the linked visit customer cannot break its quote identity',()=>db.prepare("UPDATE quote_site_visits SET customer_id='b' WHERE id='update-target'").run());
rejects('A legacy NULL visit keeps the identity of its previously linked quote when relinked',()=>db.prepare("UPDATE quote_site_visits SET quote_id='unlinked-b' WHERE id='fallback-source-visit'").run());
rejects('Changing a visit organization cannot retain its old quote link',()=>db.prepare("UPDATE quote_site_visits SET organization_id='foreign' WHERE id='update-target'").run(),invalidLink);

for(const source of ['known-source','fallback-source']){
  for(const customer of ['b',null]){
    rejects('A linked quote cannot change or lose the identity expected by '+source,()=>db.prepare('UPDATE quotes_server SET customer_id=? WHERE id=?').run(customer,source));
  }
}
rejects('Changing the identity key cannot orphan known linked visits',()=>db.prepare("UPDATE quotes_server SET id='renamed-source' WHERE id='known-source'").run(),invalidLink);
rejects('Changing the quote organization cannot orphan linked visits',()=>db.prepare("UPDATE quotes_server SET organization_id='foreign' WHERE id='known-source'").run(),invalidLink);
accepts('A NULL quote without any known identity remains NULL-compatible',()=>db.prepare("UPDATE quotes_server SET notes='Corrected note' WHERE id='legacy-null'").run());
accepts('Legacy visits with NULL identity can receive note corrections',()=>db.prepare("UPDATE quote_site_visits SET notes='Corrected legacy note' WHERE id='legacy-null-visit'").run());
accepts('An unchanged historical identity is not repaired during a note correction',()=>db.prepare("UPDATE quotes_server SET customer_id=customer_id,project_id=project_id,notes='Note only' WHERE id='legacy-project-now-known'").run());
accepts('Replaying the same valid quote identity is accepted',()=>db.prepare("UPDATE quotes_server SET project_id=project_id,customer_id=customer_id WHERE id='project-quote'").run());
accepts('Replaying the same valid visit identity is accepted',()=>db.prepare("UPDATE quote_site_visits SET quote_id=quote_id,customer_id=customer_id WHERE id='update-target'").run());

rejects('A project cannot change away from a known linked quote customer',()=>db.prepare("UPDATE projects SET customer_id='b' WHERE id='project-a'").run());
rejects('A project cannot clear a known linked quote customer',()=>db.prepare("UPDATE projects SET customer_id=NULL WHERE id='project-a'").run());
accepts('Replaying the same project identity is accepted',()=>db.prepare("UPDATE projects SET customer_id='a' WHERE id='project-a'").run());
accepts('A project with only unknown quote customers can acquire an identity',()=>db.prepare("UPDATE projects SET customer_id='a' WHERE id='project-unset'").run());
accepts('The new project identity does not rewrite old NULL quote rows',()=>assert.equal(db.prepare("SELECT customer_id FROM quotes_server WHERE id='unknown-project-compatible'").get().customer_id,null));
accepts('Project note-independent updates do not revalidate historical rows',()=>db.prepare("UPDATE projects SET name='Corrected project label' WHERE id='project-a'").run());

// Real commits between a prior read and the attempted transaction close TOCTOU.
quote('raced-quote',{customer:'a'});
assert.equal(db.prepare("SELECT customer_id FROM quotes_server WHERE id='raced-quote'").get().customer_id,'a');
db.prepare("UPDATE quotes_server SET customer_id='b' WHERE id='raced-quote'").run();
rejects('A stale quote precheck cannot commit a visit or its earlier audit',()=>batch([()=>audit('race-audit'),()=>visit('race-visit',{customer:'a',quoteId:'raced-quote'})]));
project('raced-project','a');
assert.equal(db.prepare("SELECT customer_id FROM projects WHERE id='raced-project'").get().customer_id,'a');
db.prepare("UPDATE projects SET customer_id='b' WHERE id='raced-project'").run();
rejects('A stale project precheck cannot commit a quote or its earlier audit',()=>batch([()=>audit('project-race-audit'),()=>quote('race-project-quote',{customer:'a',projectId:'raced-project'})]));
quote('raced-link',{customer:'a'});
assert.equal(db.prepare("SELECT COUNT(*) n FROM quote_site_visits WHERE quote_id='raced-link'").get().n,0);
visit('newly-linked',{customer:'a',quoteId:'raced-link'});
rejects('A newly linked visit blocks a stale quote update and rolls back notes/audit',()=>batch([()=>audit('reverse-race-audit'),()=>db.prepare("UPDATE quotes_server SET notes='Must roll back' WHERE id='raced-link'").run(),()=>db.prepare("UPDATE quotes_server SET customer_id='b' WHERE id='raced-link'").run()]));
rejects('An invalid final visit rolls back a previously inserted quote and audit',()=>batch([()=>quote('batch-quote',{customer:'a',projectId:'project-a'}),()=>audit('batch-audit'),()=>visit('batch-visit',{customer:'b',quoteId:'batch-quote'})]));
rejects('An invalid project update rolls back an earlier quote note',()=>batch([()=>db.prepare("UPDATE quotes_server SET notes='Must roll back' WHERE id='project-quote'").run(),()=>db.prepare("UPDATE projects SET customer_id='b' WHERE id='project-a'").run()]));
accepts('A coherent batch commits its quote, visit and audit together',()=>batch([()=>quote('valid-batch',{customer:'a',projectId:'project-a'}),()=>visit('valid-batch-visit',{customer:'a',quoteId:'valid-batch'}),()=>audit('valid-batch-audit')]));
assert.equal(db.prepare("SELECT COUNT(*) n FROM quote_site_visits WHERE quote_id='valid-batch'").get().n,1);
assert.equal(db.prepare("SELECT payload FROM organization_workspace_state WHERE organization_id='org'").get().payload,legacyPayload,'The original historical workspace JSON remains byte-for-byte unchanged');
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
db.close();
console.log('PASS commercial client identity: '+checks+' direct and atomic SQLite cases; actual migrations; distinct homonym IDs; organization scope; legacy NULL/replay/note compatibility; quote/project/visit races and full rollback; historical payload untouched.');
