import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {connectBrowser,waitFor,waitForApp} from './helpers/browser-cdp.mjs';

// Qualification INTÉGRÉE du lot 21 dans une seule session réelle, avec captures finales
// PC (1440) et mobile (412). Tous les parcours passent par l'application réelle et le
// serveur SQL : création avec client canonique, conservation financière sur budget
// incomplet, fermeture pendant la requête, bascule de compte pendant une réponse
// retenue, puis lecture seule du secrétariat.
const base=process.env.SOCLE_TEST_URL;assert.ok(base&&['127.0.0.1','localhost'].includes(new URL(base).hostname));
const browser=await connectBrowser(base),tab=await browser.createSession(base);
const key='__jobJourney21';let checks=0;
const run=(source,label)=>tab.evaluate(source,'journey:'+label);
const capture=async name=>{const shot=await tab.call('Page.captureScreenshot',{format:'png'});writeFileSync(new URL('./'+name+'.png',import.meta.url),Buffer.from(shot.data,'base64'));console.log('CAPTURE '+name+'.png')};
async function api(path,method='GET',data){return run(`fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{'content-type':'application/json'},${data===undefined?'':`body:JSON.stringify(${JSON.stringify(data)}),`}}).then(async r=>{const b=await r.json().catch(()=>null);if(!r.ok)throw Error(JSON.stringify(b));return b})`,'api-'+path)}
async function viewport(width){
  await tab.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<=412});
  await tab.call('Emulation.setTouchEmulationEnabled',{enabled:width<=412});
}
async function saveButton(width){
  const point=await run(`(()=>{const e=document.querySelector('#modalbody .modal-actions button.primary');if(!e)throw Error('Bouton de sauvegarde absent');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,'save-point');
  if(width<=412){await tab.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await tab.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
  else{await tab.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await tab.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point})}
}
async function loginCookie(email){const status=await run(`fetch('/__local-test/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)}})}).then(r=>r.status)`,'login-cookie');assert.equal(status,204,'Identité locale '+email+' disponible.')}
async function currentIdentity(){return run('({userId:String(globalThis.socleCurrentAccess?.userId||""),role:globalThis.socleCurrentAccess?.roleCode,owner:Boolean(globalThis.socleCurrentAccess?.owner)})','identity')}
async function switchTo(email,role){await loginCookie(email);await run('loadWorkspace()','load-workspace');await waitFor(()=>run(`globalThis.socleCurrentAccess?.roleCode===${JSON.stringify(role)}`,'role-settled'),'Rôle authentifié '+role);return currentIdentity()}
let installed=false,jobId=null,partialId=null,primaryError;
try{
  await tab.navigate(new URL('/health',base).href);await loginCookie('direction@batinova.example');
  await tab.navigate(base);await waitForApp(tab);
  const owner=await currentIdentity();assert.equal(owner.owner,true,'Session propriétaire requise pour la qualification intégrée.');

  const customer=(await api('/api/customers','POST',{companyName:'QA21 qualification intégrée',street:'Rue de la Qualification 21'})).customer;
  assert.ok(customer?.id,'Client canonique réel créé.');

  // --- 1. Création avec client canonique (PC 1440) ---
  await viewport(1440);
  await run('jobForm()','open-create');
  await waitFor(()=>run('Boolean(document.querySelector("#modal[open] form [name=name]"))','create-form'),'Formulaire chantier ouvert');
  const created=await run(`(()=>{
    const form=document.querySelector('#modalbody form');if(!form.dataset.commercialJob)throw Error('Formulaire commercial attendu');
    const set=(name,value)=>{const field=form.querySelector('[name="'+name+'"]');if(!field)return false;field.value=String(value);field.dispatchEvent(new Event('input',{bubbles:true}));return true};
    const select=form.querySelector('[name=customerId]');select.value=${JSON.stringify(String(customer.id))};select.dispatchEvent(new Event('change',{bubbles:true}));
    set('name','QA21 qualification intégrée');set('type','Rénovation');set('town','Namur');set('address','Rue de la Qualification 21');
    return {valid:form.checkValidity(),invalid:[...form.querySelectorAll(':invalid')].map(field=>field.name),jobId:String(form._jobContext.id)};
  })()`,'fill-create');
  assert.equal(created.valid,true,'Formulaire de création valide : '+created.invalid.join(', '));
  await capture('job-21-creation-1440');
  await saveButton(1440);
  await waitFor(()=>run('!document.querySelector("#modal[open]")','create-closed'),'Création enregistrée');
  await waitFor(()=>run('!saveRunning&&!saveFailed&&workspaceSnapshot()===savedSnapshot','create-persisted'),'Création reçue par le serveur');
  jobId=created.jobId;
  const afterCreate=(await api('/api/state')).state.jobs.filter(job=>String(job.id)===jobId);
  assert.equal(afterCreate.length,1,'Création unique');assert.equal(String(afterCreate[0].customerId),String(customer.id),'Client canonique conservé');
  checks++;console.log('PASS 1/5 création avec client canonique (1440)');

  // --- 2. Budget financier incomplet : toutes les valeurs présentes conservées ---
  const finance={labourBudget:750,materials:88.5,subcontracting:40,other:3,hourlyCost:39,adjustments:[{amount:11,note:'Ajustement intégré'}],supplierInvoices:120,customLedger:{keep:['a']}};
  const state=await api('/api/state');
  state.state.jobs.push({id:'QA21-journey-partial',name:'QA21 budget incomplet',customerId:customer.id,client:customer.companyName||'QA21 qualification intégrée',type:'Rénovation',finance:structuredClone(finance),notes:[{text:'Conserver'}],customField:{integrated:true}});
  await api('/api/state','PUT',{revision:state.revision,state:state.state});
  await tab.reload();await waitForApp(tab);viewport(1440);
  partialId='QA21-journey-partial';
  await run(`jobForm('QA21-journey-partial')`,'open-partial');
  await waitFor(()=>run('Boolean(document.querySelector("#modal[open] [name=name]"))','partial-form'),'Formulaire budget incomplet ouvert');
  await capture('job-21-finance-1440');
  await run(`(()=>{const e=document.querySelector('#modalbody [name=name]');e.value='QA21 budget incomplet conservé';e.dispatchEvent(new Event('input',{bubbles:true}))})()`,'rename-partial');
  await saveButton(1440);
  await waitFor(()=>run('!document.querySelector("#modal[open]")','partial-closed'),'Budget incomplet enregistré');
  await waitFor(()=>run('!saveRunning&&!saveFailed&&workspaceSnapshot()===savedSnapshot','partial-persisted'),'Budget incomplet reçu par le serveur');
  const partial=(await api('/api/state')).state.jobs.filter(job=>String(job.id)===partialId);
  assert.equal(partial.length,1,'Aucun doublon sur budget incomplet');
  assert.equal(partial[0].finance.labourBudget,750);assert.equal(partial[0].finance.materials,88.5);
  assert.equal(partial[0].finance.subcontracting,40);assert.equal(partial[0].finance.other,3);
  assert.equal(partial[0].finance.hourlyCost,39);assert.deepEqual(partial[0].finance.adjustments,[{amount:11,note:'Ajustement intégré'}]);
  assert.equal(partial[0].finance.supplierInvoices,120);assert.deepEqual(partial[0].finance.customLedger,{keep:['a']});
  assert.deepEqual(partial[0].customField,{integrated:true});
  checks++;console.log('PASS 2/5 budget incomplet : valeurs présentes et extensions conservées (1440)');

  // --- 3. Fermeture pendant la requête : jamais de doublon ---
  await run('jobForm()','open-close-case');
  const closing='QA21 fermeture intégrée '+Date.now();
  await run(`(()=>{const f=document.querySelector('#modalbody form'),s=f.querySelector('[name=customerId]');s.value=${JSON.stringify(String(customer.id))};s.dispatchEvent(new Event('change',{bubbles:true}));const set=(n,v)=>{const e=f.querySelector('[name='+n+']');e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};set('name',${JSON.stringify(closing)});set('type','Rénovation');set('town','Namur');f.requestSubmit()})()`,'submit-close-case');
  await run(`(()=>{const m=document.querySelector('#modal');if(m)m.close?.();if(m)m.removeAttribute('open')})()`,'close-during-request');
  await new Promise(resolve=>setTimeout(resolve,1500));
  const closed=(await api('/api/state')).state.jobs.filter(job=>job.name===closing);
  assert.ok(closed.length<=1,'La fermeture pendant la requête ne duplique jamais le chantier');
  checks++;console.log('PASS 3/5 fermeture pendant la requête ('+closed.length+' chantier, 1440)');

  // --- 4. Bascule de compte pendant une réponse retenue ---
  await viewport(1440);
  await run('jobForm()','open-switch-case');
  await waitFor(()=>run('Boolean(document.querySelector("#modal[open] form [name=name]"))','switch-form'),'Formulaire bascule ouvert');
  const probe=await run(`(()=>{
    const form=document.querySelector('#modalbody form'),jobId=String(form._jobContext.id);
    const p={jobId,originalJson:serverJson,originalToast:toast,originalSave:commercialSaveJob,toasts:[],captured:null,released:false,settled:false,error:null};
    let release;p.hold=new Promise(resolve=>{release=resolve});p.release=()=>{if(!p.released){p.released=true;release()}};
    p.jsonWrapper=async function(url,options={}){const result=await p.originalJson.apply(this,arguments);const u=new URL(String(url),location.href);if(u.origin===location.origin&&u.pathname==='/api/state'&&String(options.method||'GET').toUpperCase()==='PUT'){let payload;try{payload=JSON.parse(options.body)}catch{}if(payload?.state?.jobs?.some(job=>String(job.id)===p.jobId)){if(p.captured)throw Error('Double PUT');p.captured=result;await p.hold}}return result};
    p.toastWrapper=function(message){p.toasts.push(String(message));return p.originalToast.apply(this,arguments)};
    p.saveWrapper=function(){p.promise=Promise.resolve(p.originalSave.apply(this,arguments)).then(()=>{p.settled=true},error=>{p.error=String((error&&error.message)||error);p.settled=true});return p.promise};
    serverJson=p.jsonWrapper;toast=p.toastWrapper;commercialSaveJob=p.saveWrapper;
    const s=form.querySelector('[name=customerId]');s.value=${JSON.stringify(String(customer.id))};s.dispatchEvent(new Event('change',{bubbles:true}));
    const n=form.querySelector('[name=name]');n.value='QA21 bascule 21 '+Date.now();n.dispatchEvent(new Event('input',{bubbles:true}));
    const t=form.querySelector('[name=type]');t.value='Rénovation';t.dispatchEvent(new Event('input',{bubbles:true}));
    const w=form.querySelector('[name=town]');w.value='Namur';w.dispatchEvent(new Event('input',{bubbles:true}));
    globalThis[${JSON.stringify(key)}]=p;return {jobId,valid:form.checkValidity()};
  })()`,'install-switch-barrier');
  installed=true;
  assert.equal(probe.valid,true,'Formulaire de bascule valide');
  await run('document.querySelector("#modalbody form").requestSubmit()','submit-switch');
  await waitFor(()=>run(`Boolean(globalThis[${JSON.stringify(key)}].captured?.revision)`,'switch-captured'),'Réponse réelle du PUT reçue avant sa continuation',20000);
  const held=await run(`({revision:globalThis[${JSON.stringify(key)}].captured.revision,settled:globalThis[${JSON.stringify(key)}].settled})`,'held-state');
  assert.equal(held.settled,false,'Résultat retenu avant continuation');
  const accounting=await switchTo('batxl.accounting@simulation.invalid','ACCOUNTING');
  assert.notEqual(accounting.userId,owner.userId,'Acteur réellement changé');
  await waitFor(()=>run("Boolean(document.querySelector('#main')?.children.length)",'accounting-view'),'Vue secrétariat rendue');
  await capture('job-21-secretariat-1440');
  const before=await run(`(()=>{const p=globalThis[${JSON.stringify(key)}];return{ids:jobs.map(job=>String(job.id)),snapshot:workspaceSnapshot(),toasts:p.toasts.slice()}})()`,'before-release');
  assert.equal(before.ids.includes(probe.jobId),false,'Le chantier propriétaire n’est pas déjà dans la vue secrétariat');
  const released=await run(`(async()=>{const p=globalThis[${JSON.stringify(key)}];p.release();await p.promise;return{ids:jobs.map(job=>String(job.id)),snapshot:workspaceSnapshot(),toasts:p.toasts.slice(),settled:p.settled,error:p.error,userId:String(globalThis.socleCurrentAccess?.userId||'')}})()`,'release-switch');
  assert.equal(released.userId,accounting.userId,'Libération dans la session du secrétariat');
  assert.ok(released.settled&&!released.error,'Continuation de sauvegarde sans exception');
  assert.deepEqual(released.ids,before.ids,'Aucune injection dans la projection secrétariat');
  assert.equal(released.snapshot,before.snapshot,'Projection secrétariat inchangée');
  assert.equal(released.toasts.some(text=>/chantier.{0,40}enregistr/i.test(text)),false,'Aucune confirmation propriétaire pour le secrétariat');
  const refused=await run(`fetch('/api/state',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision:${held.revision},state:JSON.parse(workspaceSnapshot())})}).then(r=>r.status)`,'secretariat-write');
  assert.equal(refused,403,'Secrétariat en lecture seule sur le dossier global');
  checks++;console.log('PASS 4/5 bascule de compte pendant la requête + secrétariat lecture seule (403)');

  // Restaurer les enveloppes du cas bascule avant le parcours mobile : sinon le PUT
  // mobile est encore intercepté par le garde encore actif et rejeté (« Double PUT »).
  await run(`(()=>{const p=globalThis[${JSON.stringify(key)}];if(!p)return;if(serverJson===p.jsonWrapper)serverJson=p.originalJson;if(toast===p.toastWrapper)toast=p.originalToast;if(commercialSaveJob===p.saveWrapper)commercialSaveJob=p.originalSave})()`,'restore-switch-wrappers');

  // --- 5. Parcours mobile 412 avec capture finale ---
  const restored=await switchTo('direction@batinova.example','OWNER');
  assert.equal(restored.userId,owner.userId,'Propriétaire rétabli');
  await viewport(412);
  await run('jobForm()','open-mobile');
  await waitFor(()=>run('Boolean(document.querySelector("#modal[open] form [name=name]"))','mobile-form'),'Formulaire mobile ouvert');
  const mobile=await run(`(()=>{const f=document.querySelector('#modalbody form'),s=f.querySelector('[name=customerId]');s.value=${JSON.stringify(String(customer.id))};s.dispatchEvent(new Event('change',{bubbles:true}));const set=(n,v)=>{const e=f.querySelector('[name='+n+']');e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};set('name','QA21 mobile 412 '+Date.now());set('type','Rénovation');set('town','Namur');const r=f.getBoundingClientRect();return{jobId:String(f._jobContext.id),valid:f.checkValidity(),width:Math.round(r.width),overflow:document.documentElement.scrollWidth>window.innerWidth+1}})()`,'fill-mobile');
  assert.equal(mobile.valid,true,'Formulaire mobile valide');
  await capture('job-21-mobile-412');
  await saveButton(412);
  await waitFor(()=>run('!document.querySelector("#modal[open]")','mobile-closed'),'Création mobile enregistrée');
  await waitFor(()=>run('!saveRunning&&!saveFailed&&workspaceSnapshot()===savedSnapshot','mobile-persisted'),'Création mobile reçue par le serveur');
  const mobileSaved=(await api('/api/state')).state.jobs.filter(job=>String(job.id)===mobile.jobId);
  assert.equal(mobileSaved.length,1,'Création mobile unique');assert.equal(String(mobileSaved[0].customerId),String(customer.id));
  checks++;console.log('PASS 5/5 création mobile 412 ('+mobile.width+'px, débordement horizontal='+mobile.overflow+')');

  console.log('PASS '+checks+' parcours intégrés lot 21 (captures 1440 et 412)');
}catch(error){
  primaryError=error;
  const shot=await tab.call('Page.captureScreenshot',{format:'png'}).catch(()=>null);
  if(shot)writeFileSync(new URL('./job-21-journey-failure.png',import.meta.url),Buffer.from(shot.data,'base64'));
  throw error;
}finally{
  if(installed){
    try{
      await run(`(async()=>{const p=globalThis[${JSON.stringify(key)}];if(!p)return;p.release();try{if(p.promise)await Promise.race([p.promise,new Promise(resolve=>setTimeout(resolve,5000))])}finally{if(serverJson===p.jsonWrapper)serverJson=p.originalJson;if(toast===p.toastWrapper)toast=p.originalToast;if(commercialSaveJob===p.saveWrapper)commercialSaveJob=p.originalSave;delete globalThis[${JSON.stringify(key)}]}})()`,'restore-wrappers');
      await run("if(document.querySelector('#modal')?.open)closeModal()",'close-probe-form');
    }catch(cleanupError){if(!primaryError)throw cleanupError;console.error('Nettoyage parcours intégré incomplet : '+cleanupError.message);}
  }
  await browser.close();
}
