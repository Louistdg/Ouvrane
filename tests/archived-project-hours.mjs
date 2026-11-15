import vm from 'node:vm';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,writeFileSync,readFileSync,existsSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const app=process.env.OUVRANE_TEST_APP||dirname(dirname(fileURLToPath(import.meta.url)));
const label=process.env.OUVRANE_TEST_LABEL||'top27';
if(!/^[A-Za-z0-9_-]{1,60}$/.test(label))throw Error('Invalid evidence label');
const out=process.env.OUVRANE_TEST_OUTPUT||join(tmpdir(),'ouvrane-hours-finance-regression');mkdirSync(out,{recursive:true});const run=mkdtempSync(join(out,label+'-'));
const hash=value=>createHash('sha256').update(value).digest('hex');
cpSync(fileURLToPath(import.meta.url),join(run,'test-executed.mjs'));
cpSync(join(app,'worker'),join(run,'runtime'),{recursive:true});
if(!existsSync(join(run,'runtime/measurement-engine.js')))cpSync(join(app,'dist/server/measurement-engine.js'),join(run,'runtime/measurement-engine.js'));
writeFileSync(join(run,'runtime/package.json'),'{"type":"module"}');
const worker=(await import(pathToFileURL(join(run,'runtime/index.js')))).default;
const {openProductionDatabase}=await import(pathToFileURL(join(app,'scripts/production-db.mjs')));
const opened=openProductionDatabase({databasePath:join(run,'synthetic.sqlite'),migrationsDirectory:join(app,'drizzle')}),db=opened.database;
const stamp='2026-10-27T06:00:00.000Z',checks=[],scenarios=[];
const sqlTrace=[],runtimeEnv={DB:{prepare(sql){sqlTrace.push(sql);return opened.DB.prepare(sql)},batch:statements=>opened.DB.batch(statements)}};
function check(name,actual,...expectation){const expected=expectation.length?expectation[0]:true;let pass=true;try{assert.deepEqual(actual,expected)}catch{pass=false}checks.push({name,pass,...(!pass?{actual,expected}:{})});console.log((pass?'PASS ':'FAIL ')+name+(!pass?' '+JSON.stringify({actual,expected}):''));}
function scenario(name,result){scenarios.push({name,...result});}
function rows(table,org){return db.prepare('SELECT * FROM '+table+' WHERE organization_id=? ORDER BY rowid').all(org)}
const snap=org=>JSON.stringify({entries:rows('time_entries',org),corrections:rows('time_entry_corrections',org),audits:rows('audit_logs',org)});
function user(id){db.prepare('insert or ignore into profiles(id,first_name,last_name,email,created_at,updated_at) values(?,?,?,?,?,?)').run(id,'Synthetic',id,id+'@example.invalid',stamp,stamp)}
function member(org,id,code,permissions=[],person=null){user(id);const role=org+'-'+code;db.prepare('insert or ignore into roles(id,organization_id,code,name,created_at) values(?,?,?,?,?)').run(role,org,code,code,stamp);db.prepare('insert into organization_members(id,organization_id,user_id,role_id,status,person_id,joined_at,created_at,updated_at) values(?,?,?,?,?,?,?,?,?)').run(org+'-'+id,org,id,role,'active',person,stamp,stamp,stamp);for(const p of permissions){db.prepare('insert or ignore into permissions(code,description) values(?,?)').run(p,p);db.prepare('insert or ignore into role_permissions(role_id,permission_code) values(?,?)').run(role,p)}return role}
function org(id,{owner='owner',withState=true}={}){db.prepare('insert into organizations(id,name,created_at,updated_at) values(?,?,?,?)').run(id,id,stamp,stamp);member(id,owner,'OWNER');if(withState)setState(id,baseState(id),owner);return id}
function baseState(id){return{version:3,company:{name:'Synthetic '+id,timeZone:'Europe/Brussels',morningBreakMinutes:0,lunchBreakMinutes:0},jobs:[{id:'job',name:'Synthetic project',timeEntries:[]}],people:[{id:'p1',name:'P1'},{id:'p2',name:'P2'},{id:'p3',name:'P3'}],teams:[{id:'team-a',members:['p1','p2']},{id:'team-b',members:['p3']}],assignments:[],quotes:[],assets:[],tasks:[],dossiers:[],reminders:[],contacts:[],accountingData:{customerInvoices:[],supplierBills:[]}}}
function setState(organization,payload,owner='owner'){db.prepare('insert into organization_workspace_state(organization_id,payload,revision,source_user_id,created_at,updated_at) values(?,?,1,?,?,?) on conflict(organization_id) do update set payload=excluded.payload').run(organization,JSON.stringify(payload),owner,stamp,stamp)}
function entry(organization,id,people,{team='team-a',arrival='08:00',departure=null,note='Synthetic entry',date='2026-10-26'}={}){db.prepare('insert into time_entries(id,organization_id,project_id,team_id,people_json,work_date,arrival,departure,break_minutes,note,created_by,created_at,updated_by,updated_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,organization,'job',team,JSON.stringify(people),date,arrival,departure,0,note,'owner',stamp,'owner',stamp)}
async function api(organization,path,{method='GET',body,user='owner',headers={}}={}){const response=await worker.fetch(new Request('https://socle.local'+path,{method,headers:{origin:'https://socle.local','oai-authenticated-user-id':user,'x-socle-organization-id':organization,...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),runtimeEnv);let data;const text=await response.text();try{data=JSON.parse(text)}catch{data=null}return{status:response.status,body:data,text}}
const depart=(organization,id,people,options={})=>api(organization,'/api/time-entries/'+id+'/departure',{method:'POST',body:{departure:'16:00',personIds:people,note:'Departure regression'},...options});
function population(organization){const entries=rows('time_entries',organization);return Object.fromEntries(['p1','p2'].map(person=>[person,{open:entries.filter(e=>!e.departure&&JSON.parse(e.people_json).includes(person)).length,closed:entries.filter(e=>e.departure&&JSON.parse(e.people_json).includes(person)).length}]))}

function ui(orgId,userId='owner',personId=null,permissions=[]){
 const c=vm.createContext({console:{warn(){}},URLSearchParams,Map,Promise,Number,Date,JSON,SOCLE_PRODUCTION:true,storageReady:false,
  activeSocleOrganizationId:orgId,socleCurrentAccess:{userId,personId,owner:userId==='owner',permissions,projectIds:['job']},
  jobs:[{id:'job',timeEntries:[]},{id:'fully-archived',timeEntries:[]}],render(){},esc:v=>String(v??''),jsString:v=>String(v),visibleClockEntry:()=>true});
 c.currentTimeAccess=()=>c.socleCurrentAccess;
 c.serverJson=async path=>{const r=await api(orgId,path,{user:userId});if(r.status!==200)throw Error('API '+r.status);return r.body};
 for(const [file,start,end] of [['web/business.js','function jobHours(','jobsView=function()'],['web/field-workflows.js','let serverTimeLoadSequence=','globalThis.loadServerTimeEntries=loadServerTimeEntries;']]){
  const text=readFileSync(join(app,file),'utf8'),a=text.indexOf(start),b=text.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);vm.runInContext(text.slice(a,b),c);
 }
 return{context:c,run:s=>vm.runInContext(s,c),load:()=>vm.runInContext('loadServerTimeEntries({renderAfter:false})',c)};
}
let fatal=null;
try{
 const a=org('archive-a'),b=org('archive-b'),state=baseState(a);
 state.jobs.push({id:'fully-archived',name:'Fully archived',timeEntries:[]},{id:'forbidden',name:'Forbidden',timeEntries:[]});setState(a,state);
 for(let i=0;i<125;i++)entry(a,'past-'+i,['p1','p2'],{date:'2026-09-'+String(1+Math.floor(i/5)).padStart(2,'0'),arrival:String(8+i%5).padStart(2,'0')+':00',departure:String(9+i%5).padStart(2,'0')+':00'});
 entry(a,'current',['p1','p2'],{date:'2026-10-01',departure:'10:00'});
 entry(a,'fully',['p3'],{team:'team-b',date:'2026-09-26',departure:'08:45'});
 db.prepare("UPDATE time_entries SET project_id='fully-archived' WHERE id='fully'").run();
 entry(b,'other-tenant',['p3'],{date:'2026-09-26',departure:'09:00'});
 member(a,'worker-a','WORKER',['projects.view.assigned','time_entries.view.own'],'p1');
 member(a,'lead-a','TEAM_LEAD',['projects.view.assigned','time_entries.view.team','time_entries.view.own'],'p1');
 member(a,'no-time','NO_TIME',['projects.view.all'],'p1');
 for(const u of ['worker-a','lead-a'])db.prepare('INSERT INTO project_access VALUES(?,?,?,?,?)').run(a,u,'job','owner',stamp);
 db.prepare("INSERT INTO project_financial_baselines(id,organization_id,project_id,version,status,planned_minutes,hourly_cost_cents,progress_basis_points,created_by,created_at,updated_by,updated_at) VALUES('archive-budget',?,'job',1,'active',20000,3000,5000,'owner',?,'owner',?)").run(a,stamp,stamp);
 for(const cat of ['LABOUR','MATERIALS','SUBCONTRACTING','EQUIPMENT','OTHER'])db.prepare('INSERT INTO project_cost_budgets(baseline_id,category,budget_cents) VALUES(?,?,?)').run('archive-budget',cat,cat==='LABOUR'?1000000:0);
 const owner=ui(a),own=ui(a,'worker-a','p1',['time_entries.view.own']),lead=ui(a,'lead-a','p1',['time_entries.view.team']);
 await owner.load();check('Project lifetime before closure is 254 person-hours',owner.run('jobHours(jobs[0])'),254);
 const beforeForecast=await api(a,'/api/projects/job/financial-forecast'),beforeCost=await api(a,'/api/projects/job/cost-control');
 check('Labour before closure is 7620 EUR',beforeCost.body.labour.actualCostCents,762000);
 const denied=await api(a,'/api/time-entries/monthly/close',{method:'POST',body:{month:'2026-09'},user:'worker-a'});check('Worker cannot close month',denied.status,403);
 const closed=await api(a,'/api/time-entries/monthly/close',{method:'POST',body:{month:'2026-09'}});check('Actual monthly closure succeeds',closed.status,200);check('126 closed entries archived',closed.body.newlyArchivedEntries,126);
 const replay=await api(a,'/api/time-entries/monthly/close',{method:'POST',body:{month:'2026-09'}});check('Closing again does not duplicate',replay.body.newlyArchivedEntries,0);
 const snapshot=snap(a);await owner.load();await own.load();await lead.load();
 check('Lifetime UI total survives month closure',owner.run('jobHours(jobs[0])'),254);
 check('Wholly archived project retains its 45 minutes',owner.run('jobHours(jobs[1])'),0.75);
 check('Worker sees own archived hours only',own.run('jobHours(jobs[0])'),127);
 check('Team lead retains authorized team hours',lead.run('jobHours(jobs[0])'),254);
 await owner.run("loadProjectTimeHistory('job')");check('First history page remains bounded',owner.context.jobs[0].timeEntries.length,100);
 await owner.run("loadProjectTimeHistory('job')");check('History contains all 126 active and archived entries',owner.context.jobs[0].timeEntries.length,126);
 check('History has no duplicate',new Set(owner.context.jobs[0].timeEntries.map(e=>e.id)).size,126);
 check('Pagination does not change lifetime hours',owner.run('jobHours(jobs[0])'),254);
 check('API default still excludes archived entries',(await api(a,'/api/time-entries')).body.entries.length,1);
 check('API default summary remains operational',(await api(a,'/api/time-entries/summary')).body.totals.minutes,240);
 check('Monthly report retains 250.75 person-hours',(await api(a,'/api/time-entries/monthly?month=2026-09')).body.summary.totalHours,250.75);
 check('Foreign tenant keeps its own lifetime total',(await api(b,'/api/time-entries/summary?include_archived=1')).body.totals.minutes,60);
 check('Forbidden project with archives refused',(await api(a,'/api/time-entries/summary?project_id=forbidden&include_archived=1',{user:'worker-a'})).status,403);
 check('No time permission still refused',(await api(a,'/api/time-entries/summary?include_archived=1',{user:'no-time'})).status,403);
 check('Worker cannot read profitability',(await api(a,'/api/projects/job/financial-forecast',{user:'worker-a'})).status,403);
 check('Preview limits archived hours to target person',(await api(a,'/api/time-entries/summary?project_id=job&include_archived=1',{headers:{'x-socle-access-preview-user-id':'worker-a'}})).body.totals.minutes,7620);
 const forecast=await api(a,'/api/projects/job/financial-forecast'),cost=await api(a,'/api/projects/job/cost-control');
 check('Forecast hours unchanged after archive',forecast.body.realized.labourMinutes,beforeForecast.body.realized.labourMinutes);
 check('Actual labour cost unchanged after archive',cost.body.labour.actualCostCents,beforeCost.body.labour.actualCostCents);
 check('Project cost and margins unchanged after archive',cost.body.costControl,beforeCost.body.costControl);
 check('All reads preserve archived records and audits',snap(a),snapshot);
 const request=await api(a,'/api/time-entries/past-0/corrections',{method:'POST',body:{arrival:'08:30',departure:'09:00',personId:'p1',reason:'Synthetic post-closure correction'}});check('Archived correction request accepted',request.status,201);
 check('Pending correction still visible in cost warning',(await api(a,'/api/projects/job/cost-control')).body.alerts.pendingTimeCorrections,1);
 const review=await api(a,'/api/time-entry-corrections/'+request.body.id+'/review',{method:'POST',body:{approved:true}});check('Archived individual correction approved',review.status,200);
 await owner.load();await own.load();check('Split correction reduces total by exactly half hour',owner.run('jobHours(jobs[0])'),253.5);check('Worker corrected lifetime is 126.5 hours',own.run('jobHours(jobs[0])'),126.5);
 const final=await api(a,'/api/projects/job/cost-control');check('Correction updates actual labour cost exactly',final.body.labour.actualCostCents,760500);check('Reviewed warning clears',final.body.alerts.pendingTimeCorrections,0);
 const split=db.prepare("SELECT * FROM time_entries WHERE organization_id=? AND work_date='2026-09-01' AND arrival='08:30'").get(a);check('Split entry preserves archive marker',Boolean(split?.archived_at));
 check('Foreign keys preserved',db.prepare('pragma foreign_key_check').all(),[]);check('Database integrity preserved',db.prepare('pragma integrity_check').get().integrity_check,'ok');
}catch(error){fatal={message:error.message,stack:error.stack};console.error(error.stack)}
finally{opened.close();const result={at:new Date().toISOString(),app,run,scope:'Real worker API and UI functions, new synthetic SQLite, no browser/server/production',checks,fatal,passed:checks.filter(c=>c.pass).length,total:checks.length};writeFileSync(join(run,'RESULTATS.json'),JSON.stringify(result,null,2));writeFileSync(join(out,'LATEST-'+label+'.json'),JSON.stringify(result,null,2));console.log('RESULT '+result.passed+'/'+result.total);process.exitCode=!fatal&&checks.every(c=>c.pass)?0:1;}
