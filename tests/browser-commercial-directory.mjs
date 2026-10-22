import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {connectBrowser,waitFor,waitForApp} from './helpers/browser-cdp.mjs';

const base=process.env.SOCLE_TEST_URL;
assert.ok(base&&['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'Only the isolated local Browser Gate is authorized.');
const browser=await connectBrowser(base),tab=await browser.createSession(base);
let organizationId='',touch=false,checks=0;
const token=randomUUID();
const run=(source,label)=>tab.evaluate(source,'directory-ui:'+label);
const request=(path,method='GET',data)=>run(`fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},cache:'no-store',headers:{'content-type':'application/json','x-socle-organization-id':${JSON.stringify(organizationId)}},${data===undefined?'':`body:JSON.stringify(${JSON.stringify(data)}),`}}).then(async r=>({status:r.status,body:await r.json().catch(()=>null)}))`,'api-'+path);
async function api(path,method='GET',data){const r=await request(path,method,data);assert.ok(r.status>=200&&r.status<300,path+' HTTP'+r.status);return r.body}
function check(label,ok){assert.ok(ok,label);console.log('PASS '+label);checks++}
async function click(expression,label){
 const point=await run(`(()=>{const e=${expression};if(!e||e.disabled)return null;e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2},top=document.elementFromPoint(p.x,p.y);return e.getClientRects().length&&(top===e||e.contains(top))?p:null})()`,label+'-point');
 assert.ok(point,'Visible unobscured control '+label);
 if(touch){await tab.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await tab.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
 else{await tab.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await tab.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point})}
}
async function capture(label){const r=await tab.call('Page.captureScreenshot',{format:'png'});writeFileSync(new URL('./commercial-directory-'+label+'.png',import.meta.url),Buffer.from(r.data,'base64'))}
async function openContacts(){
 if(!touch)await click('document.querySelector("#nav [data-nav-route=contacts]")','contacts-desktop');
 else{await click('document.querySelector("#socleMobileNav [data-mobile-menu-toggle]")','mobile-more');await click('document.querySelector("#socleMobileMoreDialog[open] [data-mobile-route=contacts]")','contacts-mobile')}
 await waitFor(()=>run('view==="contacts"&&((typeof commercialDirectoryState!=="undefined"&&commercialDirectoryState.status==="ready")||(typeof iaCServerDirectoryState!=="undefined"&&iaCServerDirectoryState==="ready"))','directory-loaded'),'Contacts directory finishes loading');
}
async function createContact(label,width,address){
 await openContacts();
 await click('[...document.querySelectorAll("#main button")].find(e=>e.getAttribute("onclick")==="contactForm()")','new-contact');
 await waitFor(()=>run('document.querySelector("#modal[open] form[data-commercial-contact]")?.dataset.sxForm==="1"','contact-form'),'Real contact form and its draft controller are ready');
 const reference='QA16-'+label+'-'+width+'-'+token,email=label.toLowerCase()+'.'+width+'.'+token+'@simulation.invalid',name='Client homonyme '+width;
 await run(`(()=>{const f=document.querySelector('#modalbody form'),values=${JSON.stringify({reference,name,company:'Entreprise homonyme '+width,email,address,billingAddress:address,paymentTerms:'45 jours',usualDelayDays:7})};for(const [key,value]of Object.entries(values)){const field=f.elements.namedItem(key);if(!field)throw Error('Missing contact field '+key);field.value=String(value);field.dispatchEvent(new Event('input',{bubbles:true}))}for(const role of ['Client','Architecte','Syndic']){const field=[...f.querySelectorAll('[name=roles]')].find(e=>e.value===role);if(!field)throw Error('Missing existing role '+role);field.checked=true}return f.checkValidity()})()`,'fill-contact');
 if(label==='A'&&width===1440){
  await run('closeModal()','close-unsaved-contact');
  await click('[...document.querySelectorAll("#main button")].find(e=>e.getAttribute("onclick")==="contactForm()")','reopen-unsaved-contact');
  await waitFor(()=>run('document.querySelector("#modal[open] form[data-commercial-contact]")?.dataset.sxForm==="1"','restored-contact-form'),'The unsaved contact draft is restored');
  const draft=await run('(()=>{const f=document.querySelector("#modalbody form");return{reference:f.elements.reference.value,roles:[...f.querySelectorAll("[name=roles]:checked")].map(e=>e.value).sort()}})()','restored-contact-values');
  check('Reopening an unsaved contact keeps its reference and only the chosen roles',draft.reference===reference&&JSON.stringify(draft.roles)===JSON.stringify(['Architecte','Client','Syndic']));
 }
 if(label==='B'&&width===1440)await run('(()=>{const probe={original:serverJson,calls:[],lost:false};globalThis.__directoryLostResponse=probe;serverJson=async function(url,options={}){const result=await probe.original.apply(this,arguments);if(url==="/api/commercial-contacts"&&options.method==="POST"){probe.calls.push({body:options.body,id:result.contact.id,replayed:result.replayed===true});if(!probe.lost){probe.lost=true;throw Error("QA16 réponse perdue après validation réelle")}}return result}})()','lose-one-real-contact-response');
 await capture('contact-form-'+label+'-'+width);
 await click('document.querySelector("#modalbody form .modal-actions button.primary")','save-contact');
 await waitFor(()=>run('!document.querySelector("#modal[open]")||Boolean(document.querySelector("#commercialContactError")?.textContent)','contact-saved-or-error'),'Contact response reaches UI');
 if(label==='B'&&width===1440){
  check('A lost contact response keeps the real form available for retry',await run('Boolean(document.querySelector("#modal[open] form[data-commercial-contact]"))&&document.querySelector("#commercialContactError").textContent.includes("QA16 réponse perdue")','lost-response-error'));
  await click('document.querySelector("#modalbody form .modal-actions button.primary")','retry-real-contact-operation');
  await waitFor(()=>run('!document.querySelector("#modal[open]")','contact-retry-completed'),'The same contact operation is acknowledged after retry');
  const probe=await run('({calls:__directoryLostResponse.calls})','real-contact-retry-proof');
  await run('serverJson=__directoryLostResponse.original','restore-contact-transport');
  check('Retry replays the committed contact operation without creating another identity',probe.calls.length===2&&probe.calls[0].body===probe.calls[1].body&&probe.calls[0].id===probe.calls[1].id&&probe.calls[1].replayed);
 }
 const error=await run('document.querySelector("#commercialContactError")?.textContent||""','contact-error');assert.equal(error,'','Contact save must succeed');
 const state=await api('/api/state'),contact=state.state.contacts.find(c=>c.reference===reference);assert.ok(contact,'The actual source contact is saved');
 const customers=(await api('/api/customers?limit=250')).customers,customer=customers.find(c=>c.sourceContactId===contact.id);assert.ok(customer,'One actual canonical customer maps the contact');
 check('Contact form saves exactly the selected roles '+label+' '+width,JSON.stringify([...contact.roles].sort())===JSON.stringify(['Architecte','Client','Syndic']));
 check('Contact and quote directory share the same address '+label+' '+width,customer.street===address&&customer.paymentTermsDays===45);
 check('Only one canonical identity exists for that source '+label+' '+width,customers.filter(c=>c.sourceContactId===contact.id).length===1);
 check('Dedicated contact acknowledgement does not trigger an unsaved workspace '+label+' '+width,await run('!saveFailed&&!storageConflict&&workspaceSnapshot()===savedSnapshot','workspace-acknowledged'));
 return {contact,customer,reference,email};
}
async function openContact(contact,waitHistory=true){
 await openContacts();
 await run(`(()=>{const search=document.querySelector('#main .catalogue-tools input');search.value=${JSON.stringify(contact.reference)};search.dispatchEvent(new Event('input',{bubbles:true}))})()`,'search-source-contact');
 await click(`document.querySelector('#main [data-contact-id="'+${JSON.stringify(contact.contact.id)}+'"]')`,'open-source-contact');
 await waitFor(()=>run('view==="contact"','source-contact-visible'),'Real source contact detail opens');
 if(waitHistory)await waitFor(()=>run('!["idle","loading"].includes(iaCQuotesState)&&commercialDirectoryState.status==="ready"','source-history-loaded'),'Source contact history finishes its pending render');
}
async function pressQuoteDuringHistoryLoad(contact){
 await openContacts();
 await run('(()=>{const p={original:serverJson,held:false};globalThis.__directoryHistoryRace=p;iaCQuotesState="idle";serverJson=async function(url,options={}){const result=await p.original.apply(this,arguments);if(!p.held&&url==="/api/quotes"&&String(options.method||"GET").toUpperCase()==="GET"){p.held=true;return new Promise(resolve=>{p.release=()=>resolve(result)})}return result}})()','hold-real-quote-history');
 try{
  await openContact(contact,false);await waitFor(()=>run('Boolean(__directoryHistoryRace.release)','history-response-held'),'Actual history response is held');
  const point=await run('(()=>{const e=document.querySelector("[data-contact-create-quote]");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()','press-quote-point');
  await tab.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
  await run('__directoryHistoryRace.release()','history-arrives-while-pressed');
  await waitFor(()=>run('iaCQuotesState==="ready"','history-arrived'),'History actually loads while the pointer is held');
  await tab.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  await waitFor(()=>run('document.querySelector("#modal[open] form.quote-editor")?.dataset.sxForm==="1"','pressed-quote-opens'),'History refresh does not discard a real quote-button press',5000);
  check('A real button press survives the async history refresh',true);await run('closeModal()','close-pressed-quote');
 }finally{await run('if(globalThis.__directoryHistoryRace){__directoryHistoryRace.release?.();serverJson=__directoryHistoryRace.original}','restore-real-history-transport')}
}
async function openSourceQuote(contact){
 await openContact(contact);
 check('A client source detail offers a direct quote action',await run('Boolean(document.querySelector("[data-contact-create-quote]"))','source-quote-action'));
 await click('document.querySelector("[data-contact-create-quote]")','create-quote-from-contact');
 await waitFor(()=>run('document.querySelector("#modal[open] form.quote-editor")?.dataset.sxForm==="1"','quote-form-visible'),'Real quote form and draft controller open from the source contact');
}
async function openQuoteAcrossBackgroundSave(contact){
 await openContact(contact);
 await run(`(()=>{const probe={original:serverJson,held:false,done:false};globalThis.__directoryReadRace=probe;e2e02CustomerCatalogReady=false;serverJson=async function(url,options={}){const result=await probe.original.apply(this,arguments);if(!probe.held&&url==='/api/customers?limit=250'&&String(options.method||'GET').toUpperCase()==='GET'){probe.held=true;probe.beforeRevision=storageRevision;return new Promise(resolve=>{probe.release=()=>{if(!probe.done){probe.done=true;resolve(result)}}})}return result}})()`,'hold-real-catalog-response');
 try{
  await click('document.querySelector("[data-contact-create-quote]")','quote-before-background-save');
  await waitFor(()=>run('Boolean(__directoryReadRace.release)','catalog-response-held'),'An actual catalog response is held');
  await run('(async()=>{company.companyNotes=String(company.companyNotes||"")+"\\nQA annuaire sauvegarde concurrente";clearTimeout(saveTimer);await saveWorkspace();if(saveFailed||storageConflict)throw Error("The real background save failed");__directoryReadRace.afterRevision=storageRevision})()','real-background-workspace-save');
  await run('__directoryReadRace.release()','release-old-catalog-revision');
  await waitFor(()=>run('document.querySelector("#modal[open] form.quote-editor")?.dataset.sxForm==="1"','quote-after-background-save'),'A same-account background save does not silently cancel the requested quote form',5000);
  check('Quote form survives a real workspace revision during catalog loading',await run('__directoryReadRace.afterRevision===__directoryReadRace.beforeRevision+1','background-revision-advanced'));
 }finally{await run('if(globalThis.__directoryReadRace){__directoryReadRace.release?.();serverJson=__directoryReadRace.original}','restore-real-catalog-transport')}
}
async function saveQuoteForm(title){
 await run(`(()=>{const f=document.querySelector('#modalbody form.quote-editor'),values=${JSON.stringify({title,label:'Prestation vérifiée',description:'Parcours réel sur copie',qty:2,unit:'forfait',price:120,vat:6})};for(const [name,value]of Object.entries(values)){const e=f.querySelector('[name="'+name+'"]');if(!e)throw Error('Missing quote field '+name);e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}))}if(!f.checkValidity())throw Error('The quote form is invalid')})()`,'fill-actual-quote');
 for(let i=0;i<6;i++){
  const next='[...document.querySelectorAll("#modalbody button")].find(e=>e.getClientRects().length&&!e.disabled&&/^Suivant/.test(e.textContent.trim()))';
  if(!await run('Boolean('+next+')','quote-next-present'))break;await click(next,'quote-next');
 }
 await click('[...document.querySelectorAll("#modalbody form button")].find(e=>e.getClientRects().length&&!e.disabled&&/Enregistrer le devis/.test(e.textContent))','save-actual-quote');
 await waitFor(()=>run('!document.querySelector("#modal[open]")||Boolean(document.querySelector("#quoteError")?.textContent)','quote-saved-or-error'),'Quote response reaches UI');
 assert.equal(await run('document.querySelector("#quoteError")?.textContent||""','quote-error'),'');
 const quote=(await api('/api/quotes')).quotes.find(q=>q.title===title);assert.ok(quote,'The actual quote is retrievable');return quote;
}
try{
 await tab.navigate(new URL('/health',base).href);
 const login=await request('/__local-test/login','POST',{email:'direction@batinova.example'});assert.equal(login.status,204);
 const original=await api('/api/state');organizationId=original.organizationId;
 await tab.navigate(base);await waitForApp(tab,original.access.userId);
 await run('globalThis.__directoryUiErrors=[];addEventListener("error",e=>__directoryUiErrors.push(String(e.error?.stack||e.message)));addEventListener("unhandledrejection",e=>__directoryUiErrors.push(String(e.reason?.stack||e.reason)))','record-UI-errors');
 await tab.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await openContacts();
 check('The owner sees an explicit action to connect existing contacts',await run('Boolean(document.querySelector("#commercialDirectoryBootstrap"))','bootstrap-visible'));
 await click('document.querySelector("#commercialDirectoryBootstrap")','bootstrap');
 await waitFor(()=>run('commercialDirectoryState.initialized===true&&commercialDirectoryState.status==="ready"','bootstrap-finished'),'Explicit contact bootstrap succeeds');
 check('Bootstrap preserves every historical quote exactly',JSON.stringify((await api('/api/state')).state.quotes)===JSON.stringify(original.state.quotes));
 await capture('initialized-1440');
 const supplierName='QA16 fournisseur '+token;
 const supplier=(await api('/api/suppliers','POST',{name:supplierName,email:'supplier.'+token+'@simulation.invalid',street:'Rue des matériaux 16'})).supplier;
 await run('commercialLoadDirectory({force:true})','refresh-after-independent-supplier');
 await run(`(()=>{const s=document.querySelector('#main .catalogue-tools input');s.value=${JSON.stringify(supplierName)};s.dispatchEvent(new Event('input',{bubbles:true}))})()`,'find-independent-supplier');
 check('Independent supplier records remain accessible in the unified directory',await run(`Array.from(document.querySelectorAll('#main [data-contact-id]')).some(e=>e.dataset.contactId===${JSON.stringify('supplier:'+supplier.id)})`,'supplier-retained'));
 check('A supplier projection never becomes a legacy source contact',!(await api('/api/state')).state.contacts.some(c=>String(c.id)===String(supplier.id)||String(c.id)==='supplier:'+supplier.id));
 await click(`Array.from(document.querySelectorAll('#main [data-contact-id]')).find(e=>e.dataset.contactId===${JSON.stringify('supplier:'+supplier.id)})`,'open-independent-supplier');
 check('The supplier detail retains its address and email',await run(`document.querySelector('#modal[open]')?.textContent.includes(${JSON.stringify(supplier.email)})&&document.querySelector('#modal[open]')?.textContent.includes('Rue des matériaux 16')`,'supplier-details'));
 await capture('supplier-1440');await run('closeModal()','close-supplier');
 for(const width of [1440,412]){
  touch=width===412;await tab.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:touch});await tab.call('Emulation.setTouchEmulationEnabled',{enabled:touch});
  if(touch)await tab.call('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'});
  const a=await createContact('A',width,'Rue Alpha '+width);if(width===1440){await pressQuoteDuringHistoryLoad(a);await openQuoteAcrossBackgroundSave(a)}else await openSourceQuote(a);await run('closeModal()','close-initial-catalog-form');
  const b=await createContact('B',width,'Rue Beta '+width);
  check('Two homonymous contacts keep different canonical identities '+width,a.customer.id!==b.customer.id);
  await openSourceQuote(a);
  const values=await run('({customer:document.querySelector("#modalbody [name=customerId]")?.value,address:document.querySelector("#modalbody [name=clientAddress]")?.value,title:document.querySelector("#modalbody [name=title]")?.value})','quote-values');
  check('The source contact preselects its canonical quote customer '+width,values.customer===a.customer.id&&values.address==='Rue Alpha '+width);
  check('A new quote does not restore a previous committed quote title '+width,values.title==='');
  if(width===1440){
   await click('[...document.querySelectorAll("#modalbody .v3-stepnav button")].find(e=>e.textContent.trim()==="Travaux")','draft-work-lines');
   await click('[...document.querySelectorAll("#modalbody button")].find(e=>e.getAttribute("onclick")==="addQuoteLine()")','add-second-draft-line');
   await run('(()=>{const f=document.querySelector("#modalbody form.quote-editor");[...f.querySelectorAll("[name=label]")].forEach((e,i)=>{e.value="Travaux brouillon "+(i+1);e.dispatchEvent(new Event("input",{bubbles:true}))});[...f.querySelectorAll("[name=price]")].forEach((e,i)=>{e.value=String(135+i*10);e.dispatchEvent(new Event("input",{bubbles:true}))});closeModal()})()','close-two-line-quote-draft');
   await openSourceQuote(a);
   const restored=await run('({labels:[...document.querySelectorAll("#modalbody [name=label]")].map(e=>e.value),prices:[...document.querySelectorAll("#modalbody [name=price]")].map(e=>e.value)})','two-line-quote-restored');
   check('Reopening a quote draft preserves every work line and its price',JSON.stringify(restored.labels)===JSON.stringify(['Travaux brouillon 1','Travaux brouillon 2'])&&JSON.stringify(restored.prices)===JSON.stringify(['135','145']));
  }
  const options=await run('Array.from(document.querySelector("#modalbody [name=customerId]").options).map(o=>({value:o.value,text:o.textContent}))','real-customer-options');
  check('A newly saved client appears despite the earlier loaded catalog '+width,options.some(o=>o.value===b.customer.id));
  check('Homonymous clients have distinguishable choices '+width,options.find(o=>o.value===a.customer.id).text!==options.find(o=>o.value===b.customer.id).text);
  await run(`(()=>{const s=document.querySelector('#modalbody [name=customerId]');s.value=${JSON.stringify(b.customer.id)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`,'select-client-B');
  check('Changing client replaces the old automatically supplied address '+width,await run('document.querySelector("#modalbody [name=clientAddress]").value','changed-address')==='Rue Beta '+width);
  await run(`(()=>{document.querySelector('#modalbody [name=clientAddress]').value='Adresse explicitement conservée';document.querySelector('#modalbody [name=clientAddressFixed]').checked=true;const s=document.querySelector('#modalbody [name=customerId]');s.value=${JSON.stringify(a.customer.id)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`,'keep-manual-address');
  check('An explicitly preserved address stays unchanged '+width,await run('document.querySelector("#modalbody [name=clientAddress]").value','manual-address')==='Adresse explicitement conservée');
  await run(`(()=>{document.querySelector('#modalbody [name=clientAddressFixed]').checked=false;const s=document.querySelector('#modalbody [name=customerId]');s.value=${JSON.stringify(b.customer.id)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`,'restore-B-address');
  await capture('quote-client-'+width);
  const quote=await saveQuoteForm('QA16 devis '+width+' '+token);
  check('The actual saved quote uses client B and its address '+width,quote.customerId===b.customer.id&&quote.clientAddress==='Rue Beta '+width);
  await openContact(a);check('Homonymous contact A does not inherit B quote '+width,!(await run('document.querySelector("#main").innerText','A-history')).includes(quote.reference));
  await openContact(b);check('The correct source contact B retains the quote link '+width,(await run('document.querySelector("#main").innerText','B-history')).includes(quote.reference));
  await capture('contact-history-'+width);
 }
 await tab.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await tab.call('Emulation.setTouchEmulationEnabled',{enabled:false});touch=false;
 await click('document.querySelector("#nav [data-nav-route=home]")','leave-directory');
 const independent=(await api('/api/customers','POST',{companyName:'QA16 autre client '+token,street:'Rue extérieure 16'})).customer;
 await openContacts();
 await run(`(()=>{const s=document.querySelector('#main .catalogue-tools input');s.value=${JSON.stringify(independent.companyName)};s.dispatchEvent(new Event('input',{bubbles:true}))})()`,'find-later-independent-client');
 check('Returning to Contacts refreshes independent customers created since the last visit',await run(`Array.from(document.querySelectorAll('#main [data-contact-id]')).some(e=>e.dataset.contactId===${JSON.stringify('canonical:'+independent.id)})`,'later-independent-client-visible'));
 check('Contact journeys preserve every original historical quote',JSON.stringify((await api('/api/state')).state.quotes)===JSON.stringify(original.state.quotes));
 console.log('PASS '+checks+' real directory UI assertions');
}catch(error){
 const diagnostic=await run('({view,modal:document.querySelector("#modal")?.open,forms:[...document.querySelectorAll("#modalbody form")].map(f=>({className:f.className,enhanced:f.dataset.sxForm,identity:f.dataset.sxDraftIdentity})),toast:document.querySelector("#toast")?.textContent,errors:globalThis.__directoryUiErrors||[],quoteCalls:globalThis.__directoryQuoteCalls,storage:{storageRevision,storageConflict,saveFailed,saveRunning,dirty:workspaceSnapshot()!==savedSnapshot}})','failure-state').catch(e=>({diagnosticError:String(e)}));
 console.log('FAILURE_DIAGNOSTIC '+JSON.stringify(diagnostic));await capture('failure').catch(()=>{});throw error;
}finally{await tab.close().catch(()=>{});await browser.close().catch(()=>{})}
