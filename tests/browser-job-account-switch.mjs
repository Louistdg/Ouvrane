import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {connectBrowser,waitFor,waitForApp} from './helpers/browser-cdp.mjs';

// Cas lot 21 : changement de compte pendant une requête de chantier.
// La réponse réelle du PUT est retenue APRÈS écriture SQL, puis l'identité
// authentifiée change réellement (propriétaire -> secrétariat/comptable).
// Le résultat tardif ne doit rien injecter dans la projection du nouveau compte.
const base=process.env.SOCLE_TEST_URL;assert.ok(base&&['127.0.0.1','localhost'].includes(new URL(base).hostname));
const browser=await connectBrowser(base),tab=await browser.createSession(base);let checks=0;
const key='__jobAccountSwitchProbe';
const run=(source,label)=>tab.evaluate(source,'job-switch:'+label);
async function api(path,method='GET',data){return run(`fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{'content-type':'application/json'},${data===undefined?'':`body:JSON.stringify(${JSON.stringify(data)}),`}}).then(async r=>{const b=await r.json().catch(()=>null);if(!r.ok)throw Error(JSON.stringify(b));return b})`,'api-'+path)}
async function loginCookie(email){
  const status=await run(`fetch('/__local-test/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)}})}).then(r=>r.status)`,'login-cookie');
  assert.equal(status,204,'L’identité locale '+email+' doit pouvoir se connecter.');
}
async function currentIdentity(){return run('({userId:String(globalThis.socleCurrentAccess?.userId||""),role:globalThis.socleCurrentAccess?.roleCode,owner:Boolean(globalThis.socleCurrentAccess?.owner)})','identity')}
async function switchTo(email,role){
  await loginCookie(email);
  await run('loadWorkspace()','load-workspace');
  await waitFor(()=>run(`globalThis.socleCurrentAccess?.roleCode===${JSON.stringify(role)}`,'role-settled'),'Rôle authentifié '+role);
  return currentIdentity();
}
let installed=false,probeId=null,primaryError;
try{
  await tab.navigate(new URL('/health',base).href);
  await loginCookie('direction@batinova.example');
  await tab.navigate(base);await waitForApp(tab);
  const owner=await currentIdentity();
  assert.equal(owner.role,'OWNER','Le propriétaire doit ouvrir sa session complète.');
  assert.equal(owner.owner,true,'Le propriétaire garde le privilège de modification des chantiers.');

  const customer=(await api('/api/customers','POST',{companyName:'QA21 changement de compte',street:'Rue du Basculement'})).customer;
  assert.ok(customer?.id,'Un vrai client canonique est requis pour un chantier valide.');

  await run('jobForm()','open-new-job');
  await waitFor(()=>run('Boolean(document.querySelector("#modal[open] form [name=name]"))','form-ready'),'Le formulaire réel de chantier est ouvert');

  const prepared=await run(`(()=>{
    const form=document.querySelector('#modalbody form');
    if(!form||!form.dataset.commercialJob)throw Error('Formulaire commercial attendu');
    const jobId=String(form._jobContext?.id||'');
    if(!jobId)throw Error('Identité de chantier attendue');
    const probe={jobId,form,originalJson:serverJson,originalToast:toast,originalSave:commercialSaveJob,toasts:[],captured:null,released:false,settled:false,error:null};
    let release;probe.hold=new Promise(resolve=>{release=resolve});
    probe.release=()=>{if(!probe.released){probe.released=true;release()}};
    probe.jsonWrapper=async function(url,options={}){
      const result=await probe.originalJson.apply(this,arguments);
      const requestUrl=new URL(String(url),location.href);
      if(requestUrl.origin===location.origin&&requestUrl.pathname==='/api/state'&&String(options.method||'GET').toUpperCase()==='PUT'){
        let payload;try{payload=JSON.parse(options.body)}catch{}
        if(payload?.state?.jobs?.some(job=>String(job.id)===probe.jobId)){
          if(probe.captured)throw Error('Le formulaire a soumis deux fois');
          probe.captured=result;await probe.hold;
        }
      }
      return result;
    };
    probe.toastWrapper=function(message){probe.toasts.push(String(message));return probe.originalToast.apply(this,arguments)};
    probe.saveWrapper=function(){probe.promise=Promise.resolve(probe.originalSave.apply(this,arguments)).then(()=>{probe.settled=true},error=>{probe.error=String((error&&error.message)||error);probe.settled=true});return probe.promise};
    serverJson=probe.jsonWrapper;toast=probe.toastWrapper;commercialSaveJob=probe.saveWrapper;
    const select=form.querySelector('[name=customerId]');
    select.value=${JSON.stringify(String(customer.id))};select.dispatchEvent(new Event('change',{bubbles:true}));
    const name=form.querySelector('[name=name]');name.value='QA21 bascule de compte '+Date.now();name.dispatchEvent(new Event('input',{bubbles:true}));
    const type=form.querySelector('[name=type]');if(type){type.value='Rénovation';type.dispatchEvent(new Event('input',{bubbles:true}))}
    globalThis[${JSON.stringify(key)}]=probe;
    return {valid:form.checkValidity(),invalid:[...form.querySelectorAll(':invalid')].map(field=>field.name),jobId,name:name.value};
  })()`,'install-barrier-and-fill');
  installed=true;probeId=prepared.jobId;
  assert.equal(prepared.valid,true,'Le formulaire réel doit être valide : '+prepared.invalid.join(', '));

  await run('document.querySelector("#modalbody form").requestSubmit()','submit-once');
  await waitFor(()=>run(`Boolean(globalThis[${JSON.stringify(key)}].captured?.revision)`,'put-captured'),'La réponse réelle du PUT est reçue avant sa continuation UI',20000);
  const held=await run(`({revision:globalThis[${JSON.stringify(key)}].captured.revision,settled:globalThis[${JSON.stringify(key)}].settled,released:globalThis[${JSON.stringify(key)}].released})`,'held-state');
  assert.ok(held.revision>0,'Le serveur a bien attribué une révision au chantier écrit.');
  assert.equal(held.settled,false,'Le résultat réel doit être retenu avant sa continuation.');
  assert.equal(held.released,false);

  // Changement de compte réel pendant que le résultat du propriétaire est en attente.
  const accounting=await switchTo('batxl.accounting@simulation.invalid','ACCOUNTING');
  assert.notEqual(accounting.userId,owner.userId,'L’acteur authentifié doit réellement changer.');
  assert.equal(accounting.owner,false,'Le secrétariat n’obtient pas le privilège global.');

  const before=await run(`(()=>{const p=globalThis[${JSON.stringify(key)}];return{ids:jobs.map(job=>String(job.id)),snapshot:workspaceSnapshot(),saveFailed:globalThis.saveFailed,status:document.querySelector('#saveStatus')?.innerText||'',toasts:p.toasts.slice()}})()`,'accounting-before-release');
  assert.equal(before.ids.includes(probeId),false,'Le chantier du propriétaire ne doit pas déjà figurer dans la projection du secrétariat.');

  const released=await run(`(async()=>{const p=globalThis[${JSON.stringify(key)}];p.release();await p.promise;return{ids:jobs.map(job=>String(job.id)),snapshot:workspaceSnapshot(),saveFailed:globalThis.saveFailed,status:document.querySelector('#saveStatus')?.innerText||'',toasts:p.toasts.slice(),settled:p.settled,error:p.error,userId:String(globalThis.socleCurrentAccess?.userId||'')}})()`,'release-into-accounting-context');
  assert.equal(released.userId,accounting.userId,'La libération doit rester dans la session du secrétariat.');
  assert.ok(released.settled&&!released.error,'La continuation de sauvegarde réelle doit se terminer sans exception : '+released.error);
  assert.deepEqual(released.ids,before.ids,'Le résultat tardif du propriétaire ne doit pas injecter son chantier dans le secrétariat.');
  assert.equal(released.snapshot,before.snapshot,'La projection du secrétariat doit rester identique après libération.');
  const success=/chantier.{0,40}enregistr/i;
  assert.equal(released.toasts.some(text=>success.test(text)),false,'Le secrétariat ne doit recevoir aucune confirmation de sauvegarde propriétaire.');
  assert.equal(success.test(released.status),false,'La barre de sauvegarde du secrétariat ne doit pas annoncer un succès propriétaire.');
  assert.equal(Boolean(released.saveFailed),Boolean(before.saveFailed),'Aucune sauvegarde rejetée supplémentaire ne doit être déclenchée.');
  checks++;console.log('PASS changement de compte pendant la requête : aucune injection, aucun succès propriétaire, aucune écriture supplémentaire');

  // Le secrétariat ne peut pas écrire le dossier global : refus serveur explicite.
  const writeAttempt=await run(`fetch('/api/state',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision:${held.revision},state:JSON.parse(workspaceSnapshot())})}).then(async r=>({status:r.status,body:await r.json().catch(()=>null)}))`,'accounting-write-attempt');
  assert.equal(writeAttempt.status,403,'Le secrétariat ne doit pas pouvoir modifier le dossier global.');
  checks++;console.log('PASS secrétariat en lecture seule sur le dossier global ('+writeAttempt.status+')');

  // Le propriétaire retrouve exactement un chantier réellement écrit.
  const restored=await switchTo('direction@batinova.example','OWNER');
  assert.equal(restored.userId,owner.userId,'Le propriétaire doit retrouver sa session.');
  const server=await api('/api/state');
  const saved=server.state.jobs.filter(job=>String(job.id)===probeId);
  assert.equal(saved.length,1,'Le chantier doit être écrit exactement une fois.');
  assert.equal(saved[0].name,prepared.name,'Le nom réel écrit doit être conservé.');
  assert.equal(String(saved[0].customerId),String(customer.id),'Le client canonique doit être conservé.');
  assert.equal(server.revision,held.revision,'Aucune écriture parasite ne doit avoir eu lieu après la bascule.');
  checks++;console.log('PASS chantier réellement écrit une seule fois et retrouvé par le propriétaire (révision '+server.revision+')');

  console.log('PASS '+checks+' cas de changement de compte');
}catch(error){
  primaryError=error;
  if(probeId)error.message+=' (chantier conservé : '+probeId+')';
  const shot=await tab.call('Page.captureScreenshot',{format:'png'}).catch(()=>null);
  if(shot)writeFileSync(new URL('./job-account-switch-failure.png',import.meta.url),Buffer.from(shot.data,'base64'));
  throw error;
}finally{
  if(installed){
    try{
      await run(`(async()=>{const p=globalThis[${JSON.stringify(key)}];if(!p)return;p.release();try{if(p.promise)await Promise.race([p.promise,new Promise(resolve=>setTimeout(resolve,5000))])}finally{if(serverJson===p.jsonWrapper)serverJson=p.originalJson;if(toast===p.toastWrapper)toast=p.originalToast;if(commercialSaveJob===p.saveWrapper)commercialSaveJob=p.originalSave;delete globalThis[${JSON.stringify(key)}]}})()`,'restore-wrappers');
      await run("if(document.querySelector('#modal')?.open)closeModal()",'close-probe-form');
    }catch(cleanupError){if(!primaryError)throw cleanupError;console.error('Nettoyage bascule de compte incomplet : '+cleanupError.message);}
  }
  await browser.close();
}
