import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {resolve,relative} from 'node:path';
import {writeFileSync} from 'node:fs';
import {connectBrowser,waitFor,waitForApp} from './helpers/browser-cdp.mjs';
const base=process.env.SOCLE_TEST_URL;assert.equal(new URL(base).hostname,'127.0.0.1');
const dbPath=resolve(process.env.SOCLE_TEST_DATABASE_PATH||'');assert.ok(relative(resolve('tests/artifacts/browser-gate'),dbPath).startsWith('run-'),'Fixture only in this gate disposable copy');
const db=new DatabaseSync(dbPath);const org=db.prepare("SELECT om.organization_id FROM organization_members om JOIN roles r ON r.id=om.role_id AND r.organization_id=om.organization_id WHERE r.code='OWNER' AND om.status='active' LIMIT 1").get().organization_id;
db.exec('BEGIN');
for(let i=0;i<301;i++){const n=String(i).padStart(3,'0'),label=String(Math.floor(i/2)).padStart(3,'0');for(const archived of [false,true])db.prepare("INSERT INTO customers(id,organization_id,type,company_name,street,created_at,updated_at,archived_at) VALUES(?,?,'company',?,?,'2026-01-01','2026-01-01',?)").run('qa02-ui-'+(archived?'archive-':'client-')+n,org,'ZZQA02 Browser '+(archived?'Archive ':'Client ')+label,'Rue fictive '+n,archived?'2026-02-01':null);db.prepare("INSERT INTO suppliers(id,organization_id,name,created_at,updated_at) VALUES(?,?,?,'2026-01-01','2026-01-01')").run('qa02-ui-supplier-'+n,org,'ZZQA02 Browser Supplier '+label);}
db.exec('COMMIT');db.close();
const browser=await connectBrowser(base),tab=await browser.createSession(base);let touch=false,checks=0;
const run=(s,l)=>tab.evaluate(s,'pagination:'+l);
function check(label,actual,expected=true){assert.deepEqual(actual,expected,label);checks++;console.log('PASS '+label);}
async function api(path,method='GET',data){return run('fetch('+JSON.stringify(path)+',{method:'+JSON.stringify(method)+',headers:{"content-type":"application/json","x-socle-organization-id":globalThis.socleCurrentOrganizationId||""},'+(data===undefined?'':'body:JSON.stringify('+JSON.stringify(data)+'),')+'}).then(async r=>({status:r.status,body:await r.json().catch(()=>null)}))','api');}
async function click(selector){const p=await waitFor(()=>run('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e||e.disabled)return null;e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2},top=document.elementFromPoint(p.x,p.y);return(top===e||e.contains(top))?p:null})()','point'),'Clickable '+selector);if(touch){await tab.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await tab.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else{await tab.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await tab.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});}}
async function input(selector,value){await run('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');e.value='+JSON.stringify(value)+';e.dispatchEvent(new Event("input",{bubbles:true}))})()','input');}
async function pickerReady(){await waitFor(()=>run('(()=>{const s=document.querySelector("#modalbody form")?._customerPicker;return s&&!s.busy&&!s.error&&!s.timerPending})()','picker-ready'),'Current customer page ready');}
async function search(value){await input('[data-customer-pager] input',value);await waitFor(()=>run('(()=>{const s=document.querySelector("#modalbody form")?._customerPicker;return s&&!s.busy&&s.query==='+JSON.stringify(value)+'&&s.rows.some(c=>c.companyName.includes('+JSON.stringify(value)+'))})()','search-ready'),'Search result ready');}
async function shot(name){const r=await tab.call('Page.captureScreenshot',{format:'png'});writeFileSync(new URL('./pagination-'+name+'.png',import.meta.url),Buffer.from(r.data,'base64'));}
async function directorySearch(value){await input('#main .catalogue-tools input[type=search]',value);await waitFor(()=>run('commercialDirectoryState.status==="ready"','directory-ready'),'Directory query response settled');}
try{
 await tab.navigate(base+'/health');await api('/__local-test/login','POST',{email:'direction@batinova.example'});await tab.navigate(base);await waitForApp(tab);
 const initial=(await api('/api/state')).body,originalOrg=await run('socleCurrentOrganizationId','original-org');
 for(const width of [1440,412]){
  touch=width===412;await tab.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:touch});await tab.call('Emulation.setTouchEmulationEnabled',{enabled:touch});
  await run('quoteForm()','open-quote');await waitFor(()=>run('!!document.querySelector("[data-customer-pager]")','picker-mounted'),'Paginated canonical selector mounted');
  await search('ZZQA02 Browser Client');
  const seen=[];
  for(let page=0;page<7;page++){
   await pickerReady();seen.push(...await run('document.querySelector("#modalbody form")._customerPicker.rows.map(c=>c.id)','current-ids'));
   if(page<6){await click('[data-customer-next]');console.log('PAGE_CLICK '+JSON.stringify(await run('(()=>{const f=document.querySelector("#modalbody form"),s=f._customerPicker;return{index:s.index,busy:s.busy,error:s.error,next:!!s.next,locked:f.dataset.sxServerPending,handler:String(document.querySelector("[data-customer-next]").onclick)}})()','page-click')));await waitFor(()=>run('document.querySelector("#modalbody form")._customerPicker.index==='+String(page+1)+'&&!document.querySelector("#modalbody form")._customerPicker.busy','next-page'),'Next page loaded');}
  }
  check('All 301 client identities reached in order '+width,seen,Array.from({length:301},(_,i)=>'qa02-ui-client-'+String(i).padStart(3,'0')));
  check('Final client page has one result '+width,await run('document.querySelector("#modalbody form")._customerPicker.rows.length','last-size'),1);
  check('Final next button disabled '+width,await run('document.querySelector("[data-customer-next]").disabled','last-next'));
  await run('(()=>{const e=document.querySelector("#modalbody [name=customerId]");e.value="qa02-ui-client-300";e.dispatchEvent(new Event("change",{bubbles:true}))})()','select-beyond-250');
  await input('#modalbody [name=title]','QA02 devis '+width);
  await click('[data-customer-prev]');await pickerReady();
  check('Selection pinned outside current page '+width,await run('document.querySelector("#modalbody [name=customerId]").value','selected-id'),'qa02-ui-client-300');
  check('Typed quote content preserved '+width,await run('document.querySelector("#modalbody [name=title]").value','title'),'QA02 devis '+width);
  check('Homonymous page labels distinguish identities '+width,await run('(()=>{const opts=[...document.querySelector("#modalbody [name=customerId]").options].filter(o=>o.value);return new Set(opts.map(o=>o.textContent)).size===opts.length})()','labels'));
  await shot('quote-'+width);
  await run('(()=>{const p={original:serverJson};globalThis.__pageHeld=p;serverJson=async function(url,options){const result=await p.original.apply(this,arguments);if(url.startsWith("/api/customers?")&&new URL(url,location.href).searchParams.get("q")==="ZZQA02 Browser Client 149")return new Promise(resolve=>{p.release=()=>resolve(result)});return result}})()','hold-search');
  await input('[data-customer-pager] input','ZZQA02 Browser Client 149');await waitFor(()=>run('!!__pageHeld.release','held'),'Actual earlier search response held');
  await search('ZZQA02 Browser Client 150');await run('__pageHeld.release()','release-old-search');await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))','late-paint');
  check('Late query cannot replace newer results '+width,await run('document.querySelector("#modalbody form")._customerPicker.rows.map(c=>c.id)','latest-rows'),['qa02-ui-client-300']);
  await run('serverJson=__pageHeld.original','restore-transport');
  await run('(()=>{const f=document.querySelector("#modalbody form"),row=f.querySelector(".quote-edit-line");row.querySelector("[name=label]").value="Travail fictif";row.querySelector("[name=price]").value="42";f.requestSubmit()})()','save-real-quote');
  await waitFor(()=>run('!document.querySelector("#modal[open]")','saved-quote'),'Quote saved through actual form');
  const quote=await run('quotes.find(q=>q.title==='+JSON.stringify('QA02 devis '+width)+')','created-quote');
  check('Server quote retains customer beyond 250 '+width,(await api('/api/quotes/'+encodeURIComponent(quote.id))).body.quote.customerId,'qa02-ui-client-300');
  check('Quote creation leaves existing project finances exact '+width,(await api('/api/state')).body.state.jobs,initial.state.jobs);
  await run('navigate("contacts")','contacts');await waitFor(()=>run('commercialDirectoryState.status==="ready"','contacts-ready'),'Directory ready');
  await run('(()=>{const e=document.querySelector("#main select");e.value="active";e.dispatchEvent(new Event("change",{bubbles:true}))})()','active-filter');
  await directorySearch('Rue fictive 300');
  check('Address-only server result stays visible '+width,await run('[...document.querySelectorAll("[data-contact-id]")].some(e=>e.dataset.contactId==="canonical:qa02-ui-client-300")','address-result'));
  await directorySearch('ZZQA02 Browser Client');
  const directoryIds=[];
  for(let page=0;page<7;page++){
   directoryIds.push(...await run('[...document.querySelectorAll("[data-contact-id]")].map(e=>e.dataset.contactId).filter(id=>id.startsWith("canonical:qa02-ui-client-"))','directory-page-ids'));
   if(page<6){await click('[data-directory-pager="customers"] [data-directory-next]');await waitFor(()=>run('commercialDirectoryState.status==="ready"','directory-page-ready'),'Directory next page settled');}
  }
  check('Directory pages contain 301 distinct clients '+width,new Set(directoryIds).size,301);
  check('Directory last page has one client '+width,await run('commercialDirectoryState.customers.length','directory-last-size'),1);
  await run('(()=>{const p={original:serverJson};globalThis.__directoryHeld=p;serverJson=async function(url,options){const result=await p.original.apply(this,arguments);if(url.startsWith("/api/suppliers?")&&new URL(url,location.href).searchParams.get("q")==="ZZQA02 Browser Supplier 149")return new Promise(resolve=>{p.release=()=>resolve(result)});return result}})()','hold-directory');
  await input('#main .catalogue-tools input[type=search]','ZZQA02 Browser Supplier 149');await waitFor(()=>run('!!__directoryHeld.release','directory-held'),'Earlier supplier response held');
  await directorySearch('ZZQA02 Browser Supplier 150');
  await run('__directoryHeld.release();serverJson=__directoryHeld.original','release-directory');await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))','directory-late-paint');
  check('Late supplier response cannot overwrite newer query '+width,await run('commercialDirectoryState.suppliers.map(c=>c.id)','latest-supplier'),['qa02-ui-supplier-300']);
  check('Supplier beyond 250 found '+width,await run('[...document.querySelectorAll("[data-contact-id]")].some(e=>e.dataset.contactId==="supplier:qa02-ui-supplier-300")','supplier-row'));
  await run('(()=>{const e=document.querySelector("#main select");e.value="inactive";e.dispatchEvent(new Event("change",{bubbles:true}))})()','archived-filter');
  await directorySearch('ZZQA02 Browser Archive 150');
  check('Archived customer beyond 250 found '+width,await run('[...document.querySelectorAll("[data-contact-id]")].some(e=>e.dataset.contactId==="canonical:qa02-ui-archive-300")','archived-row'));
  check('Archived filter excludes active fixture '+width,await run('![...document.querySelectorAll("[data-contact-id]")].some(e=>e.dataset.contactId.startsWith("canonical:qa02-ui-client-"))','no-active'));
  await shot('archive-'+width);
  check('No horizontal overflow '+width,await run('document.documentElement.scrollWidth<=innerWidth+1','overflow'));
 }
 // A held response must not reopen an old form or inject another company's page.
 touch=false;await tab.call('Emulation.setTouchEmulationEnabled',{enabled:false});await tab.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await run('quoteForm()','org-form');await waitFor(()=>run('!!document.querySelector("[data-customer-pager]")','org-picker'),'Organization test form ready');
 await run('(()=>{const p={original:serverJson};globalThis.__orgPage=p;serverJson=async function(url,options){const result=await p.original.apply(this,arguments);if(url.startsWith("/api/customers?")&&new URL(url,location.href).searchParams.get("q")==="ZZQA02 Browser Client")return new Promise(resolve=>{p.release=()=>resolve(result)});return result}})()','org-hold');
 await input('[data-customer-pager] input','ZZQA02 Browser Client');await waitFor(()=>run('!!__orgPage.release','org-held'),'Page response pending before company switch');
 const other=(await api('/api/organizations','POST',{name:'QA02 entreprise vide'})).body.organization;
 await run('initOrganizationSwitcher()','refresh-companies');
 async function choose(id){await click('#organizationLabel .organization-mobile-trigger');await click('#organizationChoices [data-organization-id="'+id+'"]');await waitFor(()=>run('globalThis.socleCurrentOrganizationId==='+JSON.stringify(id)+'&&typeof storageReady!=="undefined"&&storageReady','company-ready'),'Company workspace ready');await waitForApp(tab);}
 await run('closeModal()','close-before-company-switch');await choose(other.id);await run('if(globalThis.__orgPage){__orgPage.release();serverJson=__orgPage.original}','release-foreign-response');
 check('Late old-company page cannot reopen form',await run('!document.querySelector("#modal[open]")','no-old-form'));
 await run('quoteForm()','empty-company-quote');await waitFor(()=>run('!!document.querySelector("[data-customer-pager]")','empty-picker'),'Empty company picker ready');
 check('Empty company has no foreign client',await run('document.querySelector("#modalbody form")._customerPicker.rows.length','empty-company'),0);
 await run('closeModal()','close-empty');await choose(originalOrg);
 await api('/__local-test/login','POST',{email:'anthony.simon@batinova.example'});await run('loadWorkspace().then(()=>navigate("home"))','worker');await waitForApp(tab);
 check('Worker customer API remains forbidden',(await api('/api/customers?q=ZZQA02')).status,403);check('Worker supplier API remains forbidden',(await api('/api/suppliers?q=ZZQA02')).status,403);
 await api('/__local-test/login','POST',{email:'direction@batinova.example'});
 console.log('PASS '+checks+' bounded directory pagination UI assertions PC1440/mobile412');
}catch(error){console.log('PAGINATION_FAILURE '+JSON.stringify(await run('({view,error:document.querySelector("#quoteError")?.textContent,directory:commercialDirectoryState.status})','failure').catch(()=>null)));await shot('failure');throw error;}finally{await browser.close();}
