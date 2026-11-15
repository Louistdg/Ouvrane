import assert from 'node:assert/strict';
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {openProductionDatabase} from '../scripts/production-db.mjs';
import worker from '../dist/server/index.js';
const dir=mkdtempSync(join(tmpdir(),'ouvrane-hr-audit-')),databasePath=join(dir,'test.sqlite');
copyFileSync(new URL('../data/socle.sqlite',import.meta.url),databasePath);
const opened=openProductionDatabase({databasePath,migrationsDirectory:fileURLToPath(new URL('../drizzle/',import.meta.url))}),db=opened.database;
const owner=db.prepare("SELECT om.user_id,om.organization_id FROM organization_members om JOIN roles r ON r.id=om.role_id AND r.organization_id=om.organization_id WHERE om.status='active' AND r.code='OWNER' LIMIT 1").get();
let org=owner.organization_id,checks=0;
async function api(path,method='GET',body,organization=org){const r=await worker.fetch(new Request('https://socle.local'+path,{method,headers:{'oai-authenticated-user-id':owner.user_id,'x-socle-organization-id':organization,origin:'https://socle.local','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{DB:opened.DB});return{status:r.status,body:await r.json()};}
function check(label,actual,expected){assert.deepEqual(actual,expected,label);checks++;console.log('PASS '+label);}
function legacy(state){db.prepare('UPDATE organization_workspace_state SET payload=?,revision=revision+1 WHERE organization_id=?').run(JSON.stringify(state),org);}
try{
 const created=await api('/api/organizations','POST',{name:'QA incremental audit'});assert.equal(created.status,201);org=created.body.organization.id;
 check('Empty HR directory initializes normally',(await api('/api/hr/people')).status,200);
 const state=JSON.parse(db.prepare('SELECT payload FROM organization_workspace_state WHERE organization_id=?').get(org).payload);
 state.people=[{id:'qa-morgan',name:'QA Morgan',role:'Chef A',start:'2026-10-22',contract:'CDI'},{id:'qa-robin',name:'QA Robin',role:'Ouvrier',inactiveAt:'2026-10-23'}];
 state.teams=[{id:'qa-team-a',name:'QA A',members:['qa-morgan']}];legacy(state);
 const roster=await api('/api/hr/people');check('People created after the empty import are visible',roster.status,200);
 check('Morgan imported once',db.prepare('SELECT COUNT(*) n FROM hr_people WHERE organization_id=? AND id=?').get(org,'qa-morgan').n,1);
 check('Inactive legacy person stays inactive',db.prepare('SELECT active FROM hr_people WHERE organization_id=? AND id=?').get(org,'qa-robin').active,0);
 check('New person employment imported',db.prepare('SELECT COUNT(*) n FROM employment_records WHERE organization_id=? AND person_id=?').get(org,'qa-morgan').n,1);
 check('Initial new-person membership imported',db.prepare('SELECT COUNT(*) n FROM hr_team_members WHERE organization_id=? AND person_id=? AND ends_on IS NULL').get(org,'qa-morgan').n,1);
 db.prepare('UPDATE hr_people SET display_name=?,active=0 WHERE organization_id=? AND id=?').run('Relational authority',org,'qa-morgan');
 db.prepare('UPDATE hr_team_members SET ends_on=? WHERE organization_id=? AND person_id=?').run('2026-10-23',org,'qa-morgan');
 const beforeAudits=db.prepare('SELECT COUNT(*) n FROM audit_logs WHERE organization_id=?').get(org).n;
 await api('/api/hr/people');await api('/api/hr/teams');
 check('Replay preserves relational archive and name', {...db.prepare('SELECT display_name,active FROM hr_people WHERE organization_id=? AND id=?').get(org,'qa-morgan')},{display_name:'Relational authority',active:0});
 check('Replay never resurrects ended membership',db.prepare('SELECT COUNT(*) n FROM hr_team_members WHERE organization_id=? AND person_id=? AND ends_on IS NULL').get(org,'qa-morgan').n,0);
 check('Unchanged reads do not emit import audit events',db.prepare('SELECT COUNT(*) n FROM audit_logs WHERE organization_id=?').get(org).n,beforeAudits);
 check('Tenant does not receive another tenant person',db.prepare('SELECT COUNT(*) n FROM hr_people WHERE organization_id=? AND id=?').get(owner.organization_id,'qa-morgan').n,0);
 state.people.push({id:'qa-sam',name:'QA Sam',role:'Chef B',start:'2026-10-22'});state.jobs=[{id:'qa-job',name:'QA chantier'}];legacy(state);
 await api('/api/hr/people');
 check('A later person is imported after repeated reads',db.prepare('SELECT COUNT(*) n FROM hr_people WHERE organization_id=? AND id=?').get(org,'qa-sam').n,1);
 const team=(await api('/api/hr/teams','POST',{name:'QA B'})).body.team;
 // Composition memberships start today (worker clock); a fixed assignment date goes stale once past.
 const assignment={projectId:'qa-job',teamId:team.id,date:new Date(Date.now()+86400000).toISOString().slice(0,10),people:['qa-sam'],startTime:'08:00',endTime:'12:00',assignmentType:'team',status:'planned'};
 check('Unassigned person is still rejected by planning',(await api('/api/assignments','POST',assignment)).status,400);
 const moved=await api('/api/hr/composition/move','POST',{personId:'qa-sam',expectedTeamIds:[],teamIds:[team.id],operationKey:'qa-sam-move-audit'});
 check('Normal team composition succeeds',moved.status,200);
 check('Composed team can be assigned',(await api('/api/assignments','POST',assignment)).status,201);
 await api('/api/hr/people');
 check('Later import leaves new composition intact',(await api('/api/hr/teams/'+team.id)).body.team.memberIds,['qa-sam']);
 const asset=await api('/api/assets','POST',{name:'QA vehicle',purchasePrice:12000,currentValue:9000,vehicle:{year:'2020',lastService:'2026-10-01',nextService:'2027-10-01',tyres:'4 saisons',mainDriver:'QA Morgan'}});
 check('Asset created',asset.status,201);
 const persisted=JSON.parse(db.prepare('SELECT payload_json FROM field_assets WHERE organization_id=? AND id=?').get(org,asset.body.id).payload_json);
 check('Purchase value persists',persisted.purchasePrice,12000);check('Current value persists',persisted.currentValue,9000);
 check('Vehicle details persist',persisted.vehicle,{year:'2020',lastService:'2026-10-01',nextService:'2027-10-01',tyres:'4 saisons',mainDriver:'QA Morgan'});
 check('Negative financial value rejected',(await api('/api/assets/'+asset.body.id,'PATCH',{purchasePrice:-1})).status,400);
 check('Foreign tenant cannot mutate asset',(await api('/api/assets/'+asset.body.id,'PATCH',{name:'foreign'},owner.organization_id)).status,404);
 check('SQLite foreign keys remain valid',db.prepare('PRAGMA foreign_key_check').all(),[]);
 console.log(`PASS ${checks} audit backend assertions`);
}finally{db.close();rmSync(dir,{recursive:true,force:true});}
