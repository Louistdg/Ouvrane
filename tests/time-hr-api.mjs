import assert from 'node:assert/strict';
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';
import {openProductionDatabase} from '../scripts/production-db.mjs';
import worker from '../dist/server/index.js';
import {DatabaseSync} from 'node:sqlite';
const folder=mkdtempSync(join(tmpdir(),'ouvrane-time-rh-')),databasePath=join(folder,'test.sqlite');
const seed=new URL('../data/socle.sqlite',import.meta.url),seedDb=new DatabaseSync(fileURLToPath(seed),{readOnly:true});
try{for(const name of ['production_credentials','production_sessions'])assert.equal(seedDb.prepare('SELECT COUNT(*) n FROM '+name).get().n,0,'A clean local fixture without real credentials or sessions is required')}finally{seedDb.close()}
copyFileSync(seed,databasePath);
const opened=openProductionDatabase({databasePath,migrationsDirectory:fileURLToPath(new URL('../drizzle/',import.meta.url))}),db=opened.database;
const initial=db.prepare("SELECT om.user_id,om.organization_id FROM organization_members om JOIN roles r ON r.id=om.role_id WHERE om.status='active' AND r.code='OWNER' LIMIT 1").get();
let org=initial.organization_id;const owner=initial.user_id,stamp='2026-10-24T10:00:00Z',date='2026-10-24';let checks=0;
async function api(path,method='GET',body,uid=owner,organization=org){const response=await worker.fetch(new Request('https://socle.local'+path,{method,headers:{'oai-authenticated-user-id':uid,'x-socle-organization-id':organization,origin:'https://socle.local','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB:opened.DB});return {status:response.status,body:await response.json()}}
async function ok(path,method='GET',body,uid=owner){const r=await api(path,method,body,uid);assert.ok(r.status>=200&&r.status<300,path+' '+r.status+' '+JSON.stringify(r.body));return r.body}
function check(label,a,b=true){assert.deepEqual(a,b,label);console.log('PASS '+label);checks++}
function user(label,person,code,permissions){const role=db.prepare('SELECT id FROM roles WHERE organization_id=? AND code=?').get(org,code).id;db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(role);for(const permission of permissions)db.prepare('INSERT INTO role_permissions VALUES(?,?)').run(role,permission);db.prepare('INSERT INTO profiles(id,first_name,last_name,email,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(label,label,'Test',label+'@simulation.invalid',stamp,stamp);db.prepare('INSERT INTO organization_members(id,organization_id,user_id,role_id,status,person_id,joined_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(label+'-member',org,label,role,'active',person,stamp,stamp,stamp);db.prepare('INSERT INTO project_access VALUES(?,?,?,?,?)').run(org,label,'tr-job',owner,stamp)}
const arrival=(team,people,time='08:00',day=date)=>({projectId:'tr-job',teamId:team,date:day,people:people.map(personId=>({personId,arrival:time})),note:'Isolated regression'});
try{
 org=(await ok('/api/organizations','POST',{name:'Time RH isolated regression'})).organization.id;
 await ok('/api/state');const state=JSON.parse(db.prepare('SELECT payload FROM organization_workspace_state WHERE organization_id=?').get(org).payload);
 state.people=[];state.teams=[];state.assignments=[];state.jobs=[{id:'tr-job',name:'Time project',timeEntries:[]},{id:'tr-other-job',name:'Other project',timeEntries:[]}];state.company={...state.company,morningBreakMinutes:10,lunchBreakMinutes:20};db.prepare('UPDATE organization_workspace_state SET payload=? WHERE organization_id=?').run(JSON.stringify(state),org);
 for(const p of ['tr-worker','tr-lead','tr-other','tr-outsider'])db.prepare('INSERT INTO hr_people(organization_id,id,display_name,source,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(org,p,p,'manual',stamp,stamp);
 for(const team of ['tr-team-a','tr-team-b'])db.prepare('INSERT INTO hr_teams(organization_id,id,name,source,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(org,team,team,'manual',stamp,stamp);
 for(const [person,team] of [['tr-worker','tr-team-a'],['tr-lead','tr-team-a'],['tr-other','tr-team-b']])db.prepare('INSERT INTO hr_team_members(organization_id,id,team_id,person_id,starts_on,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(org,person+'-member',team,person,'2026-01-01',stamp,stamp);
 const own=['workspace.view','projects.view.assigned','time_entries.view.own','time_entries.create.own','time_entries.correction.request'];
 user('tr-user-worker','tr-worker','WORKER',own);user('tr-user-lead','tr-lead','TEAM_LEAD',[...own,'time_entries.view.team','time_entries.create.team']);
 user('tr-user-denied','tr-outsider','ACCOUNTING',['workspace.view','projects.view.assigned']);
 const assignment=async(team,people,start,end,day=date)=>ok('/api/assignments','POST',{projectId:'tr-job',teamId:team,date:day,people,startTime:start,endTime:end,status:'planned',assignmentType:'team'});
 await assignment('tr-team-a',['tr-worker','tr-lead'],'08:00','12:00');await assignment('tr-team-a',['tr-worker'],'13:00','16:00');await assignment('tr-team-b',['tr-other'],'08:00','12:00');
 const r=await api('/api/time-entries/arrival','POST',arrival('tr-team-a',['tr-worker']), 'tr-user-worker');check('HR-only team arrival succeeds without workspace team',r.status,201);const id=r.body.ids[0];
 check('No duplicate open clock',(await api('/api/time-entries/arrival','POST',arrival('tr-team-a',['tr-worker']),'tr-user-worker')).status,409);
 check('Worker cannot clock colleague',(await api('/api/time-entries/arrival','POST',arrival('tr-team-a',['tr-lead']),'tr-user-worker')).status,403);
 check('Non-time role denied',(await api('/api/time-entries/arrival','POST',arrival('tr-team-a',['tr-worker']),'tr-user-denied')).status,403);
 check('Team leader cannot clock other team',(await api('/api/time-entries/arrival','POST',arrival('tr-team-b',['tr-other']),'tr-user-lead')).status,403);
 check('Unplanned person refused',(await api('/api/time-entries/arrival','POST',arrival('tr-team-a',['tr-outsider']))).status,400);
 check('Worker cannot change project scope',(await api('/api/time-entries/arrival','POST',{...arrival('tr-team-a',['tr-worker']),projectId:'tr-other-job'},'tr-user-worker')).status,403);
 check('Foreign organization refused',(await api('/api/time-entries','GET',undefined,'tr-user-worker','foreign-time-org')).status,403);
 const foreign=await ok('/api/time-entries/arrival','POST',arrival('tr-team-b',['tr-other']));const foreignId=foreign.ids[0];await ok('/api/time-entries/'+foreignId+'/departure','POST',{departure:'12:00',personIds:['tr-other']});
 check('Team history excludes other HR team',(await ok('/api/time-entries','GET',undefined,'tr-user-lead')).entries.some(x=>x.id===foreignId),false);
 check('Monthly report excludes other HR team',(await ok('/api/time-entries/monthly?month=2026-10','GET',undefined,'tr-user-lead')).entries.some(x=>x.id===foreignId),false);
 check('Leader reads HR team member clock',(await ok('/api/time-entries','GET',undefined,'tr-user-lead')).entries.some(x=>x.id===id));
 check('Worker cannot close other persons',(await api('/api/time-entries/'+id+'/departure','POST',{departure:'12:00',personIds:['tr-lead']},'tr-user-worker')).status,400);
 await ok('/api/time-entries/'+id+'/departure','POST',{departure:'12:00',personIds:['tr-worker']},'tr-user-worker');
 let entry=(await ok('/api/time-entries/mine','GET',undefined,'tr-user-worker')).entries.find(x=>x.id===id);check('Departure saved',entry.departure,'12:00');check('Break deduction unchanged',entry.breakMinutes,30);
 check('Closed time overlap refused',(await api('/api/time-entries/arrival','POST',arrival('tr-team-a',['tr-worker'],'11:00'),'tr-user-worker')).status,409);
 const group=await ok('/api/time-entries/arrival','POST',arrival('tr-team-a',['tr-worker','tr-lead'],'13:00'),'tr-user-lead');const gid=group.ids[0];
 check('Team clock unions planned people across day',(await ok('/api/time-entries','GET',undefined,'tr-user-lead')).entries.find(x=>x.id===gid).people.length,2);
 const mine=(await ok('/api/time-entries/mine','GET',undefined,'tr-user-worker')).entries.find(x=>x.id===gid);check('Own history hides teammate identity',mine.people,['tr-worker']);
 const ownMonth=await ok('/api/time-entries/monthly?month=2026-10','GET',undefined,'tr-user-worker');check('Own monthly summary hides teammate identities',ownMonth.people.every(p=>p.personId==='tr-worker'));
 const split=await ok('/api/time-entries/'+gid+'/departure','POST',{departure:'15:00',personIds:['tr-worker']},'tr-user-lead');check('Partial departure supported',split.split,true);
 await ok('/api/time-entries/'+gid+'/departure','POST',{departure:'16:00',personIds:['tr-lead']},'tr-user-lead');
 const requested=await ok('/api/time-entries/'+id+'/corrections','POST',{arrival:'08:15',departure:'12:00',personId:'tr-worker',reason:'Regression correction'},'tr-user-worker');
 check('Correction waits for approval',(await ok('/api/time-entries/mine','GET',undefined,'tr-user-worker')).entries.find(x=>x.id===id).arrival,'08:00');
 const cid=db.prepare('SELECT id FROM time_entry_corrections WHERE organization_id=? AND time_entry_id=?').get(org,id).id;
 check('Worker cannot approve own correction',(await api('/api/time-entry-corrections/'+cid+'/review','POST',{approved:true},'tr-user-worker')).status,403);
 await ok('/api/time-entry-corrections/'+cid+'/review','POST',{approved:true});check('Owner approval persists corrected arrival',(await ok('/api/time-entries/mine','GET',undefined,'tr-user-worker')).entries.some(x=>x.arrival==='08:15'));
 await assignment('tr-team-a',['tr-worker','tr-lead'],'08:00','10:00','2026-10-28');const closedGroup=await ok('/api/time-entries/arrival','POST',arrival('tr-team-a',['tr-worker','tr-lead'],'08:00','2026-10-28'));await ok('/api/time-entries/'+closedGroup.ids[0]+'/departure','POST',{departure:'10:00',personIds:['tr-worker','tr-lead']});const ownClosedMonth=await ok('/api/time-entries/monthly?month=2026-10','GET',undefined,'tr-user-worker');check('Own closed group hours count the worker only',ownClosedMonth.summary.totalHours,6.25);check('Own closed group summaries contain no teammate',ownClosedMonth.people.every(p=>p.personId==='tr-worker'));
 const cancelled=await assignment('tr-team-a',['tr-worker'],'08:00','12:00','2026-10-25');await ok('/api/assignments/'+cancelled.id,'DELETE');check('Cancelled assignment cannot authorize clock',(await api('/api/time-entries/arrival','POST',arrival('tr-team-a',['tr-worker'],'08:00','2026-10-25'),'tr-user-worker')).status,400);
 db.prepare('UPDATE hr_team_members SET ends_on=? WHERE organization_id=? AND person_id=?').run('2026-10-23',org,'tr-lead');check('Ended HR membership denies team clock',(await api('/api/time-entries/arrival','POST',arrival('tr-team-a',['tr-worker'],'16:00'),'tr-user-lead')).status,403);
 db.prepare('UPDATE hr_teams SET active=0 WHERE organization_id=? AND id=?').run(org,'tr-team-a');check('Inactive HR team refused',(await api('/api/time-entries/arrival','POST',arrival('tr-team-a',['tr-worker'],'16:00'),'tr-user-worker')).status,404);
 check('Legacy workspace is not patched to force access',JSON.parse(db.prepare('SELECT payload FROM organization_workspace_state WHERE organization_id=?').get(org).payload).teams,[]);
 const originalOrg=org;org=(await ok('/api/organizations','POST',{name:'Legacy time compatibility'})).organization.id;await ok('/api/state');const legacy=JSON.parse(db.prepare('SELECT payload FROM organization_workspace_state WHERE organization_id=?').get(org).payload);legacy.jobs=[{id:'legacy-time-job',name:'Legacy',timeEntries:[]}];legacy.people=[{id:'legacy-time-person',name:'Legacy person'}];legacy.teams=[{id:'legacy-time-team',name:'Legacy team',members:['legacy-time-person']}];legacy.assignments=[{id:'legacy-time-assignment',date,job:'legacy-time-job',team:'legacy-time-team',people:['legacy-time-person']}];db.prepare('UPDATE organization_workspace_state SET payload=? WHERE organization_id=?').run(JSON.stringify(legacy),org);
 check('Legacy teams still support arrival',(await api('/api/time-entries/arrival','POST',{projectId:'legacy-time-job',teamId:'legacy-time-team',date,people:[{personId:'legacy-time-person',arrival:'08:00'}]})).status,201);org=originalOrg;
 check('Database foreign keys valid',db.prepare('PRAGMA foreign_key_check').all(),[]);console.log('PASS '+checks+' time RH regression assertions');
}finally{opened.close();rmSync(folder,{recursive:true,force:true})}
