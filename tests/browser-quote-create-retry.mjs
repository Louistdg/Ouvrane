import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {connectBrowser,waitFor,waitForApp} from './helpers/browser-cdp.mjs';
const base=process.env.SOCLE_TEST_URL;
assert.ok(base&&['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'Disposable local gate only.');
const browser=await connectBrowser(base),tab=await browser.createSession(base);
const run=(code,label)=>tab.evaluate(code,'quote-retry:'+label);
let touch=false,checks=0;const token=randomUUID();
async function api(path,method='GET',data){const r=await run(`fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{'content-type':'application/json','x-socle-organization-id':globalThis.socleCurrentOrganizationId||''},${data===undefined?'':`body:JSON.stringify(${JSON.stringify(data)}),`}}).then(async r=>({status:r.status,body:await r.json().catch(()=>null)}))`,'api-'+path);assert.ok(r.status>=200&&r.status<300,path+' HTTP'+r.status);return r.body}
function check(label,actual,expected=true){assert.deepEqual(actual,expected,label);checks++;console.log('PASS '+label)}
async function click(expression,label){
 const p=await waitFor(()=>run(`(()=>{const e=${expression};if(!e||e.disabled)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2},top=document.elementFromPoint(p.x,p.y);return r.width>0&&r.height>0&&(top===e||e.contains(top))?p:null})()`,label+'-point'),'Visible control '+label);
 if(touch){await tab.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await tab.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
 else{await tab.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await tab.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p})}
}
async function capture(name){const s=await tab.call('Page.captureScreenshot',{format:'png'});writeFileSync(new URL('./quote-create-retry-'+name+'.png',import.meta.url),Buffer.from(s.data,'base64'))}
async function open(){
 await run('navigate("quotes")','quotes-view');await waitFor(()=>run('view==="quotes"&&iaCQuotesState==="ready"','quotes-ready'),'Quote list ready');
 await click('[...document.querySelectorAll("#main button")].find(e=>e.getAttribute("onclick")==="quoteForm()")','new-quote');
 await waitFor(()=>run('document.querySelector("#modal[open] form.quote-editor")?.dataset.sxForm==="1"','editor-ready'),'Real editor with draft controller');
}
async function fill(customer,title,invalid=false){
 await run(`(()=>{const f=document.querySelector('#modalbody form.quote-editor'),values=${JSON.stringify({customerId:customer.id,job:'',clientAddress:'Rue vérifiée 18',title,date:'2026-10-21',validUntil:invalid?'2026-10-20':'2026-11-21',label:'Travail réel',description:'Demande réellement enregistrée',qty:2,unit:'h',price:12.34,vat:21})};for(const [name,value]of Object.entries(values)){const e=f.querySelector('[name="'+name+'"]');if(!e)throw Error('Missing '+name);e.value=String(value);e.dispatchEvent(new Event(name==='customerId'?'change':'input',{bubbles:true}))}if(!f.checkValidity())throw Error('Invalid browser form')})()`,'fill-real-editor');
}
async function submit(){
 for(let i=0;i<6;i++){
  const next='[...document.querySelectorAll("#modalbody button")].find(e=>e.getClientRects().length&&!e.disabled&&/^Suivant/.test(e.textContent.trim()))';
  if(!await run('Boolean('+next+')','has-next'))break;await click(next,'next');
 }
 await click('[...document.querySelectorAll("#modalbody form button")].find(e=>e.getClientRects().length&&!e.disabled&&/Enregistrer le devis|Vérifier l.enregistrement/.test(e.textContent))','submit');
}
async function loseResponse(){await run(`(()=>{const p={original:serverJson,calls:[],lost:false};globalThis.__retry18=p;serverJson=async function(url,options={}){const result=await p.original.apply(this,arguments);if(url==='/api/quotes'&&options.method==='POST'){p.calls.push({body:options.body,id:result.quote.id,replayed:result.replayed===true});if(!p.lost){p.lost=true;throw Error('QA18 réponse perdue après vraie écriture')}}return result}})()`,'lose-real-response')}
async function recordRetries(){await run(`(()=>{const p={original:serverJson,calls:[],lost:true};globalThis.__retry18=p;serverJson=async function(url,options={}){const result=await p.original.apply(this,arguments);if(url==='/api/quotes'&&options.method==='POST')p.calls.push({body:options.body,id:result.quote.id,replayed:result.replayed===true});return result}})()`,'record-retry-after-reload')}
try{
 await tab.navigate(new URL('/health',base).href);await run("fetch('/__local-test/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'direction@batinova.example'})})",'owner-login');await tab.navigate(base);await waitForApp(tab);
 const history=(await api('/api/state')).state;
 for(const width of [1440,412]){
  touch=width===412;await tab.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:touch});await tab.call('Emulation.setTouchEmulationEnabled',{enabled:touch});if(touch)await tab.call('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'});
  const title='QA18 unique '+width+' '+token,customer=(await api('/api/customers','POST',{type:'company',companyName:'QA18 client '+width,street:'Rue vérifiée 18'})).customer;
  await tab.reload();await waitForApp(tab);await open();await fill(customer,title);await loseResponse();await submit();
  await waitFor(()=>run('Boolean(document.querySelector("#quoteError")?.textContent.includes("QA18 réponse perdue"))','unknown-result-visible'),'Actual successful write has an unknown result in UI');
  const first=await run('__retry18.calls[0]','actual-first-post');
  check('The real form identifies its creation '+width,typeof JSON.parse(first.body).operationKey==='string');
  check('Unknown result keeps the real form open '+width,await run('Boolean(document.querySelector("#modal[open] form.quote-editor"))','unknown-keeps-editor'));
  check('Unknown result protects original input before retry '+width,await run('document.querySelector("#modalbody [name=title]").disabled||document.querySelector("#modalbody [name=title]").readOnly','pending-input-protected'));
  check('Exactly one real SQL quote exists before recovery '+width,(await api('/api/quotes')).quotes.filter(q=>q.title===title).length,1);await capture('unknown-'+width);
  await run('closeModal()','close-unknown-editor');await open();
  check('Reopening recovers the exact pending quote title '+width,await run('document.querySelector("#modalbody [name=title]").value','reopened-title'),title);
  check('Reopened pending content stays protected '+width,await run('document.querySelector("#modalbody [name=title]").disabled||document.querySelector("#modalbody [name=title]").readOnly','reopened-protected'));
  if(width===1440){await tab.reload();await waitForApp(tab);await recordRetries();await open();check('A real document reload retains the pending title',await run('document.querySelector("#modalbody [name=title]").value','reloaded-title'),title);check('Reloaded pending content stays protected',await run('document.querySelector("#modalbody [name=title]").disabled||document.querySelector("#modalbody [name=title]").readOnly','reloaded-protected'))}
  await submit();await waitFor(()=>run('!document.querySelector("#modal[open]")','recovered'),'Actual pending quote acknowledged');
  const calls=await run('__retry18.calls','actual-retry-calls'),last=calls.at(-1);
  check('Retry sends the exact original business request '+width,last.body,first.body);check('Retry acknowledges the original quote '+width,last.id,first.id);check('Retry is a real server replay '+width,last.replayed);
  check('One quote remains after recovery '+width,(await api('/api/quotes')).quotes.filter(q=>q.title===title).map(q=>q.id),[first.id]);
  const audits=(await api('/api/audit-log?entity_type=quote&limit=200')).events;check('One creation audit after real retry '+width,audits.filter(a=>a.entityId===first.id&&a.action==='quote.created').length,1);
  await run('serverJson=__retry18.original','restore-transport');await capture('recovered-'+width);
  await open();check('Acknowledged quote does not lock a new document '+width,await run('!document.querySelector("#modalbody [name=title]").disabled&&!document.querySelector("#modalbody [name=title]").readOnly','new-editor-unlocked'));
  check('Acknowledgement clears the recovered draft '+width,await run('document.querySelector("#modalbody [name=title]").value','fresh-title'),'');
  const nextTitle=title+' nouveau';await fill(customer,nextTitle);await submit();await waitFor(()=>run('!document.querySelector("#modal[open]")','second-created'),'An intentional second quote can be created');check('An intentional new document gets a different ID '+width,(await api('/api/quotes')).quotes.find(q=>q.title===nextTitle)?.id!==first.id);
  if(width===1440){
   await open();await fill(customer,title+' corrigé',true);await submit();await waitFor(()=>run('Boolean(document.querySelector("#quoteError")?.textContent)','real-date-refusal'),'Actual server validation refuses reversed dates');
   check('A definite validation refusal permits correction',await run('!document.querySelector("#modalbody [name=validUntil]").disabled','validation-unlocked'));await fill(customer,title+' corrigé');await submit();await waitFor(()=>run('!document.querySelector("#modal[open]")','corrected-created'),'Correction of refused input succeeds');
   await open();await fill(customer,title+' stockage bloqué');
   await run('globalThis.__storage18=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException("QA18 quota","QuotaExceededError")}','deny-session-storage');await submit();await waitFor(()=>run('Boolean(document.querySelector("#quoteError")?.textContent)','storage-error'),'Unavailable recovery storage is shown instead of silently losing the key');await run('Storage.prototype.setItem=__storage18','restore-session-storage');
   check('Unavailable storage does not send a new quote',(await api('/api/quotes')).quotes.some(q=>q.title===title+' stockage bloqué'),false);await run('closeModal()','close-storage-error');
  }
  check('No horizontal overflow '+width,await run('document.documentElement.scrollWidth>innerWidth','overflow'),false);
 }
 check('Create/retry leaves the full historical workspace unchanged',(await api('/api/state')).state,history);
 console.log('PASS '+checks+' real quote create/retry browser assertions; PC1440 and Samsung412 emulated.');
}catch(error){await capture('failure');throw error}finally{await browser.close()}
