import assert from 'node:assert/strict';
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openProductionDatabase} from '../scripts/production-db.mjs';
const worker=(await import('../dist/server/index.js')).default;
const directory=mkdtempSync(join(tmpdir(),'socle-contact-history-')),databasePath=join(directory,'socle.sqlite');copyFileSync(new URL('../data/socle.sqlite',import.meta.url),databasePath);
const opened=openProductionDatabase({databasePath,migrationsDirectory:fileURLToPath(new URL('../drizzle/',import.meta.url))}),db=opened.database;
let owner,org,checks=0;
async function api(path,method='GET',body,uid=owner,organization=org){const r=await worker.fetch(new Request('https://socle.local'+path,{method,headers:{'oai-authenticated-user-id':uid,'x-socle-organization-id':organization,origin:'https://socle.local',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB:opened.DB});return {status:r.status,body:await r.json()}}
async function ok(path,method='GET',body,uid=owner){const r=await api(path,method,body,uid);assert.ok(r.status>=200&&r.status<300,path+' HTTP'+r.status+' '+JSON.stringify(r.body));return r.body}
function check(label,actual,expected=true){assert.deepEqual(actual,expected,label);checks++;console.log('PASS '+label)}
const snapshot=()=>Object.fromEntries(['organization_workspace_state','quotes_server','customers','audit_logs','quote_create_operations'].map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]));
try{
 const m=db.prepare("SELECT om.organization_id,om.user_id FROM organization_members om JOIN roles r ON r.id=om.role_id AND r.organization_id=om.organization_id WHERE om.status='active' AND r.code='OWNER' ORDER BY om.joined_at LIMIT 1").get();assert.ok(m);org=m.organization_id;owner=m.user_id;
 const original=await ok('/api/state'),history=original.state.quotes,quote=history.find(q=>(q.projectId??q.job)!=null&&q.lines?.some(line=>Number(line.price)>0));assert.ok(quote,'Use an actual preserved historical quote with prices');const route='/api/quote-history/'+encodeURIComponent(quote.id),before=snapshot();
 const response=await api(route);check('Historical quote has a real read-only detail route',response.status,200);check('Historical document stays exact including unknown source fields',response.body.quote,quote);check('Historical detail is explicitly read-only',response.body.readOnly);check('Owner historical detail allows prices',response.body.pricesVisible);check('Reading history creates no SQL copy, audit or workspace change',snapshot(),before);
 check('History route refuses mutation',(await api(route,'POST',{title:'Overwrite'})).status,405);check('Unknown historical ID does not resolve by title or label',(await api('/api/quote-history/'+encodeURIComponent('unknown/quote\"\''))).status,404);check('Foreign company cannot access history',(await api(route,'GET',undefined,owner,'other-company')).status,403);
 const customer=(await ok('/api/customers','POST',{type:'company',companyName:'QA19 current quote'})).customer;
 const live=(await ok('/api/quotes','POST',{customerId:customer.id,title:'QA19 SQL quote',client:'QA19',date:'2026-10-21',validUntil:'2026-11-21',lines:[{label:'Travail',qty:1,unit:'h',price:5,vat:21}],operationKey:'qa19-history-sql-create'})).quote;
 check('SQL UUID is never mistaken for legacy history',(await api('/api/quote-history/'+encodeURIComponent(live.id))).status,404);check('Current SQL detail reports current price visibility',(await ok('/api/quotes/'+live.id)).pricesVisible);
 const office='qa19-office',stamp='2026-10-21T04:00:00Z',role=db.prepare("SELECT id FROM roles WHERE organization_id=? AND code='WORKER'").get(org);assert.ok(role);
 db.prepare('INSERT INTO profiles(id,first_name,last_name,email,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(office,'QA19','Bureau','qa19.office@simulation.invalid',stamp,stamp);
 db.prepare('INSERT INTO organization_members(id,organization_id,user_id,role_id,status,joined_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('qa19-office-member',org,office,role.id,'active',stamp,stamp,stamp);
 const profile={profileName:'Bureau sans prix',scope:'Toute l’entreprise',modules:{quotes:{view:true,add:false,edit:false},jobs:{view:true}},sensitive:{quotePrices:false},fieldActions:{},projectIds:[]};await ok('/api/access-control/'+office,'PUT',profile);
 const unpriced=await api(route,'GET',undefined,office);check('Configured office can open historical detail',unpriced.status,200);check('Historical price visibility comes from real current permissions',unpriced.body.pricesVisible,false);
 const forbidden=new Set(['price','amount','total','totalcents','deposit','paymentterms','vat','vatrate']),leaks=[];function inspect(value,path='quote'){if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if(forbidden.has(key.toLowerCase().replace(/[_-]/g,'')))leaks.push(path+'.'+key);inspect(item,path+'.'+key)}}inspect(unpriced.body.quote);check('Historical response contains no forbidden price fields',leaks,[]);
 check('Unpriced document retains execution descriptions',unpriced.body.quote.lines.map(line=>line.label),quote.lines.map(line=>line.label));
 await ok('/api/access-control/'+office,'PUT',{...profile,scope:'Ses chantiers uniquement',projectIds:[String(quote.projectId??quote.job)]});check('Assigned historical project stays readable',(await api(route,'GET',undefined,office)).status,200);
 const other=history.find(q=>(q.projectId??q.job)!=null&&String(q.projectId??q.job)!==String(quote.projectId??quote.job));assert.ok(other);check('Historical document on another project is denied',(await api('/api/quote-history/'+encodeURIComponent(other.id),'GET',undefined,office)).status,403);
 await ok('/api/access-control/'+office,'PUT',{...profile,modules:{jobs:{view:true}}});check('Revoking quote permission revokes detail immediately',(await api(route,'GET',undefined,office)).status,403);
 check('Historical source quotes stay exact after every read and refusal',(await ok('/api/state')).state.quotes,history);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);console.log('PASS '+checks+' real contact history API assertions');
}finally{opened.close();rmSync(directory,{recursive:true,force:true})}
