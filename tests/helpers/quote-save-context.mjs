import assert from 'node:assert/strict';
import {waitFor,waitForApp} from './browser-cdp.mjs';

// No network response or business object is mocked. Only delivery of one
// already-successful POST result to the real form handler is delayed.
export async function verifyQuoteSaveContext(tab,{base,ownerEmail,workerEmail}) {
  assert.ok(base&&['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'Run against the isolated local gate copy.');
  assert.ok(ownerEmail&&workerEmail&&ownerEmail!==workerEmail,'Two existing local-test identities are required.');
  const key='__quoteSaveContextProbe',title='QA contexte devis '+Date.now()+'-'+Math.random().toString(16).slice(2,8);
  const run=(source,label)=>tab.evaluate(source,'quote-save-context:'+label);
  const api=(path,options={})=>run(`serverJson(${JSON.stringify(path)},${JSON.stringify(options)})`,'api-'+path);
  async function login(email) {
    const status=await run(`fetch('/__local-test/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)}})}).then(r=>r.status)`,'login-existing-identity');
    assert.equal(status,204,'Existing local-test login must succeed.');
    await run('loadWorkspace()','load-authenticated-workspace');
    const state=await api('/api/state');
    await waitForApp(tab,String(state.access?.userId||''));
    return state;
  }
  let installed=false,owner,worker,createdId,customer,primaryError;
  try {
    assert.equal(await run('location.origin','owned-local-origin'),new URL(base).origin,'The supplied tab must belong to this local gate.');
    assert.equal(await run(`Boolean(globalThis[${JSON.stringify(key)}])`,'no-nested-probe'),false,'Do not nest or run this probe concurrently on the same tab.');
    owner=await login(ownerEmail);assert.equal(owner.access?.roleCode,'OWNER');
    await run("if(document.querySelector('#modal')?.open)closeModal();navigate('home')",'neutral-owner-view');
    const directory=await api('/api/customers?limit=250');
    customer=directory.customers?.find(c=>c.street||c.city)||directory.customers?.[0];
    assert.ok(customer?.id,'Reuse a real existing canonical customer; this helper creates no replacement directory.');
    await run(`quoteForm('','',${JSON.stringify(String(customer.id))})`,'open-real-quote-form');
    await waitFor(()=>run('Boolean(document.querySelector("#modal[open] form.quote-editor"))','quote-form-visible'),'The actual quote form opens');

    await run(`(()=>{
      const name=${JSON.stringify(key)},form=document.querySelector('#modalbody form.quote-editor');
      if(!form||!String(form.getAttribute('onsubmit')||'').includes('e2e02SaveQuote'))throw Error('Expected the real e2e02SaveQuote form');
      const probe={originalJson:serverJson,originalToast:toast,originalSubmit:form.onsubmit,form,title:${JSON.stringify(title)},phase:'owner',toasts:[],captured:null,settled:false,saveError:null};
      let release;probe.hold=new Promise(resolve=>{release=resolve});probe.release=()=>{if(!probe.released){probe.released=true;release()}};
      probe.jsonWrapper=async function(url,options={}){
        const result=await probe.originalJson.apply(this,arguments);
        const requestUrl=new URL(String(url),location.href);
        if(requestUrl.origin===location.origin&&requestUrl.pathname==='/api/quotes'&&String(options.method||'GET').toUpperCase()==='POST'){
          let payload;try{payload=JSON.parse(options.body)}catch{}
          if(payload?.title===probe.title){
            if(probe.captured)throw Error('The probe form submitted twice');
            probe.captured=result;await probe.hold;
          }
        }
        return result;
      };
      probe.toastWrapper=function(message){if(probe.phase==='worker')probe.toasts.push(String(message));return probe.originalToast.apply(this,arguments)};
      serverJson=probe.jsonWrapper;toast=probe.toastWrapper;
      // Delegate the existing form submit to the same production function once,
      // retaining its promise so assertions run after its continuation finishes.
      form.onsubmit=function(event){probe.savePromise=Promise.resolve(e2e02SaveQuote(event)).then(()=>{probe.settled=true},error=>{probe.saveError=String(error.message||error);probe.settled=true});return false};
      globalThis[name]=probe;
    })()`,'install-one-post-result-barrier');
    installed=true;

    const customerLabel=String(customer.companyName||[customer.firstName,customer.lastName].filter(Boolean).join(' ')||customer.id);
    const address=[customer.street,[customer.postalCode,customer.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')||'Adresse de contrôle du contexte';
    const date=new Date().toISOString().slice(0,10),validUntil=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
    const validity=await run(`(()=>{
      const form=globalThis[${JSON.stringify(key)}].form;
      const put=(name,value)=>{const field=form.querySelector('[name="'+name+'"]');if(!field)throw Error('Missing real form field '+name);field.value=String(value)};
      put('job','');put('customerId',${JSON.stringify(String(customer.id))});
      form.querySelector('[name=customerId]').dispatchEvent(new Event('change',{bubbles:true}));
      put('client',${JSON.stringify(customerLabel)});put('clientAddress',${JSON.stringify(address)});put('title',${JSON.stringify(title)});
      put('date',${JSON.stringify(date)});put('validUntil',${JSON.stringify(validUntil)});
      put('label','Contrôle réel du contexte de sauvegarde');put('description','Réponse réelle retenue après écriture SQL');put('qty',1);put('unit','forfait');put('price',12.34);put('vat',21);
      return {valid:form.checkValidity(),invalid:[...form.querySelectorAll(':invalid')].map(e=>e.name)};
    })()`,'fill-real-form');
    assert.equal(validity.valid,true,'The real form must be valid: '+validity.invalid.join(', '));
    await run(`globalThis[${JSON.stringify(key)}].form.requestSubmit()`,'submit-real-form-once');
    await waitFor(()=>run(`Boolean(globalThis[${JSON.stringify(key)}].captured?.quote?.id)||globalThis[${JSON.stringify(key)}].settled`,'post-result-captured'),'The real POST response is received before its UI continuation',20000);
    const held=await run(`({id:globalThis[${JSON.stringify(key)}].captured?.quote?.id,settled:globalThis[${JSON.stringify(key)}].settled,error:globalThis[${JSON.stringify(key)}].saveError})`,'held-post-state');
    assert.ok(held.id&&!held.settled&&!held.error,'A real successful POST must be held before completion.');createdId=String(held.id);

    worker=await login(workerEmail);assert.equal(worker.access?.roleCode,'WORKER');
    assert.notEqual(String(worker.access.userId),String(owner.access.userId),'The authenticated actor must really change.');
    const before=await run(`(()=>{const p=globalThis[${JSON.stringify(key)}];p.phase='worker';p.toasts=[];return {ids:quotes.map(q=>String(q.id)),toast:document.querySelector('#toast')?.innerText||''}})()`,'worker-context-before-release');
    assert.equal(before.ids.includes(createdId),false,'The owner POST must not already be in the worker projection.');
    await run(`(async()=>{const p=globalThis[${JSON.stringify(key)}];p.release();await p.savePromise})()`,'release-post-into-worker-context');
    const after=await run(`(()=>{const p=globalThis[${JSON.stringify(key)}];return {ids:quotes.map(q=>String(q.id)),toasts:p.toasts,toast:document.querySelector('#toast')?.innerText||'',settled:p.settled,error:p.saveError,userId:globalThis.socleCurrentAccess?.userId}})()`,'worker-context-after-release');
    assert.equal(String(after.userId),String(worker.access.userId));
    assert.ok(after.settled&&!after.error,'The real production save continuation must settle without an exception.');
    assert.equal(after.ids.includes(createdId),false,'A delayed owner POST result must not inject its quote into the worker projection.');
    assert.deepEqual(after.ids,before.ids,'The delayed owner save must not change the worker quote projection.');
    const success=/devis.{0,100}(?:enregistr|déjà.{0,30}jour)/i;
    assert.equal(after.toasts.some(text=>success.test(text)),false,'The worker must receive no owner-save success toast.');
    assert.equal(after.toast!==before.toast&&success.test(after.toast),false,'The owner success must not appear in the worker toast surface.');

    await run(`globalThis[${JSON.stringify(key)}].phase='verification'`,'end-worker-observation');
    const restoredOwner=await login(ownerEmail);assert.equal(String(restoredOwner.access.userId),String(owner.access.userId));
    const persisted=(await api('/api/quotes/'+encodeURIComponent(createdId))).quote;
    assert.equal(String(persisted.id),createdId);assert.equal(persisted.title,title);assert.equal(String(persisted.customerId),String(customer.id));
    assert.equal(persisted.lines[0].qty,1);assert.equal(persisted.lines[0].price,12.34);assert.equal(persisted.lines[0].vat,21);
    console.log('PASS quote save context: real POST committed, response held across real worker login/loadWorkspace, no worker injection or success toast, owner retrieves the actual SQL quote.');
    return {quoteId:createdId,customerId:String(customer.id),ownerUserId:String(owner.access.userId),workerUserId:String(worker.access.userId)};
  }catch(error){primaryError=error;if(createdId)error.message+=' (real SQL quote retained: '+createdId+')';throw error;}
  finally {
    if(installed){
      try {
        await run(`(async()=>{const name=${JSON.stringify(key)},p=globalThis[name];if(!p)return;p.phase='cleanup';p.release();try{if(p.savePromise)await Promise.race([p.savePromise,new Promise(resolve=>setTimeout(resolve,5000))])}finally{if(serverJson===p.jsonWrapper)serverJson=p.originalJson;if(toast===p.toastWrapper)toast=p.originalToast;if(p.form?.isConnected)p.form.onsubmit=p.originalSubmit;delete globalThis[name]}})()`,'restore-all-temporary-wrappers');
        await run("if(document.querySelector('#modal')?.open)closeModal()",'close-probe-form');
        if(owner)await login(ownerEmail);
      }catch(cleanupError){if(!primaryError)throw cleanupError;console.error('Quote context cleanup failed: '+cleanupError.message);}
    }
  }
}
