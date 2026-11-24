import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {connectBrowser,waitFor,waitForApp} from './helpers/browser-cdp.mjs';

// Real local HTTP/SQLite, independent browser contexts, and real mouse/touch
// activation of save/close buttons. Only transport failures/delays are injected.
const base=process.env.SOCLE_TEST_URL;
assert.ok(base&&['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'Disposable local Browser Gate only.');
const browser=await connectBrowser(base),failures=[];
const token=randomUUID().slice(0,8),probeKey='__jobSafety21';
let passed=0;

async function scenario(label,width,body){
  const tab=await browser.createSession(base);
  const run=(source,step)=>tab.evaluate(source,'job-safety:'+label+':'+step);
  const api=async(path,method='GET',data)=>{
    const response=await run(`fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{'content-type':'application/json','x-socle-organization-id':globalThis.socleCurrentOrganizationId||''},${data===undefined?'':`body:JSON.stringify(${JSON.stringify(data)}),`}}).then(async r=>({status:r.status,body:await r.json().catch(()=>null)}))`,'api-'+path);
    assert.ok(response.status>=200&&response.status<300,path+' HTTP '+response.status+' '+JSON.stringify(response.body));
    return response.body;
  };
  const capture=async(suffix)=>{
    const image=await tab.call('Page.captureScreenshot',{format:'png'});
    writeFileSync(new URL('./job-safety-21-'+label+'-'+suffix+'.png',import.meta.url),Buffer.from(image.data,'base64'));
  };
  const click=async(expression,step)=>{
    const point=await waitFor(()=>run(`(()=>{const e=${expression};if(!e||e.matches(':disabled'))return null;for(const details of [...document.querySelectorAll('#modalbody details')])if(details.contains(e)&&!details.open)details.querySelector('summary')?.click();e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2},top=document.elementFromPoint(p.x,p.y);return r.width>0&&r.height>0&&(top===e||e.contains(top))?p:null})()`,step+'-position'),'Visible usable control: '+step);
    if(width<=412){
      await tab.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
      await tab.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }else{
      await tab.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
      await tab.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
    }
  };
  const save=()=>click('document.querySelector("#modal[open] .modal-actions button.primary")','save');
  const openNew=async()=>{
    await run("navigate('jobs')",'navigate-jobs');
    await click(`Array.from(document.querySelectorAll('#main button')).find(e=>/^(?:\\+\\s*)?(?:Nouveau|Créer un) chantier$/i.test(e.textContent.trim()))`,'new-job');
    await waitFor(()=>run('Boolean(document.querySelector("#modal[open] form [name=customerId]"))','form-ready'),'Canonical job form ready');
  };
  const fill=async(customer,name,extra={})=>{
    const result=await run(`(()=>{const form=document.querySelector('#modal[open] form');const customer=form.querySelector('[name=customerId]');customer.value=${JSON.stringify(String(customer.id))};customer.dispatchEvent(new Event('change',{bubbles:true}));const values=${JSON.stringify({name,type:'Rénovation',town:'Namur',address:'Rue des essais 21',...extra})};for(const [name,value]of Object.entries(values)){const field=form.querySelector('[name="'+name+'"]');if(!field)throw Error('Champ absent: '+name);field.value=String(value);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}))}return{valid:form.checkValidity(),invalid:[...form.querySelectorAll(':invalid')].map(e=>e.name)}})()`,'fill-form');
    assert.equal(result.valid,true,'Valid job form: '+result.invalid.join(', '));
  };
  const noOverflow=async(step)=>{
    const dimensions=await run(`(()=>{const modal=document.querySelector('#modal[open]'),form=modal?.querySelector('form'),r=form?.getBoundingClientRect();return{viewport:innerWidth,page:document.documentElement.scrollWidth,modalClient:modal?.clientWidth,modalScroll:modal?.scrollWidth,left:r?.left,right:r?.right}})()`,step+'-dimensions');
    assert.ok(dimensions.page<=dimensions.viewport+1,'No page overflow: '+JSON.stringify(dimensions));
    assert.ok(dimensions.modalScroll<=dimensions.modalClient+1,'No modal overflow: '+JSON.stringify(dimensions));
    assert.ok(dimensions.left>=-1&&dimensions.right<=dimensions.viewport+1,'Form fits viewport: '+JSON.stringify(dimensions));
  };
  const waitSaved=async()=>{
    await waitFor(()=>run('!document.querySelector("#modal[open]")','save-closed'),'Job form closes after save');
    await waitFor(()=>run('!saveRunning&&!saveFailed&&workspaceSnapshot()===savedSnapshot','save-settled'),'Local snapshot agrees with saved state');
  };
  try{
    await tab.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<=412});
    await tab.call('Emulation.setTouchEmulationEnabled',{enabled:width<=412});
    await tab.navigate(new URL('/health',base).href);
    await api('/__local-test/login','POST',{email:'direction@batinova.example'});
    await tab.navigate(base);await waitForApp(tab);
    assert.equal(await run('Boolean(globalThis.socleCurrentAccess?.owner)','owner'),true,'Authenticated owner required');
    const customer=(await api('/api/customers','POST',{companyName:'QA21 sécurité '+token+' '+label,street:'Rue des essais 21'})).customer;
    assert.ok(customer?.id,'Real canonical customer created');
    await body({tab,run,api,capture,click,save,openNew,fill,noOverflow,waitSaved,customer});
    passed++;console.log('PASS lot21 safety '+label);
  }catch(error){
    failures.push(new Error(label+': '+error.message,{cause:error}));
    console.error('FAIL lot21 safety '+label+': '+error.stack);
    await capture('failure').catch(()=>{});
  }finally{
    // Release a held real response even when an assertion failed, then restore
    // the transport. No fixture cleanup is needed: the gate owns the DB copy.
    await run(`(async()=>{const p=globalThis[${JSON.stringify(probeKey)}];if(!p)return;p.release?.();if(p.wrapper&&serverJson===p.wrapper)serverJson=p.original;if(p.storageWrapper&&Storage.prototype.setItem===p.storageWrapper)Storage.prototype.setItem=p.originalSetItem;await new Promise(resolve=>setTimeout(resolve,0));delete globalThis[${JSON.stringify(probeKey)}]})()`,'restore-transport').catch(error=>console.error('Transport cleanup: '+error.message));
    await tab.close();
  }
}

try{
  for(const width of [1440,412])await scenario('navigation-stability-'+width,width,async({tab,run,click})=>{
    // Observe the real navigation before its next animation frame. A late
    // breadcrumb used to shift this button after CDP had measured its center.
    const position=await run(`(async()=>{
      navigate('jobs');await Promise.resolve();
      const button=()=>[...document.querySelectorAll('#main button')].find(e=>e.getAttribute('onclick')==='jobForm()');
      const rect=button().getBoundingClientRect(),point={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
      const before=Boolean(document.querySelector('#main > .sx-breadcrumb'));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const after=button().getBoundingClientRect(),hit=document.elementFromPoint(point.x,point.y);
      return{before,after:Boolean(document.querySelector('#main > .sx-breadcrumb')),shift:after.y-rect.y,usable:hit===button()||button().contains(hit),point};
    })()`,'breadcrumb-position');
    console.log('NAVIGATION_POSITION '+width+' '+JSON.stringify(position));
    assert.equal(position.shift,0,'Breadcrumb must not move the new-job button after navigation');
    assert.equal(position.usable,true,'Original click coordinates still target the button');
    if(width<=412){await tab.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[position.point]});await tab.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
    else{await tab.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...position.point});await tab.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...position.point});}
    await waitFor(()=>run('Boolean(document.querySelector("#modal[open] form [name=customerId]"))','stable-form-ready'),'Canonical form opens at measured coordinates');
  });
  for(const width of [360,412])await scenario('uncertain-'+width,width,async({tab,run,api,capture,click,save,openNew,fill,noOverflow,waitSaved,customer})=>{
    const name='QA21 uncertain '+token+' '+width;
    const fieldValues=()=>run(`Array.from(document.querySelectorAll('#modal[open] form input[name],#modal[open] form select[name],#modal[open] form textarea[name]')).map(e=>({name:e.name,type:e.type,value:e.value,...(['checkbox','radio'].includes(e.type)?{checked:e.checked}:{})}))`,'field-values');
    const assertProtected=async(step)=>{
      const editable=await run(`Array.from(document.querySelectorAll('#modal[open] form input[name],#modal[open] form select[name],#modal[open] form textarea[name]')).filter(e=>!['hidden','submit','button'].includes(e.type)&&!e.matches(':disabled')&&!e.readOnly).map(e=>e.name)`,step+'-editable');
      assert.deepEqual(editable,[],'Every business input is protected '+step);
      assert.match(await run('document.querySelector("#modal[open] .modal-actions button.primary").textContent','retry-label'),/Vérifier l.enregistrement/i,'Recovery is presented as checking the existing save');
    };
    await openNew();
    await fill(customer,name,{reference:'QA21-'+width,progress:12,contractAmount:4500,plannedMonths:2,plannedHours:24,labourBudget:900,materialsBudget:400,subcontractingBudget:70,otherBudget:30});
    const originalFields=await fieldValues();
    await noOverflow('before-save');
    await run(`(()=>{const p={original:serverJson,puts:0,lost:false};p.wrapper=async function(url,options={}){const result=await p.original.apply(this,arguments);const path=new URL(String(url),location.href).pathname;if(path==='/api/state'&&String(options.method||'GET').toUpperCase()==='PUT'){p.puts++;if(!p.lost){p.lost=true;throw Error('QA21 réponse perdue après écriture réelle')}}return result};serverJson=p.wrapper;globalThis[${JSON.stringify(probeKey)}]=p})()`,'lose-response-after-commit');
    await save();
    await waitFor(()=>run('Boolean(document.querySelector("#commercialJobError")?.textContent)','uncertain-visible'),'Uncertain outcome visible in actual form');
    const committedState=await api('/api/state'),committed=committedState.state.jobs.filter(job=>job.name===name);
    assert.equal(committed.length,1,'Exactly one job committed before retry');
    await assertProtected('after-lost-response');
    await noOverflow('uncertain');await capture('protected');

    await click('document.querySelector("#modal[open] .modal-top .close")','close-uncertain');
    await waitFor(()=>run('!document.querySelector("#modal[open]")','uncertain-closed'),'Close preserves the unknown operation');
    await openNew();
    assert.deepEqual(await fieldValues(),originalFields,'Reopening new-job resumes every original field');
    await assertProtected('after-reopening');
    assert.equal(await run(`globalThis[${JSON.stringify(probeKey)}].puts`,'puts-before-reload'),1,'Reopening does not send another PUT');

    // A real document reload discards JS memory and transport wrappers. Resume
    // from the browser's saved operation, and count any subsequent PUT anew.
    await tab.reload();await waitForApp(tab);
    await run(`(()=>{const p={original:serverJson,puts:0};p.wrapper=async function(url,options={}){if(new URL(String(url),location.href).pathname==='/api/state'&&String(options.method||'GET').toUpperCase()==='PUT')p.puts++;return p.original.apply(this,arguments)};serverJson=p.wrapper;globalThis[${JSON.stringify(probeKey)}]=p})()`,'record-after-reload');
    await openNew();
    assert.deepEqual(await fieldValues(),originalFields,'F5 resumes every field of the same pending job');
    await assertProtected('after-F5');await noOverflow('after-F5');await capture('resumed-after-F5');
    await save();await waitSaved();
    const recoveredState=await api('/api/state'),recovered=recoveredState.state.jobs.filter(job=>job.name===name);
    assert.deepEqual(recovered,committed,'Retry after reopening and F5 retains the original UUID and every saved field');
    assert.equal(recoveredState.revision,committedState.revision,'Closure, reload and acknowledgement perform no hidden workspace write');
    assert.equal(await run(`globalThis[${JSON.stringify(probeKey)}].puts`,'put-count-after-reload'),0,'Recovery after F5 acknowledges the existing commit without another PUT');
    await openNew();
    assert.equal(await run('document.querySelector("#modalbody [name=name]").value','fresh-name'),'','Acknowledgement clears the pending creation');
    assert.equal(await run('document.querySelector("#modalbody [name=name]").readOnly','fresh-name-unlocked'),false,'An intentional new job is editable after recovery');
  });

  await scenario('storage-unavailable',412,async({run,api,save,openNew,fill,noOverflow,customer})=>{
    const name='QA21 storage blocked '+token;
    await openNew();await fill(customer,name);
    const before=await api('/api/state');
    await run(`(()=>{const p={original:serverJson,puts:0,originalSetItem:Storage.prototype.setItem};p.wrapper=async function(url,options={}){if(new URL(String(url),location.href).pathname==='/api/state'&&String(options.method||'GET').toUpperCase()==='PUT')p.puts++;return p.original.apply(this,arguments)};p.storageWrapper=function(){if(this===sessionStorage)throw new DOMException('QA21 stockage indisponible','QuotaExceededError');return p.originalSetItem.apply(this,arguments)};serverJson=p.wrapper;Storage.prototype.setItem=p.storageWrapper;globalThis[${JSON.stringify(probeKey)}]=p})()`,'deny-recovery-storage');
    await save();
    await waitFor(()=>run('Boolean(document.querySelector("#commercialJobError")?.textContent)','storage-error-visible'),'Storage failure is visible instead of sending an unrecoverable request');
    assert.equal(await run(`globalThis[${JSON.stringify(probeKey)}].puts`,'storage-put-count'),0,'Unavailable recovery storage prevents every PUT attempt');
    assert.deepEqual(await api('/api/state'),before,'Storage failure leaves the persisted workspace and revision exact');
    assert.equal(await run('document.querySelector("#modalbody [name=name]").value','retained-name'),name,'Input is retained on definite non-submission');
    assert.equal(await run('document.querySelector("#modalbody [name=name]").readOnly','editable-after-non-submission'),false,'A definitely unsent operation remains editable');
    await noOverflow('storage-error');
  });

  await scenario('opaque-identities',1440,async({tab,run,api,save,openNew,fill,waitSaved,customer})=>{
    const source=await api('/api/state'),personId='QA21-person-'+token,teamId='QA21-team-'+token,name='QA21 opaque '+token;
    assert.ok(source.state.people.length&&source.state.teams.length,'Fixture needs a person and a team to extend');
    const numericPerson=source.state.people.find(person=>typeof person.id==='number'),numericTeam=source.state.teams.find(team=>typeof team.id==='number');
    assert.ok(numericPerson&&numericTeam,'Existing numeric identifiers cover backward compatibility');
    source.state.people.push({...structuredClone(numericPerson),id:personId,name:'QA21 responsable opaque '+token});
    source.state.teams.push({...structuredClone(numericTeam),id:teamId,name:'QA21 équipe opaque '+token,members:[personId]});
    await api('/api/state','PUT',{revision:source.revision,state:source.state});
    await tab.reload();await waitForApp(tab);
    await openNew();await fill(customer,name,{responsibleId:personId});
    await run(`(()=>{const fields=[...document.querySelectorAll('#modalbody [name=teamIds]')];for(const e of fields){e.checked=[${JSON.stringify(teamId)},${JSON.stringify(String(numericTeam.id))}].includes(e.value);e.dispatchEvent(new Event('change',{bubbles:true}))}if(fields.filter(e=>e.checked).length!==2)throw Error('Les deux équipes doivent être disponibles')})()`,'choose-mixed-team-ids');
    await save();await waitSaved();
    const saved=(await api('/api/state')).state.jobs.filter(job=>job.name===name);
    assert.equal(saved.length,1,'One job saved with selected identities');
    assert.equal(saved[0].responsibleId,personId,'Opaque responsible ID survives actual form submission');
    assert.deepEqual(saved[0].teamIds.map(String).sort(),[teamId,String(numericTeam.id)].sort(),'Both opaque and numeric team identities survive submission');
    assert.ok(saved[0].teamIds.some(id=>id===numericTeam.id),'Numeric team identity retains its original type');
    await tab.reload();await waitForApp(tab);
    // Opening the existing public form also checks that persisted identities are
    // rendered as selected, rather than silently reverting to "À définir".
    await run(`jobForm(${JSON.stringify(saved[0].id)})`,'open-saved-job');
    await waitFor(()=>run('Boolean(document.querySelector("#modal[open] form [name=responsibleId]"))','saved-form-ready'),'Saved job form ready');
    assert.equal(await run('document.querySelector("#modalbody [name=responsibleId]").value','selected-responsible'),personId,'Saved responsible remains selected after reload');
    assert.deepEqual((await run('[...document.querySelectorAll("#modalbody [name=teamIds]:checked")].map(e=>e.value)','selected-teams')).sort(),[teamId,String(numericTeam.id)].sort(),'Saved teams remain selected after reload');
    await fill(customer,name+' numeric',{responsibleId:String(numericPerson.id)});await save();await waitSaved();
    assert.equal((await api('/api/state')).state.jobs.find(job=>job.id===saved[0].id).responsibleId,numericPerson.id,'Existing numeric responsible IDs retain their original type');
  });

  await scenario('late-response',1440,async({run,api,capture,click,save,openNew,fill,customer})=>{
    const nameA='QA21 response A '+token,nameB='QA21 draft B '+token;
    await openNew();await fill(customer,nameA);
    await run(`(()=>{const p={original:serverJson,captured:null,puts:0,returned:false,released:false};p.hold=new Promise(resolve=>{p.release=()=>{p.released=true;resolve()}});p.wrapper=async function(url,options={}){const result=await p.original.apply(this,arguments);let body;try{body=JSON.parse(options.body)}catch{}if(new URL(String(url),location.href).pathname==='/api/state'&&String(options.method||'GET').toUpperCase()==='PUT'&&body?.state?.jobs?.some(job=>job.name===${JSON.stringify(nameA)})){p.puts++;if(!p.captured){p.captured=result;await p.hold;p.returned=true}}return result};serverJson=p.wrapper;globalThis[${JSON.stringify(probeKey)}]=p})()`,'hold-real-committed-response');
    await save();
    await waitFor(()=>run(`Boolean(globalThis[${JSON.stringify(probeKey)}].captured?.revision)`,'response-held'),'Actual server response is held before UI continuation');
    assert.equal((await api('/api/state')).state.jobs.filter(job=>job.name===nameA).length,1,'A is really committed before closing its dialog');
    await click('document.querySelector("#modal[open] .modal-top .close")','close-A');
    await waitFor(()=>run('!document.querySelector("#modal[open]")','A-closed'),'A dialog closes through its real close button');
    // "New job" intentionally resumes pending A. Use the distinct quote editor
    // B so this tests another form's ownership, not the recovery of A itself.
    await run('navigate("quotes")','navigate-quotes-B');
    await waitFor(()=>run('view==="quotes"&&iaCQuotesState==="ready"','quotes-B-ready'),'Quote list ready');
    await click('[...document.querySelectorAll("#main button")].find(e=>e.getAttribute("onclick")==="quoteForm()")','new-quote-B');
    await waitFor(()=>run('Boolean(document.querySelector("#modal[open] form.quote-editor [name=title]"))','quote-B-form-ready'),'Distinct quote editor B ready');
    await run(`(()=>{const form=document.querySelector('#modal[open] form.quote-editor');for(const [name,value]of Object.entries(${JSON.stringify({title:nameB,clientAddress:'B doit rester dans le formulaire',notes:'Saisie non envoyée du devis B'})})){const field=form.querySelector('[name="'+name+'"]');if(!field)throw Error('Champ devis absent: '+name);field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}))}})()`,'fill-distinct-quote-B');
    const before=await run(`(()=>{const p=globalThis[${JSON.stringify(probeKey)}],form=document.querySelector('#modal[open] form');p.formB=form;return [...new FormData(form).entries()]})()`,'draft-B-before-response');
    await capture('draft-B-held');
    await run(`(async()=>{const p=globalThis[${JSON.stringify(probeKey)}];p.release();await new Promise(resolve=>setTimeout(resolve,0))})()`,'release-A');
    await waitFor(()=>run(`globalThis[${JSON.stringify(probeKey)}].returned`,'A-returned'),'Held transport returns to its original caller');
    const after=await run(`(async()=>{await new Promise(resolve=>setTimeout(resolve,0));const p=globalThis[${JSON.stringify(probeKey)}],form=document.querySelector('#modal[open] form');return{sameForm:form===p.formB,values:form?[...new FormData(form).entries()]:null}})()`,'draft-B-after-response');
    assert.equal(after.sameForm,true,'Late success for A must not close or replace the newer form B');
    assert.deepEqual(after.values,before,'Every unsaved field in B survives A’s late response');
    const state=await api('/api/state');
    assert.equal(state.state.jobs.filter(job=>job.name===nameA).length,1,'A remains committed exactly once');
    assert.equal((await api('/api/quotes')).quotes.filter(quote=>quote.title===nameB).length,0,'Unsubmitted quote B is not sent by A’s continuation');
    assert.equal(await run(`globalThis[${JSON.stringify(probeKey)}].puts`,'A-put-count'),1,'Late continuation performs no extra PUT');
    await capture('draft-B-preserved');
  });
}finally{await browser.close()}

console.log('LOT21_SAFETY: '+passed+' scenarios passed, '+failures.length+' failed.');
if(failures.length)throw new AggregateError(failures,'Independent lot21 safety failures: '+failures.map(error=>error.message).join(' | '));
