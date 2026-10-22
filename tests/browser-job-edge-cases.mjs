import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {connectBrowser,waitFor,waitForApp} from './helpers/browser-cdp.mjs';
const base=process.env.SOCLE_TEST_URL;assert.ok(base&&['127.0.0.1','localhost'].includes(new URL(base).hostname));
const browser=await connectBrowser(base),tab=await browser.createSession(base);let checks=0;
const run=(s,l)=>tab.evaluate(s,'job-edge:'+l);
async function api(path,method='GET',data){return run(`fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{'content-type':'application/json'},${data===undefined?'':`body:JSON.stringify(${JSON.stringify(data)}),`}}).then(async r=>{const b=await r.json().catch(()=>null);if(!r.ok)throw Error(JSON.stringify(b));return b})`,'api-'+path)}
async function clickSave(width){
  const point=await run(`(()=>{const e=document.querySelector('#modalbody .modal-actions button.primary');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,'save-point');
  if(width===412){await tab.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await tab.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
  else{await tab.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await tab.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point})}
}
try{
  await tab.navigate(new URL('/health',base).href);await api('/__local-test/login','POST',{email:'direction@batinova.example'});await tab.navigate(base);await waitForApp(tab);
  // --- CAS A : finance historique incomplète — tous les budgets présents conservés, coûts et extensions intactes ---
  let state=await api('/api/state');
  const finance={labourBudget:900,materials:121.5,subcontracting:95,other:7,hourlyCost:42,adjustments:[{amount:15,note:'Original'}],supplierInvoices:180,customLedger:{keep:[1,2]}};
  state.state.jobs.push({id:'QA21-partial',name:'QA21 budget partiel',type:'Rénovation',finance:structuredClone(finance),customField:{a:1}});
  await api('/api/state','PUT',{revision:state.revision,state:state.state});await tab.reload();await waitForApp(tab);
  for(const width of [1440,412]){
    await tab.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width===412});await tab.call('Emulation.setTouchEmulationEnabled',{enabled:width===412});
    await run(`jobForm('QA21-partial')`,'open-partial');
    await waitFor(()=>run('Boolean(document.querySelector("#modal[open] [name=name]"))','partial-ready'),'Existing partial job form ready');
    await run(`(()=>{const e=document.querySelector('#modalbody [name=name]');e.value='QA21 partiel ${width}';e.dispatchEvent(new Event('input',{bubbles:true}))})()`,'rename-partial');
    await clickSave(width);
    await waitFor(()=>run('!document.querySelector("#modal[open]")','partial-closed'),'Partial job form saves');
    await waitFor(()=>run('!saveRunning&&!saveFailed&&workspaceSnapshot()===savedSnapshot','partial-persisted'),'Partial changes reach server');
    const saved=(await api('/api/state')).state.jobs.filter(j=>String(j.id)==='QA21-partial');
    assert.equal(saved.length,1,'Editing an incomplete job must not duplicate it');
    const f=saved[0].finance;
    assert.equal(f.labourBudget,900,'Present labor budget preserved');
    assert.equal(f.materials,121.5,'Actual material cost preserved');
    assert.equal(f.subcontracting,95,'Actual subcontracting cost preserved');
    assert.equal(f.other,7,'Actual other cost preserved');
    assert.equal(f.hourlyCost,42,'Hourly cost preserved');
    assert.deepEqual(f.adjustments,[{amount:15,note:'Original'}],'Financial adjustments preserved');
    assert.deepEqual(f.customLedger,{keep:[1,2]},'Unknown financial extensions preserved');
    assert.equal(f.supplierInvoices,180,'Supplier invoice cost preserved');
    assert.deepEqual(saved[0].customField,{a:1},'Unknown custom fields preserved');
    checks++;console.log('PASS incomplete budget: present values preserved '+width);
  }
  // --- CAS B : fermeture pendant la requête -> jamais de doublon ---
  await tab.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await run('jobForm()','open-new');
  const name='QA21 fermeture '+Date.now();
  await run(`(()=>{const f=document.querySelector('#modalbody form');for(const [k,v]of Object.entries(${JSON.stringify({name,type:'Rénovation'})})){f.elements[k].value=v;f.elements[k].dispatchEvent(new Event('input',{bubbles:true}))}f.requestSubmit()})()`,'submit-then-close');
  await run(`(()=>{const m=document.querySelector('#modal');if(m)m.close?.();if(m)m.removeAttribute('open')})()`,'close-during-request');
  await new Promise(r=>setTimeout(r,1500));
  const after=(await api('/api/state')).state.jobs.filter(j=>j.name===name);
  assert.ok(after.length<=1,'Closing during a request must never duplicate the job');
  if(after.length===1)assert.equal(after[0].name,name,'The committed job keeps its identity');
  checks++;console.log('PASS closure during request ('+after.length+' job)');
  console.log('PASS '+checks+' edge cases');
}catch(error){const shot=await tab.call('Page.captureScreenshot',{format:'png'}).catch(()=>null);if(shot)writeFileSync(new URL('./job-edge-failure.png',import.meta.url),Buffer.from(shot.data,'base64'));throw error}finally{await browser.close()}
