import assert from 'node:assert/strict';
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openProductionDatabase} from '../scripts/production-db.mjs';
const worker=(await import('../dist/server/index.js')).default;
const directory=mkdtempSync(join(tmpdir(),'socle-home-layout-')),databasePath=join(directory,'socle.sqlite');
copyFileSync(new URL('../data/socle.sqlite',import.meta.url),databasePath);
const opened=openProductionDatabase({databasePath,migrationsDirectory:fileURLToPath(new URL('../drizzle/',import.meta.url))}),db=opened.database;
let organizationId,owner,terrain,checks=0;
async function api(path,method='GET',data,uid=owner,org=organizationId){
 const response=await worker.fetch(new Request('https://socle.local'+path,{method,headers:{'oai-authenticated-user-id':uid,'x-socle-organization-id':org,origin:'https://socle.local',...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),{DB:opened.DB});
 return {status:response.status,body:await response.json()};
}
function check(label,actual,expected=true){assert.deepEqual(actual,expected,label);console.log('PASS '+label);checks++}
const route='/api/me/preferences/dashboard/home-layout',body=(value,expectedValue)=>({schemaVersion:1,value,expectedValue});
const originalTables=()=>Object.fromEntries(['organization_workspace_state','quotes_server','customers','field_stock_movements','audit_logs'].map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]));
try{
 const members=db.prepare("SELECT om.organization_id,om.user_id,r.code FROM organization_members om JOIN roles r ON r.id=om.role_id AND r.organization_id=om.organization_id WHERE om.status='active'").all();
 const patron=members.find(m=>m.code==='OWNER');assert.ok(patron);organizationId=patron.organization_id;owner=patron.user_id;terrain=members.find(m=>m.organization_id===organizationId&&m.code==='WORKER')?.user_id;assert.ok(terrain);
 const company=await api('/api/organizations','POST',{name:'QA home-layout second company'});assert.equal(company.status,201);const otherOrganization=company.body.organization.id;
 const unchanged=originalTables();
 check('The existing home visibility setting has a real accepted server key',(await api('/api/me/preferences/dashboard/home-widgets')).status,200);
 check('Reading a new layout does not create a preference',(await api(route)).body.preference,null);
 const a={positions:{weather:{column:1,row:0,span:1},portals:{column:0,row:0,span:1}},mobileOrder:['portals','weather']};
 const first=await api(route,'PUT',body(a,null));check('A first layout is saved with an explicit empty baseline',first.status,200);check('The stored layout contains the submitted positions',first.body.preference.value,a);
 const rowBefore=db.prepare("SELECT * FROM user_preferences WHERE organization_id=? AND user_id=? AND preference_key='home-layout'").get(organizationId,owner);
 check('Retrying an acknowledged or lost response is replayed',(await api(route,'PUT',body(a,null))).body.replayed);
 check('Replaying a layout does not rewrite its database row',db.prepare("SELECT * FROM user_preferences WHERE organization_id=? AND user_id=? AND preference_key='home-layout'").get(organizationId,owner),rowBefore);
 const b={...a,positions:{...a.positions,weather:{column:0,row:20,span:2}}};
 check('A layout change without its baseline is refused',(await api(route,'PUT',{schemaVersion:1,value:b})).status,400);
 check('A stale second tab cannot overwrite the existing layout',(await api(route,'PUT',body(b,null))).status,409);
 check('Stale writes retain the acknowledged layout',(await api(route)).body.preference.value,a);
 check('A current baseline permits the next layout',(await api(route,'PUT',body(b,a))).status,200);
 const c={...b,mobileOrder:['weather','portals']},d={...b,mobileOrder:['portals']};
 const concurrent=await Promise.all([api(route,'PUT',body(c,b)),api(route,'PUT',body(d,b))]);
 check('Two concurrent different writes have one winner and one conflict',concurrent.map(r=>r.status).sort(),[200,409]);
 check('A foreign-organization layout is denied',(await api(route,'GET',undefined,owner,'not-this-organization')).status,403);
 check('A second account does not inherit the owner layout',(await api(route,'GET',undefined,terrain)).body.preference,null);
 check('The same owner has no inherited layout in a second real company',(await api(route,'GET',undefined,owner,otherOrganization)).body.preference,null);
 check('A second real company accepts its own independent layout',(await api(route,'PUT',body(a,null),owner,otherOrganization)).status,200);
 check('The second company layout does not replace the first',(await api(route)).body.preference.value,concurrent.find(r=>r.status===200).body.preference.value);
 check('A worker without membership cannot read the second company',(await api(route,'GET',undefined,terrain,otherOrganization)).status,403);
 check('A personal terrain preference does not grant access to customers',(await api('/api/customers','GET',undefined,terrain)).status,403);
 for(const value of [
  {...b,positions:{weather:{column:1,row:0,span:2}}},
  {...b,positions:{weather:{column:0,row:-1,span:1}}},
  {...b,positions:{unknown:{column:0,row:0,span:1}}},
  {...b,mobileOrder:['weather','weather']},
  {...b,permissions:['customers.view']}
 ])check('Malformed or authority-bearing layout is rejected',(await api(route,'PUT',body(value,(await api(route)).body.preference.value))).status,400);
 check('Visibility and geometry have separate preferences',(await api('/api/me/preferences/dashboard/home-widgets','PUT',{schemaVersion:1,value:{hidden:['weather']}})).status,200);
 check('A visibility change does not replace geometry',(await api(route)).body.preference.value,concurrent.find(r=>r.status===200).body.preference.value);
 check('Layout operations preserve workspace, quotes, customers, stock and audits',originalTables(),unchanged);
 console.log('PASS '+checks+' actual home-layout API assertions');
}finally{opened.close();rmSync(directory,{recursive:true,force:true})}
