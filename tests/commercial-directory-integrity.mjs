import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
const migrations=new URL('../drizzle/',import.meta.url);
for(const name of readdirSync(migrations).filter(n=>/^\d+.*\.sql$/.test(n)).sort())db.exec(readFileSync(new URL(name,migrations),'utf8'));
db.exec("INSERT INTO organizations(id,name,created_at,updated_at) VALUES('org','Office','before','before'),('foreign','Other office','before','before'); INSERT INTO profiles(id,created_at,updated_at) VALUES('actor','before','before');");
for(const [id,org] of [['a','org'],['b','org'],['foreign-a','foreign']])db.prepare('INSERT INTO customers(id,organization_id,type,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,org,'company','before','before');
const link=(org,contact,customer)=>db.prepare('INSERT INTO commercial_contact_customers(organization_id,contact_id,customer_id,source_json,source_version,workspace_revision,created_at,updated_at) VALUES(?,?,?,?,1,12,?,?)').run(org,contact,customer,'{}','before','before');
link('org','contact-a','a');link('org','contact-b','b');
let checks=0;
function rejects(label,fn,pattern){assert.throws(fn,pattern,label);checks++;console.log('PASS '+label)}
function accepts(label,fn){fn();checks++;console.log('PASS '+label)}
rejects('Cross-tenant contact mapping cannot bind a foreign customer',()=>link('org','bad-link','foreign-a'),/commercial_contact_tenant_mismatch/);
rejects('A contact mapping cannot be retargeted',()=>db.prepare("UPDATE commercial_contact_customers SET customer_id='b' WHERE contact_id='contact-a'").run(),/commercial_contact_identity_immutable/);
rejects('A mapped customer cannot change tenant',()=>db.prepare("UPDATE customers SET organization_id='foreign' WHERE id='a'").run(),/commercial_contact_identity_immutable/);
rejects('A mapped customer cannot change ID',()=>db.prepare("UPDATE customers SET id='renamed-a' WHERE id='a'").run(),/commercial_contact_identity_immutable/);
const state={contacts:[{id:'contact-a',roles:['Client']},{id:'contact-b',roles:['Client']}],jobs:[{id:'TEXT-JOB',clientId:'contact-a',name:'Original',finance:{materials:99}}],quotes:[{id:'historical',client:'contact-a'}]};
db.prepare('INSERT INTO organization_workspace_state(organization_id,payload,revision,created_at,updated_at) VALUES(?,?,12,?,?)').run('org',JSON.stringify(state),'before','before');
function transaction(operations){db.exec('BEGIN IMMEDIATE');try{for(const op of operations)op();db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}}
const snapshot=()=>Object.fromEntries(['organization_workspace_state','customers','commercial_contact_customers','quotes_server','audit_logs','commercial_directory_write_guards'].map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]));
const before=snapshot();
rejects('SQL revision assertion aborts a stale whole batch',()=>transaction([
 ()=>db.prepare('INSERT INTO commercial_directory_write_guards VALUES(?,?,?)').run('stale','org',11),
 ()=>db.prepare("UPDATE customers SET email='should-not-write' WHERE id='a'").run(),
]),/commercial_directory_revision_conflict/);
assert.deepEqual(snapshot(),before);checks++;console.log('PASS Stale revision leaves every row unchanged');
accepts('Current revision assertion admits a coherent batch',()=>transaction([
 ()=>db.prepare('INSERT INTO commercial_directory_write_guards VALUES(?,?,?)').run('current','org',12),
 ()=>db.prepare("UPDATE organization_workspace_state SET revision=13 WHERE organization_id='org'").run(),
 ()=>db.prepare("UPDATE customers SET email='coherent' WHERE id='a'").run(),
 ()=>db.prepare("DELETE FROM commercial_directory_write_guards WHERE operation_id='current'").run(),
]));
const insertQuote=(id,customer,project='TEXT-JOB')=>db.prepare('INSERT INTO quotes_server(id,organization_id,project_id,customer_id,reference,title,client_name,issue_date,valid_until,lines_json,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'org',project,customer,'REF-'+id,'Commercial quote','Same label','2026-10-21','2026-11-21','[]','actor','before','before');
rejects('SQL resolves legacy project customer through contact ID, never label',()=>insertQuote('wrong-client','b'),/commercial_customer_mismatch/);
accepts('SQL admits a matching customer on a legacy project',()=>insertQuote('matching-client','a'));
rejects('SQL rejects clearing a customer fixed by a legacy project',()=>insertQuote('missing-client',null),/commercial_customer_mismatch/);
const changed=structuredClone(state);changed.jobs[0].clientId='contact-b';
rejects('Changing a job client cannot contradict its existing quote',()=>db.prepare("UPDATE organization_workspace_state SET payload=? WHERE organization_id='org'").run(JSON.stringify(changed)),/commercial_customer_mismatch/);
const contradictory=structuredClone(state);contradictory.jobs[0].customerId='b';
rejects('Explicit customer ID cannot contradict the mapped client ID',()=>db.prepare("UPDATE organization_workspace_state SET payload=? WHERE organization_id='org'").run(JSON.stringify(contradictory)),/commercial_customer_mismatch/);
const cleared=structuredClone(state);delete cleared.jobs[0].clientId;
rejects('Clearing a job client cannot erase the known customer of its quote',()=>db.prepare("UPDATE organization_workspace_state SET payload=? WHERE organization_id='org'").run(JSON.stringify(cleared)),/commercial_customer_mismatch/);
rejects('Removing a quoted legacy job cannot orphan its quote',()=>db.prepare("UPDATE organization_workspace_state SET payload=? WHERE organization_id='org'").run(JSON.stringify({...state,jobs:[]})),/commercial_project_link_invalid/);
const legal=structuredClone(state);legal.jobs[0].name='Same identity, note correction';
accepts('A job edit retaining client identity preserves finance and history',()=>db.prepare("UPDATE organization_workspace_state SET payload=? WHERE organization_id='org'").run(JSON.stringify(legal)));
rejects('Deleting a mapped source cannot orphan its identity',()=>db.prepare("UPDATE organization_workspace_state SET payload=? WHERE organization_id='org'").run(JSON.stringify({...legal,contacts:legal.contacts.filter(c=>c.id!=='contact-a')})),/commercial_contact_source_missing/);
rejects('Updating a legacy quote cannot race to a different customer',()=>db.prepare("UPDATE quotes_server SET customer_id='b' WHERE id='matching-client'").run(),/commercial_customer_mismatch/);
db.prepare('INSERT INTO customers(id,organization_id,type,created_at,updated_at) VALUES(?,?,?,?,?)').run('c','org','company','before','before');
const late=structuredClone(legal);late.contacts.push({id:'contact-late',roles:['Client']});late.jobs.push({id:'LATE-JOB',clientId:'contact-late',name:'No inferred identity'});
db.prepare("UPDATE organization_workspace_state SET payload=? WHERE organization_id='org'").run(JSON.stringify(late));
insertQuote('existing-independent-customer','b','LATE-JOB');
rejects('A new mapping cannot silently replace an existing quote customer',()=>link('org','contact-late','c'),/commercial_customer_mismatch/);
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
console.log('PASS '+checks+' directory SQL assertions');
