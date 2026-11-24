import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {connectBrowser,waitForApp,waitFor} from './helpers/browser-cdp.mjs';
const base=process.env.SOCLE_TEST_URL;
assert.ok(base&&['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'Only a disposable local Browser Gate is permitted.');
const browser=await connectBrowser(base),tab=await browser.createSession(base);
let touch=false;
const run=(code,label)=>tab.evaluate(code,'home-layout:'+label);
async function api(path,method='GET',data){return run(`fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{'content-type':'application/json','x-socle-organization-id':globalThis.socleCurrentOrganizationId||''},${data===undefined?'':`body:JSON.stringify(${JSON.stringify(data)}),`}}).then(async r=>({status:r.status,body:await r.json().catch(()=>null)}))`,'api-'+path)}
async function point(selector){return run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,'point')}
async function click(selector){const p=await point(selector);if(touch){await tab.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await tab.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}else{await tab.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await tab.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p})}}
async function capture(label){const shot=await tab.call('Page.captureScreenshot',{format:'png'});writeFileSync(new URL('./home-layout-'+label+'.png',import.meta.url),Buffer.from(shot.data,'base64'))}
async function saved(){await waitFor(()=>run('document.querySelector("[data-home-layout-status]")?.dataset.state==="saved"','saved'),'The real layout receives its server acknowledgement')}
try{
 await tab.navigate(new URL('/health',base).href);
 await tab.evaluate("fetch('/__local-test/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'direction@batinova.example'})})",'home-layout:login');
 await tab.navigate(base);await waitForApp(tab);
 await tab.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await tab.evaluate('navigate("home")','home-layout:home');
 const diagnostic=await tab.evaluate("['.ia-attention','.ia-home-weather','.ia-home-portals','.ia-owner-messages','.ia-owner-tasks','.ia-owner-week','.v3-jobs'].map(selector=>{const e=document.querySelector('#main '+selector),r=e?.getBoundingClientRect();return{selector,parent:e?.parentElement?.className,tag:e?.tagName,rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,header:e?.querySelector('header,.panel-head,h2')?.outerHTML?.slice(0,500)}})",'home-layout:existing-blocks');
 console.log('HOME_BLOCKS '+JSON.stringify(diagnostic));
 await waitFor(()=>run('document.querySelectorAll("#main [data-home-block] [data-home-drag]").length>=5','direct-handles'),'The existing home blocks offer direct drag handles without opening a customization mode',8000);
 await waitFor(()=>run('document.querySelector("[data-home-layout]")?.dataset.ready==="true"','ready'),'Direct dragging is ready after the preference is loaded');

 // Mission 07: collect both original defects before reporting a regression failure.
 const missionFailures=[];
 const check=(value,message)=>{if(!value)missionFailures.push(message)};
 const alertValue=()=>run('[...document.querySelectorAll(".home-kpi")].find(e=>e.querySelector("small")?.textContent==="Alertes")?.querySelector("strong")?.textContent','alert-value');
 await waitFor(()=>run('iaAAttentionHomeReady()','feeds-ready'),'Owner feeds have finished loading');
 await run('render()','settled-home');
 await waitFor(()=>run('document.querySelector("[data-home-layout]")?.dataset.ready==="true"','settled-ready'),'Settled layout');
 assert.equal(await run('document.body.dataset.v3Theme','default-theme'),'repere-cuivre');
 const themes=['repere-eclipse','petrole','repere-cuivre','repere-lunaire'];
 assert.deepEqual(await run('[...document.querySelectorAll(".v3-theme-choice")].map(e=>e.dataset.theme)','theme-choices'),themes);
 for(const id of themes){await click('.v3-theme-button');await click('.v3-theme-choice[data-theme="'+id+'"]');assert.equal(await run('document.body.dataset.v3Theme','selected-theme'),id);await tab.reload();await waitForApp(tab);assert.equal(await run('document.body.dataset.v3Theme','persisted-theme'),id);}
 await click('.v3-theme-button');await click('.v3-theme-choice[data-theme="repere-cuivre"]');
 console.log('PASS four existing themes, Cuivre default and theme persistence');
 await waitFor(()=>run('iaAAttentionHomeReady()&&document.querySelector("[data-home-layout]")?.dataset.ready==="true"','themes-home-ready'),'Home ready after theme reloads');
 const initialAlert=Number(await alertValue());
 await run('globalThis.__missionOrders=purchaseOrders.slice();purchaseOrders.push({id:"QA07-OVERDUE",number:"QA07-OVERDUE",status:"ordered",expectedDate:"2000-01-01",lines:[]});render()','add-overdue');
 await waitFor(()=>run('document.querySelector(".ia-attention")?.textContent.includes("QA07-OVERDUE")','overdue-visible'),'Real owner attention list includes the overdue order');
 await waitFor(()=>run('Boolean(document.querySelector(".home-kpis"))','kpis-mounted'),'KPI mounted');
 check(Number(await alertValue())===initialAlert+1,'Alert counter increases by one for one overdue order');
 await run('iaAAttentionSetFilter("reports")','filter-no-order');
 await new Promise(r=>setTimeout(r,100));
 check(Number(await alertValue())===initialAlert+1,'Alert count is independent of list filters and truncation');
 await run('purchaseOrders.splice(0,purchaseOrders.length,...__missionOrders);iaAAttentionSetFilter("all");render()','restore-orders');
 for(const phone of [false,true]){
  touch=phone;
  await tab.call('Emulation.setDeviceMetricsOverride',{width:phone?412:1440,height:1000,deviceScaleFactor:1,mobile:phone});
  await tab.call('Emulation.setTouchEmulationEnabled',{enabled:phone});
  await waitFor(()=>run('document.querySelector("[data-home-layout]")?.dataset.mobile==="'+phone+'"','mode-ready'),'Layout matches viewport');
  // Delay a genuine local task response; the existing agenda completion calls render().
  await run('(()=>{const original=serverJson;globalThis.__missionAgenda={original};serverJson=async function(url,options){const result=await original.apply(this,arguments);if(url==="/api/tasks")return new Promise(resolve=>{__missionAgenda.release=()=>resolve(result)});return result};iaARefreshOwnerAgenda()})()','hold-agenda');
  await waitFor(()=>run('Boolean(__missionAgenda.release)&&document.querySelector("[data-home-layout]")?.dataset.ready==="true"','agenda-held'),'Real task response held with layout ready');
  const prior=(await api('/api/me/preferences/dashboard/home-layout')).body.preference?.value??null;
  const start=await point('[data-home-block="weather"] [data-home-drag]');
  const target=await run(phone?'(()=>{const r=document.querySelector("[data-home-block=portals]").getBoundingClientRect();return{x:r.x+30,y:r.bottom-2}})()':'(()=>{const r=document.querySelector("[data-home-layout]").getBoundingClientRect();return{x:r.x+r.width*.75,y:r.y+18}})()','refresh-target');
  await run('globalThis.__missionCard=document.querySelector("[data-home-block=weather]")','remember-card');
  if(phone){await tab.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});await tab.call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[target]})}
  else{await tab.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...start});await tab.call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,...target})}
  await waitFor(()=>run('Boolean(document.querySelector("[data-home-drop]"))','refresh-preview'),'Gesture has a destination before the response');
  await run('__missionAgenda.release()','release-actual-agenda');
  await waitFor(()=>run('iaAAttentionHomeReady()','agenda-completed'),'Existing agenda completion has requested its automatic render');
  await new Promise(r=>setTimeout(r,150));
  const held=await run('({same:__missionCard===document.querySelector("[data-home-block=weather]"),connected:__missionCard.isConnected,dragging:document.body.classList.contains("home-layout-dragging"),preview:!!document.querySelector("[data-home-drop]")})','gesture-after-response');
  await run('render();render()','coalesced-explicit-refresh');
  check(await run('__missionCard.isConnected&&!!document.querySelector("[data-home-drop]")','explicit-still-held'),'Explicit refreshes preserve the same held card');
  check(held.same&&held.connected&&held.dragging&&held.preview,'Automatic agenda refresh preserves the held card and gesture '+(phone?'mobile':'PC'));
  if(phone)await tab.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  else await tab.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...target});
  await run('serverJson=__missionAgenda.original','restore-agenda-transport');
  if(held.dragging){await saved();await waitFor(()=>run('!__missionCard.isConnected&&!document.body.classList.contains("home-layout-dragging")','deferred-refresh-applied'),'Deferred home refresh is applied after release');}
  const after=(await api('/api/me/preferences/dashboard/home-layout')).body.preference?.value??null;
  check(JSON.stringify(after)!==JSON.stringify(prior),'Completed gesture saves a new arrangement '+(phone?'mobile':'PC'));
  if(phone)check(after?.mobileOrder.indexOf('weather')>after?.mobileOrder.indexOf('portals'),'Touch destination determines saved order');
  else check(after?.positions.weather.column===1,'PC destination determines saved column');
  await tab.reload();await waitForApp(tab);
  await waitFor(()=>run('document.querySelector("[data-home-layout]")?.dataset.ready==="true"','mission-reload-ready'),'Reload restores arrangement');
  assert.deepEqual((await api('/api/me/preferences/dashboard/home-layout')).body.preference?.value??null,after,'Latest acknowledged arrangement survives reload');
  console.log('MISSION07_REFRESH '+JSON.stringify({device:phone?'mobile-412':'PC-1440',held,changed:JSON.stringify(after)!==JSON.stringify(prior),persistedAcrossReload:true}));
 }
 touch=false;await tab.call('Emulation.setTouchEmulationEnabled',{enabled:false});await tab.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 if(missionFailures.length)throw Error('MISSION07_REGRESSIONS: '+missionFailures.join('; '));
 console.log('PASS MISSION07 alert counter and automatic refresh during PC/mobile gestures');

 const before=(await api('/api/state')).body;
 assert.equal(await run('Boolean(document.querySelector("#modal[open]"))','no-mode'),false);
 const p=await point('[data-home-block="weather"] [data-home-drag]');
 const destination=await run('(()=>{const r=document.querySelector("[data-home-layout]").getBoundingClientRect();return{x:r.x+r.width*.75,y:r.y+18}})()','destination');
 await tab.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});
 await tab.call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,...destination});
 await waitFor(()=>run('Boolean(document.querySelector("[data-home-drop]"))','drop-visible'),'A real pointer move previews its destination');
 await capture('drag-1440');
 await tab.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...destination});await saved();
 let preference=(await api('/api/me/preferences/dashboard/home-layout')).body.preference;
 assert.equal(preference.value.positions.weather.column,1,'The block reaches the right-hand space selected by the user');
 console.log('PASS native home header drag, destination preview and automatic server persistence without a mode');
 await click('[data-home-block="weather"] [data-home-resize]');await saved();
 preference=(await api('/api/me/preferences/dashboard/home-layout')).body.preference;
 assert.equal(preference.value.positions.weather.span,2,'An inline block control expands to both columns');
 await tab.reload();await waitForApp(tab);
 await waitFor(()=>run('document.querySelector("[data-home-layout]")?.dataset.ready==="true"','reload-ready'),'A reload retrieves the saved arrangement');
 await waitFor(()=>run('iaAAttentionHomeReady()&&document.querySelector("[data-home-block=weather]")?.getBoundingClientRect().width>document.querySelector("[data-home-layout]")?.getBoundingClientRect().width*.9','reloaded-width'),'Saved width remains after asynchronous home feeds settle');
 console.log('PASS saved block width and position survive a real reload');
 await capture('saved-1440');
 assert.deepEqual((await api('/api/state')).body.state,before.state,'Layout changes preserve the entire business workspace');
 console.log('PASS arranging home does not modify jobs, quotes, contacts, teams or stock');
 const external={...preference.value,mobileOrder:['tasks','weather','portals']};
 assert.equal((await api('/api/me/preferences/dashboard/home-layout','PUT',{schemaVersion:1,value:external,expectedValue:preference.value})).status,200);
 await click('[data-home-block="weather"] [data-home-drag]');
 await tab.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});await tab.call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
 await waitFor(()=>run('document.querySelector("[data-home-layout-status]")?.dataset.state==="conflict"','stale-tab-conflict'),'A stale home layout does not overwrite a change from another window');
 assert.deepEqual((await api('/api/me/preferences/dashboard/home-layout')).body.preference.value,external);
 await click('[data-home-layout-status] button');
 await waitFor(()=>run('document.querySelector("[data-home-layout]")?.dataset.ready==="true"&&document.querySelector("[data-home-layout-status]")?.dataset.state==="saved"','conflict-reloaded'),'The conflict action reloads the actual current layout',6000);
 await click('[data-home-block="weather"] [data-home-drag]');
 await tab.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});await tab.call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});await saved();
 console.log('PASS stale-tab protection, explicit recovery and a subsequent keyboard move');
 await click('[data-home-block="tasks"] header button.link');
 assert.equal(await run('view','existing-action'),'actions','The existing task action is still a normal usable button');
 await run('navigate("home")','return-home');
 const geometryBeforeMobile=(await api('/api/me/preferences/dashboard/home-layout')).body.preference.value.positions;
 touch=true;await tab.call('Emulation.setDeviceMetricsOverride',{width:412,height:1000,deviceScaleFactor:1,mobile:true});await tab.call('Emulation.setTouchEmulationEnabled',{enabled:true});await tab.call('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'});
 await waitFor(()=>run('document.querySelector("[data-home-layout]")?.dataset.mobile==="true"','mobile-ready'),'The Samsung layout is stacked');
 const start=await point('[data-home-block="portals"] [data-home-drag]'),end=await run('(()=>{const r=document.querySelector("[data-home-block=weather]").getBoundingClientRect();return{x:r.x+40,y:r.y+10}})()','touch-destination');
 await tab.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});await tab.call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[end]});
 await waitFor(()=>run('Boolean(document.querySelector("[data-home-drop]"))','touch-preview'),'Touch dragging also shows its destination',5000);await capture('drag-412');
 await tab.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await saved();
 const mobileValue=(await api('/api/me/preferences/dashboard/home-layout')).body.preference.value;
 assert.ok(mobileValue.mobileOrder.indexOf('portals')<mobileValue.mobileOrder.indexOf('weather'),'A native touch move reorders the mobile stack');
 assert.deepEqual(mobileValue.positions,geometryBeforeMobile,'The phone arrangement preserves the PC geometry');
 assert.equal(await run('document.documentElement.scrollWidth>innerWidth','mobile-overflow'),false);await capture('saved-412');
 console.log('PASS Samsung emulated native touch arrangement, preview, automatic save and separate PC geometry');
 const edgeStart=await point('[data-home-block="portals"] [data-home-drag]'),scrollBefore=await run('scrollY','scroll-before-edge'),edgeEnd={x:edgeStart.x,y:980};
 await tab.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[edgeStart]});await tab.call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[edgeEnd]});
 await waitFor(()=>run(`scrollY>${scrollBefore+120}`,'native-auto-scroll'),'A held touch near the edge can reach blocks beyond the initial viewport',3500);
 await tab.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await saved();
 assert.deepEqual((await api('/api/me/preferences/dashboard/home-layout')).body.preference.value.positions,geometryBeforeMobile);
 console.log('PASS a native touch drag scrolls beyond one phone viewport without altering PC geometry');
 await run('(()=>{const p={original:serverJson,calls:[],lost:false};globalThis.__homeLost=p;serverJson=async function(url,options={}){const result=await p.original.apply(this,arguments);if(url==="/api/me/preferences/dashboard/home-layout"&&options.method==="PUT"){p.calls.push({body:options.body,replayed:result.replayed===true});if(!p.lost){p.lost=true;throw Error("QA17 réponse perdue après vraie sauvegarde")}}return result}})()','lose-real-save-response');
 await click('[data-home-block="weather"] [data-home-drag]');await tab.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});await tab.call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
 await waitFor(()=>run('document.querySelector("[data-home-layout-status]")?.dataset.state==="error"','lost-response-status'),'The interface does not claim an unknown save succeeded');
 await click('[data-home-layout-status] button');await saved();
 const replay=await run('__homeLost.calls','lost-response-replay');assert.ok(replay.length===2&&replay[0].body===replay[1].body&&replay[1].replayed);await run('serverJson=__homeLost.original','restore-save-transport');
 console.log('PASS an actual saved layout with a lost response is retried exactly and acknowledged');
 await run('(()=>{const p={original:serverJson};globalThis.__homeHeld=p;serverJson=async function(url,options={}){const result=await p.original.apply(this,arguments);if(url==="/api/me/preferences/dashboard/home-layout"&&options.method==="PUT"&&!p.release)return new Promise(resolve=>{p.release=()=>{resolve(result);p.released=true}});return result}})()','hold-real-owner-save');
 await click('[data-home-block="weather"] [data-home-drag]');await tab.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});await tab.call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
 await waitFor(()=>run('Boolean(globalThis.__homeHeld.release)','owner-result-held'),'A real owner save commits before its response is held');
 assert.equal((await api('/__local-test/login','POST',{email:'anthony.simon@batinova.example'})).status,204);
 const workerState=(await api('/api/state')).body;await run('loadWorkspace().then(()=>navigate("home"))','load-real-worker');await waitForApp(tab,workerState.access.userId);
 await run('__homeHeld.release()','release-owner-result-into-worker');
 assert.equal(await run('document.querySelectorAll("[data-home-drag]").length','worker-has-no-handles'),0);
 assert.equal((await api('/api/me/preferences/dashboard/home-layout')).body.preference,null);
 assert.equal(await run('(()=>{const e=new Event("beforeunload",{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented})()','worker-has-no-owner-pending-state'),false,'An old owner save does not leave a pending-layout guard in the worker account');
 await run('serverJson=__homeHeld.original','restore-held-save-transport');
 assert.equal(Number(await alertValue()),0,'Worker does not inherit owner alerts');
 console.log('PASS a delayed owner save cannot inject layout, success or pending state into the worker account');
 assert.equal((await api('/__local-test/login','POST',{email:'direction@batinova.example'})).status,204);await run('loadWorkspace().then(()=>navigate("home"))','restore-owner');await waitForApp(tab,before.access.userId);
 await waitFor(()=>run('document.querySelector("[data-home-layout]")?.dataset.ready==="true"','owner-ready-again'),'The owner retrieves their layout after the worker session');
 touch=false;await tab.call('Emulation.setTouchEmulationEnabled',{enabled:false});await tab.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 const ownerLayout=(await api('/api/me/preferences/dashboard/home-layout')).body.preference.value;
 const company=(await api('/api/organizations','POST',{name:'QA17 disposition indépendante'})).body.organization;assert.ok(company?.id);
 await run('initOrganizationSwitcher()','refresh-real-company-menu');
 async function chooseCompany(id){await click('#organizationLabel .organization-mobile-trigger');await click('#organizationChoices [data-organization-id="'+id+'"]');await waitFor(()=>run(`globalThis.socleCurrentOrganizationId===${JSON.stringify(id)}&&typeof storageReady!=='undefined'&&storageReady`,'company-ready'),'A real company switch reloads the selected company');await waitForApp(tab,before.access.userId);await waitFor(()=>run('document.querySelector("[data-home-layout]")?.dataset.ready==="true"','company-layout-ready'),'The selected company layout is ready')}
 await chooseCompany(company.id);
 assert.equal((await api('/api/me/preferences/dashboard/home-layout')).body.preference,null);
 await click('[data-home-block] [data-home-drag]');await tab.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});await tab.call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});await saved();
 await chooseCompany(before.organizationId);
 assert.deepEqual((await api('/api/me/preferences/dashboard/home-layout')).body.preference.value,ownerLayout);
 console.log('PASS real native company-switch controls preserve separate personal arrangements');
 assert.equal((await api('/__local-test/login','POST',{email:'batxl.accounting@simulation.invalid'})).status,204);const officeState=(await api('/api/state')).body;await run('loadWorkspace().then(()=>navigate("home"))','load-real-office');await waitForApp(tab,officeState.access.userId);
 await waitFor(()=>run('document.querySelector("[data-home-layout]")?.dataset.ready==="true"&&document.querySelectorAll("[data-home-drag]").length>0','office-ready'),'The existing office profile can arrange its own visible home blocks');
 assert.equal((await api('/api/me/preferences/dashboard/home-layout')).body.preference,null);
 await click('[data-home-block] [data-home-drag]');await tab.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});await tab.call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});await saved();await capture('office-1440');
 assert.equal((await api('/__local-test/login','POST',{email:'direction@batinova.example'})).status,204);await run('loadWorkspace().then(()=>navigate("home"))','restore-owner-after-office');await waitForApp(tab,before.access.userId);
 assert.deepEqual((await api('/api/me/preferences/dashboard/home-layout')).body.preference.value,ownerLayout);
 assert.deepEqual((await api('/api/state')).body.state,before.state);
 console.log('PASS an actual office account arranges its own blocks without changing the owner layout or business data');
}catch(error){console.log('HOME_FAILURE '+JSON.stringify(await run('({view,handles:document.querySelectorAll("[data-home-drag]").length,blocks:[...document.querySelectorAll("[data-home-block]")].map(e=>({id:e.dataset.homeBlock,parent:e.parentElement?.dataset,html:e.outerHTML.slice(0,180)})),status:document.querySelector("[data-home-layout-status]")?.outerHTML})','failure-state')));await capture('failure');throw error}
finally{await tab.close().catch(()=>{});await browser.close().catch(()=>{})}
