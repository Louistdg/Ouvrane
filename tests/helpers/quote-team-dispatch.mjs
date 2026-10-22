import assert from 'node:assert/strict';
import {waitFor,waitForApp} from './browser-cdp.mjs';

// One real UI dispatch, on the existing disposable Browser Gate workspace.
// No injected team, reminder, quote projection, or replacement history.
export async function verifyQuoteTeamDispatch(tab,{base}) {
  const origin=new URL(base).origin;
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'Use only the isolated local Browser Gate copy.');
  const token=Date.now().toString()+'-'+Math.random().toString(16).slice(2,8);
  const note='QA transmission équipe '+token+' : vérifier les cotes avant intervention.';
  const quoteReference='QA-TEAM-'+token;
  const run=(source,label)=>tab.evaluate(source,'quote-team-dispatch:'+label);
  const api=(path,method='GET',body)=>run(`serverJson(${JSON.stringify(path)},{method:${JSON.stringify(method)},${body===undefined?'':`body:JSON.stringify(${JSON.stringify(body)}),`}})`,'api-'+path);
  assert.equal(await run('location.origin','local-tab-origin'),origin,'The tab must already belong to the supplied local gate.');
  assert.equal(await run('Boolean(globalThis.socleAccessPreview)','no-access-preview'),false,'Use a real owner login, not a role preview.');
  const login=await run(`fetch('/__local-test/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'direction@batinova.example'})}).then(r=>r.status)`,'owner-local-login');
  assert.equal(login,204,'The existing local-test owner login must succeed.');
  const initial=await api('/api/state');
  assert.equal(initial.access?.roleCode,'OWNER','The authenticated API actor must be OWNER.');
  assert.ok(Array.isArray(initial.state?.quotes)&&initial.state.quotes.length>0,'Preserve the gate copy\'s existing history, without manufacturing a seed.');
  const history=structuredClone(initial.state.quotes);
  await run('loadWorkspace()','load-owner-workspace');
  await waitForApp(tab,String(initial.access.userId));
  await run("if(document.querySelector('#modal')?.open)closeModal();navigate('home')",'neutral-owner-view');
  const loaded=await api('/api/state');
  assert.deepEqual(loaded.state.quotes,history,'Loading the owner workspace must preserve every historical quote field.');
  const job=(loaded.state.jobs||[]).find(item=>/^BATXL-PRJ-/.test(String(item.id)));
  assert.ok(job,'Reuse an actual historical BATXL chantier with its text ID.');
  const peopleById=new Map((loaded.state.people||[]).map(person=>[String(person.id),person]));
  const team=(loaded.state.teams||[]).find(item=>Array.isArray(item.members)&&item.members.length>0&&item.members.every(id=>peopleById.has(String(id))));
  assert.ok(team,'Reuse an actual team whose members all exist in this workspace.');
  const expectedRecipients=[...new Set(team.members)];
  const expectedNames=expectedRecipients.map(id=>peopleById.get(String(id)).name).filter(Boolean);
  const date=new Date().toISOString().slice(0,10),validUntil=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  const customer=(await api('/api/customers','POST',{type:'individual',firstName:'QA',lastName:'Transmission '+token,street:'Rue du contrôle 13',postalCode:'5000',city:'Namur',country:'BE'})).customer;
  assert.ok(customer?.id,'Create the canonical customer through the real API.');
  const quote=(await api('/api/quotes','POST',{
    projectId:String(job.id),customerId:String(customer.id),reference:quoteReference,
    title:'Transmission réelle sans prix '+token,client:'QA Transmission '+token,
    clientAddress:'Rue du contrôle 13, 5000 Namur',date,validUntil,status:'draft',
    lines:[{label:'Contrôle des cotes',description:'Fiche destinée à une vraie équipe existante',qty:2,unit:'pièce',price:731.29,vat:21}]
  })).quote;
  assert.match(String(quote?.id||''),/^quote-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,'Exercise the actual text UUID quote ID, not a numeric substitute.');
  assert.equal(String(quote.projectId),String(job.id));
  assert.equal(String(quote.customerId),String(customer.id));
  assert.equal(history.some(item=>String(item.id)===String(quote.id)),false,'The new SQL quote must not already be historical.');

  // The API fixture was created outside the UI editor; reload through the real
  // application loader instead of injecting it into the display cache.
  await tab.reload();await waitForApp(tab,String(initial.access.userId));
  const touch=await run('navigator.maxTouchPoints>0','current-input-mode');
  async function click(expression,label) {
    const point=await waitFor(()=>run(`(()=>{const e=${expression};if(!e||e.disabled||e.getAttribute('aria-disabled')==='true')return null;e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,t=document.elementFromPoint(x,y);return r.width>0&&r.height>0&&(t===e||e.contains(t))?{x,y}:null})()`,label+'-point'),'Visible unobscured control: '+label,10000);
    if(touch){
      await tab.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
      await tab.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }else{
      await tab.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
      await tab.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
      await tab.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
    }
  }
  await run("navigate('quotes')",'load-quotes-view');
  await waitFor(()=>run('view==="quotes"&&iaCQuotesState==="ready"&&Boolean(document.querySelector("#main .quote-list"))','quotes-ready'),'Real Quotes list loaded',20000);
  // Filter the real list through its input; its subsequent row click must use
  // the production ID binding, including the quote UUID and BATXL project.
  await run(`(()=>{const input=document.querySelector('#main input[placeholder="Rechercher référence, client, chantier…"]');if(!input)throw Error('Missing quote search input');input.value=${JSON.stringify(quoteReference)};input.dispatchEvent(new Event('input',{bubbles:true}))})()`,'search-created-quote');
  const row=`[...document.querySelectorAll('#main .quote-list-row')].find(e=>e.querySelector('b')?.textContent.trim()===${JSON.stringify(quoteReference)})`;
  await click(row,'real-quote-row');
  await waitFor(()=>run(`Boolean(document.querySelector('#modal')?.open)&&document.querySelector('#modalbody')?.innerText.includes(${JSON.stringify(quoteReference)})`,'quote-detail-visible'),'The real created quote detail opens');
  await click('[...document.querySelectorAll("#modalbody .modal-actions button")].find(e=>/version\\s+équipe|sans\\s+prix/i.test(e.textContent))','real-worker-version');
  await waitFor(()=>run('Boolean(document.querySelector("#modalbody .worker-sheet"))','worker-sheet-visible'),'The actual canonical execution view opens');
  assert.equal(await run('Boolean(document.querySelector("#modalbody .edit-team-note"))','no-unsaved-standalone-note'),false,'Do not expose the disabled standalone SQL note action.');
  await click('[...document.querySelectorAll("#modalbody .modal-actions button")].find(e=>/Retour au devis complet/i.test(e.textContent))','real-return-to-quote');
  await waitFor(()=>run('Boolean(document.querySelector("#modalbody .quote-paper"))','return-to-full-quote'),'Return to the canonical quote works with its UUID');
  await click('document.querySelector("#modalbody .send-worker-quote")','real-send-to-team');
  await waitFor(()=>run('Boolean(document.querySelector("#modal[open] #modalbody form select[name=team]"))&&Boolean(document.querySelector("#modalbody form textarea[name=message]"))','team-form-visible'),'The real team dispatch form opens with the UUID quote ID');
  const filled=await run(`(()=>{const form=document.querySelector('#modalbody form'),select=form.querySelector('select[name=team]'),message=form.querySelector('textarea[name=message]');if(![...select.options].some(o=>o.value===${JSON.stringify(String(team.id))}))throw Error('The real BATXL team is missing from the selector');select.value=${JSON.stringify(String(team.id))};select.dispatchEvent(new Event('change',{bubbles:true}));message.value=${JSON.stringify(note)};message.dispatchEvent(new Event('input',{bubbles:true}));return {team:select.value,message:message.value,valid:form.checkValidity(),text:form.innerText}})()`,'choose-real-team-and-note');
  assert.equal(filled.team,String(team.id));assert.equal(filled.message,note);assert.equal(filled.valid,true);
  assert.match(filled.text,/sans\s+prix/i,'The dispatch form must state the execution sheet has no prices.');
  assert.doesNotMatch(filled.text,/731[.,]29/,'The dispatch form must not reproduce the quote line price.');
  const beforeDispatch=await api('/api/state');
  assert.deepEqual(beforeDispatch.state.quotes,history);
  const beforeReminderIds=new Set((beforeDispatch.state.reminders||[]).map(item=>String(item.id)));
  await click('document.querySelector("#modalbody form button.primary")','real-submit-team-dispatch');
  await waitFor(()=>run(`!document.querySelector('#modal')?.open&&reminders.some(item=>String(item.quoteId)===${JSON.stringify(String(quote.id))}&&item.note===${JSON.stringify(note)})`,'team-alert-created'),'A real dispatch adds its reminder and closes the form');
  await run('(async()=>{if(!storageReady)throw Error("Workspace not ready");clearTimeout(saveTimer);await saveWorkspace()})()','flush-real-autosave');
  await waitFor(()=>run('storageReady&&!saveRunning&&!saveFailed&&!storageConflict&&workspaceSnapshot()===savedSnapshot','autosave-acknowledged'),'Team alert workspace save acknowledged',12000);

  const forbidden=new Set(['price','unitprice','unitpricecents','amount','amountcents','subtotal','subtotalcents','netamount','grossamount','total','totalcents','totalht','totalhtva','totalttc','totaltvac','vat','vatrate','vatamount','taxamount','deposit','depositpercent','paymentterms','cost','costprice','purchaseprice','deliveredcost','margin','markup','sourcepriceobserved','sourcevatincluded']);
  function checkReminder(state,label) {
    assert.deepEqual(state.quotes,history,label+': every original historical quote and line must be exactly preserved.');
    assert.equal(state.quotes.some(item=>String(item.id)===String(quote.id)),false,label+': SQL quote must never be copied into historical workspace quotes.');
    const matches=(state.reminders||[]).filter(item=>String(item.quoteId)===String(quote.id)&&item.note===note);
    assert.equal(matches.length,1,label+': exactly one durable reminder for this dispatch.');
    const reminder=matches[0];
    assert.equal(beforeReminderIds.has(String(reminder.id)),false,label+': the dispatch must create a new reminder.');
    assert.equal(String(reminder.quoteId),String(quote.id));assert.equal(reminder.note,note);
    assert.deepEqual(reminder.recipientIds,expectedRecipients,label+': preserve the actual team member IDs and their types.');
    assert.deepEqual(reminder.recipientNames,expectedNames,label+': resolve the real people, without manufactured recipients.');
    assert.equal(reminder.owner,team.name);assert.equal(reminder.linkType,'job');assert.equal(String(reminder.linkId),String(job.id));assert.equal(reminder.state,'todo');
    const leaked=[];
    function inspect(value,path='reminder') {
      if(!value||typeof value!=='object')return;
      for(const [key,child] of Object.entries(value)){
        if(forbidden.has(key.replace(/[_-]/g,'').toLowerCase()))leaked.push(path+'.'+key);
        inspect(child,path+'.'+key);
      }
    }
    inspect(reminder);
    assert.deepEqual(leaked,[],label+': the reminder must contain no price, total, VAT, or monetary provenance fields.');
    assert.doesNotMatch(JSON.stringify(reminder),/731[.,]29/,label+': no embedded quote price.');
    return reminder;
  }
  const persisted=await api('/api/state');
  const reminder=checkReminder(persisted.state,'GET after autosave');
  await tab.reload();
  await waitForApp(tab,String(initial.access.userId));
  const reloaded=await api('/api/state');
  assert.equal(reloaded.access?.roleCode,'OWNER');
  assert.equal(String(reloaded.organizationId),String(initial.organizationId));
  assert.deepEqual(checkReminder(reloaded.state,'GET after reload'),reminder,'The exact reminder must survive a full document reload.');
  const restored=await run(`({reminder:reminders.find(item=>String(item.id)===${JSON.stringify(String(reminder.id))}),history:JSON.parse(workspaceSnapshot()).quotes})`,'restored-durable-reminder');
  assert.deepEqual(restored.reminder,reminder,'The loaded application must restore the durable team alert.');
  assert.deepEqual(restored.history,history,'The reloaded application snapshot must retain the full original quote history.');
  const sqlAfter=(await api('/api/quotes/'+encodeURIComponent(quote.id))).quote;
  assert.deepEqual(sqlAfter,quote,'Sending an execution alert must not rewrite the SQL commercial document.');
  console.log('PASS quote team dispatch: real UUID row / without-prices / return / Envoyer équipe / existing team / submit clicks; one durable no-price reminder survives reload; exact historical quotes preserved; no SQL copy.');
  return {quoteId:String(quote.id),customerId:String(customer.id),reminderId:String(reminder.id),teamId:String(team.id),recipientIds:expectedRecipients};
}
