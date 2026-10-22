import assert from 'node:assert/strict';
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openProductionDatabase} from '../scripts/production-db.mjs';
const worker=(await import('../dist/server/index.js')).default;
const directory=mkdtempSync(join(tmpdir(),'socle-quote-retry-')),databasePath=join(directory,'socle.sqlite');
copyFileSync(new URL('../data/socle.sqlite',import.meta.url),databasePath);
const opened=openProductionDatabase({databasePath,migrationsDirectory:fileURLToPath(new URL('../drizzle/',import.meta.url))}),db=opened.database;
let org,owner,terrain,checks=0;
async function api(path,method='GET',data,uid=owner,organization=org){
 const r=await worker.fetch(new Request('https://socle.local'+path,{method,headers:{'oai-authenticated-user-id':uid,'x-socle-organization-id':organization,origin:'https://socle.local',...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),{DB:opened.DB});
 return {status:r.status,body:await r.json()};
}
function check(label,actual,expected=true){assert.deepEqual(actual,expected,label);checks++;console.log('PASS '+label)}
async function ok(path,method='GET',data,uid=owner,organization=org){const r=await api(path,method,data,uid,organization);assert.ok(r.status>=200&&r.status<300,path+' HTTP'+r.status+' '+JSON.stringify(r.body));return r.body}
const all=table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();
const snapshot=()=>Object.fromEntries(['quotes_server','quote_create_operations','audit_logs','projects'].map(t=>[t,all(t)]));
try{
 const members=db.prepare("SELECT om.organization_id,om.user_id,r.code FROM organization_members om JOIN roles r ON r.id=om.role_id AND r.organization_id=om.organization_id WHERE om.status='active'").all(),patron=members.find(m=>m.code==='OWNER');assert.ok(patron);org=patron.organization_id;owner=patron.user_id;terrain=members.find(m=>m.organization_id===org&&m.code==='WORKER')?.user_id;assert.ok(terrain);
 const original=(await ok('/api/state')).state;
 const customer=(await ok('/api/customers','POST',{type:'company',companyName:'QA sans doublon',street:'Rue du contrôle 18'})).customer;
 const payload={customerId:customer.id,projectId:null,reference:'',status:'draft',title:'Devis unique',client:'QA',clientAddress:'Rue du contrôle 18',date:'2026-10-21',validUntil:'2026-11-21',deposit:30,paymentTerms:'30 jours',notes:'Conserver',exclusions:'Aucune',lines:[{label:'Travail',description:'Ligne réelle',qty:2,unit:'h',price:12.34,vat:21}],operationKey:'quote-retry-first-operation'};
 const first=await api('/api/quotes','POST',payload);check('Quote create accepts a stable operation key',first.status,201);const quote=first.body.quote;
 const saved=snapshot(),replay=await api('/api/quotes','POST',structuredClone(payload));
 check('Unknown successful POST is acknowledged again',replay.status,200);check('Retry is reported as replay',replay.body.replayed);check('Retry returns the original quote and reference',replay.body.quote,quote);check('Retry changes no quote, operation, audit or project',snapshot(),saved);
 db.prepare('UPDATE customers SET archived_at=? WHERE id=?').run('2026-10-21T04:00:00Z',customer.id);const archivedCustomer=snapshot();check('A committed creation remains replayable after its customer is archived',(await ok('/api/quotes','POST',payload)).quote.id,quote.id);check('Customer archive replay cannot create a second document',snapshot(),archivedCustomer);db.prepare('UPDATE customers SET archived_at=NULL WHERE id=?').run(customer.id);
 const reordered=Object.fromEntries(Object.entries(payload).reverse());reordered.lines=payload.lines.map(line=>Object.fromEntries(Object.entries(line).reverse()));
 check('Object key order does not fork the business request',(await ok('/api/quotes','POST',reordered)).quote.id,quote.id);
 check('Changed payload cannot reuse a committed key',(await api('/api/quotes','POST',{...payload,title:'Would overwrite'})).status,409);check('Conflicting retry has no side effects',snapshot(),saved);
 const simultaneous={...payload,operationKey:'quote-retry-concurrent-operation',title:'Concurrent'};
 const concurrent=await Promise.all([api('/api/quotes','POST',simultaneous),api('/api/quotes','POST',simultaneous)]);
 check('Concurrent identical creates have one creation and one replay',concurrent.map(r=>r.status).sort(),[200,201]);check('Concurrent creates return one quote ID',concurrent[0].body.quote.id,concurrent[1].body.quote.id);
 const competing={...payload,operationKey:'quote-retry-conflict-operation'};
 check('Different concurrent requests have one winner and one conflict',(await Promise.all([api('/api/quotes','POST',competing),api('/api/quotes','POST',{...competing,title:'Different'})])).map(r=>r.status).sort(),[201,409]);
 const accepted={...payload,operationKey:'quote-retry-accepted-operation',status:'accepted'};
 const acceptedQuote=(await ok('/api/quotes','POST',accepted)).quote,beforeAccepted=snapshot();await ok('/api/quotes','POST',accepted);
 check('Accepted replay cannot repeat financial or audit effects',snapshot(),beforeAccepted);check('One creation and one acceptance audit',db.prepare('SELECT action FROM audit_logs WHERE entity_id=? ORDER BY action').all(acceptedQuote.id).map(r=>r.action),['quote.accepted','quote.created']);
 for(const operationKey of ['',null,12,10000000,'short','quote key with spaces'])check('Malformed supplied key is refused',(await api('/api/quotes','POST',{...payload,operationKey})).status,400);
 const beforeDenied=snapshot();check('Unprivileged account cannot replay owner request',(await api('/api/quotes','POST',payload,terrain)).status,403);check('Foreign organization cannot disclose the result',(await api('/api/quotes','POST',payload,owner,'foreign-company')).status,403);check('Denied retries change no data',snapshot(),beforeDenied);
 const invalid={...payload,operationKey:'quote-retry-correctable-operation',title:''};check('Invalid input does not consume a key',(await api('/api/quotes','POST',invalid)).status,400);check('Corrected input can reuse an unconsumed key',(await api('/api/quotes','POST',{...invalid,title:'Corrected'})).status,201);
 const fail={...payload,operationKey:'quote-retry-atomic-operation'};const beforeFailure=snapshot();
 db.exec("CREATE TRIGGER qa_quote_audit_failure BEFORE INSERT ON audit_logs WHEN NEW.action='quote.created' BEGIN SELECT RAISE(ABORT,'qa_atomic_quote_failure'); END;");
 check('Downstream failure refuses the entire transaction',(await api('/api/quotes','POST',fail)).status,500);check('Failed transaction leaves no quote or consumed key',snapshot(),beforeFailure);db.exec('DROP TRIGGER qa_quote_audit_failure');
 check('Rolled-back operation succeeds after failure removed',(await api('/api/quotes','POST',fail)).status,201);
 const {operationKey:ignored,...edit}=payload;const changed=(await ok('/api/quotes/'+quote.id,'PUT',{...edit,reference:quote.reference,title:'Later edit preserved'})).quote,afterEdit=snapshot();
 check('Create retry returns the current quote without reverting edits',(await ok('/api/quotes','POST',payload)).quote,changed);check('Retry after edit adds no audit',snapshot(),afterEdit);
 const company=(await ok('/api/organizations','POST',{name:'QA retry second company'})).organization.id;
 const otherCustomer=(await ok('/api/customers','POST',{type:'company',companyName:'Other'},owner,company)).customer;
 const other=(await ok('/api/quotes','POST',{...payload,customerId:otherCustomer.id},owner,company)).quote;
 check('Second company has its own operation namespace',other.id!==quote.id);check('Second company retry returns its own quote',(await ok('/api/quotes','POST',{...payload,customerId:otherCustomer.id},owner,company)).quote.id,other.id);
 const withoutKey={...payload,title:'Legacy consumer'};delete withoutKey.operationKey;check('Existing unkeyed consumers remain compatible',(await api('/api/quotes','POST',withoutKey)).status,201);
 db.prepare('UPDATE quotes_server SET archived_at=? WHERE id=?').run('2026-10-21T04:00:00Z',quote.id);const archived=snapshot();check('Archived committed quote cannot be recreated by retry',(await api('/api/quotes','POST',payload)).status,409);check('Archived retry never forks the quote',snapshot(),archived);
 check('Historical workspace remains exactly preserved',(await ok('/api/state')).state,original);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);console.log('PASS '+checks+' real quote create/retry assertions');
}finally{opened.close();rmSync(directory,{recursive:true,force:true})}
