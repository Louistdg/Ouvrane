import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {connectBrowser,waitFor,waitForApp} from './helpers/browser-cdp.mjs';
const base=process.env.SOCLE_TEST_URL;assert.ok(base&&['127.0.0.1','localhost'].includes(new URL(base).hostname));
const browser=await connectBrowser(base),tab=await browser.createSession(base);let checks=0;
const run=(s,l)=>tab.evaluate(s,'job-retry:'+l);
async function api(path,method='GET',data){return run(`fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{'content-type':'application/json'},${data===undefined?'':`body:JSON.stringify(${JSON.stringify(data)}),`}}).then(async r=>{const b=await r.json().catch(()=>null);if(!r.ok)throw Error(JSON.stringify(b));return b})`,'api-'+path)}
try{
 await tab.navigate(new URL('/health',base).href);await api('/__local-test/login','POST',{email:'direction@batinova.example'});await tab.navigate(base);await waitForApp(tab);
 const customer=(await api('/api/customers','POST',{companyName:'QA21 reprise',street:'Rue Reprise'})).customer;
 for(const width of [1440,412]){
  await tab.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width===412});await tab.call('Emulation.setTouchEmulationEnabled',{enabled:width===412});await run('jobForm()','open-new-job');
  const name='QA21 réponse perdue '+width;
  await run(`(()=>{const f=document.querySelector('#modalbody form');for(const [k,v]of Object.entries(${JSON.stringify({name,type:'Rénovation'})})){f.elements[k].value=v;f.elements[k].dispatchEvent(new Event('input',{bubbles:true}))}const c=f.querySelector('[name=customerId]');c.value=${JSON.stringify(customer.id)};c.dispatchEvent(new Event('change',{bubbles:true}));globalThis.__jobRetry21={original:serverJson,puts:0,lost:false};serverJson=async function(url,options={}){const result=await __jobRetry21.original.apply(this,arguments);if(url==='/api/state'&&options.method==='PUT'){__jobRetry21.puts++;if(!__jobRetry21.lost){__jobRetry21.lost=true;throw Error('QA21 réponse perdue après création réelle')}}return result};f.requestSubmit()})()`,'submit-and-lose-response');
  await waitFor(()=>run('Boolean(document.querySelector("#commercialJobError")?.textContent)','lost-response-visible'),'The actual form retains the lost response');
  let state=await api('/api/state');const created=state.state.jobs.filter(j=>j.name===name);assert.equal(created.length,1,'The first actual PUT created exactly one job');
  assert.ok(await run('document.querySelector("#modalbody [name=name]").readOnly','protected-title'),'An uncertain job title cannot be edited');assert.ok(await run('document.querySelector("#modalbody [name=customerId]").disabled','protected-customer'),'An uncertain customer cannot be changed');
  const shot=await tab.call('Page.captureScreenshot',{format:'png'});writeFileSync(new URL('./job-retry-unknown-'+width+'.png',import.meta.url),Buffer.from(shot.data,'base64'));
  await run('document.querySelector("#modalbody form").requestSubmit()','verify-original-request');await waitFor(()=>run('!document.querySelector("#modal[open]")','retry-closed'),'Original saved job is acknowledged');
  state=await api('/api/state');assert.deepEqual(state.state.jobs.filter(j=>j.name===name),created,'Retry preserves the original job and never duplicates it');assert.equal(await run('__jobRetry21.puts','put-count'),1,'Retry reads the committed job instead of sending a second PUT');await run('serverJson=__jobRetry21.original','restore-transport');checks++;console.log('PASS real job creation recovery '+width);
 }
 console.log('PASS '+checks+' job lost-response cases');
}catch(error){const shot=await tab.call('Page.captureScreenshot',{format:'png'}).catch(()=>null);if(shot)writeFileSync(new URL('./job-retry-failure.png',import.meta.url),Buffer.from(shot.data,'base64'));throw error}finally{await browser.close()}
