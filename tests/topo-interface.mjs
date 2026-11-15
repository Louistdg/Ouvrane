import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root=process.cwd(),source=fs.readFileSync(path.join(root,'web/project-hub.js'),'utf8'),calls=[],requests=[];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const context=vm.createContext({
 console,Date,Intl,Map,Set,JSON,Promise,queueMicrotask,
 document:{querySelector:()=>null},
 view:'jobWorkspace',currentJobId:'p1',jobWorkspaceTab:'summary',
 socleCurrentOrganizationId:'org1',socleCurrentAccess:{userId:'user1',roleCode:'OWNER',permissions:[]},
 esc:escape,jsString:value=>String(value).replaceAll("'","\\'"),
 render:()=>calls.push(['render']),
 openWorkPacketHistory:id=>calls.push(['task',id]),
 iaAShowPurchaseOrder:id=>calls.push(['order',id]),
 showQuote:id=>calls.push(['quote',id]),
 navigate:route=>calls.push(['navigate',route]),
 canViewModule:route=>['purchases','quotes','timeEntries'].includes(route),
 purchaseOrders:[{id:'po1'}],quotes:[{id:23}],
 serverJson:async(...args)=>{requests.push(args);throw Error('Unexpected API call in navigation test');}
});
vm.runInContext(source+'\n globalThis.testHub={state:projectHubUiState,list:projectHubNextActionList,panel:projectHubNextActionsPanel,access:projectHubAccessKey,run:projectHubRunAction,refresh:projectHubRefresh};',context);
const api=context.testHub;
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS '+name);}
const state={
 status:'ready',forecastStatus:'ready',
 hub:{capabilities:{viewTasks:true,viewProcurement:true,viewCommercial:true,viewFinancial:true},
 tasks:{items:[{id:'t1',title:'Sécuriser',status:'blocked'},{id:'t2',title:'Déposer',status:'todo'},{id:'t3',title:'Ancien',status:'done'}]},
 procurement:{purchaseOrders:{items:[{id:'po1',reference:'BC-1',status:'commandée'},{id:'po2',reference:'BC-2',status:'reçue'}]}},
 commercial:{quotes:{items:[{id:23,reference:'D-1',status:'Brouillon'},{id:24,reference:'D-2',status:'Accepté'}]}}},
 forecast:{quality:{reasons:['TIME_CORRECTIONS_PENDING','UNCLASSIFIED_COSTS','BASELINE_MISSING']}}
};
const keys=s=>Array.from(api.list(s),x=>x.key);
check('loading has no action',()=>assert.equal(api.list({status:'loading'}).length,0));
check('failed hub has no action',()=>assert.equal(api.list({status:'error'}).length,0));
check('blocked task first',()=>assert.equal(keys(state)[0],'task:t1'));
check('completed task omitted',()=>assert(!keys(state).includes('task:t3')));
check('received order omitted',()=>assert(!keys(state).includes('order:po2')));
check('accepted quote omitted',()=>assert(!keys(state).includes('quote:24')));
check('list bounded to six',()=>assert.equal(api.list(state).length,6));
check('time correction present',()=>assert(keys(state).includes('time-review')));
check('unclassified cost present',()=>assert(keys(state).includes('cost-classification')));
const noRights=structuredClone(state);noRights.hub.capabilities={};
check('stale data without capabilities not exposed',()=>assert.equal(api.list(noRights).length,0));
const tasksOnly=structuredClone(state);tasksOnly.hub.capabilities={viewTasks:true};
check('task-only user sees only tasks',()=>assert.deepEqual(keys(tasksOnly),['task:t1','task:t2']));
const noForecast=structuredClone(state);noForecast.forecastStatus='loading';
check('loading forecast has no financial actions',()=>assert(!keys(noForecast).some(x=>['time-review','cost-classification','forecast'].includes(x))));
const unsafe=structuredClone(tasksOnly);unsafe.hub.tasks.items[0].title='<img src=x onerror=alert(1)>';
check('action titles escaped',()=>{const html=api.panel(unsafe,'p"<&');assert(!html.includes('<img'));assert(html.includes('&lt;img'));assert(html.includes('data-project-id="p&quot;&lt;&amp;"'));});
check('empty text does not assert exhaustive completion',()=>assert(api.panel(noRights,'p1').includes('parmi les éléments chargés')));
state.accessKey=api.access();api.state.set('p1',state);
const button=key=>({dataset:{projectId:'p1',actionKey:key}});
check('task opens existing read view',()=>{calls.length=0;api.run(button('task:t1'));assert.deepEqual(calls,[['task','t1']]);});
check('order opens its exact record',()=>{calls.length=0;api.run(button('order:po1'));assert.deepEqual(calls,[['order','po1']]);});
check('unknown action is ignored',()=>{calls.length=0;api.run(button('order:not-listed'));assert.equal(calls.length,0);});
check('other project cannot dispatch stale action',()=>{calls.length=0;context.currentJobId='p2';api.run(button('task:t1'));assert.equal(calls.length,0);context.currentJobId='p1';});
check('other screen cannot dispatch stale action',()=>{calls.length=0;context.view='stock';api.run(button('task:t1'));assert.equal(calls.length,0);context.view='jobWorkspace';});
check('scope change invalidates rendered actions',()=>{calls.length=0;context.socleCurrentAccess={userId:'user2',roleCode:'OWNER',permissions:[]};api.run(button('task:t1'));assert.equal(calls.length,0);assert.equal(api.state.size,0);});
state.accessKey=api.access();api.state.set('p1',state);
check('financial navigation changes only tab',()=>{calls.length=0;api.run(button('cost-classification'));assert.equal(context.jobWorkspaceTab,'finance');assert.deepEqual(calls,[['render']]);});
check('time action uses authorized pointages route',()=>{calls.length=0;api.run(button('time-review'));assert.deepEqual(calls,[['navigate','timeEntries']]);});
check('manual refresh only current project',()=>{calls.length=0;api.refresh('p2');assert(api.state.has('p1'));assert.equal(calls.length,0);api.refresh('p1');assert.equal(api.state.size,0);assert.deepEqual(calls,[['render']]);});
check('actions never submit API mutations',()=>assert.equal(requests.length,0));
const stockSource=fs.readFileSync(path.join(root,'web/stock-catalog-v2.js'),'utf8');
const start=stockSource.indexOf('function stockCatalogUnitLabel('),end=stockSource.indexOf('\nfunction stockCatalogLocationLabel(',start);
assert(start>=0&&end>start);
const format=vm.runInNewContext(stockSource.slice(start,end)+'\nstockCatalogUnitLabel;');
for(const [input,expected] of [['linear_metre','mètre linéaire'],['square_metre','m²'],['bag_5kg','sac de 5 kg'],['box_100','boîte de 100'],['piece','pièce'],['custom-unit','custom-unit']]){
 check('display unit '+input,()=>assert.equal(format(input),expected));
}
console.log(JSON.stringify({result:'PASS',checks,scope:'Project actions permissions/context/navigation + display units',apiMutations:requests.length}));

