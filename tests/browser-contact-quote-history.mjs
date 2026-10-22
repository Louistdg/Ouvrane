import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {resolve,dirname,basename} from 'node:path';
import {connectBrowser,waitFor,waitForApp} from './helpers/browser-cdp.mjs';
import {verifyQuoteSaveContext} from './helpers/quote-save-context.mjs';
import {verifyQuoteTeamDispatch} from './helpers/quote-team-dispatch.mjs';

// Protect the existing gate-copy history, including fields unknown to the UI.
// SQL rows may join the display projection; they must never enter its snapshot.
const base=process.env.SOCLE_TEST_URL;
assert.ok(base&&['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'Use an isolated local Browser Gate copy.');
const browser=await connectBrowser(base),tab=await browser.createSession(base);
const failures=[],token=Date.now().toString();let organizationId='',touch=false;
function check(label,ok,detail={}){console.log((ok?'PASS ':'FAIL ')+label+' '+JSON.stringify(detail));if(!ok)failures.push(label);}
const run=(source,label)=>tab.evaluate(source,'quote-history:'+label);
const request=(path,method='GET',body)=>run(`fetch(${JSON.stringify(path)},{cache:'no-store',method:${JSON.stringify(method)},headers:{'content-type':'application/json','x-socle-organization-id':${JSON.stringify(organizationId)}},${body===undefined?'':`body:JSON.stringify(${JSON.stringify(body)}),`}}).then(async r=>({status:r.status,body:await r.json().catch(()=>null)}))`,'api-'+path);
const api=async(path,method='GET',body)=>{const response=await request(path,method,body);assert.ok(response.status>=200&&response.status<300,path+' HTTP'+response.status);return response.body;};
const ids=items=>(items||[]).map(item=>String(item.id));
const memory=()=>run('JSON.parse(JSON.stringify(quotes))','display-projection');
const snapshot=()=>run('JSON.parse(workspaceSnapshot()).quotes','historical-snapshot');
const errorCount=()=>run('globalThis.__quoteHistoryErrors.length','error-count');
const closeModal=()=>run('if(document.querySelector("#modal")?.open)closeModal()','close-modal');
const capture=async name=>{const shot=await tab.call('Page.captureScreenshot',{format:'png'});writeFileSync(new URL('./contact-quote-history-'+name+'.png',import.meta.url),Buffer.from(shot.data,'base64'));};

async function flushWorkspaceState(){
  await run('(async()=>{if(!storageReady)throw Error("Workspace not ready");clearTimeout(saveTimer);await saveWorkspace()})()','flushWorkspaceState');
  await waitFor(()=>run('storageReady&&!saveRunning&&!saveFailed&&!storageConflict&&workspaceSnapshot()===savedSnapshot','save-settled'),'Workspace flush acknowledged without conflict',12000);
}
async function restoreProbe(expected,label){
  const current=await api('/api/state');
  if(!isDeepStrictEqual(current.state,expected)){
    // Undo only this wrongly accepted probe, on the disposable gate copy,
    // using its exact pre-probe payload. No manufactured/replacement seed.
    const response=await request('/api/state','PUT',{revision:current.revision,state:expected});
    assert.equal(response.status,200,'Exact pre-probe gate-copy restoration: '+label);
    assert.ok(isDeepStrictEqual((await api('/api/state')).state,expected),'Restoration must preserve every original field.');
    console.log('CLEANUP restored exact pre-probe payload: '+label);
  }
}
async function rejectMutation(label,mutate){
  const fresh=await api('/api/state'),proposed=structuredClone(fresh.state);mutate(proposed);
  const response=await request('/api/state','PUT',{revision:fresh.revision,state:proposed}),after=await api('/api/state');
  check(label+' returns409',response.status===409,{status:response.status});
  check(label+' leaves payload and revision unchanged',isDeepStrictEqual(after.state,fresh.state)&&after.revision===fresh.revision,{beforeIds:ids(fresh.state.quotes),afterIds:ids(after.state.quotes)});
  if(!isDeepStrictEqual(after.state,fresh.state)||after.revision!==fresh.revision)await restoreProbe(fresh.state,label);
}
async function preserve(label,original,sqlId){
  const display=await memory(),stored=await snapshot(),expectedIds=ids(original);
  check(label+' retains every historical ID in the memory projection',expectedIds.every(id=>ids(display).includes(id)),{expectedIds,actualIds:ids(display)});
  check(label+' serializes exactly the original historical objects',isDeepStrictEqual(stored,original),{expectedCount:original.length,actualCount:stored?.length});
  if(sqlId)check(label+' excludes SQL display rows from the snapshot',!stored.some(q=>String(q.id)===sqlId),{sqlId});
  try{await flushWorkspaceState();check(label+' flush succeeds',true);}catch(error){check(label+' flush succeeds',false,{error:error.message});}
  const persisted=(await api('/api/state')).state.quotes;
  check(label+' preserves original IDs and full contents after flush and GET/api/state',isDeepStrictEqual(persisted,original),{expectedIds,actualIds:ids(persisted)});
  if(sqlId)check(label+' does not persist a SQL copy as legacy history',!persisted.some(q=>String(q.id)===sqlId),{sqlId});
}
function row(quote){
  return `(()=>{const id=${JSON.stringify(String(quote.id))},ref=${JSON.stringify(String(quote.ref||quote.reference||quote.id))};return [...document.querySelectorAll('#main .quote-list-row,#main [data-quote-id],#main button[onclick*="showQuote"]')].find(e=>e.getClientRects().length&&(e.dataset.quoteId===id||[...e.querySelectorAll('b,strong')].some(n=>n.textContent.trim()===ref)||(e.getAttribute('onclick')||'').includes("'"+id+"'")||(e.getAttribute('onclick')||'').includes('"'+id+'"')))||null})()`;
}
async function click(expression,label){
  const point=await run(`(()=>{const e=${expression};if(!e||e.disabled||e.getAttribute('aria-disabled')==='true')return null;e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,t=document.elementFromPoint(x,y);return e.getClientRects().length&&(t===e||e.contains(t))?{x,y}:null})()`,label+'-point');
  assert.ok(point,'Visible unobscured control: '+label);
  if(touch){await tab.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await tab.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else{await tab.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await tab.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});}
}
async function openQuotes(){
  if(!touch)await click('document.querySelector("#nav [data-nav-route=quotes]")','desktop-quotes');
  else{
    const primary='document.querySelector("#socleMobileNav [data-mobile-route=quotes]")';
    if(await run(`Boolean(${primary}?.getClientRects().length)`,'mobile-primary-quotes'))await click(primary,'mobile-quotes');
    else{await click('document.querySelector("#socleMobileNav [data-mobile-menu-toggle]")','mobile-more');await click('document.querySelector("#socleMobileMoreDialog[open] [data-mobile-route=quotes]")','mobile-quotes-route');}
  }
  await waitFor(()=>run('view==="quotes"&&Boolean(document.querySelector("#main .quote-list"))','quotes-visible'),'Real Quotes navigation renders its list');
  await waitFor(()=>run('typeof iaCQuotesState==="undefined"||!["idle","loading"].includes(iaCQuotesState)||Boolean(document.querySelector("#main .quote-list-row"))','quotes-settled'),'Quotes loading settles');
  for(let n=0;n<20;n++){
    const more='[...document.querySelectorAll("#main .quote-list button,#main .ia-c-list-more button")].find(e=>e.getClientRects().length&&!e.disabled&&/^Afficher\\b/i.test(e.textContent.trim()))';
    if(!await run(`Boolean(${more})`,'has-more'))break;await click(more,'show-more');
  }
}
function expectedHistory(quote,state){
  const person=(state.contacts||[]).find(c=>String(c.id)===String(quote.client)||String(c.id)===String(quote.customerId));
  const job=(state.jobs||[]).find(j=>String(j.id)===String(quote.job));
  const client=person?(person.company||person.legalName||person.name):String(quote.client||job?.client||'');
  const labels={draft:'Brouillon',brouillon:'Brouillon',sent:'À présenter','envoyé':'À présenter','à présenter':'À présenter',accepted:'Accepté','accepté':'Accepté',rejected:'Refusé','refusé':'Refusé',expired:'Expiré','expiré':'Expiré'};
  return {client,status:labels[String(quote.status||'').toLowerCase()]||quote.status,rates:[...new Set((quote.lines||[]).map(line=>Number(line.vatRate??line.vat??0)))]};
}
async function historyDetail(quote,state,width){
  const ref=String(quote.ref||quote.reference||quote.id),expected=expectedHistory(quote,state),before=await errorCount();
  try{
    if(!await run(`Boolean(${row(quote)})`,'sample-history-present'))return;
    await click(row(quote),'historical-detail');
    await waitFor(()=>run(`Boolean(document.querySelector('#modal')?.open)||__quoteHistoryErrors.length>${before}`,'detail-or-error'),'Historical detail opens',5000);
    const detail=await run(`(()=>{const r=document.querySelector('#modalbody'),buttons=[...r.querySelectorAll('button')].filter(e=>e.getClientRects().length&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');return{open:!!document.querySelector('#modal')?.open,text:r.innerText,client:[...r.querySelectorAll('.quote-parties>div')].find(e=>e.querySelector('small')?.textContent.trim()==='CLIENT')?.querySelector('strong')?.textContent.trim(),statuses:[...r.querySelectorAll('.badge,[data-quote-status],select')].map(e=>e.tagName==='SELECT'?e.selectedOptions[0]?.textContent.trim():e.textContent.trim()),editable:buttons.some(e=>/^Modifier\\b/i.test(e.textContent.trim())),statusEditable:[...r.querySelectorAll('select')].some(e=>!e.disabled&&/QuoteStatus|quotes\\.find/.test(e.getAttribute('onchange')||'')),withoutPrices:buttons.some(e=>/sans\\s+prix|version\\s+équipe/i.test(e.textContent))}})()`,'historical-detail-state');
    check('Historical detail opens without inline-ID/VAT errors '+width,detail.open&&detail.text.includes(ref)&&!/(?:NaN|undefined|Infinity)/.test(detail.text)&&(await errorCount())===before,{id:String(quote.id)});
    check('Historical client label is independently resolved '+width,detail.client===expected.client,{expectedClient:expected.client,actualClient:detail.client});
    check('Historical status is independently normalized '+width,detail.statuses.includes(expected.status),{expectedStatus:expected.status,actualStatuses:detail.statuses});
    check('Historical vatRate appears as the expected VAT rate '+width,expected.rates.every(rate=>new RegExp('(?:^|\\s)'+rate+'\\s*%').test(detail.text)),{expectedRates:expected.rates});
    check('Historical detail remains read-only '+width,!detail.editable&&!detail.statusEditable);
    await capture('historical-detail-'+width);
    check('Historical version without prices is available '+width,detail.withoutPrices);
    if(detail.open&&detail.withoutPrices){
      await click('[...document.querySelectorAll("#modalbody button")].find(e=>e.getClientRects().length&&!e.disabled&&/sans\\s+prix|version\\s+équipe/i.test(e.textContent))','historical-without-prices');
      const worker=await run('({open:!!document.querySelector("#modal")?.open,text:document.querySelector("#modalbody").innerText})','historical-worker-state');
      check('Real historical without-prices click works '+width,worker.open&&(worker.text.includes(ref)||Boolean(quote.title&&worker.text.includes(quote.title)))&&!/(?:NaN|undefined|Infinity|prix unitaire|total\s+(?:TVAC|HTVA|TTC))/i.test(worker.text)&&(await errorCount())===before);
      await capture('historical-without-prices-'+width);
    }
  }catch(error){check('Historical detail interaction '+width,false,{error:error.message});}finally{await closeModal();}
}
async function sqlEditor(quote,customerId,width){
  const present=await run(`Boolean(${row(quote)})`,'sql-present');check('Real SQL quote appears alongside history '+width,present,{id:String(quote.id)});if(!present)return;
  const before=await errorCount();
  try{
    await click(row(quote),'sql-detail');
    await waitFor(()=>run(`Boolean(document.querySelector('#modal')?.open)||__quoteHistoryErrors.length>${before}`,'sql-detail-or-error'),'SQL detail opens',5000);
    const modifier='[...document.querySelectorAll("#modalbody button")].find(e=>e.getClientRects().length&&!e.disabled&&e.getAttribute("aria-disabled")!=="true"&&/^Modifier\\b/i.test(e.textContent.trim()))';
    const available=await run(`Boolean(${modifier})`,'sql-modifier');check('SQL Modifier is available '+width,available);
    if(available){
      await click(modifier,'sql-modifier');
      await waitFor(()=>run(`Boolean(document.querySelector('#modalbody form.quote-editor input[name=title]'))||__quoteHistoryErrors.length>${before}`,'sql-editor-or-error'),'Actual Modifier click opens SQL editor',5000);
      const editor=await run('({title:document.querySelector("#modalbody form.quote-editor input[name=title]")?.value,customerId:document.querySelector("#modalbody form.quote-editor select[name=customerId]")?.value})','sql-editor-values');
      check('Real SQL Modifier click preserves quote and customer '+width,editor.title===quote.title&&String(editor.customerId)===String(customerId)&&(await errorCount())===before);
      await capture('sql-editor-'+width);
    }
  }catch(error){check('SQL detail/Modifier interaction '+width,false,{error:error.message});}finally{await closeModal();}
}

async function workerQuotePermission(history){
  const path=process.env.SOCLE_TEST_DATABASE_PATH;
  assert.ok(path,'SOCLE_TEST_DATABASE_PATH must identify the disposable gate database.');
  assert.match(dirname(resolve(path)),/browser-gate[\\/]run-[0-9a-f-]+$/i,'Never change permissions in the candidate or seed.');
  assert.equal(basename(path),'socle.sqlite');
  const database=new DatabaseSync(path);let removed=false,permission,worker,visibleIds;
  try{
    worker=database.prepare("SELECT om.user_id userId,om.role_id roleId FROM local_test_identities i JOIN organization_members om ON om.user_id=i.profile_id AND om.organization_id=i.organization_id JOIN roles r ON r.id=om.role_id AND r.organization_id=om.organization_id WHERE LOWER(i.email)=? AND om.organization_id=? AND om.status='active' AND r.code='WORKER'").get('anthony.simon@batinova.example',organizationId);
    assert.ok(worker,'The existing Anthony local-test identity must have an active WORKER membership.');
    permission=database.prepare("SELECT role_id,permission_code FROM role_permissions WHERE role_id=? AND permission_code='quotes.view'").get(worker.roleId);
    assert.ok(permission,'Invalid fixture: quotes.view must already exist so only the removed permission is restored.');
    assert.equal(database.prepare('DELETE FROM role_permissions WHERE role_id=? AND permission_code=?').run(permission.role_id,permission.permission_code).changes,1);
    removed=true;
    assert.equal((await request('/__local-test/login','POST',{email:'anthony.simon@batinova.example'})).status,204);
    const denied=await api('/api/state');
    assert.equal(String(denied.access?.userId),String(worker.userId),'The real worker session must be active.');
    assert.equal(denied.access?.roleCode,'WORKER');
    assert.ok(Array.isArray(denied.state?.jobs)&&denied.state.jobs.length>0,'Invalid fixture: Anthony must still see at least one real project while quotes.view is denied.');
    visibleIds=new Set(denied.state.jobs.map(job=>String(job.id)));
    check('WORKER without quotes.view retains visible projects',visibleIds.size>0,{visibleProjects:visibleIds.size});
    check('WORKER without quotes.view receives no historical quotes',Array.isArray(denied.state.quotes)&&denied.state.quotes.length===0,{returnedQuoteIds:ids(denied.state.quotes)});
  }finally{
    try{if(removed){database.prepare('INSERT INTO role_permissions(role_id,permission_code) VALUES(?,?)').run(permission.role_id,permission.permission_code);console.log('CLEANUP restored only Anthony role quotes.view on the gate copy');}}
    finally{database.close();}
  }
  const allowed=await api('/api/state'),expected=history.filter(q=>visibleIds.has(String(q.job??q.projectId))),quotes=allowed.state.quotes;
  assert.equal(String(allowed.access?.userId),String(worker.userId));
  assert.ok(expected.length>0,'Invalid fixture: the existing visible projects must have historical quotes to exercise restored access.');
  check('Restored WORKER permission returns every related historical quote',Array.isArray(quotes)&&expected.every(q=>ids(quotes).includes(String(q.id))),{expectedIds:ids(expected),actualIds:ids(quotes)});
  check('Restored WORKER quote access stays within visible projects',Array.isArray(quotes)&&quotes.every(q=>visibleIds.has(String(q.job??q.projectId))));
  // Expectations are independent of the production stripper. Physical
  // quantitySource remains useful; supplier price provenance does not.
  const monetaryKeys=new Set(['price','unitPrice','unitPriceCents','amount','amountCents','subtotal','subtotalCents','netAmount','grossAmount','total','totalCents','totalHt','totalHT','totalHTVA','totalTtc','totalTTC','totalTVAC','vatAmount','taxAmount','deposit','depositPercent','paymentTerms','cost','costPrice','purchasePrice','deliveredCost','margin','markup','source','sourcePriceObserved','sourceVatIncluded']);
  const leaked=[];
  function inspect(value,path){if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){const next=path+'.'+key;if(monetaryKeys.has(key))leaked.push(next);else inspect(item,next);}}
  inspect(quotes,'quotes');
  check('Restored WORKER historical quotes contain no prices or monetary provenance',Array.isArray(quotes)&&quotes.length>0&&leaked.length===0,{forbiddenFieldPaths:leaked});
}

try{
  await tab.call('Page.addScriptToEvaluateOnNewDocument',{source:'globalThis.__quoteHistoryErrors=[];addEventListener("error",e=>__quoteHistoryErrors.push(String(e.message)));addEventListener("unhandledrejection",e=>__quoteHistoryErrors.push(String(e.reason?.message||e.reason)));'});
  // A JSON page cannot run the app's restore/migration/autosave chain. Capture
  // the original server payload BEFORE the first application document loads.
  await tab.navigate(new URL('/health',base).href);
  const login=await request('/__local-test/login','POST',{email:'direction@batinova.example'});assert.equal(login.status,204);
  const original=await api('/api/state');organizationId=String(original.organizationId);
  const history=original.state.quotes;
  assert.ok(Array.isArray(history)&&history.length>0,'The gate copy must already contain historical quotes; no seed is injected.');
  console.log('BASELINE before restore historyIds='+JSON.stringify(ids(history)));
  await rejectMutation('PUT quotes=[]',state=>{state.quotes=[];});
  await rejectMutation('PUT historical line price+1',state=>{const q=state.quotes.find(q=>q.lines?.length);assert.ok(q,'A real historical line is required.');q.lines[0].price=Number(q.lines[0].price||0)+1;});
  const customer=(await api('/api/customers','POST',{type:'individual',firstName:'QA',lastName:'History '+token,street:'Rue du test 13',postalCode:'5000',city:'Namur',country:'BE'})).customer;
  const date=new Date().toISOString().slice(0,10),validUntil=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  const sql=(await api('/api/quotes','POST',{customerId:customer.id,reference:'QA-HISTORY-'+token,title:'Nouveau devis SQL distinct '+token,client:'QA History '+token,clientAddress:'Rue du test 13, 5000 Namur',date,validUntil,status:'draft',lines:[{label:'Poste SQL de régression',description:'API sur copie isolée',qty:2,unit:'pièce',price:19.25,vat:21}]})).quote;
  assert.ok(sql?.id&&!ids(history).includes(String(sql.id)),'The SQL quote must have its own real identity.');
  await rejectMutation('PUT adding a SQL display copy',state=>{state.quotes.push(structuredClone(sql));});
  check('SQL creation leaves the original historical payload intact',isDeepStrictEqual((await api('/api/state')).state.quotes,history));
  const sample=history.find(q=>q.lines?.some(line=>Number(line.vatRate??line.vat)>0))||history[0];
  for(const width of [1440,412]){
    touch=width===412;
    await tab.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:touch});
    await tab.call('Emulation.setTouchEmulationEnabled',{enabled:touch,maxTouchPoints:5});
    await tab.call('Network.setUserAgentOverride',{userAgent:touch?'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 SamsungBrowser/26.0':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'});
    await tab.navigate(base);await waitForApp(tab);
    check('Initial snapshot matches the original pre-restore payload '+width,isDeepStrictEqual(await snapshot(),history));
    try{
      await openQuotes();
      await preserve('Opening Quotes '+width,history,String(sql.id));
      for(const q of history)check('Historical row present '+width+' '+String(q.ref||q.id),await run(`Boolean(${row(q)})`,'history-row'),{id:String(q.id)});
      await capture('list-'+width);
      check('No horizontal page overflow '+width,await run('document.documentElement.scrollWidth<=innerWidth+1','overflow'));
      await historyDetail(sample,original.state,width);
      await sqlEditor(sql,customer.id,width);
      await preserve('Reading history and SQL editor '+width,history,String(sql.id));
    }catch(error){check('Navigation/UI scenario '+width,false,{error:error.message});}
    finally{await closeModal();await restoreProbe(original.state,'navigation/UI '+width);}
  }
  // Dedicated loader probe: current navigation aliases can bypass this real
  // loader. Keep its before/after evidence separate from normal UI navigation.
  await tab.navigate(base);await waitForApp(tab);
  console.log('PROBE explicit loader before='+JSON.stringify(ids(await memory())));
  try{await run('iaCLoadQuotes()','explicit-sql-loader');}catch(error){check('Explicit SQL loader completes',false,{error:error.message});}
  console.log('PROBE explicit loader after='+JSON.stringify(ids(await memory())));
  await preserve('Explicit SQL loader probe',history,String(sql.id));
  await restoreProbe(original.state,'explicit SQL loader');
  check('SQL quote remains independently retrievable',(await api('/api/quotes/'+encodeURIComponent(sql.id))).quote.id===sql.id);
  await workerQuotePermission(history);
  await verifyQuoteSaveContext(tab,{base,ownerEmail:'direction@batinova.example',workerEmail:'anthony.simon@batinova.example'});
  await verifyQuoteTeamDispatch(tab,{base});
  assert.deepEqual(failures,[],'Quote history regression failures: '+failures.join('; '));
  console.log('PASS quote history: immutable original workspace payload and409 guards; PC1440/Samsung412 real history detail/without-prices and canonical SQL Modifier clicks; SQL display rows excluded from workspace persistence.');
}finally{await tab.close();await browser.close();}
