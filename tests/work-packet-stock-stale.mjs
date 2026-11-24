import assert from 'node:assert/strict';
import {workPacketsRoute,workPacketSummaries} from '../dist/server/work-packets.js';

const activeReservations=[];
const row={
  id:'packet-1',task_id:'task-1',project_id:'project-1',version:1,response_mode:'confirm',created_at:'2026-10-24T19:00:00.000Z',
  snapshot_json:JSON.stringify({
    taskId:'task-1',projectId:'project-1',title:'Pose ardoises',description:'Contrôle terrain',responseMode:'confirm',
    recipients:[{userId:'worker-1',name:'Ouvrier'}],plan:null,preparation:null,stockReservations:[]
  }),
  task_guard_json:JSON.stringify({
    title:'Pose ardoises',description:'Contrôle terrain',status:'todo',priority:'normal',assignedTo:'worker-1',dueAt:'',
    checklistJson:'[]',materialsJson:'[{"name":"Ardoise","quantity":2079,"unit":"pc"}]',peopleJson:'["worker-1"]',updatedAt:'before',
    preparation:{bindingId:null,assignment:null,assets:null},stock:[]
  })
};

const reservation=()=>({
  id:'task-stock-1',material_index:0,materials_json:'[{"name":"Ardoise","quantity":2079,"unit":"pc"}]',
  stock_item_id:'stock-1',item_name:'Ardoise',location_id:'location-1',location_name:'Dépôt',unit:'pc',
  quantity_milli:2079000,remaining_milli:2079000,consumed_milli:0,preparation_id:'prep-1',created_at:'2026-10-24T19:30:00.000Z'
});

function statement(sql){
  const first=async()=>{
    if(sql.includes('SELECT * FROM work_packet_issues WHERE'))return row;
    if(sql.includes('SELECT id,version FROM work_packet_issues'))return {id:row.id,version:row.version};
    if(sql.includes('FROM work_packet_recipients'))return {ok:1};
    if(sql.includes('SELECT * FROM work_packet_events WHERE organization_id=? AND operation_key=?'))return null;
    if(sql.includes('FROM task_preparations WHERE'))return null;
    if(sql.includes('SELECT project_id FROM project_tasks'))return {project_id:row.project_id};
    throw new Error('Unexpected first(): '+sql);
  };
  const all=async()=>{
    if(sql.includes('SELECT i.* FROM work_packet_issues i'))return {results:[row]};
    if(sql.includes('FROM work_packet_events e JOIN profiles'))return {results:[]};
    if(sql.includes('FROM task_stock_remaining'))return {results:activeReservations};
    if(sql.includes('SELECT e.id eventId'))return {results:[]};
    throw new Error('Unexpected all(): '+sql);
  };
  return {bind(){return {first,all}}};
}

const env={DB:{prepare:statement}};
const ctx={uid:'worker-1',organizationId:'org-1',roleCode:'WORKER'};
const helpers={
  allowed:async()=>false,
  requirePermission:async()=>{},
  requireProjectScope:async()=>{},
  relationExists:async()=>{},
  taskById:async()=>({id:'task-1',project_id:'project-1',status:'todo'}),
  body:async request=>request.json(),
  json:(data,status=200)=>({status,data})
};

const fresh=await workPacketsRoute(new Request('https://local/api/work-packets/packet-1'),new URL('https://local/api/work-packets/packet-1'),env,ctx,'packet-1',null,helpers);
assert.equal(fresh.status,200);
assert.equal(fresh.data.stockChanged,false,'A packet matching its stored stock guard is current');

const freshSummary=await workPacketSummaries(env,ctx,helpers,{taskId:'task-1'});
assert.equal(freshSummary.items[0].stockChanged,false);
assert.equal(freshSummary.items[0].needsResponse,true);

activeReservations.push(reservation());

const stale=await workPacketsRoute(new Request('https://local/api/work-packets/packet-1'),new URL('https://local/api/work-packets/packet-1'),env,ctx,'packet-1',null,helpers);
assert.equal(stale.status,200);
assert.equal(stale.data.snapshot.stockReservations.length,0,'Issued packet remains immutable');
assert.equal(stale.data.stockChanged,true,'A later reservation must mark the packet stock as changed');

const staleSummary=await workPacketSummaries(env,ctx,helpers,{taskId:'task-1'});
assert.equal(staleSummary.items[0].stockChanged,true);
assert.equal(staleSummary.items[0].needsResponse,false,'A recipient must not acknowledge a packet with changed stock as current');

await assert.rejects(
  ()=>workPacketsRoute(
    new Request('https://local/api/work-packets/packet-1/events',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({kind:'opened',text:'',photoDocumentIds:[],operationKey:'stale-open-123'})
    }),
    new URL('https://local/api/work-packets/packet-1/events'),env,ctx,'packet-1','events',helpers
  ),
  error=>error?.status===409&&/stock/.test(error.message),
  'Opened/confirmed/replied acknowledgements must be rejected after stock changes'
);

const frozen=JSON.parse(row.snapshot_json),issuedGuard=JSON.parse(row.task_guard_json);
frozen.stockReservations=[{id:'task-stock-1',remaining:2079,consumed:0}];
issuedGuard.stock=[{id:'task-stock-1',remainingMilli:2079000}];
row.snapshot_json=JSON.stringify(frozen);row.task_guard_json=JSON.stringify(issuedGuard);
activeReservations[0].remaining_milli=2078000;activeReservations[0].consumed_milli=1000;
const progress=await workPacketsRoute(new Request('https://local/api/work-packets/packet-1'),new URL('https://local/api/work-packets/packet-1'),env,ctx,'packet-1',null,helpers);
assert.equal(progress.data.stockChanged,false,'Normal consumption does not rewrite the work instructions');
assert.equal(progress.data.stockProgressChanged,true);
assert.equal(progress.data.stockProgress[0].consumedMilliSinceIssue,1000);
assert.equal(progress.data.snapshot.stockReservations[0].remaining,2079,'Frozen stock snapshot is preserved');
assert.equal((await workPacketSummaries(env,ctx,helpers,{taskId:'task-1'})).items[0].needsResponse,true,'Consumption must not suppress the requested response');
activeReservations[0].remaining_milli=2077000;
assert.equal((await workPacketsRoute(new Request('https://local/api/work-packets/packet-1'),new URL('https://local/api/work-packets/packet-1'),env,ctx,'packet-1',null,helpers)).data.stockChanged,true,'Releasing reserved stock changes the preparation');
console.log('PASS work packet stock: new reservations block stale acknowledgements; normal consumption preserves responses and frozen history; release invalidates preparation.');
