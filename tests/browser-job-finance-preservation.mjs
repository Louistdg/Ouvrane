import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {connectBrowser,waitFor,waitForApp} from './helpers/browser-cdp.mjs';
const base=process.env.SOCLE_TEST_URL;assert.ok(base&&['127.0.0.1','localhost'].includes(new URL(base).hostname));
const browser=await connectBrowser(base),tab=await browser.createSession(base);let checks=0;
const run=(s,l)=>tab.evaluate(s,'job-finance:'+l);
async function api(path,method='GET',data){return run(`fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{'content-type':'application/json'},${data===undefined?'':`body:JSON.stringify(${JSON.stringify(data)}),`}}).then(async r=>{const b=await r.json().catch(()=>null);if(!r.ok)throw Error(JSON.stringify(b));return b})`,'api-'+path)}
try{
 await tab.navigate(new URL('/health',base).href);await api('/__local-test/login','POST',{email:'direction@batinova.example'});await tab.navigate(base);await waitForApp(tab);
 const original=await api('/api/state'),fixtures=[210021,'QA21-text'];
 const finance={plannedHours:10,labourBudget:1200,materialsBudget:500,subcontractingBudget:200,otherBudget:30,materials:121.5,subcontracting:95,other:7,hourlyCost:42,adjustments:[{amount:15,note:'Original'}],supplierInvoices:180,customLedger:{keep:[1,2]}};
 for(const id of fixtures)original.state.jobs.push({id,name:'QA21 chantier '+id,client:'Client conservé',type:'Rénovation',finance:structuredClone(finance),notes:[{text:'Conserver'}],customField:{original:true}});
 await api('/api/state','PUT',{revision:original.revision,state:original.state});await tab.reload();await waitForApp(tab);
 for(const width of [1440,412])for(const id of fixtures){
  await tab.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width===412});await tab.call('Emulation.setTouchEmulationEnabled',{enabled:width===412});
  await run(`jobForm(${JSON.stringify(id)})`,'open-existing-job');
  await waitFor(()=>run('Boolean(document.querySelector("#modal[open] [name=name]"))','form-ready'),'Existing chantier form ready');
  await run(`(()=>{const e=document.querySelector('#modalbody [name=name]');e.value=${JSON.stringify('QA21 modifié '+id+' '+width)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`,'rename-job');
  const point=await run(`(()=>{const e=document.querySelector('#modalbody .modal-actions button.primary');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,'save-point');
  if(width===412){await tab.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await tab.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}else{await tab.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await tab.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point})}
  await waitFor(()=>run('!document.querySelector("#modal[open]")','form-closed'),'Actual job form saves');
  await waitFor(()=>run('!saveRunning&&!saveFailed&&workspaceSnapshot()===savedSnapshot','persisted'),'Job changes reach actual server');
  const saved=(await api('/api/state')).state.jobs.filter(j=>String(j.id)===String(id));assert.equal(saved.length,1,'Editing never creates a duplicate chantier');assert.deepEqual(saved[0].finance,finance,'Changing a chantier name must retain all costs and financial extensions');assert.equal(saved[0].name,'QA21 modifié '+id+' '+width);assert.deepEqual(saved[0].customField,{original:true});checks++;console.log('PASS financial preservation and identity '+id+' '+width);
 }
 console.log('PASS '+checks+' real job form preservation cases');
}catch(error){const shot=await tab.call('Page.captureScreenshot',{format:'png'}).catch(()=>null);if(shot)writeFileSync(new URL('./job-finance-failure.png',import.meta.url),Buffer.from(shot.data,'base64'));throw error}finally{await browser.close()}
