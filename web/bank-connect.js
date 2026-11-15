(function(root){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const apiBase='/api/bank/connections';
 let generation=0,loggedOut=false,state=empty('');
 function empty(key){return{key,status:'idle',data:null,error:'',notice:'',choosing:false,institutions:null,institutionsLoading:false,busy:'',controller:null,startIntent:null};}
 function context(){
  const access=root.socleCurrentAccess,org=typeof activeSocleOrganizationId==='undefined'?'':String(activeSocleOrganizationId||''),uid=String(access?.userId||''),role=String(access?.roleCode||'');
  const preview=Boolean(root.socleAccessPreview),limited=Boolean(root.socleLimitedSession),loading=Boolean(root.socleWorkspaceLoading);
  return{org,uid,role,key:JSON.stringify([org,uid,role,preview,limited,loading,loggedOut]),allowed:Boolean(org&&uid&&role==='OWNER'&&!preview&&!limited&&!loading&&!loggedOut)};
 }
 function clearLegacyFinance(){
  if(typeof iaCBankLoadSerial!=='undefined')iaCBankLoadSerial++;
  if(typeof iaCBankState!=='undefined'){iaCBankState='idle';iaCBankAccounts=[];iaCBankTransactions=[];}
  if(typeof serverFinanceLoadSerial!=='undefined')serverFinanceLoadSerial++;
  if(typeof serverFinanceState!=='undefined'){serverFinanceState='idle';serverFinance=null;serverExpenses=[];serverInvoices=[];serverFinanceError='';}
 }
 function invalidate(){clearLegacyFinance();generation++;state.controller?.abort();state=empty('');}
 function reset(){const current=context();if(state.key!==current.key){
  if(state.key){
   clearLegacyFinance();
  }
  generation++;state.controller?.abort();state=empty(current.key);
 }return current;}
 function capture(){const current=reset();if(!current.allowed)return null;return{...current,generation};}
 function owns(ticket){const current=context();return Boolean(ticket&&ticket.generation===generation&&ticket.key===current.key&&current.allowed);}
 function stale(){const error=Error('Contexte bancaire modifié.');error.stale=true;return error;}
 function message(status){return status===401?'Votre connexion a expiré. Reconnectez-vous à Ouvrane.':status===403?'Cet accès bancaire est réservé au propriétaire autorisé de cette entreprise.':status===409?'La connexion a changé. Actualisez avant de réessayer.':status===429?'Le service bancaire est occupé. Réessayez dans quelques instants.':'Le service bancaire ne peut pas confirmer cette opération. Réessayez depuis Ouvrane.';}
 async function request(ticket,path,options={}){
  if(!owns(ticket))throw stale();
  let response;try{response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers:{...(options.body?{'content-type':'application/json'}:{}),'x-socle-organization-id':ticket.org},signal:state.controller?.signal});}catch{if(!owns(ticket))throw stale();throw Error('Le service bancaire est momentanément inaccessible. Réessayez depuis Ouvrane.');}
  if(!owns(ticket))throw stale();
  let data;try{data=await response.json();}catch{if(!owns(ticket))throw stale();throw Error('La réponse bancaire est illisible. Aucune réussite ne peut être confirmée.');}
  if(!owns(ticket))throw stale();
  if(!response.ok)throw Error(message(response.status));
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('La réponse bancaire est incomplète.');
  return data;
 }
 function validateConnections(data,ticket){
  if(typeof data.configured!=='boolean'||data.provider!=='enablebanking'||data.mode!=='evaluation'||data.organization?.id!==ticket.org||typeof data.organization.name!=='string'||!Array.isArray(data.connections))throw Error('Les connexions reçues ne correspondent pas à l’entreprise choisie.');
  return data;
 }
 function paint(ticket){if(owns(ticket)&&typeof render==='function'&&(typeof view==='undefined'||view==='accounting'))render();}
 function fail(ticket,error){if(!owns(ticket)||error.stale)return;state.error=error.name==='AbortError'?'La demande bancaire a été interrompue.':error.message||'Le service bancaire est indisponible.';}
 async function load(force=false){
  const ticket=capture();if(!ticket||state.busy||state.status==='loading'||!force&&state.status!=='idle')return;
  state.controller?.abort();state.controller=new AbortController();state.status='loading';state.error='';
  try{const data=validateConnections(await request(ticket,apiBase),ticket);if(!owns(ticket))return;state.data=data;state.status='ready';}
  catch(error){if(!owns(ticket))return;state.status='error';fail(ticket,error);}
  paint(ticket);
 }
 async function chooseBank(){
  const ticket=capture();if(!ticket||state.busy||state.status!=='ready'||!state.data.configured)return;
  state.choosing=true;state.error='';if(state.institutions){paint(ticket);return;}
  if(state.institutionsLoading)return;state.institutionsLoading=true;state.controller=new AbortController();paint(ticket);
  try{
   const data=await request(ticket,apiBase+'/institutions?country=BE');
   if(!Array.isArray(data.institutions)||data.institutions.some(i=>typeof i?.name!=='string'||!i.name.trim()||i.country!=='BE'))throw Error('Le catalogue des banques belges ne peut pas être confirmé.');
   if(owns(ticket))state.institutions=data.institutions;
  }catch(error){fail(ticket,error);}finally{if(owns(ticket)){state.institutionsLoading=false;paint(ticket);}}
 }
 function authorizationUrl(value){
  if(typeof value!=='string'||value!==value.trim()||/[\u0000-\u0020\u007f]/.test(value))throw Error('Le lien d’autorisation bancaire est invalide.');
  let url;try{url=new URL(value);}catch{throw Error('Le lien d’autorisation bancaire est invalide.');}
  if(url.origin!=='https://auth.enablebanking.com'||url.username||url.password||url.hash)throw Error('Le domaine d’autorisation bancaire n’est pas autorisé.');
  return url.href;
 }
 async function beginAuthorization(name,confirmed){
  const ticket=capture();if(!ticket||state.busy||state.status!=='ready'||!state.data.configured)return;
  if(!confirmed){state.error='Confirmez l’entreprise dans laquelle importer vos propres comptes.';paint(ticket);return;}
  const institution=state.institutions?.find(i=>i.name===name&&i.country==='BE');
  if(!institution){state.error='Choisissez une banque dans le catalogue reçu.';paint(ticket);return;}
  state.busy='start';state.error='';state.controller=new AbortController();
  if(!state.startIntent||state.startIntent.name!==institution.name)state.startIntent={name:institution.name,key:'bank-start-'+crypto.randomUUID()};
  const payload={aspspName:institution.name,country:'BE',operationKey:state.startIntent.key};paint(ticket);
  try{const result=await request(ticket,apiBase+'/start',{method:'POST',body:JSON.stringify(payload)});const url=authorizationUrl(result.url);if(!owns(ticket))return;root.location.assign(url);}
  catch(error){if(!owns(ticket))return;fail(ticket,error);state.busy='';paint(ticket);}
 }
 const activeStatuses=new Set(['active','connected','authorized']);
 function active(connection){return activeStatuses.has(connection.status)&&(!connection.expiresAt||Date.parse(connection.expiresAt)>Date.now());}
 function count(value){if(!Number.isSafeInteger(value)||value<0)throw Error('Le résultat de l’import bancaire est incomplet.');return value;}
 async function operate(id,kind){
  const ticket=capture();if(!ticket||state.busy||state.status!=='ready'||!state.data.configured)return;
  const connection=state.data.connections.find(c=>c.id===id);if(!connection)return;
  if(kind==='sync'&&!active(connection))return;
  if(kind==='disconnect'&&!root.confirm('Déconnecter cette banque ? Les mouvements déjà importés resteront dans Ouvrane.'))return;
  if(!owns(ticket))return;state.busy=kind+':'+id;state.error='';state.notice='';state.controller=new AbortController();paint(ticket);
  const payload=kind==='sync'?{operationKey:'bank-sync-'+crypto.randomUUID()}:{};
  try{
   const data=await request(ticket,apiBase+'/'+encodeURIComponent(id)+'/'+kind,{method:'POST',body:JSON.stringify(payload)});
   if(kind==='sync'){
    const imported=count(data.importedCount),duplicates=count(data.duplicateCount),quarantined=count(data.quarantinedCount);count(data.accountsCount);
    state.notice=imported+' mouvement(s) importé(s), '+duplicates+' doublon(s) ignoré(s), '+quarantined+' élément(s) à vérifier. Aucun paiement effectué.';
   }else{if(data.disconnected!==true)throw Error('La déconnexion n’a pas pu être confirmée.');state.notice='Autorisation bancaire déconnectée. Les mouvements importés sont conservés.';}
   const fresh=validateConnections(await request(ticket,apiBase),ticket);if(!owns(ticket))return;state.data=fresh;clearLegacyFinance();
  }catch(error){fail(ticket,error);}finally{if(owns(ticket)){state.busy='';paint(ticket);}}
 }
 function date(value){const d=new Date(value);return value&&Number.isFinite(d.getTime())?new Intl.DateTimeFormat('fr-BE',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Brussels'}).format(d):'Non renseigné';}
 function connectionCard(connection){
  const status=active(connection)?'Autorisation active':({pending:'Autorisation en attente',expired:'Autorisation expirée',disconnected:'Déconnectée',revoked:'Autorisation retirée'})[connection.status]||'État à vérifier';
  const accounts=Array.isArray(connection.accounts)?connection.accounts:[];
  return '<article class="panel"><div class="panel-head"><div><h3>'+escape(connection.aspspName||'Banque')+'</h3><p>'+escape(status)+' · Dernier import : '+escape(date(connection.lastSyncedAt))+'</p></div><div class="contact-actions"><button type="button" class="btn" data-bank-link-action="sync" data-bank-link-id="'+escape(connection.id)+'" '+(state.busy||!state.data.configured||!active(connection)?'disabled':'')+'>Importer les mouvements</button><button type="button" class="btn" data-bank-link-action="disconnect" data-bank-link-id="'+escape(connection.id)+'" '+(state.busy||!state.data.configured||['disconnected','revoked'].includes(connection.status)?'disabled':'')+'>Déconnecter</button></div></div>'+(accounts.length?'<ul>'+accounts.map(a=>'<li><strong>'+escape(a.name||'Compte')+'</strong> · '+escape(a.ibanMasked||'IBAN masqué')+' · '+escape(a.currency||'')+'</li>').join('')+'</ul>':'<p>Aucun compte confirmé sur cette autorisation.</p>')+'</article>';
 }
 function panel(){
  const ticket=capture();if(!ticket)return '';
  if(state.status==='idle')queueMicrotask(()=>load());
  const data=state.data,ready=state.status==='ready',configured=ready&&data.configured;
  const organization=ready?escape(data.organization.name):'Vérification de l’entreprise sélectionnée…';
  let chooser='';
  if(state.choosing&&configured){
   chooser=state.institutionsLoading?'<p role="status">Chargement du catalogue bancaire belge…</p>':state.institutions?'<form data-bank-connect-form><label>Banque en Belgique<select name="aspspName" required><option value="">Choisir ma banque…</option>'+state.institutions.map(i=>'<option value="'+escape(i.name)+'">'+escape(i.name)+'</option>').join('')+'</select></label><label><input name="confirmedOrganization" type="checkbox" required> J’ajoute mes propres comptes privés dans « '+organization+' ».</label><p>Après votre accord, un premier import des 90 derniers jours sera demandé. Aucun paiement ne sera effectué.</p><div class="contact-actions"><button class="btn primary" type="submit" '+(state.busy?'disabled':'')+'>Continuer vers ma banque</button><button class="btn" type="button" data-bank-link-action="cancel" '+(state.busy?'disabled':'')+'>Annuler</button></div></form>':'<button class="btn" data-bank-link-action="choose" type="button">Réessayer le catalogue</button>';
  }
  return '<section class="panel" data-bank-connect-root><div class="panel-head"><div><p class="eyebrow">CONNEXION BANCAIRE · LECTURE SEULE</p><h2>Relier mes comptes à Ouvrane</h2><p>Entreprise choisie : <strong>'+organization+'</strong></p></div><button type="button" class="btn primary" data-bank-link-action="choose" '+(!configured||state.busy?'disabled':'')+'>Connecter une banque</button></div><p>Vos connexions personnelles sont réservées au propriétaire connecté. Choisissez une autre entreprise dans le sélecteur Ouvrane avant toute autorisation si nécessaire.</p><p class="notice">Mode d’évaluation pour vos propres comptes. Un usage commercial nécessite un contrat adapté. Votre mot de passe bancaire se saisit uniquement auprès de votre banque, jamais dans Ouvrane.</p>'+(state.status==='loading'||state.status==='idle'?'<p role="status">Vérification du service bancaire…</p>':'')+(ready&&!configured?'<p role="status">Configuration bancaire en attente. Aucune nouvelle autorisation n’est possible pour le moment.</p>':'')+(state.error?'<p class="form-error" role="alert">'+escape(state.error)+'</p>':'')+(state.status==='error'?'<button type="button" class="btn" data-bank-link-action="refresh">Réessayer</button>':'')+(state.notice?'<p role="status">'+escape(state.notice)+'</p>':'')+chooser+(ready?data.connections.map(connectionCard).join(''):'')+'</section>';
 }
 const previousPanel=iaCBankPanel;
 iaCBankPanel=function(...args){reset();return panel()+previousPanel.apply(this,args);};
 if(typeof render==='function'){const previousRender=render;render=function(...args){reset();return previousRender.apply(this,args);};}
 if(typeof setActiveSocleOrganizationId==='function'){const previous=setActiveSocleOrganizationId;setActiveSocleOrganizationId=function(value){if(String(value||'')!==String(activeSocleOrganizationId||''))invalidate();return previous.apply(this,arguments);};}
 if(typeof syncSocleSessionOrganization==='function'){const previous=syncSocleSessionOrganization;syncSocleSessionOrganization=function(uid){if(String(uid||'')!==String(root.socleCurrentAccess?.userId||''))invalidate();return previous.apply(this,arguments);};}
 document.addEventListener('submit',event=>{
  const form=event.target;
  if(form?.matches?.('form[action="/auth/logout"]')){loggedOut=true;invalidate();return;}
  if(!form?.matches?.('[data-bank-connect-form]'))return;
  event.preventDefault();void beginAuthorization(String(form.elements.aspspName.value),Boolean(form.elements.confirmedOrganization.checked));
 },true);
 document.addEventListener('click',event=>{
  const button=event.target?.closest?.('[data-bank-link-action]');if(!button||button.disabled)return;
  const action=button.dataset.bankLinkAction,id=button.dataset.bankLinkId;
  if(action==='choose')void chooseBank();else if(action==='refresh')void load(true);else if(action==='sync'||action==='disconnect')void operate(String(id),action);else if(action==='cancel'){if(!state.busy){state.choosing=false;paint(capture());}}
 });
 root.addEventListener?.('pagehide',()=>{loggedOut=true;invalidate();});
 root.addEventListener?.('storage',event=>{if(['socle.activeOrganizationId','socle.sessionUserId'].includes(event.key))invalidate();});
 root.ouvraneBankConnect={refresh:()=>load(true),chooseBank,beginAuthorization,syncConnection:id=>operate(String(id),'sync'),disconnectConnection:id=>operate(String(id),'disconnect')};
})(globalThis);
