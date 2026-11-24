import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const app=process.env.OUVRANE_TEST_APP||dirname(dirname(fileURLToPath(import.meta.url)));
let checks=0;
function check(label,actual,expected=true){assert.deepEqual(actual,expected,label);checks++;console.log('PASS '+label)}
function section(file,start,end){const text=readFileSync(join(app,file),'utf8'),a=text.indexOf(start),b=text.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,'Source markers '+file);return text.slice(a,b)}
const context=vm.createContext({
 console:{warn(){},log(){}},URLSearchParams,Map,Promise,Number,Date,JSON,
 SOCLE_PRODUCTION:true,socleCurrentAccess:{userId:'owner-a',owner:true,permissions:[],projectIds:[]},
 activeSocleOrganizationId:'org-a',storageReady:false,
 jobs:[{id:'job',timeEntries:[]}],
 esc:value=>String(value??''),jsString:value=>String(value).replaceAll("'","\\'"),
 getPerson:id=>({name:id}),fullDate:value=>value,visibleClockEntry:()=>true,
 netMinutes:e=>e.departure?60:0,render(){},centsMoney:value=>'EUR '+(value/100).toFixed(2),
 money:value=>'EUR '+Number(value).toFixed(2),allocationMoney:value=>'EUR '+(value/100).toFixed(2)
});
context.currentTimeAccess=()=>context.socleCurrentAccess;
context.iaCQuoteScope=()=>JSON.stringify([context.activeSocleOrganizationId,context.socleCurrentAccess.userId]);
vm.runInContext(section('web/business.js','function jobHours(','jobsView=function()'),context);
vm.runInContext(section('web/field-workflows.js','let serverTimeLoadSequence=','globalThis.loadServerTimeEntries=loadServerTimeEntries;'),context);
vm.runInContext(section('web/supplier-allocations.js','function costControlAmount(','async function loadProjectCostControl('),context);
const run=source=>vm.runInContext(source,context);
const makeEntries=(from,count)=>Array.from({length:count},(_,i)=>({id:'p'+(from+i),projectId:'job',people:['p1'],date:'2026-10-01',arrival:'08:00',departure:'09:00',history:[]}));
const summary=(minutes,entries=125)=>({projects:[{projectId:'job',minutes,entries,openEntries:0}]});
check('Hours unknown before canonical load',run('jobHours(jobs[0])'),null);
check('Unknown hours never shown as zero',run('jobHoursLabel(jobs[0])'),'Non disponible');
context.serverJson=async path=>path.split('?')[0].endsWith('/summary')?summary(7500):{entries:makeEntries(0,65),nextCursor:'global-next'};
await run('loadServerTimeEntries({renderAfter:false})');
check('Canonical total independent of 65 loaded rows',run('jobHours(jobs[0])'),125);
check('French hours formatter',run('jobHoursLabel(jobs[0])'),'125,0 h');
check('Partial history labelled explicitly',run('jobTimeHistoryLabel(jobs[0])').includes('65 affiché(s) sur 125'));
check('History exposes load action for missing rows',run('serverJobTimeHistoryControl(jobs[0])').includes('Charger l’historique'));
const foldedHistory=run('renderServerJobTimeRows(jobs[0])');
check('Detailed history starts collapsed with one canonical total',/^<details class="server-job-time-history"><summary>/.test(foldedHistory)&&foldedHistory.split('125,0 h').length===2);
context.serverJson=async path=>{if(path.split('?')[0].endsWith('/summary'))throw Error('Synthetic unavailable');return{entries:makeEntries(0,65)}};
await run('loadServerTimeEntries({renderAfter:false})');
check('Failed canonical summary remains unavailable',run('jobHours(jobs[0])'),null);
check('Recent history survives summary error',context.jobs[0].timeEntries.length,65);
check('Summary error does not disguise partial sum as total',run('serverJobTimeHistoryControl(jobs[0])').includes('ne constituent pas un total'));
context.serverJson=async path=>path.split('?')[0].endsWith('/summary')?summary(7500):{entries:makeEntries(0,65)};
await run('loadServerTimeEntries({renderAfter:false})');
let pages=0;
context.serverJson=async path=>{
 const url=new URL('https://example.invalid'+path);
 assert.equal(url.searchParams.get('project_id'),'job');
 if(pages++===0)return{entries:makeEntries(0,100),nextCursor:'page-2'};
 assert.equal(url.searchParams.get('cursor'),'page-2');
 return{entries:[...makeEntries(99,1),...makeEntries(100,25)],nextCursor:null};
};
await run("loadProjectTimeHistory('job')");
check('First project page replaces partial global history',context.jobs[0].timeEntries.length,100);
const loadedHistory=run('renderServerJobTimeRows(jobs[0])');
check('History remains expanded after loading a page without duplicate total',/^<details class="server-job-time-history" open><summary>/.test(loadedHistory)&&loadedHistory.split('125,0 h').length===2);
check('Total stays exact after first page',run('jobHours(jobs[0])'),125);
await run("loadProjectTimeHistory('job')");
check('Second project page appends without duplicate',context.jobs[0].timeEntries.length,125);
check('Completed history offers no further load',run('serverJobTimeHistoryControl(jobs[0])').includes('<button'),false);
check('Total stays exact after full history',run('jobHours(jobs[0])'),125);
let resolveOldRows,resolveOldSummary;
context.serverJson=path=>new Promise(resolve=>{if(path.split('?')[0].endsWith('/summary'))resolveOldSummary=resolve;else resolveOldRows=resolve});
const oldLoad=run('loadServerTimeEntries({renderAfter:false})');
context.activeSocleOrganizationId='org-b';context.socleCurrentAccess={userId:'owner-b',owner:true,permissions:[],projectIds:[]};
context.jobs=[{id:'job',timeEntries:[]}];
context.serverJson=async path=>path.split('?')[0].endsWith('/summary')?summary(180,1):{entries:[{...makeEntries(999,1)[0],note:'ORG-B'}]};
await run('loadServerTimeEntries({renderAfter:false})');
resolveOldRows({entries:[{...makeEntries(1000,1)[0],note:'ORG-A'}]});resolveOldSummary(summary(999999));
await oldLoad;
check('Late tenant A summary cannot overwrite tenant B',run('jobHours(jobs[0])'),3);
check('Late tenant A rows cannot overwrite tenant B',context.jobs[0].timeEntries[0].note,'ORG-B');
context.socleCurrentAccess.permissions=['changed'];
check('Permission change invalidates cached totals',run('jobHours(jobs[0])'),null);
context.socleCurrentAccess.permissions=[];
context.serverJson=async path=>path.split('?')[0].endsWith('/summary')?{projects:[]}:{entries:[]};
await run('loadServerTimeEntries({renderAfter:false})');
check('Successful empty summary is a known zero',run('jobHours(jobs[0])'),0);
check('Known zero is formatted distinctly',run('jobHoursLabel(jobs[0])'),'0,0 h');

context.job={id:'job'};
context.data={
 client:{soldHtCents:200000,invoicedHtCents:100000,invoicedTotalCents:121000,creditTotalCents:10000,paidTotalCents:20000,outstandingTotalCents:91000},
 procurement:{costToDateCents:30000,invoicedCents:20000,receivedNotInvoicedCents:10000,pendingDeliveryOrders:0,unpaidCents:15000,outstandingOrderCents:0,supplierPriceVarianceCents:0,supplierInvoiceMatchingPendingCents:0},
 labour:{hours:125,actualCostCents:50000,remainingPlannedCostCents:5000},
 costControl:{totalCostToDateCents:80000,costAtCompletionCents:85000,projectedMarginCents:115000},
 alerts:{pendingTimeCorrections:0},quality:{confidence:'HIGH',reasons:[]}
};
context.projectedJobFinance=()=>{throw Error('Local legacy finance must not be consulted')};
const html=run('projectCostControlHtml(job,data)');
check('Canonical revenue rendered',html.includes('<small>Vendu HT</small><strong>EUR 2000.00</strong>'));
check('Canonical projected margin rendered',html.includes('<small>Marge projetée</small><strong>EUR 1150.00</strong>'));
check('Actual invoice TVAC rendered',html.includes('<small>Facturé client TVAC</small><strong>EUR 1210.00</strong>'));
check('Actual invoice HT rendered',html.includes('HT EUR 1000.00 · avant avoirs'));
check('Credits explicitly TVAC',html.includes('avoirs TVAC EUR 100.00'));
delete context.data.client.invoicedTotalCents;
const missing=run('projectCostControlHtml(job,data)');
check('Missing TVAC remains unavailable',missing.includes('<small>Facturé client TVAC</small><strong>Non disponible</strong>'));
check('Incomplete contract marked for completion',missing.includes('Données à compléter'));
context.data.client.invoicedTotalCents=0;
check('Valid zero TVAC is shown as zero',run('projectCostControlHtml(job,data)').includes('<small>Facturé client TVAC</small><strong>EUR 0.00</strong>'));
context.data.labour.hours=undefined;
check('Missing hours are never presented as zero',run('projectCostControlHtml(job,data)').includes('Heures indisponibles'));
console.log('RESULT '+checks+'/'+checks+' frontend VM checks passed.');

