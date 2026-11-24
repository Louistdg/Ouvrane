import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openProductionDatabase} from '../scripts/production-db.mjs';
import worker from '../dist/server/index.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const resultsRoot='D:/Ouvrane/Corrections/2026-10-24-INTEGRATION-PROMAX/retour-agent-tests';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/promax-reference/pointages-lot-B.json',import.meta.url),'utf8'));
const folder=mkdtempSync(join(resultsRoot,'lot-B-pointages-db-'));
const databasePath=join(folder,'synthetic.sqlite');
const opened=openProductionDatabase({databasePath,migrationsDirectory:join(root,'drizzle')});
const db=opened.database;
const stamp='2026-10-24T10:00:00Z',owner='pointage-lot-b-owner';
let org='',checks=0;
const knownFailures=[];

async function api(path,method='GET',body,uid=owner){
  const response=await worker.fetch(new Request('https://socle.local'+path,{method,headers:{'oai-authenticated-user-id':uid,'x-socle-organization-id':org,origin:'https://socle.local','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB:opened.DB});
  return{status:response.status,body:await response.json()};
}
async function ok(path,method='GET',body,uid=owner){
  const result=await api(path,method,body,uid);
  assert.ok(result.status>=200&&result.status<300,path+' '+result.status+' '+JSON.stringify(result.body));
  return result.body;
}
function check(label,actual,expected=true){assert.deepEqual(actual,expected,label);console.log('PASS '+label);checks++}
function arrival(date,time=fixture.cases.concurrentArrival.arrival){
  return{projectId:fixture.project,teamId:fixture.team,date,people:[{personId:fixture.person,arrival:time}],note:'Synthetic Mission 04 pointage'};
}
async function assignment(date,start='08:00',end='12:00'){
  return ok('/api/assignments','POST',{projectId:fixture.project,teamId:fixture.team,date,people:[fixture.person],startTime:start,endTime:end,status:'planned',assignmentType:'team'});
}

try{
  db.prepare('INSERT INTO profiles(id,first_name,last_name,email,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(owner,'QA','Pointage','pointage-owner@simulation.invalid',stamp,stamp);
  org=fixture.organization;
  db.prepare('INSERT INTO organizations(id,name,created_at,updated_at) VALUES(?,?,?,?)').run(org,'Synthetic pointage lot B',stamp,stamp);
  db.prepare('INSERT INTO roles(id,organization_id,code,name,created_at) VALUES(?,?,?,?,?)').run('pointage-lot-b-owner-role',org,'OWNER','Synthetic owner',stamp);
  db.prepare('INSERT INTO organization_members(id,organization_id,user_id,role_id,status,joined_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('pointage-lot-b-owner-member',org,owner,'pointage-lot-b-owner-role','active',stamp,stamp,stamp);
  const state={version:3,company:{name:'Synthetic pointage lot B',blankWorkspace:true,simulationMode:false,testCompany:false,morningBreakMinutes:10,lunchBreakMinutes:20},people:[],teams:[],jobs:[{id:fixture.project,name:'Synthetic pointage project',timeEntries:[]}],assignments:[],quotes:[],assets:[],tasks:[],dossiers:[],reminders:[],newsItems:[],priceCatalog:[],albums:[],companyEvents:[],trainingCatalogue:[],trainingInterest:[],quoteDrafts:[],repairMissions:[],contacts:[],fleet:[],savedJobViews:[],subcontractors:[],savedTaskViews:[],savedFinanceViews:[],savedAssetViews:[],partners:[],partnerRequests:[],stockItems:[],recurringCharges:[],purchaseOrders:[],deliveryNotes:[],accountingData:{customerInvoices:[],supplierBills:[],expenseReceipts:[],monthlyPayroll:0,vatReserve:0,refinedPayroll:true},accessAssignments:{},documentArchives:{}};
  db.prepare('INSERT INTO organization_workspace_state(organization_id,payload,revision,source_user_id,created_at,updated_at) VALUES(?,?,1,?,?,?)').run(org,JSON.stringify(state),owner,stamp,stamp);
  db.prepare('INSERT INTO hr_people(organization_id,id,display_name,source,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(org,fixture.person,'Synthetic person','manual',stamp,stamp);
  db.prepare('INSERT INTO hr_teams(organization_id,id,name,source,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(org,fixture.team,'Synthetic team','manual',stamp,stamp);
  db.prepare('INSERT INTO hr_team_members(organization_id,id,team_id,person_id,starts_on,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(org,fixture.person+'-member',fixture.team,fixture.person,'2026-01-01',stamp,stamp);

  const correctionCase=fixture.cases.rejectedCorrection;
  await assignment(correctionCase.date);
  const created=await ok('/api/time-entries/arrival','POST',arrival(correctionCase.date,correctionCase.arrival));
  const entryId=created.ids[0];
  await ok('/api/time-entries/'+entryId+'/departure','POST',{departure:correctionCase.departure,personIds:[fixture.person]});
  const correction=await ok('/api/time-entries/'+entryId+'/corrections','POST',{arrival:correctionCase.proposedArrival,departure:correctionCase.departure,personId:fixture.person,reason:correctionCase.reason});
  const rejected=await ok('/api/time-entry-corrections/'+correction.id+'/review','POST',{approved:false});
  const correctionRow=db.prepare('SELECT * FROM time_entry_corrections WHERE id=? AND organization_id=?').get(correction.id,org);
  const unchanged=db.prepare('SELECT arrival,departure FROM time_entries WHERE id=? AND organization_id=?').get(entryId,org);
  check('Correction rejection returns rejected status',rejected.status,'rejected');
  check('Rejected correction retains reason and original/proposed values',[correctionRow.reason,correctionRow.original_arrival,correctionRow.proposed_arrival], [correctionCase.reason,correctionCase.arrival,correctionCase.proposedArrival]);
  check('Rejected correction records reviewer and time',Boolean(correctionRow.reviewed_by&&correctionRow.reviewed_at));
  check('Rejected correction leaves source entry unchanged',[unchanged.arrival,unchanged.departure],[correctionCase.arrival,correctionCase.departure]);

  const dst=fixture.cases.brusselsAutumnOverlap;
  await assignment(dst.date,'00:00','05:00');
  const dstCreated=await ok('/api/time-entries/arrival','POST',arrival(dst.date,dst.arrival));
  const dstId=dstCreated.ids[0];
  await ok('/api/time-entries/'+dstId+'/departure','POST',{departure:dst.departure,personIds:[fixture.person]});
  const dstRow=db.prepare('SELECT work_date,arrival,departure,break_minutes FROM time_entries WHERE id=?').get(dstId);
  check('Repeated local autumn-clock time is retained as HH:mm text',[dstRow.work_date,dstRow.arrival,dstRow.departure],[dst.date,dst.arrival,dst.departure]);
  check('Current record has no UTC offset or repeated-hour occurrence fields',Object.keys(dstRow).some(key=>/offset|zone|occurrence|instant/i.test(key)),false);
  console.log('INFO Europe/Brussels 2026-10-25 02:30 is ambiguous; this API stores date and HH:mm only. No expected elapsed-time/payroll rule was asserted.');

  const concurrent=fixture.cases.concurrentArrival;
  await assignment(concurrent.date);
  const simultaneous=await Promise.all([
    api('/api/time-entries/arrival','POST',arrival(concurrent.date)),
    api('/api/time-entries/arrival','POST',arrival(concurrent.date))
  ]);
  const statuses=simultaneous.map(result=>result.status).sort((a,b)=>a-b);
  if(JSON.stringify(statuses)!==JSON.stringify([201,409])){
    knownFailures.push({case:'concurrent same-person arrival',expected:[201,409],actual:statuses,impact:'Two simultaneous requests can both create an open clock for the same person.'});
    console.log('FAIL KNOWN concurrent same-person arrivals: expected [201,409], received '+JSON.stringify(statuses));
  }else check('Concurrent same-person arrivals admit one create and reject the duplicate',statuses,[201,409]);
  const openCount=db.prepare("SELECT COUNT(*) n FROM time_entries WHERE organization_id=? AND work_date=? AND archived_at IS NULL AND departure IS NULL AND people_json LIKE ?").get(org,concurrent.date,'%'+fixture.person+'%').n;
  if(openCount!==1){
    knownFailures.push({case:'concurrent open-entry cardinality',expected:1,actual:openCount,impact:'The database contains duplicate simultaneously-open synthetic entries after the race.'});
    console.log('FAIL KNOWN concurrent open-entry cardinality: expected 1, received '+openCount);
  }else check('Concurrent requests leave one open entry for the synthetic person',openCount,1);

  const summary={fixture:fixture.fixture,organization:org,checks,syntheticOnly:true,database:'fresh migration-built SQLite in reserved results temp directory; removed at exit',runtimeFile:'../dist/server/index.js',cases:{rejectedCorrection:'executed',autumnDst:'characterization only; no DST business rule asserted',concurrentArrival:'executed'},knownFailures};
  writeFileSync(join(resultsRoot,'lot-B-pointages-resultats.json'),JSON.stringify(summary,null,2)+'\n','utf8');
  console.log('RESULT '+JSON.stringify(summary));
  if(knownFailures.length)process.exitCode=1;
}finally{
  opened.close();
  rmSync(folder,{recursive:true,force:true});
}
