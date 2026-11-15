/* Disposable preview only. It starts the real production adapter against a newly seeded synthetic database. */
import {mkdirSync,writeFileSync,readFileSync,existsSync,appendFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import {openProductionDatabase} from '../scripts/production-db.mjs';
import {provisionCredential} from '../scripts/production-auth.mjs';
import {startProduction} from '../scripts/production.mjs';
const app=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(process.env.OUVRANE_TOPO_PREVIEW||'D:/Ouvrane/Corrections/2026-10-27-TOPO-FIABILITE-INTERFACE/QA/PREVIEW');
if(!out.replaceAll('\\','/').includes('/2026-10-27-TOPO-FIABILITE-INTERFACE/QA/PREVIEW'))throw Error('Preview must stay in its dedicated synthetic output');
mkdirSync(out,{recursive:true});
const dbPath=join(out,'synthetic.sqlite');
if(existsSync(dbPath))throw Error('Preview database already exists; choose a fresh PREVIEW subdirectory');
const opened=openProductionDatabase({databasePath:dbPath,migrationsDirectory:join(app,'drizzle')}),db=opened.database;
const stamp=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),org='topo-org',owner='topo-owner';
const secret=randomBytes(32).toString('base64url'),password=randomBytes(24).toString('base64url'),email='topo-owner@example.invalid';
db.prepare('INSERT INTO organizations(id,name,created_at,updated_at) VALUES(?,?,?,?)').run(org,'Ouvrane — démonstration des améliorations',stamp,stamp);
db.prepare("INSERT INTO profiles(id,first_name,last_name,email,identity_kind,created_at,updated_at) VALUES(?,?,?,?, 'account',?,?)").run(owner,'Camille','Test',email,stamp,stamp);
db.prepare('INSERT INTO roles(id,organization_id,code,name,created_at) VALUES(?,?,?,?,?)').run('topo-role-owner',org,'OWNER','Patron',stamp);
db.prepare("INSERT INTO organization_members(id,organization_id,user_id,role_id,status,joined_at,created_at,updated_at) VALUES(?,?,?,?,'active',?,?,?)").run('topo-member-owner',org,owner,'topo-role-owner',stamp,stamp,stamp);
for(const [id,name] of [[101,'Alex Test'],[102,'Sam Test']])db.prepare('INSERT INTO hr_people(organization_id,id,display_name,active,created_at,updated_at) VALUES(?,?,?,1,?,?)').run(org,String(id),name,stamp,stamp);
const job=(id,name)=>({id,name,reference:id==='topo-job-a'?'DEMO-TOITURE':'DEMO-RENOVATION',client:'Client de démonstration',town:'Namur',address:'Adresse fictive',type:'Toiture',phase:'En cours',status:'active',progress:30,contractAmount:10000,finance:{},required:[],photos:[],execution:[],materials:[],contacts:[],notes:[],documents:[],timeEntries:[],dailyChecks:{},teamIds:[11]});
const state={version:3,company:{name:'Ouvrane — démonstration des améliorations',country:'BE',region:'Wallonie',blankWorkspace:true,timeZone:'Europe/Brussels',morningBreakMinutes:0,lunchBreakMinutes:0},jobs:[job('topo-job-a','Réfection de toiture — démonstration'),job('topo-job-b','Rénovation — démonstration')],people:[{id:101,name:'Alex Test',category:'Ouvrier',trade:'Couvreur',active:true,training:[],hr:{}},{id:102,name:'Sam Test',category:'Ouvrier',trade:'Couvreur',active:true,training:[],hr:{}}],teams:[{id:11,name:'Équipe toiture',members:[101,102],lead:101}],assignments:[],quotes:[],customers:[],suppliers:[],contacts:[],tasks:[],assets:[],stock:[],purchaseOrders:[],visits:[],dossiers:[],reminders:[],fleet:[],settings:{},accountingData:{customerInvoices:[],supplierBills:[]}};
for(const item of state.jobs)db.prepare('INSERT INTO projects(id,organization_id,name,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(item.id,org,item.name,'active',stamp,stamp);
db.prepare('INSERT INTO organization_workspace_state(organization_id,payload,revision,source_user_id,created_at,updated_at) VALUES(?,?,1,?,?,?)').run(org,JSON.stringify(state),owner,stamp,stamp);
for(let i=0;i<160;i++)db.prepare('INSERT INTO time_entries(id,organization_id,project_id,team_id,work_date,people_json,arrival,departure,break_minutes,note,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('topo-time-'+i,org,i<125?'topo-job-a':'topo-job-b','11',new Date(Date.parse(day+'T12:00:00Z')-(159-i)*86400000).toISOString().slice(0,10),'["101"]','08:00','09:00',0,'Pointage de démonstration',owner,new Date(Date.parse(stamp)+i).toISOString(),owner,stamp);
db.prepare('INSERT INTO stock_locations(id,organization_id,name,type,status,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('topo-store',org,'Dépôt démonstration','warehouse','active',owner,stamp,owner,stamp);
for(const [i,name,unit,quantity] of [[1,'Ardoises démonstration','piece',80],[2,'Liteaux démonstration','linear_metre',120],[3,'Sous-toiture démonstration','square_metre',65],[4,'Mortier démonstration','bag_5kg',4],[5,'Fixations démonstration','box_100',3]]){
 db.prepare('INSERT INTO field_stock_items(id,organization_id,name,quantity,reserved,unit,unit_cost_cents,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,0,?,?,?,?,?,?)').run('topo-stock-'+i,org,name,quantity,unit,150,owner,stamp,owner,stamp);
 db.prepare('INSERT INTO stock_balances(organization_id,stock_item_id,location_id,quantity,updated_at) VALUES(?,?,?,?,?)').run(org,'topo-stock-'+i,'topo-store',quantity,stamp);
}
await provisionCredential(db,{userId:owner,password,secret});
const worker=(await import('../dist/server/index.js')).default;
async function api(path,method='GET',body){
 const result=await worker.fetch(new Request('https://topo-preview.invalid'+path,{method,headers:{origin:'https://topo-preview.invalid','oai-authenticated-user-id':owner,'x-socle-organization-id':org,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB:opened.DB});
 const data=await result.json();if(!result.ok)throw Error('Synthetic seed '+path+' '+result.status+' '+JSON.stringify(data));return data;
}
const customer=(await api('/api/customers','POST',{type:'company',companyName:'Client de démonstration',street:'Adresse fictive'})).customer;
const quote=(await api('/api/quotes','POST',{customerId:customer.id,projectId:'topo-job-a',title:'Toiture — devis démonstration',client:'Client de démonstration',date:day,validUntil:day,status:'accepted',lines:[{label:'Couverture démonstration',qty:100,unit:'m²',price:100,vat:21}],operationKey:'topo-quote-create'})).quote;
for(const [title,status] of [['Préparer les matériaux','todo'],['Confirmer la livraison','blocked'],['Visite de préparation','done']])await api('/api/projects/topo-job-a/tasks','POST',{title,status,description:'Étape fictive pour vérifier les parcours.',priority:'normal',checklist:[{id:'check-1',label:'Vérifier les informations',done:false}],materials:[{name:'Ardoises à confirmer'}],operationKey:'topo-task-'+randomUUID()});
const visit=(await api('/api/quote-visits','POST',{customerId:customer.id,place:'Visite toiture démonstration',contact:'Contact fictif',notes:'Préparation synthétique',operationKey:'topo-visit-create'})).visit;
await api('/api/quote-visits/'+visit.id+'/quote','POST',{quoteId:quote.id});
const input={planes:[{id:'versant-1',eaveLengthM:'10',developedSlopeM:'5',openingsM2:'0'}],guttersM:'10',flashingsM:'2',config:{usefulCoverWidthMm:'180',usefulExposureMm:'120',battenSpacingM:'0.30',counterBattenSpacingM:'0.60',slateWastePct:'10',underlayAllowancePct:'10',timberWastePct:'10'},unitPrices:{SLATE_PIECES:'1',UNDERLAY:'1',BATTENS:'1',COUNTER_BATTENS:'1',GUTTERS:'1',FLASHINGS:'1'},packages:{SLATE_PIECES:'1',UNDERLAY:'1',BATTENS:'1',COUNTER_BATTENS:'1',GUTTERS:'1',FLASHINGS:'1'},vatRate:21};
await api('/api/measurements','POST',{visitId:visit.id,input,sourceLabel:'Première visite',expectedVersion:0,operationKey:'topo-measurement-1'});
input.guttersM='12';
await api('/api/measurements','POST',{visitId:visit.id,input,sourceLabel:'Mesures vérifiées',expectedVersion:1,operationKey:'topo-measurement-2'});
// The create routes intentionally start drafts/tasks as todo. Set explicit synthetic review states.
db.prepare("UPDATE project_tasks SET status='blocked' WHERE organization_id=? AND title=?").run(org,'Confirmer la livraison');
db.prepare("UPDATE project_tasks SET status='done',checklist_json=? WHERE organization_id=? AND title=?").run(JSON.stringify([{id:'check-1',label:'Vérifier les informations',done:true}]),org,'Visite de préparation');
db.prepare("UPDATE quotes_server SET status='accepted' WHERE organization_id=? AND id=?").run(org,quote.id);
const invoice=(await api('/api/invoices','POST',{customerId:customer.id,projectId:'topo-job-a',quoteId:quote.id,invoiceNumber:'DEMO-2026-001',issueDate:day,dueDate:day,subtotalCents:1000000,vatAmountCents:210000,notes:'Facture entièrement fictive de validation.'})).invoice;
writeFileSync(join(out,'FIXTURES.json'),JSON.stringify({organization:org,owner,projects:state.jobs.map(job=>job.id),quoteId:quote.id,visitId:visit.id,invoiceId:invoice.id,expectedHours:{'topo-job-a':125,'topo-job-b':35},expectedFinance:{invoicedHtCents:1000000,invoicedTotalCents:1210000},synthetic:true},null,2));
opened.close();
const reserve=net.createServer();await new Promise(done=>reserve.listen(0,'127.0.0.1',done));const backendPort=reserve.address().port;await new Promise(done=>reserve.close(done));
const log=(level)=>(...args)=>appendFileSync(join(out,'runtime.log'),JSON.stringify({at:new Date().toISOString(),level,args})+'\n');
const logger={log:log('info'),warn:log('warning'),error:log('error')};
const originalListen=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){if(args[1]==='0.0.0.0')args[1]='127.0.0.1';return originalListen.apply(this,args)};
let runtime;try{runtime=await startProduction({env:{PORT:String(backendPort),SOCLE_PUBLIC_URL:'https://topo-preview.invalid',SOCLE_DATA_DIR:out,SOCLE_DB_PATH:dbPath,SOCLE_SESSION_SECRET:secret,SOCLE_ALLOW_BOOTSTRAP:'0',WEB_CONCURRENCY:'1',SOCLE_ACCESS_LOG:'1'},logger,modelConverter:null})}finally{net.Server.prototype.listen=originalListen}
const login=await fetch('http://127.0.0.1:'+backendPort+'/auth/login',{method:'POST',headers:{origin:'https://topo-preview.invalid','content-type':'application/json'},body:JSON.stringify({email,password})});
if(login.status!==200){await runtime.close();throw Error('Synthetic login refused')}
const cookie=login.headers.get('set-cookie').split(';')[0];
let previewOrigin='';
const proxy=http.createServer((request,response)=>{
 const expectedHost=new URL(previewOrigin).host;
 if(request.headers.host!==expectedHost||request.headers.origin&&request.headers.origin!==previewOrigin){response.writeHead(403);response.end('Local preview only');return}
 const headers={...request.headers,host:'127.0.0.1:'+backendPort,cookie,origin:'https://topo-preview.invalid'};
 const upstream=http.request({hostname:'127.0.0.1',port:backendPort,path:request.url,method:request.method,headers},result=>{
  const resultHeaders={...result.headers};delete resultHeaders['set-cookie'];resultHeaders['x-ouvrane-preview']='synthetic';
  response.writeHead(result.statusCode,resultHeaders);result.pipe(response);
 });
 upstream.on('error',error=>{logger.error(error.name);if(!response.headersSent)response.writeHead(502);response.end('Preview unavailable')});request.pipe(upstream);
});
await new Promise(done=>proxy.listen(0,'127.0.0.1',done));previewOrigin='http://127.0.0.1:'+proxy.address().port;
writeFileSync(join(out,'READY.json'),JSON.stringify({url:previewOrigin,backendPort,pid:process.pid,app,synthetic:true},null,2));
console.log('TOPO_PREVIEW_READY '+previewOrigin);
let closed=false;
async function close(){if(closed)return;closed=true;clearInterval(timer);proxy.closeAllConnections();await new Promise(done=>proxy.close(done));await runtime.close();writeFileSync(join(out,'CLOSED.json'),JSON.stringify({at:new Date().toISOString(),closed:true}));console.log('TOPO_PREVIEW_CLOSED')}
const timer=setInterval(()=>{if(existsSync(join(out,'STOP')))void close()},1000);
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>void close());