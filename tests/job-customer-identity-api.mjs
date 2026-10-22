import assert from 'node:assert/strict';
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openProductionDatabase} from '../scripts/production-db.mjs';
import worker from '../dist/server/index.js';
const dir=mkdtempSync(join(tmpdir(),'socle-job-customer-')),databasePath=join(dir,'socle.sqlite');copyFileSync(new URL('../data/socle.sqlite',import.meta.url),databasePath);
const opened=openProductionDatabase({databasePath,migrationsDirectory:fileURLToPath(new URL('../drizzle/',import.meta.url))}),db=opened.database;
let owner,org,checks=0;
async function api(path,method='GET',data){const r=await worker.fetch(new Request('https://socle.local'+path,{method,headers:{'oai-authenticated-user-id':owner,'x-socle-organization-id':org,origin:'https://socle.local',...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),{DB:opened.DB});return{status:r.status,body:await r.json()}}
async function ok(path,method='GET',data){const r=await api(path,method,data);assert.ok(r.status>=200&&r.status<300,path+' HTTP'+r.status+' '+JSON.stringify(r.body));return r.body}
function check(label,actual,expected=true){assert.deepEqual(actual,expected,label);checks++;console.log('PASS '+label)}
const snapshot=()=>Object.fromEntries(['organization_workspace_state','customers','audit_logs','commercial_contact_customers','commercial_directory_write_guards'].map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]));
async function rejected(change,label){const current=await ok('/api/state'),state=structuredClone(current.state),before=snapshot();change(state);check(label,(await api('/api/state','PUT',{revision:current.revision,state})).status,409);check(label+' preserves every row',snapshot(),before)}
try{
 const m=db.prepare("SELECT om.organization_id,om.user_id FROM organization_members om JOIN roles r ON r.id=om.role_id AND r.organization_id=om.organization_id WHERE om.status='active' AND r.code='OWNER' ORDER BY om.joined_at LIMIT 1").get();assert.ok(m);org=m.organization_id;owner=m.user_id;
 const initial=await ok('/api/state'),job={id:'QA21-canonical-job',name:'QA21 chantier',client:'Même nom',type:'Rénovation',finance:{materials:121.5,hourlyCost:42,adjustments:[{amount:15}]}};
 await rejected(state=>state.jobs.push({...job,customerId:'customer-does-not-exist'}),'A new chantier rejects an unknown customer');
 const a=(await ok('/api/customers','POST',{companyName:'Même nom',street:'Rue A'})).customer;
 let current=await ok('/api/state');current.state.jobs.push({...job,customerId:a.id},{...job,id:'QA21-legacy-job'});await ok('/api/state','PUT',{revision:current.revision,state:current.state});
 check('A valid customer identity is saved explicitly',(await ok('/api/state')).state.jobs.find(j=>j.id===job.id).customerId,a.id);
 await ok('/api/customers/'+a.id,'DELETE');current=await ok('/api/state');current.state.jobs.find(j=>j.id===job.id).name='Nom modifié';await ok('/api/state','PUT',{revision:current.revision,state:current.state});check('Existing chantier can retain its inactive customer',(await ok('/api/state')).state.jobs.find(j=>j.id===job.id).customerId,a.id);
 await rejected(state=>state.jobs.push({...job,id:'QA21-new-inactive',customerId:a.id}),'A new chantier cannot choose an inactive customer');
 await rejected(state=>state.jobs.find(j=>j.id==='QA21-legacy-job').customerId=a.id,'Changing an existing chantier cannot choose an inactive customer');
 current=await ok('/api/state');current.state.jobs.find(j=>j.id==='QA21-legacy-job').name='Legacy conservé';await ok('/api/state','PUT',{revision:current.revision,state:current.state});check('Matching a client label never creates a canonical association',(await ok('/api/state')).state.jobs.find(j=>j.id==='QA21-legacy-job').customerId??null,null);
 const orgRow=db.prepare('SELECT * FROM organizations WHERE id=?').get(org);orgRow.id='qa21-other-org';orgRow.name='QA21 autre société';db.prepare('INSERT INTO organizations('+Object.keys(orgRow).join(',')+') VALUES('+Object.keys(orgRow).map(()=>'?').join(',')+')').run(...Object.values(orgRow));
 const foreign=db.prepare('SELECT * FROM customers WHERE id=?').get(a.id);foreign.id='qa21-foreign-customer';foreign.organization_id=orgRow.id;foreign.archived_at=null;db.prepare('INSERT INTO customers('+Object.keys(foreign).join(',')+') VALUES('+Object.keys(foreign).map(()=>'?').join(',')+')').run(...Object.values(foreign));
 await rejected(state=>state.jobs.push({...job,id:'QA21-foreign-job',customerId:foreign.id}),'A chantier cannot link to another company customer');
 const before=snapshot(),payload=JSON.parse(db.prepare('SELECT payload FROM organization_workspace_state WHERE organization_id=?').get(org).payload);payload.jobs.push({...job,id:'QA21-direct-write',customerId:foreign.id});assert.throws(()=>db.prepare('UPDATE organization_workspace_state SET payload=? WHERE organization_id=?').run(JSON.stringify(payload),org),/commercial_customer_mismatch/);checks++;console.log('PASS Database rejects an invalid direct write too');check('Direct rejected write leaves all rows exact',snapshot(),before);
 const sourceA={id:'QA21-contact-A',reference:'QA21-A',name:'Ancien client',roles:['Client'],active:true},sourceB={...sourceA,id:'QA21-contact-B',reference:'QA21-B'};
 current=await ok('/api/state');current.state.contacts.push(sourceA,sourceB);current.state.jobs.push({...job,id:'QA21-contact-job',clientId:sourceA.id},{...job,id:'QA21-homonym-job',client:sourceA.name});await ok('/api/state','PUT',{revision:current.revision,state:current.state});
 current=await ok('/api/state');await ok('/api/commercial-directory/bootstrap','POST',{revision:current.revision,operationKey:'qa21-contact-bootstrap'});const mapped=(await ok('/api/customers?limit=250')).customers.find(c=>c.sourceContactId===sourceA.id);assert.ok(mapped);
 current=await ok('/api/state');await ok('/api/commercial-contacts/'+sourceA.id,'PATCH',{revision:current.revision,operationKey:'qa21-archive-source',contact:{active:false}});
 current=await ok('/api/state');current.state.jobs.find(j=>j.id==='QA21-contact-job').customerId=mapped.id;
 const explicit=await api('/api/state','PUT',{revision:current.revision,state:current.state});check('An existing inactive source contact can become an explicit canonical link',explicit.status,200);
 check('Explicit source link retains its original contact ID',(await ok('/api/state')).state.jobs.find(j=>j.id==='QA21-contact-job').clientId,sourceA.id);
 await rejected(state=>{const j=state.jobs.find(j=>j.id==='QA21-homonym-job');j.clientId=sourceA.id;j.customerId=mapped.id},'Adding a contact ID now does not fake a historical inactive link');
 check('Explicit source link preserves finances',(await ok('/api/state')).state.jobs.find(j=>j.id==='QA21-contact-job').finance,job.finance);
 check('Original historical quotes remain exact',(await ok('/api/state')).state.quotes,initial.state.quotes);check('Customer linking preserves all financial fields',(await ok('/api/state')).state.jobs.find(j=>j.id===job.id).finance,job.finance);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);console.log('PASS '+checks+' real chantier customer identity API assertions');
}finally{opened.close();rmSync(dir,{recursive:true,force:true})}
