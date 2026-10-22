/* E2E-02 — QUOTE-PREPROJECT-LIFECYCLE
 * Commercial quotes can exist with organization + canonical customer only.
 * No project, financial baseline, stock movement or delivery is created here.
 */
let e2e02CustomerCatalogReady=false;
let e2e02CustomerCatalogKey='',e2e02CustomerCatalogRequest=null;
const e2e02QuoteCreatesRunning=new Set();
function e2e02QuoteCreateStorageKey(){return 'ouvrane:quote-create:'+iaCQuoteScope()}
function e2e02PendingQuoteCreate(){
  let raw;try{raw=sessionStorage.getItem(e2e02QuoteCreateStorageKey())}catch{throw Error('Le navigateur ne permet pas de conserver la demande. Réactivez le stockage de cet onglet avant de créer un devis.')}
  if(!raw)return null;
  let value;try{value=JSON.parse(raw)}catch{throw Error('La demande de devis conservée est illisible. Vérifiez vos devis avant une nouvelle création.')}
  if(value?.version!==1||typeof value.key!=='string'||!/^quote-create:[A-Za-z0-9-]+$/.test(value.key)||value.payload?.operationKey!==value.key||!Array.isArray(value.payload?.lines))throw Error('La demande de devis conservée est invalide. Vérifiez vos devis avant une nouvelle création.');
  return value;
}
function e2e02ProtectQuoteCreate(form,locked){
  if(!form)return;
  if(locked){
    if(!form._quoteCreateDisabled)form._quoteCreateDisabled=new Map();
    form.querySelectorAll('input,select,textarea,section button').forEach(field=>{if(!form._quoteCreateDisabled.has(field))form._quoteCreateDisabled.set(field,field.disabled);field.disabled=true});
  }else if(form._quoteCreateDisabled){form._quoteCreateDisabled.forEach((disabled,field)=>field.disabled=disabled);form._quoteCreateDisabled=null}
  const notice=form.querySelector('[data-quote-create-pending]');if(notice)notice.hidden=!locked;
  const button=form.querySelector('.modal-actions button.primary');if(button)button.textContent=locked?'Vérifier l’enregistrement':'Enregistrer le devis';
}
function e2e02PrepareQuoteForm(form){
  if(form?.dataset.sxServerPending==='true'){e2e02ProtectQuoteCreate(form,true);form.querySelector('.modal-actions button.primary').disabled=e2e02QuoteCreatesRunning.has(e2e02QuoteCreateStorageKey())}
}
function e2e02QuoteCreateForm(operation,original){
  if(operation){const active=document.querySelector('#modal[open] form.quote-editor');if(active?.dataset.quoteCreateKey===operation.key)return active}
  return original?.isConnected?original:null;
}


function e2e02CustomerContext(){
  return JSON.stringify([typeof iaCQuoteScope==='function'?iaCQuoteScope():'',typeof iaCQuoteWorkspaceGeneration==='number'?iaCQuoteWorkspaceGeneration:0,typeof storageRevision==='number'?storageRevision:0]);
}
function e2e02InvalidateCustomers(){
  e2e02CustomerCatalogReady=false;e2e02CustomerCatalogKey='';e2e02CustomerCatalogRequest=null;iaCCustomers=[];
}

function e2e02CustomerLabel(customer){
  return String(customer?.companyName||[customer?.firstName,customer?.lastName].filter(Boolean).join(' ')||customer?.id||'').trim();
}
function e2e02CustomerAddress(customer){
  const locality=[customer?.postalCode,customer?.city].filter(Boolean).join(' ').trim();
  return [customer?.street,locality].filter(Boolean).join(', ').trim();
}
function e2e02CustomerChoiceLabel(customer){
  const label=e2e02CustomerLabel(customer);
  if(!iaCCustomers.some(other=>String(other.id)!==String(customer.id)&&e2e02CustomerLabel(other)===label))return label;
  const source=typeof contacts==='undefined'?null:contacts.find(contact=>String(contact.id)===String(customer.sourceContactId||''));
  return label+' · '+(source?.reference||e2e02CustomerAddress(customer)||customer.email||customer.phone||customer.id);
}
async function e2e02EnsureCustomers(){
  const key=e2e02CustomerContext();
  if(e2e02CustomerCatalogReady&&e2e02CustomerCatalogKey===key)return;
  if(e2e02CustomerCatalogRequest?.key===key)return e2e02CustomerCatalogRequest.promise;
  if(e2e02CustomerCatalogKey!==key)iaCCustomers=[];
  e2e02CustomerCatalogReady=false;
  const request={key,promise:null};e2e02CustomerCatalogRequest=request;
  request.promise=serverJson('/api/customers?limit=250').then(data=>{
    if(e2e02CustomerContext()!==key||e2e02CustomerCatalogRequest!==request)throw Object.assign(Error('Le contexte de l’annuaire a changé.'),{staleContext:true});
    iaCCustomers=Array.isArray(data.customers)?data.customers:[];
    e2e02CustomerCatalogKey=key;e2e02CustomerCatalogReady=true;
  }).finally(()=>{if(e2e02CustomerCatalogRequest===request)e2e02CustomerCatalogRequest=null});
  return request.promise;
}
function e2e02ApplyCustomer(select){
  const customer=iaCCustomers.find(item=>String(item.id)===String(select.value||'')),form=select.form;
  if(!form)return;
  const client=form.querySelector('[name="client"]'),address=form.querySelector('[name="clientAddress"]');
  if(customer){
    if(client){client.value=e2e02CustomerLabel(customer);client.readOnly=true}
    if(address&&!form.querySelector('[name="clientAddressFixed"]')?.checked)address.value=e2e02CustomerAddress(customer);
  }else if(client){
    client.readOnly=false;client.value=form.dataset?.legacyClient||'';
    if(address&&!form.querySelector('[name="clientAddressFixed"]')?.checked)address.value='';
  }
}
function e2e02QuoteFormMarkup(id='',draftId='',preferredCustomerId=''){
  if(id&&iaCIsHistoricalQuote(id))return '<p class="notice">Ce devis historique est conservé en lecture seule.</p>';
  const pending=!id?e2e02PendingQuoteCreate():null;
  const quote=pending?.payload||quotes.find(item=>String(item.id)===String(id||''))||{
    title:'',job:null,projectId:null,customerId:null,client:'',clientAddress:'',
    date:reference,validUntil:isoDay(reference,30),deposit:30,
    paymentTerms:'Acompte à la commande, situations suivant avancement, solde à la réception.',
    exclusions:'Travaux imprévus non décrits dans le devis.',notes:'',
    lines:[{label:'',description:'',qty:1,unit:'forfait',price:0,vat:6}]
  };
  const draft=!pending&&typeof quoteDrafts!=='undefined'?quoteDrafts.find(item=>String(item.id)===String(draftId||'')):null;
  const projectId=quote.projectId??quote.job??null;
  const selectedCustomerId=String(pending?quote.customerId||'':preferredCustomerId||draft?.customerId||quote.customerId||'');
  const selectedCustomer=iaCCustomers.find(item=>String(item.id)===selectedCustomerId);
  const legacyProjectLinked=Boolean(id&&projectId&&!selectedCustomerId);
  const customerRequired=!legacyProjectLinked;
  const clientValue=selectedCustomer?e2e02CustomerLabel(selectedCustomer):(draft?.contact||quote.client||'');
  const addressValue=quote.clientAddress||e2e02CustomerAddress(selectedCustomer)||draft?.place||'';
  const titleValue=draft?('Devis à établir · '+draft.place):quote.title;
  const notesValue=draft?[quote.notes||'', 'Adresse de la visite : '+draft.place, 'Relevé terrain : '+(draft.notes||'voir dossier de visite.')].filter(Boolean).join('\n\n'):quote.notes||'';
  const customerOptions=[
    '<option value="">'+(legacyProjectLinked?'Client historique · conserver le libellé':'Choisir le client…')+'</option>',
    ...iaCCustomers.filter(customer=>!customer.archivedAt||String(customer.id)===selectedCustomerId).map(customer=>'<option value="'+esc(customer.id)+'" '+(String(customer.id)===selectedCustomerId?'selected':'')+'>'+esc(e2e02CustomerChoiceLabel(customer)+(customer.archivedAt?' · fiche inactive':''))+'</option>')
  ].join('');
  const projectOptions=[
    '<option value="">Aucun chantier · devis commercial</option>',
    ...jobs.map(job=>'<option value="'+esc(job.id)+'" '+(String(job.id)===String(projectId||'')?'selected':'')+'>'+esc(job.name)+' · '+esc(job.client||job.town||'')+'</option>')
  ].join('');
  const idArg=id?"'"+jsString(String(id))+"'":"''";
  const draftIdentity=pending?.draftIdentity||('quote:'+(id||('new:'+draftId+':'+selectedCustomerId)));
  const recovery=pending?' data-sx-server-pending="true" data-quote-create-key="'+esc(pending.key)+'"'+(pending.draftKey?' data-sx-draft-key="'+esc(pending.draftKey)+'"':''):'';
  return '<form class="quote-editor e2e02-quote-editor" data-e2e02-preproject="true" data-sx-managed-save="true" data-sx-draft-identity="'+esc(draftIdentity)+'"'+recovery+' data-legacy-client="'+esc(quote.client||'')+'" onsubmit="e2e02SaveQuote(event,'+idArg+')">'+
    '<p data-quote-create-pending class="notice" role="status" '+(pending?'':'hidden')+'>Une création de devis attend sa confirmation. Vérifiez son enregistrement avant de modifier le contenu ou de créer un autre devis. La même demande sera reprise sans doublon.</p>'+
    '<section><p class="form-section-title">Client & chantier</p>'+
    '<div class="form-two">'+
      '<label>Client canonique<select name="customerId" '+(customerRequired?'required':'')+' onchange="e2e02ApplyCustomer(this)">'+customerOptions+'</select></label>'+
      '<label>Chantier <span class="subtle">(facultatif)</span><select name="job">'+projectOptions+'</select></label>'+
    '</div><label class="commercial-address-choice"><input type="checkbox" name="clientAddressFixed"><span>Conserver l’adresse saisie lors d’un changement de client</span></label>'+
    '<p class="help-line">Le devis peut être préparé et accepté avant la création du chantier. La conversion chantier sera une étape séparée.</p>'+
    '<div class="form-two">'+
      '<label>Libellé client<input name="client" required maxlength="120" value="'+esc(clientValue)+'" '+(selectedCustomer?'readonly':'')+'></label>'+
      '<label>Adresse client / lieu prévu<input name="clientAddress" required maxlength="200" value="'+esc(addressValue)+'"></label>'+
    '</div>'+
    '<label>Objet du devis<input name="title" required maxlength="150" value="'+esc(titleValue)+'"></label>'+
    '<div class="form-two"><label>Date du devis<input name="date" type="date" required value="'+esc(quote.date)+'"></label><label>Valable jusqu’au<input name="validUntil" type="date" required value="'+esc(quote.validUntil)+'"></label></div>'+
    '</section>'+
    '<section><div class="quote-lines-title"><p class="form-section-title">Détail des travaux</p><button type="button" class="link" onclick="addQuoteLine()">+ Ajouter une ligne</button></div>'+
    '<div class="catalogue-picker"><small>Ajouter depuis mes ouvrages & tarifs</small><select onchange="insertCatalogueLine(this.value);this.value=\'\'"><option value="">Choisir un poste…</option>'+priceCatalog.map(item=>'<option value="'+esc(item.id)+'">'+esc(item.name)+' — '+money(item.price)+' / '+esc(item.unit)+'</option>').join('')+'</select></div>'+
    '<div id="quoteLines">'+(quote.lines||[]).map(quoteLine).join('')+'</div></section>'+
    '<section><p class="form-section-title">Conditions</p><div class="form-two">'+
      '<label>Acompte demandé (%)<input name="deposit" type="number" min="0" max="100" value="'+Number(quote.deposit||0)+'"></label>'+
      '<label>Conditions de paiement<input name="paymentTerms" maxlength="300" value="'+esc(quote.paymentTerms||'')+'"></label>'+
    '</div><label>Remarques<textarea name="notes" rows="3">'+esc(notesValue)+'</textarea></label><label>Exclusions / réserves<textarea name="exclusions" rows="3">'+esc(quote.exclusions||'')+'</textarea></label></section>'+
    '<p id="quoteError" class="form-error" role="alert"></p>'+
    (iaCCustomers.length||pending?'<div class="modal-actions"><button class="btn primary">Enregistrer le devis</button></div>':'<p class="notice"><strong>Aucun client canonique disponible.</strong> Créez d’abord le client dans l’annuaire commercial.</p>')+
    '</form>';
}
function e2e02OpenQuoteForm(id='',draftId='',preferredCustomerId=''){
  if(!canModuleAction('quotes',id?'edit':'add'))return denyAccess('Vous ne pouvez pas créer ou modifier de devis.');
  modal(id?'Modifier le devis':'Créer un devis',e2e02QuoteFormMarkup(id,draftId,preferredCustomerId));
  e2e02PrepareQuoteForm(document.querySelector('#modalbody form.quote-editor'));
}
quoteForm=function(id='',draftId='',preferredCustomerId=''){
  if(!canModuleAction('quotes',id?'edit':'add'))return denyAccess('Vous ne pouvez pas créer ou modifier de devis.');
  e2e02EnsureCustomers()
    .then(()=>e2e02OpenQuoteForm(id,draftId,preferredCustomerId))
    .catch(error=>toast(error.message||'Annuaire clients indisponible.'));
};
function quoteFormForCustomer(customerId){
  quoteForm('','',String(customerId||''));
}
async function e2e02SaveQuote(event,id=''){
  event.preventDefault();
  const editor=event.target;id=id||editor.dataset.quoteSavedId||'';
  if(!canModuleAction('quotes',id?'edit':'add'))return denyAccess('Vous ne pouvez pas enregistrer ce devis.');
  const storageKey=e2e02QuoteCreateStorageKey();if(!id&&e2e02QuoteCreatesRunning.has(storageKey))return;
  let operation=null,payload,fresh=false,submitted=false;
  try{if(!id)operation=e2e02PendingQuoteCreate()}catch(problem){editor.querySelector('#quoteError').textContent=problem.message;return}
  if(operation)payload=operation.payload;
  else{
    const form=new FormData(editor),error=editor.querySelector('#quoteError');
    const labels=form.getAll('label'),descriptions=form.getAll('description'),qtys=form.getAll('qty'),units=form.getAll('unit'),prices=form.getAll('price'),vats=form.getAll('vat');
    if(!labels.length||labels.some(value=>!String(value).trim())){if(error)error.textContent='Ajoutez au moins une ligne de travaux.';return}
    const lines=labels.map((label,index)=>({
      label:String(label).trim(),description:String(descriptions[index]||'').trim(),
      qty:Number(qtys[index]),unit:String(units[index]||'forfait').trim(),
      price:Number(prices[index]),vat:Number(vats[index])
    }));
    if(lines.some(line=>!line.unit||!Number.isFinite(line.qty)||!Number.isFinite(line.price)||line.qty<=0||line.price<0||![0,6,12,21].includes(line.vat))){if(error)error.textContent='Une ligne de devis est invalide.';return}
    const existing=id?quotes.find(item=>String(item.id)===String(id)):null;
    const projectId=String(form.get('job')||'').trim()||null,customerId=String(form.get('customerId')||'').trim()||null;
    if(!projectId&&!customerId){if(error)error.textContent='Choisissez un client pour un devis sans chantier.';return}
    payload={
      projectId,customerId,reference:existing?.ref||existing?.reference||'',
      status:existing?.serverStatus||'draft',
      title:String(form.get('title')||'').trim(),
      client:String(form.get('client')||'').trim(),
      clientAddress:String(form.get('clientAddress')||'').trim(),
      date:form.get('date'),validUntil:form.get('validUntil'),
      deposit:Number(form.get('deposit'))||0,
      paymentTerms:String(form.get('paymentTerms')||'').trim(),
      notes:String(form.get('notes')||'').trim(),
      exclusions:String(form.get('exclusions')||'').trim(),lines
    };

  }
  const generation=iaCQuoteWorkspaceGeneration,scope=iaCQuoteScope(),current=()=>generation===iaCQuoteWorkspaceGeneration&&scope===iaCQuoteScope();
  const setError=message=>{const target=e2e02QuoteCreateForm(operation,editor);if(target)target.querySelector('#quoteError').textContent=message};
  try{
    if(!id){
      if(!operation){
        const key='quote-create:'+crypto.randomUUID();payload={...payload,operationKey:key};
        operation={version:1,key,payload,draftIdentity:editor.dataset.sxDraftIdentity||'',draftKey:editor.dataset.sxDraftKey||'',sourceDraftId:String(new FormData(editor).get('sourceDraftId')||'').trim()};
        try{sessionStorage.setItem(storageKey,JSON.stringify(operation))}catch{throw Error('Demande non envoyée : le navigateur ne permet pas de conserver sa reprise. Libérez le stockage de cet onglet puis réessayez.')}
        fresh=true;
      }
      editor.dataset.quoteCreateKey=operation.key;e2e02ProtectQuoteCreate(editor,true);e2e02QuoteCreatesRunning.add(storageKey);
    }
    const button=editor.querySelector('.modal-actions button.primary');if(button)button.disabled=true;setError('');submitted=true;
    const result=await serverJson(id?'/api/quotes/'+encodeURIComponent(id):'/api/quotes',{method:id?'PUT':'POST',body:JSON.stringify(payload)});
    if(!current())return;
    const q=result.quote,local={...q,id:q.id,ref:q.reference,status:iaCQuoteStatusLabel(q.status),serverStatus:q.status,job:q.projectId};
    const pos=quotes.findIndex(item=>String(item.id)===String(q.id));if(pos>=0)quotes[pos]=local;else quotes.unshift(local);
    const target=e2e02QuoteCreateForm(operation,editor);if(target)target.dataset.quoteSavedId=q.id;
    let linkWarning='';const sourceDraftId=operation?.sourceDraftId||String(new FormData(editor).get('sourceDraftId')||'').trim();
    if(sourceDraftId){try{await serverJson('/api/quote-visits/'+encodeURIComponent(sourceDraftId)+'/quote',{method:'POST',body:JSON.stringify({quoteId:q.id})});if(!current())return;const draft=quoteDrafts.find(item=>String(item.id)===sourceDraftId);if(draft)draft.quoteId=q.id}catch(linkError){linkWarning=' Le devis existe, mais son relevé terrain n’a pas pu être rattaché : '+(linkError.message||'réessayez depuis le dossier de visite.')}}
    if(!current())return;
    if(operation&&e2e02PendingQuoteCreate()?.key===operation.key)sessionStorage.removeItem(storageKey);
    globalThis.sxAcknowledgeForm?.(editor);if(target&&target!==editor)globalThis.sxAcknowledgeForm?.(target);
    if(target&&target===document.querySelector('#modal[open] form.quote-editor'))closeModal();
    iaCQuotesState='ready';render();toast((result.replayed?'Devis retrouvé, sans nouvelle création.':'Devis enregistré sur le serveur.')+linkWarning);
  }catch(problem){
    if(!current())return;
    const target=e2e02QuoteCreateForm(operation,editor);
    if(!id&&submitted&&fresh&&[400,404,422].includes(problem.status)){
      if(e2e02PendingQuoteCreate()?.key===operation.key)sessionStorage.removeItem(storageKey);
      if(target){e2e02ProtectQuoteCreate(target,false);delete target.dataset.quoteCreateKey}
    }else if(target&&!submitted)e2e02ProtectQuoteCreate(target,false);
    if(target)target.querySelector('#quoteError').textContent=problem.message||'Résultat de l’enregistrement inconnu. Vérifiez la même demande avant de continuer.';
  }finally{
    if(!id)e2e02QuoteCreatesRunning.delete(storageKey);
    if(current()){const target=e2e02QuoteCreateForm(operation,editor),button=target?.querySelector('.modal-actions button.primary');if(button)button.disabled=false}
  }
}

saveLinkedQuote=e2e02SaveQuote;
saveQuote=e2e02SaveQuote;

iaCUpdateQuoteStatus=async function(id,label){
  const q=quotes.find(item=>String(item.id)===String(id));if(!q)return;
  if(iaCIsHistoricalQuote(id))return iaCQuoteReadOnly();
  const generation=iaCQuoteWorkspaceGeneration,scope=iaCQuoteScope(),current=()=>generation===iaCQuoteWorkspaceGeneration&&scope===iaCQuoteScope();
  const status=iaCQuoteStatusCode(label);
  try{
    const result=await serverJson('/api/quotes/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({
      projectId:q.projectId??q.job??null,customerId:q.customerId||null,reference:q.ref||q.reference||'',status,
      title:q.title||'',client:q.client||'',clientAddress:q.clientAddress||'',date:q.date,validUntil:q.validUntil,
      deposit:q.deposit||0,paymentTerms:q.paymentTerms||'',notes:q.notes||'',exclusions:q.exclusions||'',lines:q.lines||[]
    })});
    if(!current())return;
    q.status=label;q.serverStatus=status;
    if(result.quote){q.projectId=result.quote.projectId;q.job=result.quote.projectId;q.customerId=result.quote.customerId}
    iaCQuotesState='idle';await iaCLoadQuotes();if(current())toast(result.replayed?'Statut déjà à jour.':'Statut du devis enregistré.');
  }catch(error){if(current())toast(error.message||'Mise à jour du devis refusée.')}
};

const e2e02QuotesViewBase=quotesView;
quotesView=function(){
  return e2e02QuotesViewBase().replaceAll('<small>Chantier</small>','<small>Sans chantier</small>');
};

const e2e02ContactsViewBase=contactsView;
contactsView=function(){
  return e2e02ContactsViewBase()+iaCServerDirectoryPanel();
};

const e2e02DirectoryPanelBase=iaCServerDirectoryPanel;
iaCServerDirectoryPanel=function(){
  if(iaCServerDirectoryState!=='ready')return e2e02DirectoryPanelBase();
  e2e02CustomerCatalogReady=true;
  const q=String(contactQuery||'').trim().toLowerCase();
  const customers=iaCCustomers.filter(c=>[c.companyName,c.firstName,c.lastName,c.email,c.phone,c.vatNumber].join(' ').toLowerCase().includes(q));
  const suppliers=iaCSuppliers.filter(v=>[v.name,v.email,v.phone,v.vatNumber].join(' ').toLowerCase().includes(q));
  const customerRows=customers.slice(0,25).map(c=>
    '<div class="detail-row"><span><strong>'+esc(e2e02CustomerLabel(c))+'</strong><small>'+esc(c.vatNumber||c.email||c.phone||'Coordonnées à renseigner')+'</small></span>'+
    '<span><span class="badge">Serveur</span> '+(canModuleAction('quotes','add')?'<button class="btn" type="button" onclick="quoteFormForCustomer(\''+jsString(c.id)+'\')">Créer un devis</button>':'')+'</span></div>'
  ).join('');
  const supplierRows=suppliers.slice(0,25).map(v=>'<div class="detail-row"><span><strong>'+esc(v.name)+'</strong><small>'+esc(v.vatNumber||v.email||v.phone||'Coordonnées à renseigner')+'</small></span><span class="badge">Serveur</span></div>').join('');
  return '<section class="panel ia-c-server-directory"><div class="panel-head"><div><p class="eyebrow">DONNÉES COMMERCIALES · SERVEUR</p><h2>Clients '+customers.length+' · Fournisseurs '+suppliers.length+'</h2><span>Tenant-scoped · persisté côté serveur</span></div></div><div class="ia-c-directory-columns"><div><h3>Clients</h3>'+(customerRows||'<div class="empty">Aucun client serveur.</div>')+'</div><div><h3>Fournisseurs</h3>'+(supplierRows||'<div class="empty">Aucun fournisseur serveur.</div>')+'</div></div></section>';
};

const e2e02ShowQuoteBase=showQuote;
showQuote=function(id){
  e2e02ShowQuoteBase(id);
  const q=quotes.find(item=>String(item.id)===String(id));
  if(q&&!q.projectId&&!q.job){
    document.querySelector('#modalbody .send-worker-quote')?.remove();
    const actions=document.querySelector('#modalbody .modal-actions');
    if(actions&&!actions.querySelector('.e2e02-preproject-badge'))actions.insertAdjacentHTML('afterbegin','<span class="badge e2e02-preproject-badge">Devis pré-chantier</span>');
  }
};
