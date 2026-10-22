// One source directory and a separate display projection for independent
// canonical customers. Never serialize that projection into contacts.
let commercialDirectoryState={status:'idle',key:'',initialized:false,links:[],suppliers:[],archivedCustomers:[],error:'',promise:null};
let commercialWriteDepth=0;
let commercialIndependentContact=null;
const commercialIndependentStatusOperations=new Map();
function commercialHas(permission){const access=globalThis.socleCurrentAccess;return Boolean(access&&(access.owner||access.permissions?.includes(permission)))}
function commercialCanWrite(permission){return !globalThis.socleAccessPreview&&commercialHas(permission)}
function commercialCurrent(key){return key===e2e02CustomerContext()}
function commercialResetDirectory(){commercialDirectoryState={status:'idle',key:'',initialized:false,links:[],suppliers:[],archivedCustomers:[],error:'',promise:null};e2e02InvalidateCustomers()}
const commercialRestoreBase=restoreWorkspace;
restoreWorkspace=function(state){if(document.querySelector('#modal[open]'))closeModal();commercialIndependentContact=null;commercialIndependentStatusOperations.clear();commercialResetDirectory();commercialRestoreBase(state);if(company.blankWorkspace)ensureBlankRecords()};
const commercialScheduleBase=scheduleSave;
scheduleSave=function(){if(!commercialWriteDepth)return commercialScheduleBase()};
const commercialSaveWorkspaceBase=saveWorkspace;
saveWorkspace=async function(...args){if(!commercialWriteDepth)return commercialSaveWorkspaceBase(...args)};

async function commercialFlushWorkspace(){
  if(!storageReady||storageConflict||globalThis.socleAccessPreview)throw Error('Rechargez le dossier avant de modifier cette fiche.');
  clearTimeout(saveTimer);
  const scope=iaCQuoteScope(),generation=iaCQuoteWorkspaceGeneration,deadline=Date.now()+15000;
  while(saveRunning){if(Date.now()>deadline)throw Error('Une sauvegarde est encore en cours. Réessayez dans un instant.');await new Promise(resolve=>setTimeout(resolve,50));if(scope!==iaCQuoteScope()||generation!==iaCQuoteWorkspaceGeneration)throw Object.assign(Error('Le contexte a changé.'),{staleContext:true})}
  if(workspaceSnapshot()!==savedSnapshot||saveFailed){
    if(globalThis.socleLimitedSession)throw Error('Des modifications locales ne sont pas enregistrées. Rechargez le dossier avant de reprendre.');
    await saveWorkspace();
    if(saveFailed||storageConflict||workspaceSnapshot()!==savedSnapshot)throw Error('Terminez la sauvegarde du dossier avant de reprendre cette fiche.');
  }
  if(scope!==iaCQuoteScope()||generation!==iaCQuoteWorkspaceGeneration)throw Object.assign(Error('Le contexte a changé.'),{staleContext:true});
}
async function commercialLoadDirectory({force=false}={}){
  if(!commercialHas('customers.view'))return false;
  const key=e2e02CustomerContext();
  if(!force&&commercialDirectoryState.key===key&&commercialDirectoryState.status==='ready')return true;
  if(commercialDirectoryState.key===key&&commercialDirectoryState.status==='loading')return commercialDirectoryState.promise;
  if(force)e2e02InvalidateCustomers();
  const state={status:'loading',key,initialized:false,links:[],suppliers:[],archivedCustomers:[],error:'',promise:null};commercialDirectoryState=state;
  state.promise=Promise.all([serverJson('/api/commercial-directory'),e2e02EnsureCustomers(),commercialHas('expenses.view')?serverJson('/api/suppliers?limit=250'):Promise.resolve({suppliers:[]}),serverJson('/api/customers?status=archived&limit=250')]).then(([directory,,suppliers,archived])=>{
    if(!commercialCurrent(key)||commercialDirectoryState!==state)return false;
    state.initialized=Boolean(directory.initialized);state.links=Array.isArray(directory.links)?directory.links:[];state.suppliers=Array.isArray(suppliers.suppliers)?suppliers.suppliers:[];state.archivedCustomers=Array.isArray(archived.customers)?archived.customers:[];state.status='ready';return true;
  }).catch(error=>{if(commercialCurrent(key)&&commercialDirectoryState===state){state.status='error';state.error=error.message||'Annuaire indisponible.'}return false}).finally(()=>{
    if(commercialDirectoryState===state&&['contacts','contact'].includes(view))render();
  });
  return state.promise;
}
function commercialDirectoryNotice(){
  if(!commercialHas('customers.view'))return '';
  const state=commercialDirectoryState;
  if(state.key!==e2e02CustomerContext()||state.status==='idle'){queueMicrotask(()=>commercialLoadDirectory());return '<p class="notice" role="status">Chargement des fiches clients…</p>'}
  if(state.status==='loading')return '<p class="notice" role="status">Chargement des fiches clients…</p>';
  if(state.status==='error')return '<p class="notice" role="alert">'+esc(state.error)+' <button type="button" class="btn" onclick="commercialLoadDirectory({force:true})">Réessayer</button></p>';
  if(state.initialized)return '';
  return '<section class="panel"><p>Retrouvez les mêmes clients dans les devis, les visites et les chantiers.</p>'+(commercialCanWrite('customers.edit')&&globalThis.socleCurrentAccess?.owner?'<button type="button" id="commercialDirectoryBootstrap" class="btn primary" onclick="commercialBootstrap(this)">Relier mes fiches clients</button>':'<p class="notice">Le responsable doit d’abord relier les fiches clients existantes.</p>')+'</section>';
}
async function commercialBootstrap(button){
  if(!globalThis.socleCurrentAccess?.owner||globalThis.socleAccessPreview)return denyAccess('Seul le responsable peut relier les fiches existantes.');
  let key='';
  try{
    await commercialFlushWorkspace();key=e2e02CustomerContext();if(button)button.disabled=true;
    const pending=button?._commercialBootstrap||(button._commercialBootstrap={revision:storageRevision,operationKey:'directory-'+crypto.randomUUID()});
    commercialWriteDepth++;clearTimeout(saveTimer);
    await serverJson('/api/commercial-directory/bootstrap',{method:'POST',body:JSON.stringify(pending)});
    if(!commercialCurrent(key))return;
    commercialResetDirectory();await commercialLoadDirectory({force:true});
    if(document.querySelector('#modal[open] form[data-commercial-contact]')){
      document.querySelector('#modalbody [data-commercial-bootstrap-notice]')?.remove();
      document.querySelector('#modalbody form .modal-actions button.primary')?.removeAttribute('disabled');
    }
    render();toast('Fiches clients reliées aux devis et aux chantiers.');
  }catch(error){if(!error.staleContext&&(!key||commercialCurrent(key)))toast(error.message||'Le raccord des fiches a échoué. Réessayez.')}
  finally{commercialWriteDepth=Math.max(0,commercialWriteDepth-1);if(button?.isConnected)button.disabled=false;scheduleSave()}
}

const commercialModuleForViewBase=moduleForView;
moduleForView=function(target){if(['contacts','contact'].includes(target)&&commercialHas('customers.view'))return 'quotes';return commercialModuleForViewBase(target)};
const commercialNavigateBase=navigate;
navigate=function(target){
  if(target==='contacts'&&view!=='contacts'&&canViewModule(target))commercialResetDirectory();
  return commercialNavigateBase.apply(this,arguments);
};
let commercialContactStatus='active';
function commercialContactIsActive(contact){return contact.active!==false&&contact.active!==0&&!['inactive','archived','deleted'].includes(String(contact.status||'').toLowerCase())}
function commercialContactProjection(){
  const sourceIds=new Set(contacts.map(contact=>String(contact.id)));
  const canonical=[...new Map([...iaCCustomers,...(commercialCurrent(commercialDirectoryState.key)?commercialDirectoryState.archivedCustomers:[])].map(customer=>[String(customer.id),customer])).values()];
  const independent=commercialHas('customers.view')?canonical.filter(customer=>!customer.sourceContactId||!sourceIds.has(String(customer.sourceContactId))).map(customer=>({id:'canonical:'+customer.id,name:e2e02CustomerLabel(customer),company:customer.companyName,roles:['Client'],email:customer.email,phone:customer.phone,active:!customer.archivedAt,_canonicalCustomer:customer})):[];
  const suppliers=commercialHas('expenses.view')&&commercialCurrent(commercialDirectoryState.key)?commercialDirectoryState.suppliers.map(supplier=>({id:'supplier:'+supplier.id,name:supplier.name,roles:['Fournisseur'],email:supplier.email,phone:supplier.phone,vatNumber:supplier.vatNumber,active:!supplier.archivedAt,_canonicalSupplier:supplier})):[];
  return [...contacts,...independent,...suppliers];
}
contactsView=function(){
  const notice=commercialDirectoryNotice(),query=String(contactQuery||'').trim().toLowerCase(),all=commercialContactProjection();
  const filtered=all.filter(c=>(contactRole==='Tous'||(c.roles||[]).includes(contactRole))&&(commercialContactStatus==='all'||commercialContactIsActive(c)===(commercialContactStatus==='active'))&&[c.name,c.company,c.phone,c.email,c.reference,c.vatNumber,...(c.roles||[])].join(' ').toLowerCase().includes(query)).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'fr',{sensitivity:'base'}));
  const visible=filtered.slice(0,iaCContactVisibleCount),remaining=filtered.length-visible.length;
  const roleChoices=[...new Set(['Tous','Client','Prospect',...roles,...contacts.flatMap(c=>c.roles||[])])];
  return heading('Contacts','Clients, architectes, fournisseurs et sous-traitants.',false)+notice+
    '<div class="catalogue-tools"><input placeholder="Rechercher un contact…" value="'+esc(contactQuery)+'" oninput="contactQuery=this.value;iaCContactVisibleCount=5;render()">'+
    '<select aria-label="État des fiches" onchange="commercialContactStatus=this.value;iaCContactVisibleCount=5;render()">'+[['active','Fiches actives'],['inactive','Fiches inactives'],['all','Toutes les fiches']].map(([value,label])=>'<option value="'+value+'" '+(commercialContactStatus===value?'selected':'')+'>'+label+'</option>').join('')+'</select>'+
    (globalThis.socleCurrentAccess?.owner&&!globalThis.socleAccessPreview?'<label class="btn upload">Importer CSV<input type="file" accept=".csv,text/csv" onchange="importContactsCsv(event)"></label>':'')+
    (commercialCanWrite('customers.create')?'<button class="btn primary" type="button" onclick="contactForm()">+ Nouveau contact</button>':'')+'</div>'+
    '<div class="filter-pills">'+roleChoices.map(role=>'<button class="'+(contactRole===role?'selected':'')+'" onclick="contactRole=\''+jsString(role)+'\';iaCContactVisibleCount=5;render()">'+esc(role)+'</button>').join('')+'</div>'+
    '<section class="panel"><div class="panel-head"><h2>'+filtered.length+' contact(s)</h2><span class="subtle">A→Z · recherche · fiche détaillée</span></div>'+
    visible.map(c=>'<button class="task" data-contact-id="'+esc(c.id)+'" onclick="openContact(\''+jsString(String(c.id))+'\')"><span class="task-text"><strong>'+esc(c.name)+'</strong><small>'+esc(c.company||(c.roles||[]).join(' · '))+' · '+esc(c.phone||c.email||'Coordonnées à renseigner')+'</small></span><span class="badge">'+esc(!commercialContactIsActive(c)?'Inactive':(c.roles||[]).join(' · '))+'</span></button>').join('')+
    (!visible.length?'<div class="empty">Aucune fiche ne correspond à la recherche.</div>':'')+
    (remaining?'<div class="ia-c-list-more"><button class="btn" onclick="iaCContactVisibleCount='+all.length+';render()">Afficher les '+remaining+' autres</button></div>':'')+'</section>';
};
const commercialOpenContactBase=openContact;
openContact=function(id){
  const row=commercialContactProjection().find(c=>String(c.id)===String(id));
  if(row?._canonicalSupplier){
    const supplier=row._canonicalSupplier;
    return modal(supplier.name,'<p>'+esc([supplier.street,[supplier.postalCode,supplier.city].filter(Boolean).join(' ')].filter(Boolean).join(', '))+'</p><p>'+esc([supplier.email,supplier.phone].filter(Boolean).join(' · '))+'</p>'+(supplier.vatNumber?'<p>TVA : '+esc(supplier.vatNumber)+'</p>':''));
  }
  if(!row?._canonicalCustomer){commercialIndependentContact=null;return commercialOpenContactBase(id)}
  commercialIndependentContact={customer:row._canonicalCustomer,scope:iaCQuoteScope(),generation:iaCQuoteWorkspaceGeneration};
  currentContactId=String(row.id);view='contact';render();
};
function commercialContactQuoteLink(quote){
  return '<button type="button" class="detail-row contact-history-quote" data-contact-quote-id="'+esc(String(quote.id))+'" data-contact-quote-historical="'+String(iaCIsHistoricalQuote(quote.id))+'"><span><strong>'+esc(quote.ref||quote.title||'Devis')+'</strong><small>'+esc([quote.title,quote.status].filter(Boolean).join(' · '))+'</small></span><span>'+(quote.amount!=null?'<b>'+money(quote.amount)+'</b>':'')+' <span aria-hidden="true">↗</span></span></button>';
}
let commercialQuoteNavigationSequence=0;
async function commercialOpenContactQuote(id,historical){
  if(!commercialHas('quotes.view'))return denyAccess('Vous ne pouvez pas consulter les devis.');
  const sequence=++commercialQuoteNavigationSequence,scope=iaCQuoteScope(),generation=iaCQuoteWorkspaceGeneration,contactId=String(currentContactId);
  const current=()=>sequence===commercialQuoteNavigationSequence&&scope===iaCQuoteScope()&&generation===iaCQuoteWorkspaceGeneration&&view==='contact'&&String(currentContactId)===contactId&&!document.querySelector('#modal[open]');
  try{
    const result=await serverJson((historical?'/api/quote-history/':'/api/quotes/')+encodeURIComponent(id));if(!current())return;
    const q=result.quote;if(!q||String(q.id)!==String(id))throw Error('Le devis demandé n’a pas pu être retrouvé.');
    const display=historical?iaCHistoricalQuoteProjection(contacts,[q])[0]:{...q,ref:q.reference,status:iaCQuoteStatusLabel(q.status),serverStatus:q.status,job:q.projectId};
    const index=quotes.findIndex(item=>String(item.id)===String(id));if(index>=0)quotes[index]=display;else quotes.push(display);
    if(!historical)iaCServerQuoteIds.add(String(q.id));
    if(result.pricesVisible===false)showWorkerQuote(display.id);else showQuote(display.id);
  }catch(error){if(current())toast(error.message||'Devis indisponible. Réessayez.')}
}
document.addEventListener('click',event=>{
  const status=event.target.closest?.('#main [data-customer-status]');
  if(status){event.preventDefault();commercialSetIndependentStatus(status.dataset.customerStatus);return}
  const edit=event.target.closest?.('#main .contact-actions [data-commercial-contact-edit]');
  if(edit){event.preventDefault();contactForm(edit.dataset.commercialContactEdit);return}
  const button=event.target.closest?.('#main [data-contact-commercial-history] [data-contact-quote-id]');if(!button)return;
  event.preventDefault();commercialOpenContactQuote(button.dataset.contactQuoteId,button.dataset.contactQuoteHistorical==='true');
});
function commercialCustomerIdForContact(contact){return commercialDirectoryState.links.find(link=>String(link.contactId)===String(contact.id))?.customerId||''}
function commercialContactHasJob(contact,job){
  const sourceId=String(contact.id),customerId=commercialCustomerIdForContact(contact);
  return String(job.clientId??'')===sourceId||(job.contactIds||[]).some(id=>String(id)===sourceId)||Boolean(customerId&&String(job.customerId||'')===customerId);
}
function commercialContactHasQuote(contact,quote){
  const sourceId=String(contact.id),customerId=commercialCustomerIdForContact(contact),original=JSON.parse(iaCWorkspaceQuoteHistory).find(item=>String(item.id)===String(quote.id));
  const record=original||quote;
  if(original&&[record.client,record.clientId,record.contactId].some(value=>value!=null&&String(value)===sourceId))return true;
  if(customerId&&String(record.customerId||'')===customerId)return true;
  const projectId=record.projectId??record.job;
  return projectId!=null&&jobs.some(job=>String(job.id)===String(projectId)&&commercialContactHasJob(contact,job));
}
contactMatches=function(contact,value){const customerId=commercialCustomerIdForContact(contact);return value!=null&&(String(value)===String(contact.id)||Boolean(customerId&&String(value)===customerId))};
const commercialContactDetailBase=contactDetail;
contactDetail=function(){
  if(commercialIndependentContact&&String(currentContactId)==='canonical:'+commercialIndependentContact.customer.id&&commercialIndependentContact.scope===iaCQuoteScope()&&commercialIndependentContact.generation===iaCQuoteWorkspaceGeneration)return commercialIndependentContactDetail();
  const contact=contacts.find(item=>String(item.id)===String(currentContactId));if(!contact)return commercialContactDetailBase();
  const notice=commercialDirectoryNotice();
  if(commercialHas('quotes.view')&&iaCQuotesState==='idle'){
    const key=e2e02CustomerContext();queueMicrotask(()=>iaCLoadQuotes().then(()=>{
      if(!commercialCurrent(key)||view!=='contact')return;
      const current=document.querySelector('#main [data-contact-commercial-history]');
      if(!current)return;
      const updated=document.createElement('div');updated.innerHTML=commercialContactDetailBase();
      const history=updated.querySelector('[data-contact-commercial-history]');if(history)current.replaceWith(history);
    }));
  }
  const host=document.createElement('div');host.innerHTML=commercialContactDetailBase();
  for(const button of host.querySelectorAll('.contact-actions button')){
    const action=button.getAttribute('onclick')||'';
    if((action.startsWith('contactForm(')&&!commercialCanWrite('customers.edit'))||(action.startsWith('mergeContactForm(')&&(!globalThis.socleCurrentAccess?.owner||globalThis.socleAccessPreview)))button.remove();
    else if(action.startsWith('contactForm(')){button.removeAttribute('onclick');button.type='button';button.dataset.commercialContactEdit=String(contact.id)}
  }
  const customerId=commercialCustomerIdForContact(contact),customer=iaCCustomers.find(item=>String(item.id)===customerId);
  if(customer&&commercialContactIsActive(contact)&&(contact.roles||[]).includes('Client')&&commercialCanWrite('quotes.create')){
    const button=document.createElement('button');button.type='button';button.className='btn primary';button.dataset.contactCreateQuote='';button.textContent='Créer un devis';button.setAttribute('onclick',"quoteFormForCustomer('"+jsString(customerId)+"')");host.querySelector('.contact-actions')?.prepend(button);
  }
  return notice+host.innerHTML;
};
const commercialMergeContactsBase=mergeContacts;
mergeContacts=function(keepId,removeId){
  if(!globalThis.socleCurrentAccess?.owner||globalThis.socleAccessPreview)return denyAccess('Seul le responsable peut fusionner des fiches sans liaison.');
  const history=JSON.parse(iaCWorkspaceQuoteHistory),linked=id=>commercialDirectoryState.links.some(link=>String(link.contactId)===String(id))||jobs.some(job=>String(job.clientId??'')===String(id)||(job.contactIds||[]).some(value=>String(value)===String(id)))||history.some(quote=>[quote.client,quote.clientId,quote.contactId].some(value=>value!=null&&String(value)===String(id)));
  if(linked(keepId)||linked(removeId))return toast('Une fiche liée aux dossiers ne peut pas être fusionnée. Désactivez la fiche à conserver dans l’historique.');
  return commercialMergeContactsBase(keepId,removeId);
};

const commercialContactFormBase=contactForm;
contactForm=async function(id=''){
  if(!commercialCanWrite(id?'customers.edit':'customers.create'))return denyAccess('Vous ne pouvez pas modifier les fiches de cet annuaire.');
  try{
    await commercialFlushWorkspace();const key=e2e02CustomerContext();const loaded=await commercialLoadDirectory({force:true});if(!commercialCurrent(key))return;if(!loaded)throw Error(commercialDirectoryState.error||'Annuaire indisponible. Réessayez.');
    const contact=contacts.find(c=>String(c.id)===String(id));commercialContactFormBase(contact?.id??id);
    const form=document.querySelector('#modalbody form');if(!form)return;
    form.dataset.commercialContact='true';form.dataset.sxManagedSave='true';form.dataset.sxDraftIdentity='contact:'+String(id||'new');form.dataset.commercialContactId=String(id);form.dataset.commercialRevision=String(storageRevision);form._commercialContext=key;
    const error=document.createElement('p');error.id='commercialContactError';error.className='form-error';error.setAttribute('role','alert');form.querySelector('.modal-actions').before(error);
    if(!commercialDirectoryState.initialized){const notice=document.createElement('div');notice.dataset.commercialBootstrapNotice='';notice.innerHTML=commercialDirectoryNotice();form.prepend(notice);form.querySelector('.modal-actions button.primary').disabled=true}
  }catch(error){if(!error.staleContext)toast(error.message||'Fiche indisponible.')}
};
function commercialAcknowledgeContact(result,pending){
  if(!commercialCurrent(pending.context))return false;
  const replace=list=>{const index=list.findIndex(item=>String(item.id)===String(result.contact.id));if(index>=0)list[index]=result.contact;else list.push(result.contact)};
  const stored=JSON.parse(pending.snapshot);stored.contacts=Array.isArray(stored.contacts)?stored.contacts:[];replace(stored.contacts);replace(contacts);
  storageRevision=result.revision;savedSnapshot=JSON.stringify(stored);saveFailed=false;
  commercialResetDirectory();return true;
}
async function commercialSaveContact(event,id,data){
  event.preventDefault();const form=event.target,error=form.querySelector('#commercialContactError'),button=form.querySelector('.modal-actions button.primary');
  if(!commercialCanWrite(id?'customers.edit':'customers.create'))return denyAccess('Cette modification n’est pas autorisée.');
  const previous=contacts.find(contact=>String(contact.id)===String(id));
  if(data.active===true&&['inactive','archived','deleted'].includes(String(previous?.status||'').toLowerCase()))data={...data,status:'active'};
  if(!data.reference||!data.name||!data.roles.length){error.textContent='Référence, nom et au moins un rôle sont obligatoires.';return}
  if(button)button.disabled=true;error.textContent='';
  try{
    if(!form._commercialOperation){
      await commercialFlushWorkspace();if(!commercialCurrent(form._commercialContext))throw Error('Le dossier a changé. Rouvrez cette fiche pour reprendre la version actuelle.');
      form._commercialOperation={context:form._commercialContext,snapshot:savedSnapshot,data:JSON.stringify(data),id:String(form.dataset.commercialContactId||id||''),payload:{revision:Number(form.dataset.commercialRevision),operationKey:'contact-'+crypto.randomUUID(),contact:data}};
    }
    commercialWriteDepth++;clearTimeout(saveTimer);
    let pending=form._commercialOperation;
    const send=operation=>serverJson('/api/commercial-contacts'+(operation.id?'/'+encodeURIComponent(operation.id):''),{method:operation.id?'PATCH':'POST',body:JSON.stringify(operation.payload)});
    let result=await send(pending);if(!commercialAcknowledgeContact(result,pending))return;
    const changedAfterFailure=pending.data!==JSON.stringify(data);form._commercialOperation=null;form._commercialContext=e2e02CustomerContext();form.dataset.commercialRevision=String(result.revision);form.dataset.commercialContactId=String(result.contact.id);
    if(changedAfterFailure){
      pending={context:e2e02CustomerContext(),snapshot:savedSnapshot,data:JSON.stringify(data),id:String(result.contact.id),payload:{revision:result.revision,operationKey:'contact-'+crypto.randomUUID(),contact:data}};form._commercialOperation=pending;
      result=await send(pending);if(!commercialAcknowledgeContact(result,pending))return;form._commercialOperation=null;
    }
    globalThis.sxAcknowledgeForm?.(form);closeModal();render();toast(result.replayed?'Fiche déjà enregistrée.':'Fiche enregistrée et disponible dans vos devis.');
  }catch(problem){if(form.isConnected&&commercialCurrent(form._commercialContext)&&!problem.staleContext){if(problem.status&&problem.status<500)form._commercialOperation=null;error.textContent=problem.message||'Enregistrement interrompu. Réessayez pour vérifier la même opération.'}}
  finally{commercialWriteDepth=Math.max(0,commercialWriteDepth-1);if(button?.isConnected)button.disabled=false;scheduleSave()}
}

// Quote and visit consumers share the same catalog and its context guard.
document.addEventListener('sx:draft-restore',event=>{
  const form=event.target;if(!form.matches?.('form.quote-editor'))return;
  const container=form.querySelector('#quoteLines'),count=event.detail?.values?.label?.values?.length;
  if(!container||!Number.isInteger(count)||count<1)return;
  while(container.querySelectorAll('.quote-edit-line').length<count)container.insertAdjacentHTML('beforeend',quoteLine());
  for(const row of [...container.querySelectorAll('.quote-edit-line')].slice(count))row.remove();
});
quoteForm=async function(id='',draftId='',preferredCustomerId=''){
  if(!canModuleAction('quotes',id?'edit':'add'))return denyAccess('Vous ne pouvez pas créer ou modifier ce devis.');
  const scope=iaCQuoteScope(),generation=iaCQuoteWorkspaceGeneration,sameActor=()=>scope===iaCQuoteScope()&&generation===iaCQuoteWorkspaceGeneration;
  try{
    await commercialFlushWorkspace();if(!sameActor())return;
    for(let attempt=0;attempt<3;attempt++){
      const key=e2e02CustomerContext();
      try{
        await e2e02EnsureCustomers();if(!sameActor())return;if(!commercialCurrent(key))continue;
        const quote=quotes.find(item=>String(item.id)===String(id));
        if(quote?.customerId&&!iaCCustomers.some(c=>String(c.id)===String(quote.customerId))){
          const data=await serverJson('/api/customers/'+encodeURIComponent(quote.customerId)+'?includeArchived=1');if(!sameActor())return;if(!commercialCurrent(key))continue;if(data.customer)iaCCustomers.push(data.customer);
        }
        if(!sameActor()||!canModuleAction('quotes',id?'edit':'add'))return;
        modal(id?'Modifier le devis':'Créer un devis',e2e02QuoteFormMarkup(id,draftId,preferredCustomerId));
        const form=document.querySelector('#modalbody form');
        if(form&&draftId){const input=document.createElement('input');input.type='hidden';input.name='sourceDraftId';input.value=String(draftId);form.append(input)}
        e2e02PrepareQuoteForm(form);
        return;
      }catch(error){if(error.staleContext&&sameActor())continue;throw error}
    }
    throw Error('Le dossier se met à jour. Réessayez dans un instant.');
  }catch(error){if(sameActor()&&!error.staleContext)toast(error.message||'Clients indisponibles.')}
};


function commercialIndependentStatusKey(customerId){return JSON.stringify([iaCQuoteScope(),iaCQuoteWorkspaceGeneration,String(customerId)])}
function commercialIndependentContactDetail(){
  const selection=commercialIndependentContact,customer=selection.customer,id=String(customer.id);
  if(iaCQuotesState==='idle')queueMicrotask(()=>iaCLoadQuotes().then(()=>{if(commercialIndependentContact===selection&&view==='contact')render()}));
  const pending=commercialIndependentStatusOperations.get(commercialIndependentStatusKey(id)),related=quotes.filter(quote=>String(quote.customerId||'')===id),linked=jobs.filter(job=>String(job.customerId||'')===id);
  const canCreate=!customer.archivedAt&&commercialCanWrite('quotes.create'),canStatus=!customer.sourceContactId&&commercialCanWrite('customers.edit');
  const history=iaCQuotesState==='error'?'<p class="notice" role="alert">'+esc(iaCQuotesError)+' <button type="button" class="btn" onclick="iaCQuotesState=\'idle\';render()">Réessayer</button></p>':iaCQuotesState!=='ready'?'<p role="status">Chargement des devis…</p>':related.map(commercialContactQuoteLink).join('')||'<div class="empty">Aucun devis associé.</div>';
  return commercialDirectoryNotice()+'<div class="contact-detail-back"><button type="button" class="btn" onclick="navigate(\'contacts\')">← Retour à l’annuaire</button></div>'+heading(e2e02CustomerLabel(customer),e2e02CustomerAddress(customer),false)+
    '<div class="contact-actions"><span class="badge '+(customer.archivedAt?'red':'green')+'">'+(customer.archivedAt?'Inactive':'Active')+'</span>'+
    (canCreate?'<button type="button" class="btn primary" data-contact-create-quote onclick="quoteFormForCustomer(\''+jsString(id)+'\')">Créer un devis</button>':'')+
    (canStatus?'<button type="button" class="btn" data-customer-status="'+esc(id)+'" '+(pending?.busy?'disabled':'')+'>'+(pending?'Vérifier l’enregistrement':customer.archivedAt?'Réactiver la fiche':'Désactiver la fiche')+'</button>':'')+'</div>'+
    (pending?.error?'<p class="notice" id="commercialCustomerStatusError" role="alert">'+esc(pending.error)+'</p>':'')+
    '<section class="panel"><div class="panel-head"><h2>Coordonnées</h2></div><p>'+esc(e2e02CustomerAddress(customer)||'Adresse à renseigner')+'</p><p>'+esc([customer.email,customer.phone].filter(Boolean).join(' · '))+'</p><p>Conditions de paiement : '+esc(customer.paymentTermsText||String(customer.paymentTermsDays??30)+' jours')+'</p>'+(customer.archivedAt?'<p class="subtle">La fiche reste disponible avec ses devis et ses chantiers. Réactivez-la pour de nouveaux devis.</p>':'')+'</section>'+
    '<section class="panel"><div class="panel-head"><h2>Chantiers associés</h2></div>'+(linked.map(job=>'<button type="button" class="task" onclick="openJobWorkspace(\''+jsString(String(job.id))+'\')"><span class="task-text"><strong>'+esc(job.name)+'</strong><small>'+esc(job.client||job.town||'')+'</small></span><span aria-hidden="true">↗</span></button>').join('')||'<div class="empty">Aucun chantier associé.</div>')+'</section>'+
    '<section class="panel" data-contact-commercial-history><div class="panel-head"><h2>Historique commercial</h2></div>'+history+'</section>';
}
async function commercialSetIndependentStatus(customerId){
  const selection=commercialIndependentContact;if(!selection||String(selection.customer.id)!==String(customerId)||selection.customer.sourceContactId)return;
  if(!commercialCanWrite('customers.edit'))return denyAccess('Vous ne pouvez pas modifier cette fiche.');
  const scope=iaCQuoteScope(),generation=iaCQuoteWorkspaceGeneration,key=commercialIndependentStatusKey(customerId),sameActor=()=>scope===iaCQuoteScope()&&generation===iaCQuoteWorkspaceGeneration;
  let pending=commercialIndependentStatusOperations.get(key);
  if(pending?.busy)return;
  if(!pending){pending={payload:{active:Boolean(selection.customer.archivedAt),operationKey:'customer-status-'+crypto.randomUUID()},busy:false,error:''};commercialIndependentStatusOperations.set(key,pending)}
  pending.busy=true;pending.error='';render();
  try{
    const result=await serverJson('/api/customers/'+encodeURIComponent(customerId)+'/status',{method:'POST',body:JSON.stringify(pending.payload)});
    if(!sameActor())return;
    if(String(result.customer?.id)!==String(customerId))throw Error('La fiche demandée n’a pas pu être retrouvée.');
    commercialIndependentStatusOperations.delete(key);
    if(String(commercialIndependentContact?.customer.id)===String(customerId))commercialIndependentContact.customer=result.customer;
    commercialResetDirectory();await commercialLoadDirectory({force:true});
    if(sameActor()&&view==='contact'&&String(currentContactId)==='canonical:'+customerId)toast(result.replayed?'État de la fiche vérifié.':result.customer.archivedAt?'Fiche désactivée. Ses dossiers sont conservés.':'Fiche réactivée.');
  }catch(error){if(sameActor())pending.error=error.message||'Enregistrement interrompu. Réessayez pour vérifier la même opération.'}
  finally{pending.busy=false;if(sameActor()&&view==='contact'&&String(currentContactId)==='canonical:'+customerId)render()}
}

const commercialOriginalJobForm=jobForm;
jobForm=async function(id=0){
  if(!globalThis.socleCurrentAccess?.owner||globalThis.socleAccessPreview)return denyAccess('La modification globale des chantiers est réservée au responsable.');
  const scope=iaCQuoteScope(),generation=iaCQuoteWorkspaceGeneration,current=()=>scope===iaCQuoteScope()&&generation===iaCQuoteWorkspaceGeneration;
  try{
    await commercialFlushWorkspace();await commercialLoadDirectory({force:true});if(!current())return;
    if(commercialDirectoryState.status!=='ready')throw Error(commercialDirectoryState.error||'Clients indisponibles.');
    const job=jobs.find(item=>String(item.id)===String(id)),selected=String(job?.customerId||commercialDirectoryState.links.find(link=>String(link.contactId)===String(job?.clientId))?.customerId||'');
    if(selected&&!iaCCustomers.some(c=>String(c.id)===selected)){const data=await serverJson('/api/customers/'+encodeURIComponent(selected)+'?includeArchived=1');if(!current())return;iaCCustomers.push(data.customer)}
    commercialOriginalJobForm(id);const form=document.querySelector('#modalbody form');if(!form)return;
    form.dataset.commercialJob='true';form.dataset.sxManagedSave='true';form.dataset.sxDraftIdentity='job:'+String(id||'new');form._jobContext={scope,generation,revision:storageRevision,id:job?.id||'job-'+crypto.randomUUID(),existing:Boolean(job)};
    const label=document.createElement('label');label.textContent='Client';const select=document.createElement('select');select.name='customerId';select.required=Boolean(selected||!job);
    select.innerHTML='<option value="">'+(job?'Client historique · conserver le libellé':'Choisir le client…')+'</option>'+iaCCustomers.filter(c=>!c.archivedAt||String(c.id)===selected).map(c=>'<option value="'+esc(c.id)+'" '+(String(c.id)===selected?'selected':'')+'>'+esc(e2e02CustomerChoiceLabel(c)+(c.archivedAt?' · fiche inactive':''))+'</option>').join('');label.append(select);
    const input=form.querySelector('[name=client]');input.closest('label').before(label);input.readOnly=Boolean(selected);select.onchange=()=>{const c=iaCCustomers.find(c=>String(c.id)===select.value);input.readOnly=Boolean(c);if(c)input.value=e2e02CustomerLabel(c)};
    const error=document.createElement('p');error.id='commercialJobError';error.className='form-error';error.setAttribute('role','alert');form.querySelector('.modal-actions').before(error);
  }catch(error){if(current())toast(error.message||'Chantier indisponible.')}
};
function commercialProtectUncertain(form){
  const uncertain=Boolean(form._jobPending?.attempted&&!form._jobPending?.acknowledged);
  const name=form.querySelector('[name=name]'),customer=form.querySelector('[name=customerId]');
  if(name)name.readOnly=uncertain;
  if(customer)customer.disabled=uncertain;
}
async function commercialSaveJob(event,id,data){
  event.preventDefault();const form=event.target,context=form._jobContext,error=form.querySelector('#commercialJobError'),button=form.querySelector('.modal-actions button.primary');
  if(form._jobBusy)return;
  const current=()=>context&&context.scope===iaCQuoteScope()&&context.generation===iaCQuoteWorkspaceGeneration;
  if(!current()||!globalThis.socleCurrentAccess?.owner||globalThis.socleAccessPreview)return;
  form._jobBusy=true;button.disabled=true;error.textContent='';
  try{
    if(workspaceSnapshot()!==savedSnapshot||saveRunning||storageConflict)throw Error('Le dossier a changé. Conservez votre saisie et rechargez avant de reprendre.');
    if(!form._jobPending){
      const state=JSON.parse(savedSnapshot),old=state.jobs.find(j=>String(j.id)===String(context.id)),selected=String(new FormData(form).get('customerId')||'');
      const customer=iaCCustomers.find(c=>String(c.id)===selected);
      const linked=old?.customerId||commercialDirectoryState.links.find(link=>String(link.contactId)===String(old?.clientId))?.customerId;
      if(selected&&(!customer||customer.archivedAt&&String(linked)!==selected))throw Error('Choisissez un client actif pour cette affectation.');
      const job={...(old||{id:context.id,color:'purple',required:[],photos:[],execution:[],materials:[],contacts:[],notes:[],documents:[],timeEntries:[],dailyChecks:{}}),...data};
      if(customer){job.customerId=customer.id;job.client=e2e02CustomerLabel(customer);if(customer.sourceContactId)job.clientId=contacts.find(c=>String(c.id)===String(customer.sourceContactId))?.id??customer.sourceContactId;else delete job.clientId}
      else if(linked)throw Error('Le client lié ne peut pas être retiré de ce chantier.');
      const index=state.jobs.findIndex(j=>String(j.id)===String(context.id));if(index<0)state.jobs.push(job);else state.jobs[index]=job;
      form._jobPending={state,job,revision:context.revision};
    }
    const pending=form._jobPending;
    // Resolve an uncertain previous PUT by reading the actual saved job first.
    if(pending.attempted){const actual=await serverJson('/api/state');if(!current())return;const job=actual.state?.jobs?.find(j=>String(j.id)===String(context.id));if(JSON.stringify(job)===JSON.stringify(pending.job)){pending.state=actual.state;pending.revision=actual.revision;pending.acknowledged=true}else if(actual.revision!==pending.revision)throw Error('Une autre modification existe sur le serveur. Votre saisie est conservée ici.');}
    if(!pending.acknowledged){pending.attempted=true;commercialWriteDepth++;try{const result=await serverJson('/api/state',{method:'PUT',body:JSON.stringify({revision:pending.revision,state:pending.state})});pending.revision=result.revision;pending.acknowledged=true}finally{commercialWriteDepth=Math.max(0,commercialWriteDepth-1)}}
    if(!current())return;
    if(workspaceSnapshot()!==savedSnapshot)throw Error('Le chantier est enregistré, mais d’autres changements locaux restent à reprendre.');
    globalThis.sxAcknowledgeForm?.(form);restoreWorkspace(pending.state);storageRevision=pending.revision;savedSnapshot=workspaceSnapshot();saveFailed=false;render();toast('Chantier enregistré sur le serveur.');
  }catch(problem){if(current()&&form.isConnected){if(problem.status>=400&&problem.status<500&&!form._jobPending?.acknowledged)form._jobPending=null;error.textContent=problem.message||'Enregistrement interrompu. Vérifiez la même demande en réessayant.';commercialProtectUncertain(form)}}
  finally{form._jobBusy=false;if(button.isConnected)button.disabled=false}
}
