import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {connectBrowser,waitFor,waitForApp} from './helpers/browser-cdp.mjs';

// Lot 21 only: use the real contact directory, quote editor and chantier navigation
// against the Browser Gate's disposable database. Network/overlay/account races
// belong to browser-job-safety-21.mjs; this suite does not simulate their success.
const base=process.env.SOCLE_TEST_URL;
assert.ok(base&&['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'Local disposable Browser Gate only.');
const browser=await connectBrowser(base),tab=await browser.createSession(base),token=randomUUID();
let touch=false,checks=0,organizationId='';
const run=(source,label)=>tab.evaluate(source,'journey-21:'+label);
async function api(path,method='GET',data){
  const result=await run(`fetch(${JSON.stringify(path)},{cache:'no-store',method:${JSON.stringify(method)},headers:{'content-type':'application/json','x-socle-organization-id':${JSON.stringify(organizationId)}},${data===undefined?'':`body:JSON.stringify(${JSON.stringify(data)}),`}}).then(async r=>({status:r.status,body:await r.json().catch(()=>null)}))`,'api-'+path);
  assert.ok(result.status>=200&&result.status<300,path+' HTTP'+result.status+' '+JSON.stringify(result.body));
  return result.body;
}
function pass(label){checks++;console.log('PASS '+label)}
async function viewport(width){
  touch=width<=412;
  await tab.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:touch});
  await tab.call('Emulation.setTouchEmulationEnabled',{enabled:touch});
}
async function click(expression,label){
  const point=await waitFor(()=>run(`(()=>{const e=${expression};if(!e||e.disabled||e.getAttribute('aria-disabled')==='true')return null;e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2},top=document.elementFromPoint(p.x,p.y);return r.width>0&&r.height>0&&(top===e||e.contains(top))?{...p,control:{tag:e.tagName,text:e.textContent.trim().slice(0,100),onclick:e.getAttribute('onclick'),action:e.dataset.action||'',id:e.id}}:null})()`,label+'-point'),'Visible unobscured control: '+label);
  console.log('CLICK '+label+' '+JSON.stringify(point.control));
  const coordinates={x:point.x,y:point.y};
  if(touch){await tab.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[coordinates]});await tab.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
  else{await tab.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...coordinates});await tab.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...coordinates})}
}
async function capture(name){const shot=await tab.call('Page.captureScreenshot',{format:'png'});writeFileSync(new URL('./job-21-'+name+'.png',import.meta.url),Buffer.from(shot.data,'base64'));console.log('CAPTURE job-21-'+name+'.png')}
async function noOverflow(label){
  const geometry=await run(`(()=>{const form=document.querySelector('#modal[open] form'),dialog=document.querySelector('#modal[open]'),rect=dialog?.getBoundingClientRect();return{width:innerWidth,page:document.documentElement.scrollWidth,form:form?{client:form.clientWidth,scroll:form.scrollWidth}:null,dialog:rect?{left:rect.left,right:rect.right}:null}})()`,'overflow-'+label);
  assert.ok(geometry.page<=geometry.width+1,'No horizontal page overflow '+label+' '+JSON.stringify(geometry));
  if(geometry.form)assert.ok(geometry.form.scroll<=geometry.form.client+1,'No horizontal form overflow '+label+' '+JSON.stringify(geometry));
  if(geometry.dialog)assert.ok(geometry.dialog.left>=-1&&geometry.dialog.right<=geometry.width+1,'Dialog fits viewport '+label+' '+JSON.stringify(geometry));
}
async function route(name){
  if(!touch)await click(`document.querySelector('#nav [data-nav-route=${name}]')`,'desktop-'+name);
  else{
    const direct=`document.querySelector('#socleMobileNav [data-mobile-route=${name}]')`;
    if(await run(`Boolean(${direct}?.getClientRects().length)`,'mobile-direct-'+name))await click(direct,'mobile-'+name);
    else{await click('document.querySelector("#socleMobileNav [data-mobile-menu-toggle]")','mobile-more');await click(`document.querySelector('#socleMobileMoreDialog[open] [data-mobile-route=${name}]')`,'mobile-more-'+name)}
  }
  await waitFor(()=>run(`view===${JSON.stringify(name)}`,'route-'+name),'Actual navigation to '+name);
  if(name==='contacts')await waitFor(()=>run('commercialDirectoryState.status==="ready"','directory-ready'),'Canonical directory ready');
}
async function openContact(contact,status='active'){
  await route('contacts');
  await run(`(()=>{const filter=document.querySelector('#main select[aria-label="État des fiches"]');filter.value=${JSON.stringify(status)};filter.dispatchEvent(new Event('change',{bubbles:true}));const search=document.querySelector('#main .catalogue-tools input');search.value=${JSON.stringify(contact.reference||contact.name)};search.dispatchEvent(new Event('input',{bubbles:true}))})()`,'find-fixture-contact');
  await click(`[...document.querySelectorAll('#main [data-contact-id]')].find(e=>e.dataset.contactId===${JSON.stringify(String(contact.id))})`,'open-fixture-contact');
  await waitFor(()=>run(`view==='contact'&&String(currentContactId)===${JSON.stringify(String(contact.id))}&&iaCQuotesState==='ready'&&commercialDirectoryState.status==='ready'`,'contact-ready'),'Source contact and commercial history loaded');
}
async function formReady(kind){
  const selector=kind==='job'?'form[data-commercial-job]':kind==='quote'?'form.quote-editor':'form[data-commercial-contact]';
  await waitFor(()=>run(`document.querySelector('#modal[open] ${selector}')?.dataset.sxForm==='1'`,'form-ready-'+kind),'Actual '+kind+' form and draft controller ready');
}
async function fill(values,selector='#modalbody form'){
  return run(`(()=>{const f=document.querySelector(${JSON.stringify(selector)});if(!f)throw Error('Form missing');for(const [name,value]of Object.entries(${JSON.stringify(values)})){const field=f.querySelector('[name="'+name+'"]');if(!field)throw Error('Missing field '+name);field.value=String(value);field.dispatchEvent(new Event(field.tagName==='SELECT'?'change':'input',{bubbles:true}))}return{valid:f.checkValidity(),invalid:[...f.querySelectorAll(':invalid')].map(e=>e.name)}})()`,'fill-form');
}
async function settled(){await waitFor(()=>run('storageReady&&!saveRunning&&!saveFailed&&!storageConflict&&workspaceSnapshot()===savedSnapshot','workspace-settled'),'Workspace acknowledged without conflict')}
async function saveJob(){
  const valid=await run('document.querySelector("#modalbody form").checkValidity()','job-valid');assert.equal(valid,true,'Real job form valid before submit');
  await click('document.querySelector("#modalbody form .modal-actions button.primary")','save-job');
  await waitFor(()=>run('!document.querySelector("#modal[open]")||Boolean(document.querySelector("#commercialJobError")?.textContent)','job-result'),'Job save result');
  assert.equal(await run('document.querySelector("#commercialJobError")?.textContent||""','job-error'),'');
  await settled();
}
async function saveQuote(){
  assert.equal(await run('document.querySelector("#modalbody form.quote-editor").checkValidity()','quote-valid'),true,'Real quote form valid');
  for(let i=0;i<6;i++){
    const next='[...document.querySelectorAll("#modalbody button")].find(e=>e.getClientRects().length&&!e.disabled&&/^Suivant/.test(e.textContent.trim()))';
    if(!await run(`Boolean(${next})`,'quote-next-present'))break;
    await click(next,'quote-next');
  }
  await click('[...document.querySelectorAll("#modalbody form button")].find(e=>e.getClientRects().length&&!e.disabled&&/Enregistrer le devis/.test(e.textContent))','save-quote');
  await waitFor(()=>run('!document.querySelector("#modal[open]")||Boolean(document.querySelector("#quoteError")?.textContent)','quote-result'),'Quote save result');
  assert.equal(await run('document.querySelector("#quoteError")?.textContent||""','quote-error'),'');
}
async function quoteFromContact(quoteId){
  await click(`[...document.querySelectorAll('#main [data-contact-quote-id]')].find(e=>e.dataset.contactQuoteId===${JSON.stringify(String(quoteId))})`,'contact-quote-link');
  await waitFor(()=>run('Boolean(document.querySelector("#modal[open] .quote-paper"))','quote-detail'),'Saved quote opens from contact');
  await click('[...document.querySelectorAll("#modalbody button")].find(e=>e.getClientRects().length&&!e.disabled&&/^Modifier/.test(e.textContent.trim()))','edit-saved-quote');
  await formReady('quote');
}
async function newJob(customerId,name){
  await route('jobs');
  await click('[...document.querySelectorAll("#main button")].find(e=>e.getClientRects().length&&(e.getAttribute("onclick")==="jobForm()"||e.dataset.action==="create"))','new-job-from-navigation');
  await formReady('job');
  const values=await fill({customerId,name,type:'Rénovation',town:'Namur',address:'Rue du parcours 21'});
  assert.equal(values.valid,true,'Creation valid: '+values.invalid.join(', '));
  return run('String(document.querySelector("#modalbody form")._jobContext.id)','new-job-id');
}
async function setContactActive(contact,active){
  await openContact(contact,active?'inactive':'active');
  await click('document.querySelector("#main .contact-actions [data-commercial-contact-edit]")','edit-source-contact');
  await formReady('contact');
  const current=await run('document.querySelector("#modalbody input[name=active]").checked','source-active');
  assert.equal(current,!active,'Source begins with expected status');
  await click('document.querySelector("#modalbody input[name=active]")','toggle-source-status');
  await click('document.querySelector("#modalbody form .modal-actions button.primary")','save-source-status');
  await waitFor(()=>run('!document.querySelector("#modal[open]")||Boolean(document.querySelector("#commercialContactError")?.textContent)','source-status-result'),'Source status result');
  assert.equal(await run('document.querySelector("#commercialContactError")?.textContent||""','source-status-error'),'');
  assert.equal((await api('/api/state')).state.contacts.find(c=>String(c.id)===String(contact.id)).active,active);
}

try{
  await tab.call('Page.addScriptToEvaluateOnNewDocument',{source:`globalThis.__journey21Errors=[];globalThis.__journey21Toasts=[];addEventListener('error',e=>__journey21Errors.push(String(e.error?.stack||e.message)));addEventListener('unhandledrejection',e=>__journey21Errors.push(String(e.reason?.stack||e.reason)));addEventListener('DOMContentLoaded',()=>{const t=document.querySelector('#toast');if(t)new MutationObserver(()=>{const text=t.textContent.trim();if(text&&__journey21Toasts.at(-1)!==text)__journey21Toasts.push(text)}).observe(t,{subtree:true,childList:true,characterData:true})})`});
  await tab.navigate(new URL('/health',base).href);
  await api('/__local-test/login','POST',{email:'direction@batinova.example'});
  const initial=await api('/api/state');organizationId=String(initial.organizationId);
  assert.equal(initial.access.roleCode,'OWNER','Owner fixture required');
  await tab.navigate(base);await waitForApp(tab,initial.access.userId);await viewport(1440);
  await route('contacts');
  if(await run('Boolean(document.querySelector("#commercialDirectoryBootstrap"))','bootstrap-present')){
    await click('document.querySelector("#commercialDirectoryBootstrap")','connect-existing-fixture-contacts');
    await waitFor(()=>run('commercialDirectoryState.initialized&&commercialDirectoryState.status==="ready"','bootstrap-ready'),'Existing contacts linked through owner action');
  }
  const stateAfterBootstrap=(await api('/api/state')).state;
  const customers=(await api('/api/customers?limit=250')).customers;
  const customer=customers.find(c=>!c.archivedAt&&stateAfterBootstrap.contacts.some(contact=>String(contact.id)===String(c.sourceContactId)&&contact.active!==false&&contact.active!==0&&!['inactive','archived','deleted'].includes(String(contact.status||'').toLowerCase())&&(contact.roles||[]).includes('Client')&&contact.reference));
  assert.ok(customer,'An existing active fixture Client with canonical mapping is required; no substitute seed is injected.');
  const contact=stateAfterBootstrap.contacts.find(c=>String(c.id)===String(customer.sourceContactId));

  // Contact -> real quote action. The quote initially has no project.
  await openContact(contact);
  await click('document.querySelector("#main [data-contact-create-quote]")','create-quote-from-contact');
  await formReady('quote');
  assert.equal(await run('document.querySelector("#modalbody [name=customerId]").value','quote-source-customer'),String(customer.id));
  const quoteTitle='QA21 parcours '+token;
  const quoteValues=await fill({title:quoteTitle,clientAddress:'Rue du parcours 21, Namur',label:'Travail lot 21',description:'Qualification locale',qty:2,unit:'h',price:123.45,vat:6});
  assert.equal(quoteValues.valid,true,'Quote data valid: '+quoteValues.invalid.join(', '));
  await capture('contact-devis-1440');await saveQuote();
  let quote=(await api('/api/quotes')).quotes.find(q=>q.title===quoteTitle);assert.ok(quote,'Quote exists on server');
  assert.equal(String(quote.customerId),String(customer.id));assert.equal(quote.projectId??null,null,'A quote alone never creates a chantier');
  const originalLines=structuredClone(quote.lines);
  assert.equal((await api('/api/state')).state.jobs.length,stateAfterBootstrap.jobs.length,'Quote creation leaves chantier count unchanged');
  pass('contact existant -> devis canonique par navigation réelle');

  // Create the chantier from its real route, then link the existing quote via its editor.
  const jobId=await newJob(customer.id,'QA21 chantier lié '+token);
  await noOverflow('create-1440');await capture('creation-1440');await saveJob();
  const created=(await api('/api/state')).state.jobs.filter(j=>String(j.id)===jobId);
  assert.equal(created.length,1);assert.equal(String(created[0].customerId),String(customer.id));assert.equal(String(created[0].clientId),String(contact.id));
  await openContact(contact);await quoteFromContact(quote.id);
  const linkedValues=await fill({job:jobId});assert.equal(linkedValues.valid,true);
  await saveQuote();quote=(await api('/api/quotes/'+encodeURIComponent(quote.id))).quote;
  assert.equal(String(quote.projectId),jobId);assert.equal(String(quote.customerId),String(customer.id));assert.deepEqual(quote.lines,originalLines,'Linking a chantier preserves quote quantities and prices');
  await tab.reload();await waitForApp(tab,initial.access.userId);await openContact(contact);
  assert.ok(await run(`[...document.querySelectorAll('#main [data-contact-quote-id]')].some(e=>e.dataset.contactQuoteId===${JSON.stringify(String(quote.id))})`,'quote-history-link'),'Contact still links the exact saved quote after reload');
  await click(`[...document.querySelectorAll('#main button')].find(e=>e.getAttribute('onclick')?.includes('openJobWorkspace')&&e.textContent.includes(${JSON.stringify(created[0].name)}))`,'contact-linked-chantier');
  await waitFor(()=>run(`view==='jobWorkspace'&&String(currentJobId)===${JSON.stringify(jobId)}`,'linked-chantier-open'),'Contact link opens exact chantier');
  await capture('contact-devis-chantier-1440');pass('devis -> chantier, liens canoniques persistés après rechargement');

  // A real existing record with financial extensions: edit only selected budgets.
  const beforeFinance=await api('/api/state'),financialJob=beforeFinance.state.jobs.find(j=>String(j.id)===jobId);
  Object.assign(financialJob.finance,{plannedHours:10,labourBudget:750,materialsBudget:250,subcontractingBudget:90,otherBudget:15,materials:88.5,subcontracting:40,other:3,hourlyCost:39,adjustments:[{amount:11,note:'Historique conservé'}],supplierInvoices:120,customLedger:{keep:['lot21']}});
  financialJob.customLot21={keep:true};await api('/api/state','PUT',{revision:beforeFinance.revision,state:beforeFinance.state});
  await tab.reload();await waitForApp(tab,initial.access.userId);await settled();
  const financeBaseline=(await api('/api/state')).state.jobs.find(j=>String(j.id)===jobId);
  await run(`jobForm(${JSON.stringify(jobId)})`,'open-budget-form');await formReady('job');
  await fill({plannedHours:14.5,labourBudget:1750.25,materialsBudget:640.75});
  await capture('finance-1440');await saveJob();
  const afterFinance=(await api('/api/state')).state.jobs.find(j=>String(j.id)===jobId);
  assert.deepEqual(afterFinance.finance,{...financeBaseline.finance,plannedHours:14.5,labourBudget:1750.25,materialsBudget:640.75},'Only intentional budgets change; actual costs, other budgets and unknown fields remain exact');
  assert.deepEqual(afterFinance.customLot21,{keep:true});assert.equal(String(afterFinance.customerId),String(customer.id));
  pass('budgets volontairement modifiés, coûts et extensions conservés');

  // Archive the real source Contact and preserve it only on its existing chantier.
  await setContactActive(contact,false);
  const archived=(await api('/api/customers/'+encodeURIComponent(customer.id)+'?includeArchived=1')).customer;
  assert.ok(archived.archivedAt);assert.equal(String(archived.sourceContactId),String(contact.id));
  await tab.reload();await waitForApp(tab,initial.access.userId);
  await run(`jobForm(${JSON.stringify(jobId)})`,'open-inactive-client-job');await formReady('job');
  const inactiveOption=await run('(()=>{const s=document.querySelector("#modalbody [name=customerId]");return{value:s.value,label:s.selectedOptions[0]?.textContent}})()','inactive-client-selected');
  assert.equal(inactiveOption.value,String(customer.id));assert.match(inactiveOption.label,/inactive/i);
  const retainedName='QA21 client inactif conservé '+token;await fill({name:retainedName});await capture('client-inactif-1440');await saveJob();
  const retained=(await api('/api/state')).state.jobs.find(j=>String(j.id)===jobId);
  assert.equal(retained.name,retainedName);assert.equal(String(retained.customerId),String(customer.id));assert.equal(String(retained.clientId),String(contact.id));assert.deepEqual(retained.finance,afterFinance.finance);
  assert.deepEqual((await api('/api/quotes/'+encodeURIComponent(quote.id))).quote.lines,originalLines);
  await route('jobs');await click('[...document.querySelectorAll("#main button")].find(e=>e.getClientRects().length&&(e.getAttribute("onclick")==="jobForm()"||e.dataset.action==="create"))','new-job-inactive-check');await formReady('job');
  assert.equal(await run(`[...document.querySelector('#modalbody [name=customerId]').options].some(o=>o.value===${JSON.stringify(String(customer.id))})`,'inactive-absent-on-create'),false,'Archived source cannot be selected for a new chantier');
  await click('document.querySelector("#modal[open] .modal-top .close")','close-inactive-new-form');
  await setContactActive(contact,true);pass('client Contact inactif conservé sur ancien chantier et exclu des nouveaux');

  // Touch navigation and real persistence at both narrow widths, with asserted geometry.
  for(const width of [360,412]){
    await viewport(width);await openContact(contact);await noOverflow('contact-'+width);
    const mobileId=await newJob(customer.id,'QA21 mobile '+width+' '+token);
    await noOverflow('job-'+width);await capture('mobile-'+width);await saveJob();
    await tab.reload();await waitForApp(tab,initial.access.userId);
    const mobile=(await api('/api/state')).state.jobs.filter(j=>String(j.id)===mobileId);
    assert.equal(mobile.length,1);assert.equal(String(mobile[0].customerId),String(customer.id));assert.equal(String(mobile[0].clientId),String(contact.id));
    await noOverflow('reloaded-'+width);pass('navigation tactile '+width+', aucun débordement, chantier unique après F5');
  }
  assert.deepEqual((await api('/api/state')).state.quotes,initial.state.quotes,'Original historical quotes remain exact throughout the real commercial journey');
  console.log('PASS '+checks+' parcours commerciaux lot 21; PC1440, mobile360/412 émulés.');
}catch(error){
  console.log('JOURNEY_FAILURE_DIAGNOSTIC '+JSON.stringify(await run(`(()=>{const f=document.querySelector('#modalbody form');return{view,owner:globalThis.socleCurrentAccess?.owner,role:globalThis.socleCurrentAccess?.roleCode,storageReady,saveRunning,saveFailed,storageConflict,revision:storageRevision,snapshotClean:workspaceSnapshot()===savedSnapshot,directory:commercialDirectoryState.status,directoryError:commercialDirectoryState.error,modalOpen:Boolean(document.querySelector('#modal')?.open),form:f?{dataset:{...f.dataset},id:f.id}:null,errors:globalThis.__journey21Errors||[],toasts:globalThis.__journey21Toasts||[],controls:[...document.querySelectorAll('#main button')].filter(e=>e.getClientRects().length&&/nouveau chantier|créer un chantier/i.test(e.textContent)).map(e=>({text:e.textContent.trim(),onclick:e.getAttribute('onclick'),action:e.dataset.action||'',disabled:e.disabled}))}})()`,'failure-diagnostic').catch(e=>({diagnosticError:e.message}))));
  await capture('journey-failure').catch(()=>{});throw error
}finally{await browser.close()}
