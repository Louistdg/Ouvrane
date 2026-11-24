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

let fatal=null;
try{
 const a=org('top27-a'),b=org('top27-b');
 const state=baseState(a);state.jobs.push({id:'other',name:'Other project',timeEntries:[]});setState(a,state);
 for(let i=0;i<125;i++)entry(a,'a-'+i,['p1','p2'],{date:'2026-10-01',departure:'16:00'});
 db.prepare("UPDATE time_entries SET break_minutes=30 WHERE organization_id=?").run(a);
 for(let i=0;i<160;i++){entry(a,'other-'+i,['p3'],{team:'team-b',date:'2026-10-26',departure:'09:00'});db.prepare("UPDATE time_entries SET project_id='other' WHERE id=?").run('other-'+i)}
 entry(a,'open-a',['p1'],{date:'2026-10-02'});
 entry(a,'archived-a',['p1','p2'],{date:'2026-10-01',departure:'16:00'});db.prepare("UPDATE time_entries SET archived_at=? WHERE id='archived-a'").run(stamp);
 entry(b,'b-entry',['p3'],{departure:'09:00'});
 const summary=(data,id='job')=>data.body.projects.find(row=>row.projectId===id);
 const before=snap(a),r=await api(a,'/api/time-entries/summary');
 check('summary route returns 200',r.status,200);
 check('full project total includes 125 older entries',summary(r)?.minutes,125*450*2);
 check('summary entry count includes open row and excludes archived',summary(r)?.entries,126);
 check('open row contributes no minutes',summary(r)?.openEntries,1);
 check('summary does not disclose people or history',/people_json|Synthetic entry|created_by/.test(r.text),false);
 check('read-only summary leaves entries/corrections/audit unchanged',snap(a),before);
 const page=await api(a,'/api/time-entries?limit=100');
 check('first global history page contains no old project entries',page.body.entries.filter(e=>e.projectId==='job').length,0);
 check('history still paginated',Boolean(page.body.nextCursor));
 const totalAfterPage=await api(a,'/api/time-entries/summary');
 check('total independent from first history page',summary(totalAfterPage)?.minutes,summary(r)?.minutes);
 const from=await api(a,'/api/time-entries/summary?project_id=job&from=2026-10-01&to=2026-10-01');
 check('date range keeps full matching history',summary(from)?.entries,125);
 const empty=await api(a,'/api/time-entries/summary?project_id=job&from=2026-11-01');
 check('empty range is a known zero',empty.body.totals,{minutes:0,entries:0,openEntries:0});
 check('invalid date refused',(await api(a,'/api/time-entries/summary?from=2026-02-31')).status,400);
 check('inverted date range refused',(await api(a,'/api/time-entries/summary?from=2026-11-01&to=2026-10-01')).status,400);
 check('summary refuses mutation',(await api(a,'/api/time-entries/summary',{method:'POST',body:{}})).status,405);
 const archived=await api(a,'/api/time-entries/summary?project_id=job&include_archived=1');
 check('archive inclusion explicit',summary(archived)?.minutes,125*450*2+480*2);
 const isolated=await api(b,'/api/time-entries/summary');
 check('identical project IDs remain tenant isolated',summary(isolated)?.minutes,60);
 member(a,'worker-a','WORKER',['projects.view.assigned','time_entries.view.own'],'p1');
 db.prepare('insert into project_access values(?,?,?,?,?)').run(a,'worker-a','job','owner',stamp);
 const own=await api(a,'/api/time-entries/summary',{user:'worker-a'});
 check('own view counts only the acting person',summary(own)?.minutes,125*450);
 check('own view never returns other project',own.body.projects.some(p=>p.projectId==='other'),false);
 check('explicit forbidden project refused',(await api(a,'/api/time-entries/summary?project_id=other',{user:'worker-a'})).status,403);
 member(a,'lead-a','TEAM_LEAD',['projects.view.assigned','time_entries.view.team','time_entries.view.own'],'p1');
 db.prepare('insert into project_access values(?,?,?,?,?)').run(a,'lead-a','job','owner',stamp);
 const team=await api(a,'/api/time-entries/summary',{user:'lead-a'});
 check('team view counts team people once',summary(team)?.minutes,125*450*2);
 member(a,'no-time','NO_TIME',['projects.view.all'],'p1');
 check('no time permission refused',(await api(a,'/api/time-entries/summary',{user:'no-time'})).status,403);
 const preview=await api(a,'/api/time-entries/summary',{headers:{'x-socle-access-preview-user-id':'worker-a'}});
 check('access preview uses impersonated visibility',summary(preview)?.minutes,125*450);
 const created=await api(a,'/api/invoices',{method:'POST',body:{projectId:'job',invoiceNumber:'TOP27-INV',issueDate:'2026-10-01',dueDate:'2026-10-30',subtotalCents:100000,vatAmountCents:21000,notes:'Synthetic contract regression'}});
 check('synthetic client invoice created',created.status,201);
 const invoiceId=created.body.invoice.id;
 check('synthetic payment created',(await api(a,'/api/invoices/'+invoiceId+'/payments',{method:'POST',body:{amountCents:20000,paymentDate:'2026-10-02',paymentMethod:'bank_transfer',reference:'TOP27',note:'Synthetic',operationKey:'top27-pay'}})).status,201);
 check('synthetic credit created',(await api(a,'/api/invoices/'+invoiceId+'/credit-notes',{method:'POST',body:{amountCents:10000,creditDate:'2026-10-03',reason:'Synthetic credit',reference:'TOP27',note:'Synthetic',operationKey:'top27-credit'}})).status,201);
 const forecast=await api(a,'/api/projects/job/financial-forecast'),cost=await api(a,'/api/projects/job/cost-control');
 check('financial forecast succeeds',forecast.status,200);check('cost control succeeds',cost.status,200);
 check('hours agree between full summary and financial forecast',forecast.body.realized.labourMinutes,summary(archived)?.minutes);
 check('canonical invoiced HT',cost.body.client.invoicedHtCents,100000);
 check('canonical invoiced TVAC',cost.body.client.invoicedTotalCents,121000);
 check('canonical credits TVAC',cost.body.client.creditTotalCents,10000);
 check('canonical collected TVAC',cost.body.client.paidTotalCents,20000);
 check('canonical outstanding net of payment and credit',cost.body.client.outstandingTotalCents,91000);
 check('forecast and cost control share TVAC contract',forecast.body.realized.invoicedTtcCents,cost.body.client.invoicedTotalCents);
 check('foreign keys preserved',db.prepare('pragma foreign_key_check').all(),[]);
 check('database integrity preserved',db.prepare('pragma integrity_check').get().integrity_check,'ok');
}catch(error){fatal={message:error.message,stack:error.stack};console.error(error.stack)}
finally{
 opened.close();
 const result={at:new Date().toISOString(),app,run,scope:'Copied source worker + new synthetic SQLite only; no running server or existing database',checks,fatal,passed:checks.filter(c=>c.pass).length,total:checks.length};
 writeFileSync(join(run,'RESULTATS.json'),JSON.stringify(result,null,2));writeFileSync(join(out,'LATEST-'+label+'.json'),JSON.stringify({run,result:join(run,'RESULTATS.json'),passed:result.passed,total:result.total,fatal},null,2));
 console.log('RESULT '+result.passed+'/'+result.total+' '+run);process.exitCode=!fatal&&checks.every(c=>c.pass)?0:1;
}

