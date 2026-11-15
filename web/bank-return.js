(function(root){
 'use strict';
 let state='',code='',providerError='',invalid=false,invalidParams=false,ownerUid='',controller=new AbortController();
 let org='',initialMarker='';
 const status=()=>document.querySelector('#bank-return-status');
 function marker(){
  let selected='',uid='';try{selected=localStorage.getItem('socle.activeOrganizationId')||'';uid=localStorage.getItem('socle.sessionUserId')||'';}catch{}
  const access=root.socleCurrentAccess;
  return JSON.stringify([selected,uid,access?.userId||'',access?.roleCode||'',Boolean(root.socleAccessPreview)]);
 }
 function current(){return !invalid&&marker()===initialMarker;}
 function show(text){if(current()&&status())status().textContent=text;}
 function generic(http){return http===401?'Votre session Ouvrane a expiré. Reconnectez-vous, puis relancez la connexion bancaire.':http===403?'L’autorisation ne peut pas être utilisée avec ce compte ou cette entreprise. Revenez dans Ouvrane.':'La connexion bancaire n’a pas pu être confirmée. Revenez dans Ouvrane pour vérifier son état.';}
 async function request(path,payload){
  if(!current())throw Error('context');
  let response;try{response=await fetch(path,{method:payload?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{'x-socle-organization-id':org,...(payload?{'content-type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:controller.signal});}catch{throw Error(generic(0));}
  if(!current())throw Error('context');
  let data;try{data=await response.json();}catch{throw Error('La réponse bancaire est illisible. Revenez dans Ouvrane pour vérifier son état.');}
  if(!current())throw Error('context');
  if(!response.ok)throw Error(generic(response.status));
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('La réponse bancaire est incomplète. Revenez dans Ouvrane.');
  return data;
 }
 async function verifyOwner(){
  const value=await request('/api/state'),access=value.access;
  if(value.organizationId!==org||value.role!=='OWNER'||access?.roleCode!=='OWNER'||!access.userId||value.preview)throw Error('L’entreprise ou le propriétaire ne correspond pas à cette autorisation.');
  if(ownerUid&&access.userId!==ownerUid)throw Error('Le compte connecté a changé. Revenez dans Ouvrane.');
  ownerUid=access.userId;
 }
 function count(value){if(!Number.isSafeInteger(value)||value<0)throw Error('Le résultat de l’import n’est pas confirmé. Consultez les connexions dans Ouvrane.');return value;}
 async function run(){
  try{
   const params=new URL(root.location.href).searchParams;
   const states=params.getAll('state'),codes=params.getAll('code'),errors=params.getAll('error');
   invalidParams=states.length>1||codes.length>1||errors.length>1;
   state=states.length===1?states[0]:'';code=codes.length===1?codes[0]:'';providerError=errors.length===1?errors[0]:'';
  }finally{
   // Effacer la query et le fragment avant toute requête, affichage d'erreur ou attente.
   root.history.replaceState(null,'',root.location.pathname);
  }
  initialMarker=marker();
  if(invalidParams){show('Ce retour bancaire est ambigu. Revenez dans Ouvrane pour vérifier la connexion.');state=code=providerError='';return;}
  if(providerError){show(providerError==='access_denied'?'Autorisation bancaire refusée ou annulée. Aucun import n’a été demandé. Vous pouvez revenir dans Ouvrane.':'La banque n’a pas validé cette autorisation. Revenez dans Ouvrane pour réessayer.');state=code=providerError='';return;}
  const match=/^([A-Za-z0-9_-]{1,200})\.([A-Za-z0-9_-]{43})$/.exec(state);
  if(!match||!code||code.length>4096||/[\u0000-\u0020\u007f]/.test(code)){show('Ce retour bancaire est incomplet ou a déjà été traité. Revenez dans Ouvrane pour vérifier la connexion.');state=code='';return;}
  org=match[1];
  let selected='';try{selected=localStorage.getItem('socle.activeOrganizationId')||'';}catch{}
  if(selected&&selected!==org||root.socleAccessPreview){show('Une autre entreprise est sélectionnée. Revenez dans Ouvrane avant de reprendre cette autorisation.');state=code='';return;}
  const syncKey='bank-return-sync-'+crypto.randomUUID();
  try{
   await verifyOwner();
   const completed=await request('/api/bank/connections/complete',{state,code});
   state=code='';
   const connection=completed.connection;
   if(typeof connection?.id!=='string'||!connection.id||connection.id.length>200)throw Error('La banque n’a pas confirmé la connexion. Vérifiez son état dans Ouvrane.');
   count(completed.accountsConnected);
   await verifyOwner();
   show('Autorisation confirmée. Import des mouvements des 90 derniers jours en cours…');
   // Une seule tentative automatique ; la clé reste identique pendant cette exécution.
   const result=await request('/api/bank/connections/'+encodeURIComponent(connection.id)+'/sync',{operationKey:syncKey});
   const imported=count(result.importedCount),duplicates=count(result.duplicateCount),quarantined=count(result.quarantinedCount);count(result.accountsCount);
   await verifyOwner();
   show('Connexion confirmée : '+imported+' mouvement(s) importé(s), '+duplicates+' doublon(s) ignoré(s), '+quarantined+' élément(s) à vérifier. Aucun paiement effectué.');
  }catch(error){
   if(current())show(error.message==='context'?'Le contexte a changé. Revenez dans Ouvrane.':error.name==='AbortError'?'La vérification a été interrompue. Revenez dans Ouvrane.':error.message||'La connexion bancaire est à vérifier dans Ouvrane.');
  }finally{state=code=providerError='';}
 }
 root.addEventListener?.('storage',event=>{if(['socle.activeOrganizationId','socle.sessionUserId'].includes(event.key)){invalid=true;controller.abort();}});
 root.addEventListener?.('pagehide',()=>{invalid=true;controller.abort();});
 void run();
})(globalThis);
