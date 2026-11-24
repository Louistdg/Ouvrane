import assert from 'node:assert/strict';
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openProductionDatabase} from '../scripts/production-db.mjs';
const worker=(await import('../dist/server/index.js')).default;
const dir=mkdtempSync(fileURLToPath(new URL('../work/tmp/pagination-',import.meta.url))),databasePath=join(dir,'test.sqlite');
copyFileSync(new URL('../data/socle.sqlite',import.meta.url),databasePath);
const opened=openProductionDatabase({databasePath,migrationsDirectory:fileURLToPath(new URL('../drizzle/',import.meta.url))}),db=opened.database;
const members=db.prepare("SELECT om.organization_id,om.user_id,r.code FROM organization_members om JOIN roles r ON r.id=om.role_id AND r.organization_id=om.organization_id WHERE om.status='active'").all();
const owner=members.find(m=>m.code==='OWNER'),workerId=members.find(m=>m.organization_id===owner.organization_id&&m.code==='WORKER').user_id;
let org=owner.organization_id,checks=0;
async function api(path,uid=owner.user_id,organization=org,method='GET',body){const r=await worker.fetch(new Request('https://socle.local'+path,{method,headers:{'oai-authenticated-user-id':uid,'x-socle-organization-id':organization,origin:'https://socle.local','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{DB:opened.DB});return{status:r.status,body:await r.json()};}
function check(label,actual,expected=true){assert.deepEqual(actual,expected,label);checks++;console.log('PASS '+label);}
try{
 const original=await api('/api/state');
 db.exec('BEGIN');
 const customer=db.prepare("INSERT INTO customers(id,organization_id,type,company_name,street,created_at,updated_at,archived_at) VALUES(?,?,'company',?,?,'2026-01-01','2026-01-01',?)");
 const supplier=db.prepare("INSERT INTO suppliers(id,organization_id,name,created_at,updated_at) VALUES(?,?,?,'2026-01-01','2026-01-01')");
 for(let i=0;i<301;i++){const n=String(i).padStart(3,'0'),label=String(Math.floor(i/2)).padStart(3,'0');customer.run('qa02-active-'+n,org,'ZZQA02 active '+label,'Rue '+n,null);customer.run('qa02-archive-'+n,org,'ZZQA02 archive '+label,'Rue '+n,'2026-02-01');supplier.run('qa02-supplier-'+n,org,'ZZQA02 supplier '+label);}
 db.exec('COMMIT');
 for(const [path,key,prefix]of [['/api/customers?q=ZZQA02%20active&status=active','customers','qa02-active-'],['/api/customers?q=ZZQA02%20archive&status=archived','customers','qa02-archive-'],['/api/suppliers?q=ZZQA02%20supplier','suppliers','qa02-supplier-']]){
  let cursor=null,ids=[],sizes=[],firstCursor;
  do{const r=await api(path+'&limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):''));check('Page authorized '+key,r.status,200);assert.ok(r.body[key].length<=50);ids.push(...r.body[key].map(x=>x.id));sizes.push(r.body[key].length);cursor=r.body.nextCursor;firstCursor??=cursor;if(ids.length===50)check('More than 250 entries expose a bounded next page',typeof cursor,'string');assert.ok(sizes.length<10,'No cursor loop');}while(cursor);
  check('301 identities in stable label/id order '+prefix,ids,Array.from({length:301},(_,i)=>prefix+String(i).padStart(3,'0')));check('No duplicated identity '+prefix,new Set(ids).size,301);check('Last page is bounded and ends traversal '+prefix,sizes,[50,50,50,50,50,50,1]);
  check('Cursor cannot be reused with another search '+prefix,(await api(path.replace('ZZQA02','other')+'&cursor='+encodeURIComponent(firstCursor))).status,400);
 }
 let oddCursor=null,oddIds=[];
 do{const r=await api('/api/customers?q=ZZQA02%20active&limit=51'+(oddCursor?'&cursor='+encodeURIComponent(oddCursor):''));assert.equal(r.status,200);oddIds.push(...r.body.customers.map(c=>c.id));oddCursor=r.body.nextCursor;}while(oddCursor);
 check('Homonyms split across an odd page boundary retain every identity',oddIds,Array.from({length:301},(_,i)=>'qa02-active-'+String(i).padStart(3,'0')));
 check('Search reaches client beyond 250',(await api('/api/customers?q=ZZQA02%20active%20150&limit=50')).body.customers.map(x=>x.id),['qa02-active-300']);
 check('Search reaches archived client beyond 250',(await api('/api/customers?q=ZZQA02%20archive%20150&status=archived&limit=50')).body.customers.map(x=>x.id),['qa02-archive-300']);
 check('Search reaches supplier beyond 250',(await api('/api/suppliers?q=ZZQA02%20supplier%20150&limit=50')).body.suppliers.map(x=>x.id),['qa02-supplier-300']);
 check('Literal percent is not a wildcard',(await api('/api/customers?q=%25&limit=50')).body.customers,[]);
 check('Noninteger limit is rejected',(await api('/api/customers?limit=1.5')).status,400);
 check('Malformed cursor is rejected',(await api('/api/suppliers?cursor=invalid')).status,400);
 check('Worker cannot list company clients',(await api('/api/customers',workerId)).status,403);
 check('Worker cannot list suppliers',(await api('/api/suppliers',workerId)).status,403);
 const other=(await api('/api/organizations',owner.user_id,org,'POST',{name:'QA02 seconde entreprise'})).body.organization.id;
 const page=await api('/api/customers?q=ZZQA02&limit=50');
 check('Second organization does not inherit records',(await api('/api/customers?q=ZZQA02',owner.user_id,other)).body.customers,[]);
 check('Cursor is bound to organization',(await api('/api/customers?q=ZZQA02&cursor='+encodeURIComponent(page.body.nextCursor),owner.user_id,other)).status,400);
 check('No membership cannot read other organization',(await api('/api/customers',workerId,other)).status,403);
 check('Pagination preserves business workspace',(await api('/api/state')).body.state,original.body.state);
 console.log('PASS '+checks+' pagination API assertions');
}finally{db.close();rmSync(dir,{recursive:true,force:true});}
