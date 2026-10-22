import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {connectBrowser,waitFor,waitForApp} from './helpers/browser-cdp.mjs';
const base=process.env.SOCLE_TEST_URL;assert.ok(base&&['127.0.0.1','localhost'].includes(new URL(base).hostname));
const browser=await connectBrowser(base),tab=await browser.createSession(base);let checks=0;
const run=(s,l)=>tab.evaluate(s,'job-customer:'+l);
async function api(path,method='GET',data){return run(`fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{'content-type':'application/json'},${data===undefined?'':`body:JSON.stringify(${JSON.stringify(data)}),`}}).then(async r=>{const b=await r.json().catch(()=>null);if(!r.ok)throw Error(JSON.stringify(b));return b})`,'api-'+path)}
try{
 await tab.navigate(new URL('/health',base).href);await api('/__local-test/login','POST',{email:'direction@batinova.example'});await tab.navigate(base);await waitForApp(tab);
 const a=(await api('/api/customers','POST',{companyName:'QA21 homonyme',street:'Rue Alpha'})).customer,b=(await api('/api/customers','POST',{companyName:'QA21 homonyme',street:'Rue Beta'})).customer;
 const original=await api('/api/state'),fixtures=[210021,'QA21-text'];
 const finance={plannedHours:10,labourBudget:1200,materialsBudget:500,subcontractingBudget:200,otherBudget:30,materials:121.5,subcontracting:95,other:7,hourlyCost:42,adjustments:[{amount:15,note:'Original'}],supplierInvoices:180,customLedger:{keep:[1,2]}};
 for(const id of fixtures)original.state.jobs.push({id,name:'QA21 chantier '+id,customerId:a.id,client:a.companyName,type:'Rénovation',finance:structuredClone(finance),notes:[{text:'Conserver'}],customField:{original:true}});
 await api('/api/state','PUT',{revision:original.revision,state:original.state});await tab.reload();await waitForApp(tab);
 for(const width of [1440,412])for(const id of fixtures){
  await tab.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width===412});await tab.call('Emulation.setTouchEmulationEnabled',{enabled:width===412});
  await run(`jobForm(${JSON.stringify(id)})`,'open-existing-job');
  await waitFor(()=>run('Boolean(document.querySelector("#modal[open] [name=name]"))','form-ready'),'Existing chantier form ready');
  assert.ok(await run('Boolean(document.querySelector("#modalbody select[name=customerId]"))','canonical-selector'),'Chantier uses the canonical customer selector');
  assert.ok(await run(`(()=>{const e=document.querySelector('#modalbody [name=customerId]');return [...e.options].find(o=>o.value===${JSON.stringify(a.id)}).text!==[...e.options].find(o=>o.value===${JSON.stringify(b.id)}).text})()`,'homonym-labels'),'Homonymous customer choices remain distinguishable');
  const target=width===1440?b:a;await run(`(()=>{const e=document.querySelector('#modalbody [name=customerId]');e.value=${JSON.stringify(target.id)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`,'choose-customer');
  await run(`(()=>{const e=document.querySelector('#modalbody [name=name]');e.value=${JSON.stringify('QA21 modifié '+id+' '+width)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`,'rename-job');
  const point=await run(`(()=>{const e=document.querySelector('#modalbody .modal-actions button.primary');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,'save-point');
  if(width===412){await tab.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await tab.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}else{await tab.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await tab.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point})}
  await waitFor(()=>run('!document.querySelector("#modal[open]")','form-closed'),'Actual job form saves');
  await waitFor(()=>run('!saveRunning&&!saveFailed&&workspaceSnapshot()===savedSnapshot','persisted'),'Job changes reach actual server');
  const saved=(await api('/api/state')).state.jobs.filter(j=>String(j.id)===String(id));assert.equal(saved.length,1,'Editing never creates a duplicate chantier');assert.equal(saved[0].customerId,target.id,'Selected customer identity reaches server');assert.deepEqual(saved[0].finance,finance,'Changing a chantier name must retain all costs and financial extensions');assert.equal(saved[0].name,'QA21 modifié '+id+' '+width);assert.deepEqual(saved[0].customField,{original:true});checks++;console.log('PASS financial preservation and identity '+id+' '+width);
 }
 const currentJob=(await api('/api/state')).state.jobs.find(j=>j.id===fixtures[0]);
 await api('/api/quotes','POST',{operationKey:'qa21-client-conflict-quote',customerId:a.id,projectId:String(fixtures[0]),client:a.companyName,title:'Devis lié',date:'2026-10-21',validUntil:'2026-11-21',lines:[{label:'Travail',qty:1,unit:'h',price:42,vat:6}]});
 await run(`jobForm(${JSON.stringify(fixtures[0])})`,'open-conflicting-job');
 await run(`(()=>{const f=document.querySelector('#modalbody form'),e=f.querySelector('[name=customerId]');e.value=${JSON.stringify(b.id)};e.dispatchEvent(new Event('change',{bubbles:true}));f.requestSubmit()})()`,'submit-conflicting-client');
 await waitFor(()=>run('Boolean(document.querySelector("#commercialJobError")?.textContent)','conflict-visible'),'Conflict stays in the actual form');assert.deepEqual((await api('/api/state')).state.jobs.find(j=>j.id===fixtures[0]),currentJob,'Rejected client change leaves the server job exact');
 await run(`(()=>{const f=document.querySelector('#modalbody form'),e=f.querySelector('[name=customerId]');e.value=${JSON.stringify(a.id)};e.dispatchEvent(new Event('change',{bubbles:true}));f.requestSubmit()})()`,'correct-conflicting-client');await waitFor(()=>run('!document.querySelector("#modal[open]")','corrected-form-closed'),'Correcting client after refusal can save');checks++;console.log('PASS conflict preserves data and allows correction');
 console.log('PASS '+checks+' real job form preservation cases');
}catch(error){const shot=await tab.call('Page.captureScreenshot',{format:'png'}).catch(()=>null);if(shot)writeFileSync(new URL('./job-customer-failure.png',import.meta.url),Buffer.from(shot.data,'base64'));throw error}finally{await browser.close()}
