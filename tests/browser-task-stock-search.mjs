import assert from 'node:assert/strict';
import {connectBrowser,waitForApp} from './helpers/browser-cdp.mjs';
const base=process.env.SOCLE_TEST_URL,browser=await connectBrowser(base),tab=await browser.createSession(base);
try{
 await tab.navigate(base);await tab.evaluate("fetch('/__local-test/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'direction@batinova.example'})})",'search-login');await tab.reload();await waitForApp(tab);
 const api=async(path,data)=>tab.evaluate(`fetch(${JSON.stringify(path)},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(data)})}).then(async r=>({status:r.status,data:await r.json()}))`,'search-fixture');
 const projectId=await tab.evaluate('String(jobs[0].id)','search-project'),location=await api('/api/stock-locations',{name:'Dépôt test réponses inversées '+Date.now(),type:'warehouse'});assert.equal(location.status,201);
 for(const ref of ['RACE-OLD','RACE-NEW']){const r=await api('/api/stock-items',{name:ref,reference:ref,unit:'m2',quantity:1,locationId:location.data.id,operationKey:'search-item-'+ref+'-'+Date.now()});assert.equal(r.status,201,JSON.stringify(r))}
 const created=await api('/api/projects/'+projectId+'/tasks',{title:'Contrôle recherche stock',materials:[{name:'Sous-toiture',quantity:1,unit:'m2'}],operationKey:'search-task-'+Date.now()});assert.equal(created.status,201);const taskId=created.data.task.id;
 await tab.evaluate(`openTaskStock(${JSON.stringify(taskId)})`,'search-desk');
 await tab.evaluate(`(()=>{window.searchNativeFetch=window.fetch;const gate=new Promise(resolve=>{window.releaseOldOptions=resolve});window.fetch=async(...args)=>{const r=await window.searchNativeFetch(...args);if(String(args[0]).includes('/stock/options?')&&String(args[0]).includes('q=RACE-OLD'))await gate;return r};const f=document.querySelector('[data-stock-action=reserve]');f.elements.materialIndex.value='0';f.elements.stockSearch.value='RACE-OLD';window.oldSearch=loadTaskStockOptions('0')})()`,'hold-old-options');
 await tab.evaluate("document.querySelector('[name=quantity]').value='0.5';document.querySelector('[name=stockSearch]').value='RACE-NEW';loadTaskStockOptions('0')",'new-options-first');
 const current=()=>tab.evaluate("JSON.parse(document.querySelector('#taskStockDesk').dataset.options).map(o=>o.reference)",'current-option-references');
 assert.deepEqual(await current(),['RACE-NEW']);
 await tab.evaluate('window.releaseOldOptions();window.oldSearch','old-options-arrive-last');
 assert.deepEqual(await current(),['RACE-NEW'],'A late search must not replace the latest search or its indexed selection');
 assert.equal(await tab.evaluate("document.querySelector('[name=quantity]').value",'preserve-entered-quantity'),'0.5','Searching an article must not reset a manually entered quantity');
 await tab.evaluate('window.fetch=window.searchNativeFetch','restore-search-fetch');
 // Refresh uses the same root element; an old form must not publish into its replacement.
 await tab.evaluate(`(()=>{const gate=new Promise(resolve=>{window.releaseDetachedOptions=resolve});window.fetch=async(...args)=>{const r=await window.searchNativeFetch(...args);if(String(args[0]).includes('/stock/options?')&&String(args[0]).includes('q=RACE-OLD'))await gate;return r};const f=document.querySelector('[data-stock-action=reserve]');f.elements.stockSearch.value='RACE-OLD';window.detachedSearch=loadTaskStockOptions('0')})()`,'hold-detached-form-options');
 await tab.evaluate(`openTaskStock(${JSON.stringify(taskId)})`,'replace-search-form');
 await tab.evaluate("(()=>{const f=document.querySelector('[data-stock-action=reserve]');f.elements.materialIndex.value='0';f.elements.stockSearch.value='RACE-NEW';return loadTaskStockOptions('0')})()",'replacement-options');
 await tab.evaluate('window.releaseDetachedOptions();window.detachedSearch','detached-options-arrive-last');
 assert.deepEqual(await current(),['RACE-NEW'],'A disconnected form must not mutate the live root option mapping');
 await tab.evaluate('window.fetch=window.searchNativeFetch','restore-detached-fetch');
 // Clearing the material invalidates pending requests and makes creation unavailable.
 await tab.evaluate(`(()=>{const gate=new Promise(resolve=>{window.releaseClearedOptions=resolve});window.fetch=async(...args)=>{const r=await window.searchNativeFetch(...args);if(String(args[0]).includes('/stock/options?'))await gate;return r};window.clearedSearch=loadTaskStockOptions('0')})()`,'hold-before-clear');
 await tab.evaluate("document.querySelector('[name=materialIndex]').value='';loadTaskStockOptions('')",'clear-material');
 await tab.evaluate('window.releaseClearedOptions();window.clearedSearch','late-response-after-clear');assert.deepEqual(await current(),[]);assert.equal(await tab.evaluate("document.querySelector('[name=option]').disabled",'cleared-selection-disabled'),true);
 await tab.evaluate('window.fetch=window.searchNativeFetch','restore-clear-fetch');
 console.log('PASS real stock search with inverted HTTP responses, same-root form replacement and cleared material: visible options and stored IDs keep the latest selection.');
}finally{await tab.close();await browser.close()}
