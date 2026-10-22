import assert from 'node:assert/strict';
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {openProductionDatabase} from '../scripts/production-db.mjs';
import worker from '../dist/server/index.js';

// Real API routes and SQLite. The candidate is copied once and never opened
// writable; no HTTP server or external request is involved in this post-build suite.
const directory=mkdtempSync(join(tmpdir(),'socle-commercial-scope-'));
const path=join(directory,'socle.sqlite');
copyFileSync(new URL('../data/socle.sqlite',import.meta.url),path);
const opened=openProductionDatabase({databasePath:path,migrationsDirectory:fileURLToPath(new URL('../drizzle/',import.meta.url))}),db=opened.database;
const failures=[],stamp='2026-10-21T01:00:00.000Z';
function check(name,ok){console.log((ok?'PASS ':'FAIL ')+name);if(!ok)failures.push(name)}
const env={DB:opened.DB};
let org,owner;
async function api(uid,path,method='GET',data){
 const form=data instanceof FormData;
 const response=await worker.fetch(new Request('https://socle.local'+path,{method,headers:{'oai-authenticated-user-id':uid,'x-socle-organization-id':org,origin:'https://socle.local',...(data===undefined||form?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:form?data:JSON.stringify(data)})}),env);
 return {status:response.status,...((response.headers.get('content-type')||'').includes('json')?{body:await response.json()}:{bytes:(await response.arrayBuffer()).byteLength})};
}
async function ok(path,method='GET',data){const result=await api(owner,path,method,data);assert.ok(result.status>=200&&result.status<300,'Fixture '+path+' HTTP'+result.status+' '+JSON.stringify(result.body));return result.body}
try{
 const membership=db.prepare("SELECT om.organization_id,om.user_id FROM organization_members om JOIN roles r ON r.id=om.role_id AND r.organization_id=om.organization_id WHERE om.status='active' AND r.code='OWNER' ORDER BY om.joined_at LIMIT 1").get();
 assert.ok(membership,'An existing owner is required on the disposable copy.');org=membership.organization_id;owner=membership.user_id;
 const stateBefore=(await ok('/api/state')).state;
 assert.ok(stateBefore.jobs?.length>=2);
 const project=stateBefore.jobs[0],otherProject=stateBefore.jobs[1],uid='commercial-scope-worker',role='commercial-scope-role';
 db.prepare('INSERT INTO profiles(id,first_name,last_name,email,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(uid,'Scope','Worker','commercial.scope@simulation.invalid',stamp,stamp);
 db.prepare('INSERT INTO roles(id,organization_id,code,name,created_at) VALUES(?,?,?,?,?)').run(role,org,'COMMERCIAL_SCOPE_FIELD','Test scope',stamp);
 db.prepare('INSERT INTO organization_members(id,organization_id,user_id,role_id,status,joined_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('member-commercial-scope',org,uid,role,'active',stamp,stamp,stamp);
 for(const permission of ['workspace.view','projects.view.assigned','quotes.view','quotes.create','quotes.edit','documents.secure.view'])db.prepare('INSERT INTO role_permissions(role_id,permission_code) VALUES(?,?)').run(role,permission);
 db.prepare('INSERT INTO project_access(organization_id,user_id,project_id,granted_by,created_at) VALUES(?,?,?,?,?)').run(org,uid,String(project.id),owner,stamp);
 const a=(await ok('/api/customers','POST',{type:'company',companyName:'Scope A',street:'Rue A 1',city:'Namur'})).customer;
 const b=(await ok('/api/customers','POST',{type:'company',companyName:'Scope B',street:'Rue B 2',city:'Liège'})).customer;
 const quoteData=(customer,projectId=null)=>({projectId,customerId:customer.id,title:'Portée commerciale',client:customer.companyName,clientAddress:customer.street,date:'2026-10-21',validUntil:'2026-11-21',lines:[{label:'Travaux',qty:1,unit:'forfait',price:120,vat:6}]});
 const prospect=(await ok('/api/quotes','POST',quoteData(a))).quote;
 const quoteA=(await ok('/api/quotes','POST',quoteData(a,String(project.id)))).quote;
 const quoteB=(await ok('/api/quotes','POST',quoteData(b))).quote;
 const outside=(await ok('/api/quotes','POST',quoteData(a,String(otherProject.id)))).quote;
 const visit=(await ok('/api/quote-visits','POST',{customerId:a.id,place:'Visite prospect A',notes:'Notes confidentielles A',operationKey:'scope-prospect-A'})).visit;
 const linked=(await ok('/api/quote-visits','POST',{customerId:a.id,place:'Visite chantier A',operationKey:'scope-project-A'})).visit;
 await ok('/api/quote-visits/'+linked.id+'/quote','POST',{quoteId:quoteA.id});

 check('Configured field writer has no customers.view',!db.prepare("SELECT 1 FROM role_permissions WHERE role_id=? AND permission_code='customers.view'").get(role));
 const list=await api(uid,'/api/quotes');
 check('Field quote list preserves assigned-project access',list.status===200&&list.body.quotes.some(q=>q.id===quoteA.id));
 check('Field quote list excludes prospects without a project',list.status===200&&!list.body.quotes.some(q=>q.id===prospect.id||q.id===quoteB.id));
 check('Field quote list excludes other projects',list.status===200&&!list.body.quotes.some(q=>q.id===outside.id));
 const allowed=await api(uid,'/api/quotes/'+quoteA.id);
 check('Assigned quote remains readable without prices',allowed.status===200&&!('price' in allowed.body.quote.lines[0])&&!('deposit' in allowed.body.quote));
 check('Direct prospect quote denied',(await api(uid,'/api/quotes/'+prospect.id)).status===403);
 check('Direct other-project quote denied',(await api(uid,'/api/quotes/'+outside.id)).status===403);
 const visits=await api(uid,'/api/quote-visits');
 check('Visit list retains the assigned linked visit',visits.status===200&&visits.body.visits.some(v=>v.id===linked.id));
 check('Visit list excludes the unassigned prospect visit',visits.status===200&&!visits.body.visits.some(v=>v.id===visit.id));
 check('Direct prospect visit denied',(await api(uid,'/api/quote-visits/'+visit.id)).status===403);
 const beforeVisit=db.prepare('SELECT * FROM quote_site_visits WHERE organization_id=? AND id=?').get(org,visit.id);
 const beforeAudit=db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n;
 const deniedPatch=await api(uid,'/api/quote-visits/'+visit.id,'PATCH',{notes:'Should not change'});
 check('Field writer cannot patch a prospect visit',deniedPatch.status===403);
 check('Rejected prospect patch leaves row and audit exact',isDeepStrictEqual(db.prepare('SELECT * FROM quote_site_visits WHERE organization_id=? AND id=?').get(org,visit.id),beforeVisit)&&db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n===beforeAudit);
 const mismatch=await api(owner,'/api/quote-visits/'+visit.id+'/quote','POST',{quoteId:quoteB.id});
 check('Visit customer A cannot link to quote customer B',mismatch.status===409);
 check('Rejected client mismatch leaves visit unlinked',db.prepare('SELECT quote_id FROM quote_site_visits WHERE organization_id=? AND id=?').get(org,visit.id).quote_id===null);
 const beforeQuote=db.prepare('SELECT * FROM quotes_server WHERE organization_id=? AND id=?').get(org,quoteA.id);
 const changed=await api(owner,'/api/quotes/'+quoteA.id,'PUT',{...quoteData(b,String(project.id)),reference:quoteA.reference});
 check('A linked quote cannot be reassigned to another visit customer',changed.status===409);
 check('Rejected quote reassignment leaves all commercial fields exact',isDeepStrictEqual(db.prepare('SELECT * FROM quotes_server WHERE organization_id=? AND id=?').get(org,quoteA.id),beforeQuote));
 // Direct quote documents must not bypass scope merely because prices were
 // granted. These are ordinary uploads, without a visit relation.
 const documents={};
 for(const [label,quote] of Object.entries({prospect,outside,assigned:quoteA,customer:null})){
  const form=new FormData();
  form.set('file',new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=','base64')],'scope-'+label+'.png',{type:'image/png'}));
  form.set('operationKey','scope-standard-document-'+label);form.set('relations',JSON.stringify([quote?{type:'quote',targetId:quote.id}:{type:'customer',targetId:a.id}]));
  documents[label]=(await ok('/api/documents','POST',form)).document.id;
 }
 db.prepare('INSERT INTO member_access_settings(organization_id,user_id,profile_name,scope,updated_by,updated_at) VALUES(?,?,?,?,?,?)').run(org,uid,'Bureau commercial limité','Comptabilité et pièces administratives',owner,stamp);
 db.prepare("INSERT INTO role_permissions(role_id,permission_code) VALUES(?,'quotes.prices.view')").run(role);
 const priced=await api(uid,'/api/quotes/'+quoteA.id);
 check('Explicit office profile can read prices on its assigned quote',priced.status===200&&priced.body.quote.lines[0].price===120);
 for(const label of ['prospect','outside','customer']){
  check('Standard quote document denied '+label,[403,404].includes((await api(uid,'/api/documents/'+documents[label])).status));
  check('Standard quote preview denied '+label,[403,404].includes((await api(uid,'/api/documents/'+documents[label]+'/preview')).status));
 }
 check('Assigned standard quote document remains readable',(await api(uid,'/api/documents/'+documents.assigned)).status===200);
 const docList=await api(uid,'/api/documents');
 check('Document list filters prospect and other-project quote files',docList.status===200&&!docList.body.documents.some(d=>d.id===documents.prospect||d.id===documents.outside||d.id===documents.customer));
 // Derived metric endpoints must have the same visit boundary as the
 // measurement itself. A minimal immutable fixture exercises reads, not maths.
 for(const permission of ['stock.view','purchase_orders.manage','tasks.manage.project'])db.prepare('INSERT OR IGNORE INTO role_permissions(role_id,permission_code) VALUES(?,?)').run(role,permission);
 const metricInsert=db.prepare('INSERT INTO measurement_snapshots(organization_id,id,visit_id,version,operation_key,input_json,result_json,source_label,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
 metricInsert.run(org,'scope-prospect-measurement',visit.id,1,'scope-prospect-measurement','{}','{"materialNeeds":[]}','Fixture confidentialité',owner,stamp);
 metricInsert.run(org,'scope-assigned-measurement',linked.id,1,'scope-assigned-measurement','{}','{"materialNeeds":[]}','Fixture affectée',owner,stamp);
 for(const suffix of ['/procurement','/tasks']){
  check('Assigned measurement derivative remains readable '+suffix,(await api(uid,'/api/measurements/scope-assigned-measurement'+suffix)).status===200);
  check('Prospect measurement derivative denied '+suffix,(await api(uid,'/api/measurements/scope-prospect-measurement'+suffix)).status===403);
 }
 // A real archive can leave a legacy visit behind; do not let that hide every
 // other dossier from the owner. This does not fabricate a cross-tenant ID.
 const archivedQuote=(await ok('/api/quotes','POST',quoteData(a))).quote;
 const orphan=(await ok('/api/quote-visits','POST',{customerId:a.id,place:'Visite de devis archivé',operationKey:'scope-archived-visit'})).visit;
 await ok('/api/quote-visits/'+orphan.id+'/quote','POST',{quoteId:archivedQuote.id});
 db.prepare('UPDATE quotes_server SET archived_at=? WHERE organization_id=? AND id=?').run(stamp,org,archivedQuote.id);
 const orphanList=await api(owner,'/api/quote-visits');
 check('An archived-quote visit does not break the entire owner list',orphanList.status===200&&orphanList.body.visits.some(v=>v.id===linked.id)&&!orphanList.body.visits.some(v=>v.id===orphan.id));
 check('The orphan visit detail remains unavailable',(await api(owner,'/api/quote-visits/'+orphan.id)).status===404);
 // Even a whole-project reader still needs the customer-directory right for
 // a prospect. Search must not disclose references denied by GET /quotes.
 db.prepare("INSERT INTO role_permissions(role_id,permission_code) VALUES(?,'projects.view.all')").run(role);
 const search=await api(uid,'/api/search?q='+encodeURIComponent(prospect.reference));
 check('Global search excludes a prospect without customers.view',search.status===200&&!search.body.groups.some(g=>g.id==='quotes'&&g.items.some(item=>item.id===prospect.id)));
 const stateAfter=(await ok('/api/state')).state;
 check('All original historical quotes stay exact',isDeepStrictEqual(stateAfter.quotes,stateBefore.quotes));
 check('All original contacts and jobs stay exact',isDeepStrictEqual(stateAfter.contacts,stateBefore.contacts)&&isDeepStrictEqual(stateAfter.jobs,stateBefore.jobs));
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
}finally{opened.close();rmSync(directory,{recursive:true,force:true})}
assert.deepEqual(failures,[],failures.length+' failed commercial scope checks');
console.log('PASS real API and disposable SQLite commercial client scope');
