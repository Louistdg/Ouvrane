import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root=process.argv[2]||process.cwd();
const server=fs.readFileSync(path.join(root,'web/server-modules.js'),'utf8');
const admin=fs.readFileSync(path.join(root,'web/admin.js'),'utf8');
const orderedStartup='// Resolve the initial organization before the workspace captures its request scope.\nglobalThis.socleOrganizationStartup=Promise.resolve().then(initOrganizationSwitcher);';
const oldStartup='queueMicrotask(initOrganizationSwitcher);';
const oldAdmin="document.querySelector('#nav').setAttribute('inert','');try{let body;";
const orderedAdmin="document.querySelector('#nav').setAttribute('inert','');try{if(globalThis.socleOrganizationStartup)await globalThis.socleOrganizationStartup;let body;";
const beforeAdmin=admin.replace(orderedAdmin,oldAdmin),afterAdmin=beforeAdmin.replace(oldAdmin,orderedAdmin);
assert(beforeAdmin.includes(oldAdmin));assert(afterAdmin.includes(orderedAdmin));
assert(server.includes(oldStartup)||server.includes(orderedStartup));
const helperStart=server.indexOf("let activeSocleOrganizationId="),helperEnd=server.indexOf('function setSocleMobileOrganizationMenu(',helperStart);
assert(helperStart>=0&&helperEnd>helperStart);
const helpers=server.slice(helperStart,helperEnd);
function workspaceFunction(source){
 const start=source.indexOf('async function loadWorkspace(){');
 const end=source.indexOf('\n// Wait for all feature modules',start);
 assert(start>=0&&end>start);
 return source.slice(start,end);
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function environment(initialOrg=''){
 const log=[],pending=[],elements={main:{innerHTML:''},nav:{setAttribute(){},removeAttribute(){}},saveStatus:{textContent:''}};
 const values=new Map(initialOrg?[['socle.activeOrganizationId',initialOrg]]:[]);
 const context=vm.createContext({
  console:{warn:(...args)=>log.push({warning:args.map(String)}),log:()=>{}},
  URL,Headers,Request,Response,FormData,AbortController,setTimeout,clearTimeout,queueMicrotask,
  localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)},
  location:{href:'http://localhost:4399/',origin:'http://localhost:4399'},
  document:{querySelector:selector=>elements[selector.replace('#','')]||null,body:{classList:{remove(){}}}},
  storageReady:false,storageRevision:0,savedSnapshot:'',sessionAccessKey:'',
  render:()=>log.push({render:true}),
  restoreWorkspace:state=>log.push({restored:state.fixture}),
  workspaceSnapshot:()=>'{"fixture":true}',
  storageMessage:message=>log.push({storageMessage:message}),
  scheduleSave:()=>log.push({writeScheduled:true}),
  esc:value=>String(value),
  fetch:(url,init={})=>{
   const entry={url:String(url),method:String(init.method||'GET').toUpperCase(),organization:new Headers(init.headers).get('x-socle-organization-id')||''};
   log.push(entry);
   return new Promise((resolve,reject)=>pending.push({...entry,resolve,reject,resolved:false}));
  }
 });
 vm.runInContext(helpers,context);
 context.initOrganizationSwitcher=()=>{
  const started=vm.runInContext('recoverActiveSocleOrganization()',context);
  context.startedOrganizationInitialization=started;
  return started;
 };
 function respond(url,body,status=200){
  const entry=pending.find(entry=>entry.url===url&&!entry.resolved);
  assert(entry,'pending '+url);entry.resolved=true;
  entry.resolve(new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}}));
 }
 return {context,log,elements,respond,pending};
}
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS '+name);}
async function bootstrap(ordered,initialOrg=''){
 const env=environment(initialOrg),ctx=env.context;
 vm.runInContext(workspaceFunction(ordered?afterAdmin:beforeAdmin),ctx);
 vm.runInContext(ordered?orderedStartup:oldStartup,ctx);
 await tick();
 const loading=vm.runInContext('loadWorkspace()',ctx);
 await tick();
 if(ordered)check('state waits for organization '+(initialOrg||'fresh'),()=>assert.deepEqual(env.log.filter(e=>e.url).map(e=>e.url),['/api/organizations']));
 else check('old startup sends both requests concurrently',()=>assert.deepEqual(env.log.filter(e=>e.url).map(e=>e.url),['/api/organizations','/api/state']));
 env.respond('/api/organizations',{activeOrganizationId:'org1',organizations:[{id:'org1',name:'Test'}]});
 await ctx.startedOrganizationInitialization;
 await tick();
 const stateRequest=env.log.find(e=>e.url==='/api/state');
 assert(stateRequest);
 if(ordered)check('state uses resolved organization '+(initialOrg||'fresh'),()=>assert.equal(stateRequest.organization,'org1'));
 env.respond('/api/state',{organizationId:'org1',access:{userId:'user1',roleCode:'OWNER',permissions:['workspace.view']},role:'OWNER',state:{fixture:true},revision:1});
 await loading;
 if(!ordered){
  check('old race reproduced as context-change load failure',()=>assert.match(env.elements.main.innerHTML,/Le contexte de la demande a changé/));
  check('old race never applies stale state',()=>assert(!env.log.some(e=>e.restored)));
 }else{
  check('ordered startup applies current state '+(initialOrg||'fresh'),()=>assert(env.log.some(e=>e.restored===true)));
  check('ordered startup ready without retry '+(initialOrg||'fresh'),()=>{assert.equal(ctx.storageReady,true);assert.equal(env.log.filter(e=>e.url==='/api/state').length,1);assert.doesNotMatch(env.elements.main.innerHTML,/Impossible de charger/);});
  check('bootstrap performs only reads '+(initialOrg||'fresh'),()=>{assert(env.log.filter(e=>e.url).every(e=>e.method==='GET'));assert(!env.log.some(e=>e.writeScheduled));});
 }
 return env;
}
await bootstrap(false);
await bootstrap(true);
await bootstrap(true,'org1');
await bootstrap(true,'old-org');
{
 const env=environment('org1'),ctx=env.context;
 ctx.socleCurrentAccess={userId:'user1',roleCode:'OWNER',permissions:['workspace.view']};
 const promise=vm.runInContext("fetchSocleJson('/api/state',{},'org1')",ctx);
 ctx.socleCurrentAccess={userId:'user2',roleCode:'OWNER',permissions:['workspace.view']};
 env.respond('/api/state',{state:{stale:true}});
 await assert.rejects(promise,e=>e.name==='AbortError'&&/contexte/.test(e.message));
 check('account-change guard preserved',()=>assert.equal(env.log.filter(e=>e.url).length,1));
}
{
 const env=environment('org1'),ctx=env.context;
 const promise=vm.runInContext("fetchSocleJson('/api/state',{method:'PUT',body:'{}'},'org1')",ctx);
 env.respond('/api/state',{error:'Unavailable'},503);
 const result=await promise;
 check('writes are not retried',()=>{assert.equal(result.response.status,503);assert.equal(env.log.filter(e=>e.url).length,1);assert.equal(env.log[0].method,'PUT');});
}
{
 const env=environment('org1'),ctx=env.context;
 const promise=vm.runInContext("fetchSocleJson('/api/state',{method:'PUT',body:'{}'},'org1')",ctx);
 vm.runInContext("setActiveSocleOrganizationId('org2')",ctx);
 env.respond('/api/state',{ok:true});
 await assert.rejects(promise,e=>e.name==='AbortError');
 check('organization-change write response rejected without replay',()=>assert.equal(env.log.filter(e=>e.url).length,1));
}
console.log(JSON.stringify({result:'PASS',checks,oldRaceReproduced:true,scopeGuardChanged:false,writeRetries:0}));

