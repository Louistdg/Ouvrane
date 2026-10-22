import assert from 'node:assert/strict';
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openProductionDatabase} from '../scripts/production-db.mjs';
import worker from '../dist/server/index.js';
// Contract: status commands retain identity and documents, and an old retry
// must never undo a later reactivation. Exercise the compiled worker and SQLite.
const dir=mkdtempSync(join(tmpdir(),'socle-customer-status-')),databasePath=join(dir,'socle.sqlite');copyFileSync(new URL('../data/socle.sqlite',import.meta.url),databasePath);
const opened=openProductionDatabase({databasePath,migrationsDirectory:fileURLToPath(new URL('../drizzle/',import.meta.url))}),db=opened.database;
let org,owner,checks=0;
async function api(path,method='GET',data,uid=owner,organization=org){const response=await worker.fetch(new Request('https://socle.local'+path,{method,headers:{'oai-authenticated-user-id':uid,'x-socle-organization-id':organization,origin:'https://socle.local',...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),{DB:opened.DB});return{status:response.status,body:await response.json()}}
async function ok(path,method='GET',data,uid=owner){const r=await api(path,method,data,uid);assert.ok(r.status>=200&&r.status<300,path+' HTTP'+r.status+' '+JSON.stringify(r.body));return r.body}
function check(label,actual,expected=true){assert.deepEqual(actual,expected,label);checks++;console.log('PASS '+label)}
const snapshot=()=>Object.fromEntries(['organization_workspace_state','customers','quotes_server','commercial_contact_customers','commercial_directory_operations','audit_logs'].map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]));
try{
 const member=db.prepare("SELECT om.organization_id,om.user_id FROM organization_members om JOIN roles r ON r.id=om.role_id AND r.organization_id=om.organization_id WHERE om.status='active' AND r.code='OWNER' ORDER BY om.joined_at LIMIT 1").get();assert.ok(member);org=member.organization_id;owner=member.user_id;
 const original=await ok('/api/state'),a=(await ok('/api/customers','POST',{type:'company',companyName:'Même client indépendant',email:'a@simulation.invalid',street:'Rue A20',paymentTermsDays:0,notes:'Conditions originales'})).customer;
 const b=(await ok('/api/customers','POST',{type:'company',companyName:a.companyName,email:'b@simulation.invalid',street:'Rue B20'})).customer;
 const quoteData={customerId:a.id,title:'Devis du client A20',client:a.companyName,date:'2026-10-21',validUntil:'2026-11-21',lines:[{label:'Travaux',description:'Conserver la description',qty:2,unit:'h',price:37.5,vat:6}]};
 const quote=(await ok('/api/quotes','POST',{...quoteData,operationKey:'status20-quote-create'})).quote;
 await ok('/api/customers/'+a.id,'DELETE');const archived=(await ok('/api/customers/'+a.id+'?includeArchived=1')).customer;
 check('Archived list retrieves the actual inactive customer',(await ok('/api/customers?status=archived&limit=250')).customers.some(c=>c.id===a.id));
 check('Archived list excludes the active homonym',(await ok('/api/customers?status=archived&limit=250')).customers.some(c=>c.id===b.id),false);
 check('All-customer list explicitly includes both states',(await ok('/api/customers?includeArchived=1&limit=250')).customers.filter(c=>[a.id,b.id].includes(c.id)).length,2);
 check('The default quote customer catalog remains active-only',(await ok('/api/customers?limit=250')).customers.some(c=>c.id===a.id),false);
 check('An unknown customer status is rejected',(await api('/api/customers?status=unknown')).status,400);
 const path='/api/customers/'+a.id+'/status',restore={active:true,operationKey:'status20-first-restore'};
 const restored=await api(path,'POST',restore);check('Independent customer has a real status command',restored.status,200);check('Reactivation retains the original ID and clears the archive',restored.body.customer.id===a.id&&restored.body.customer.archivedAt===null);
 const retained=c=>Object.fromEntries(Object.entries(c).filter(([key])=>!['updatedAt','archivedAt'].includes(key)));
 check('Status changes retain every commercial field exactly',retained(restored.body.customer),retained(a));
 check('Reactivation preserves the exact existing SQL quote',(await ok('/api/quotes/'+quote.id)).quote,quote);
 check('Reactivation leaves the workspace exact',(await ok('/api/state')).state,original.state);
 const beforeRetry=snapshot();check('Same status request is acknowledged as replay',(await ok(path,'POST',restore)).replayed);check('Status replay changes no rows or audit',snapshot(),beforeRetry);
 check('A key cannot be reused for the opposite command',(await api(path,'POST',{...restore,active:false})).status,409);
 const archive={active:false,operationKey:'status20-second-archive'};await ok(path,'POST',archive);const inactive=(await ok('/api/customers/'+a.id+'?includeArchived=1')).customer;assert.ok(inactive.archivedAt);
 check('New quote cannot select an inactive independent customer',(await api('/api/quotes','POST',{...quoteData,operationKey:'status20-archived-new-quote'})).status,404);
 check('Existing quote can retain its inactive independent customer',(await api('/api/quotes/'+quote.id,'PUT',{...quoteData,reference:quote.reference})).status,200);
 await ok(path,'POST',{active:true,operationKey:'status20-newer-restore'});const beforeOldRetry=snapshot(),oldRetry=await ok(path,'POST',archive);
 check('An old archive retry reports the current active customer',oldRetry.replayed&&oldRetry.customer.archivedAt===null);check('An old archive retry never repeats its past mutation',snapshot(),beforeOldRetry);
 const noOpBefore=db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action IN ('customer.archived','customer.restored') AND entity_id=?").get(a.id).n;
 await ok(path,'POST',{active:true,operationKey:'status20-already-active'});
 check('A new command for the current state adds no false audit',db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action IN ('customer.archived','customer.restored') AND entity_id=?").get(a.id).n,noOpBefore);
 const concurrent={active:false,operationKey:'status20-concurrent-archive'},beforeAudit=noOpBefore;
 const results=await Promise.all([api(path,'POST',concurrent),api(path,'POST',concurrent)]);check('Concurrent copies of one status command both succeed',results.map(r=>r.status),[200,200]);
 check('Concurrent copies commit only one status transition',db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action IN ('customer.archived','customer.restored') AND entity_id=?").get(a.id).n,beforeAudit+1);
 check('Concurrent status retry contains a real replay',results.some(r=>r.body.replayed));
 const atomicBefore=snapshot(),atomicBody={active:true,operationKey:'status20-atomic-restore'};
 db.exec("CREATE TRIGGER qa20_abort_status BEFORE UPDATE OF archived_at ON customers WHEN OLD.id='"+a.id.replaceAll("'","''")+"' BEGIN SELECT RAISE(ABORT,'qa20_abort_status'); END;");
 check('An injected database failure rejects the status command',(await api(path,'POST',atomicBody)).status>=400);
 check('Failed status transaction rolls back receipt, audit and customer',snapshot(),atomicBefore);db.exec('DROP TRIGGER qa20_abort_status');
 check('The same command can succeed after a rolled-back failure',(await ok(path,'POST',atomicBody)).customer.archivedAt,null);
 await ok(path,'POST',{active:false,operationKey:'status20-before-office-archive'});
 const beforeDenied=snapshot();for(const body of [{active:'false',operationKey:'status20-invalid-boolean'},{active:false,operationKey:'short'},{active:false,operationKey:'status20-invalid-field',unknown:true}])check('Malformed status is rejected '+JSON.stringify(body),(await api(path,'POST',body)).status,400);
 check('Status rejects unsupported HTTP methods',(await api(path,'PUT',{active:true})).status,405);
 check('Foreign company cannot operate on customer status',(await api(path,'POST',{active:true,operationKey:'status20-foreign-company'},owner,'not-this-company')).status,403);
 check('Invalid or foreign requests leave all records exact',snapshot(),beforeDenied);
 const uid='status20-office',stamp='2026-10-21T05:30:00Z',role=db.prepare("SELECT id FROM roles WHERE organization_id=? AND code='WORKER'").get(org);assert.ok(role);
 db.prepare('INSERT INTO profiles(id,first_name,last_name,email,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(uid,'Bureau','Status20','status20.office@simulation.invalid',stamp,stamp);
 db.prepare('INSERT INTO organization_members(id,organization_id,user_id,role_id,status,joined_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('status20-member',org,uid,role.id,'active',stamp,stamp,stamp);
 const profile={profileName:'Bureau clients20',scope:'Toute l’entreprise',modules:{quotes:{view:true,edit:true},jobs:{view:true}},sensitive:{quotePrices:false},fieldActions:{},projectIds:[]};await ok('/api/access-control/'+uid,'PUT',profile);
 check('Actual office with edit permission can restore the same client',(await api(path,'POST',{active:true,operationKey:'status20-office-restore'},uid)).body.customer.id,a.id);
 await ok('/api/access-control/'+uid,'PUT',{...profile,modules:{quotes:{view:true,edit:false},jobs:{view:true}}});const revoked=snapshot();
 check('Office loses mutation access immediately after revocation',(await api(path,'POST',{active:false,operationKey:'status20-denied-office'},uid)).status,403);check('A denied command leaves customer and audit exact',snapshot(),revoked);
 const state=await ok('/api/state');await ok('/api/commercial-directory/bootstrap','POST',{revision:state.revision,operationKey:'status20-link-directory'});const linked=(await ok('/api/customers?includeArchived=1&limit=250')).customers.find(c=>c.sourceContactId);assert.ok(linked);
 const beforeLinked=snapshot();const denied=await api('/api/customers/'+linked.id+'/status','POST',{active:false,operationKey:'status20-linked-denied'});
 check('Source-managed customer cannot bypass its source contact',denied.status,409);check('Source-managed refusal identifies the original route',denied.body.code,'customer_managed_by_contact');check('Source-managed refusal changes nothing',snapshot(),beforeLinked);
 check('The independent homonym keeps its own exact identity',(await ok('/api/customers/'+b.id)).customer,b);
 check('Every historical quote remains exact',(await ok('/api/state')).state.quotes,original.state.quotes);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);console.log('PASS '+checks+' real independent customer status API assertions');
}finally{opened.close();rmSync(dir,{recursive:true,force:true})}
