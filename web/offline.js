/* Notes et instantane hors connexion, limites au compte et a l'entreprise
   confirmes par une reponse reseau /api/state dans ce document.
   Un rechargement sans cette verification ne reutilise aucun ancien acces. */
(function () {
  'use strict';
  var DB_NAME='socle-offline',DB_VERSION=2,STORE_SNAPSHOT='snapshot',STORE_QUEUE='queue';
  var CATEGORIES=['Avancement','Problème','Livraison','Sécurité'];
  var queueListeners=[],dbPromise=null,verifiedScope=null,epoch=0,stateSequence=0;
  var authLocked=false,autoFlushArmed=false,flushPromise=null,lastServedAt=null;
  var originalFetch=window.fetch?window.fetch.bind(window):null;
  var confirmedLogouts=new WeakSet(),lastVerifiedUserId=null;

  function preview(headers){return Boolean(globalThis.socleAccessPreview||headers&&headers.get('x-socle-access-preview-user-id'))}
  function scopeOf(body){
    if(!body||body.preview||body.offlineSnapshot||!body.access?.userId||!body.organizationId)return null;
    var a=body.access;
    return {userId:String(a.userId),organizationId:String(body.organizationId),signature:JSON.stringify([a.roleCode,a.personId,a.scope,a.configured,(a.permissions||[]).slice().sort(),(a.projectIds||[]).slice().sort()])};
  }
  function same(a,b){return Boolean(a&&b&&a.userId===b.userId&&a.organizationId===b.organizationId)}
  function selectedOrganization(){try{return typeof activeSocleOrganizationId!=='undefined'?String(activeSocleOrganizationId||''):String(localStorage.getItem('socle.activeOrganizationId')||'')}catch(_){return ''}}
  function currentScope(organizationId){
    if(authLocked||preview()||!verifiedScope)return null;
    var selected=selectedOrganization(),access=globalThis.socleCurrentAccess,organization=String(globalThis.socleCurrentOrganizationId||'');
    if(organizationId&&organizationId!==verifiedScope.organizationId||selected&&selected!==verifiedScope.organizationId||organization&&organization!==verifiedScope.organizationId||access?.userId&&String(access.userId)!==verifiedScope.userId)return null;
    return verifiedScope;
  }
  function invalidate(){epoch++;stateSequence++;verifiedScope=null;autoFlushArmed=false;lastServedAt=null;notify()}
  function key(scope){return 'socle-v5:'+JSON.stringify([scope.userId,scope.organizationId])}
  function owned(row,scope){return Boolean(row&&row.format===2&&row.namespace==='socle-v5'&&same(row,scope))}
  function live(scope,generation){return generation===epoch&&same(currentScope(),scope)}
  function requestInfo(input,init){
    init=init||{};var url;try{url=new URL(input instanceof Request?input.url:String(input),location.href)}catch(_){return null}
    var headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(init.headers||{}).forEach(function(value,name){headers.set(name,value)});
    return {url:url,headers:headers,method:String(init.method||(input instanceof Request?input.method:'GET')).toUpperCase(),sameOrigin:url.origin===location.origin};
  }
  function openDb(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise(function(resolve,reject){
      if(!('indexedDB' in window)){reject(Error('Stockage local indisponible.'));return}
      var request=indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=function(){var db=request.result;if(!db.objectStoreNames.contains(STORE_SNAPSHOT))db.createObjectStore(STORE_SNAPSHOT);if(!db.objectStoreNames.contains(STORE_QUEUE))db.createObjectStore(STORE_QUEUE,{keyPath:'operationKey'});request.transaction.objectStore(STORE_SNAPSHOT).delete('state')};
      request.onsuccess=function(){resolve(request.result)};request.onerror=function(){reject(request.error||Error('Stockage local indisponible.'))};
    });return dbPromise;
  }
  function tx(store,mode,work){return openDb().then(function(db){return new Promise(function(resolve,reject){var transaction=db.transaction(store,mode),result;try{result=work(transaction.objectStore(store))}catch(error){transaction.abort();reject(error);return}transaction.oncomplete=function(){resolve(result&&result.result!==undefined?result.result:result)};transaction.onerror=function(){reject(transaction.error)};transaction.onabort=function(){reject(transaction.error||Error('Stockage interrompu.'))}})})}
  function saveSnapshot(body){
    var scope=currentScope(),source=scopeOf(body),generation=epoch;
    if(!same(scope,source)||scope.signature!==source.signature)return Promise.reject(Error('Identité réseau non confirmée pour cet instantané.'));
    return tx(STORE_SNAPSHOT,'readwrite',function(store){if(!live(scope,generation))return false;store.put({format:2,namespace:'socle-v5',userId:scope.userId,organizationId:scope.organizationId,signature:scope.signature,payload:body,state:body.state,savedAt:new Date().toISOString()},key(scope));return true});
  }
  function readSnapshot(organizationId){
    var scope=currentScope(organizationId),generation=epoch;if(!scope)return Promise.resolve(null);
    return tx(STORE_SNAPSHOT,'readonly',function(store){return store.get(key(scope))}).then(function(record){return live(scope,generation)&&owned(record,scope)&&record.signature===scope.signature?record:null});
  }
  function purgeUser(userId){return Promise.all([STORE_SNAPSHOT,STORE_QUEUE].map(function(name){return tx(name,'readwrite',function(store){var cursor=store.openCursor();cursor.onsuccess=function(){var row=cursor.result;if(!row)return;if(row.value?.format===2&&row.value.namespace==='socle-v5'&&row.value.userId===userId)row.delete();row.continue()};return true})}))}
  function queueFor(scope){if(!scope)return Promise.resolve([]);return tx(STORE_QUEUE,'readonly',function(store){return store.getAll()}).then(function(rows){return (rows||[]).filter(function(row){return owned(row,scope)}).sort(function(a,b){return String(a.createdAt).localeCompare(String(b.createdAt))})})}
  function listQueue(){var scope=currentScope(),generation=epoch;return queueFor(scope).then(function(rows){return live(scope,generation)?rows:[]})}
  function queueNote(note){
    var scope=currentScope(),generation=epoch;if(!scope)return Promise.reject(Error('Connectez-vous pour confirmer votre compte et votre entreprise avant de garder une note.'));
    var entry={format:2,namespace:'socle-v5',userId:scope.userId,organizationId:scope.organizationId,status:'pending',httpStatus:null,lastError:'',operationKey:'note-'+crypto.randomUUID(),projectId:String(note.projectId),projectName:String(note.projectName||''),category:CATEGORIES.indexOf(note.category)>=0?note.category:'Avancement',text:String(note.text||'').slice(0,250),createdAt:new Date().toISOString()};
    return tx(STORE_QUEUE,'readwrite',function(store){if(!live(scope,generation))throw Error('Le compte ou l’entreprise a changé. La note n’a pas été enregistrée.');store.put(entry);return entry}).then(function(row){notify();return row});
  }
  function changeEntry(entry,values,remove){return tx(STORE_QUEUE,'readwrite',function(store){var request=store.get(entry.operationKey);request.onsuccess=function(){var saved=request.result;if(!owned(saved,entry))return;if(remove)store.delete(entry.operationKey);else store.put(Object.assign({},saved,values))};return true})}
  function notify(){listQueue().then(function(items){queueListeners.forEach(function(listener){try{listener(items)}catch(_){}});renderBanner(items)}).catch(function(){})}
  function onQueueChange(listener){queueListeners.push(listener);return listener}
  function networkScope(body,info,generation,sequence,arm){
    if(generation!==epoch||sequence!==stateSequence||authLocked||preview(info.headers))return null;
    var scope=scopeOf(body),requested=info.headers.get('x-socle-organization-id');
    if(!scope||requested&&requested!==scope.organizationId)return null;
    if(!same(verifiedScope,scope)||verifiedScope.signature!==scope.signature)epoch++;
    verifiedScope=scope;lastVerifiedUserId=scope.userId;if(arm)autoFlushArmed=true;
    saveSnapshot(body).then(function(){notify();maybeFlush()}).catch(function(){});return scope;
  }
  function responseError(response){return response.json().catch(function(){return {}}).then(function(body){var error=Error(body.error||'Envoi refusé ('+response.status+').');error.status=response.status;throw error})}
  function postNote(entry){return fetch('/api/projects/'+encodeURIComponent(entry.projectId)+'/notes',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-socle-organization-id':entry.organizationId},body:JSON.stringify({category:entry.category,visibility:'Équipe et patron',text:entry.text,operationKey:entry.operationKey})}).then(function(response){if(!response.ok)return responseError(response);return response.json()})}
  async function revalidate(scope,generation){
    var response=await originalFetch('/api/state',{cache:'no-store',credentials:'same-origin',headers:{'x-socle-organization-id':scope.organizationId}});
    if(!response.ok){invalidate();return false}
    var body=await response.json(),next=scopeOf(body);
    if(!live(scope,generation)||!same(next,scope)){invalidate();return false}
    if(next.signature!==scope.signature){invalidate();verifiedScope=next;await saveSnapshot(body).catch(function(){});return false}
    return true;
  }
  function flushQueue(options){
    if(flushPromise)return flushPromise;
    var scope=currentScope(),generation=epoch,retry=Boolean(options&&options.retryBlocked);
    if(!scope||!originalFetch)return Promise.resolve({sent:0,failed:0,skipped:true});
    flushPromise=(async function(){
      var sent=0,failed=0,items=(await queueFor(scope)).filter(function(row){return row.status==='pending'||retry&&row.status==='blocked'});
      if(!items.length||!live(scope,generation))return {sent:0,failed:0};
      try{if(!await revalidate(scope,generation))return {sent:0,failed:0,skipped:true}}catch(_){return {sent:0,failed:0,offline:true}}
      for(var entry of items){
        if(!live(scope,generation))break;
        try{await postNote(entry);if(!live(scope,generation))break;await changeEntry(entry,null,true);sent++}
        catch(error){if(!live(scope,generation))break;failed++;await changeEntry(entry,{status:error.status>=400&&error.status<500?'blocked':'pending',httpStatus:error.status||null,lastError:error.message||'Réseau indisponible.',lastAttemptAt:new Date().toISOString()},false);if(error.status===401){invalidate();break}}
      }
      return {sent:sent,failed:failed};
    })().finally(function(){flushPromise=null;notify()});return flushPromise;
  }
  function maybeFlush(){if(autoFlushArmed&&navigator.onLine&&currentScope()){autoFlushArmed=false;flushQueue()}}
  function logoutConfirmed(response){if(response.status===204&&!response.redirected)return true;if(!response.ok||!response.redirected)return false;try{var url=new URL(response.url);return url.origin===location.origin&&url.pathname==='/login'}catch(_){return false}}
  async function logoutRequest(input,init){
    var userId=lastVerifiedUserId;invalidate();authLocked=true;try{localStorage.setItem('socle.offlineLogout',crypto.randomUUID())}catch(_){}
    try{var probe=await originalFetch('/api/state',{cache:'no-store',credentials:'same-origin'});if(probe.ok)userId=scopeOf(await probe.json())?.userId||null}catch(_){}
    var response=await originalFetch(input,init);
    if(logoutConfirmed(response)){if(userId)await purgeUser(userId);lastVerifiedUserId=null;confirmedLogouts.add(response);notify()}
    return response;
  }
  if(originalFetch)window.fetch=function(input,init){
    var info=requestInfo(input,init);if(!info||!info.sameOrigin)return originalFetch(input,init);
    if(info.method==='POST'&&['/auth/logout','/__local-test/logout'].includes(info.url.pathname))return logoutRequest(input,init);
    if(info.method==='POST'&&['/auth/login','/__local-test/login'].includes(info.url.pathname)){lastVerifiedUserId=null;invalidate();authLocked=true;return originalFetch(input,init).then(function(response){if(response.ok)authLocked=false;return response})}
    if(info.method!=='GET'||info.url.pathname!=='/api/state')return originalFetch(input,init);
    if(preview(info.headers))invalidate();
    var generation=epoch,sequence=++stateSequence,organizationId=info.headers.get('x-socle-organization-id')||selectedOrganization();
    return originalFetch(input,Object.assign({},init,{cache:'no-store'})).then(function(response){
      if(response.ok){response.clone().json().then(function(body){networkScope(body,info,generation,sequence,true)}).catch(function(){})}
      else if(response.status===401||response.status===403)invalidate();
      return response;
    }).catch(function(error){
      if(generation!==epoch||sequence!==stateSequence||preview(info.headers))throw error;
      return readSnapshot(organizationId).then(function(record){if(!record||!record.state)throw error;lastServedAt=record.savedAt;return new Response(JSON.stringify(Object.assign({},record.payload,{offlineSnapshot:record.savedAt})),{status:200,headers:{'content-type':'application/json'}})});
    });
  };
  document.addEventListener('submit',function(event){
    var form=event.target;if(event.defaultPrevented||!(form instanceof HTMLFormElement)||String(form.method).toUpperCase()!=='POST')return;
    var url=new URL(form.action,location.href);if(url.origin!==location.origin||url.pathname!=='/auth/logout')return;
    event.preventDefault();var buttons=Array.from(form.querySelectorAll('button'));buttons.forEach(function(button){button.disabled=true});
    logoutRequest(url.href,{method:'POST',credentials:'same-origin',body:new FormData(form)}).then(function(response){if(confirmedLogouts.has(response)){location.assign('/login');return}throw Error('Déconnexion non confirmée. Rechargez la page avant de réessayer.')}).catch(function(error){buttons.forEach(function(button){button.disabled=false});if(typeof toast==='function')toast(error.message||'Déconnexion non confirmée. Vos notes restent sur ce téléphone.')});
  },true);
  window.addEventListener('storage',function(event){if(event.key==='socle.offlineLogout'){lastVerifiedUserId=null;invalidate();authLocked=true}else if(['socle.sessionUserId','socle.activeOrganizationId'].includes(event.key)||event.key===null){lastVerifiedUserId=null;invalidate()}});

  function banner(){
    if(!document.body)return null;var node=document.querySelector('[data-offline-banner]');
    if(!node){node=document.createElement('div');node.className='sx-offline-banner';node.dataset.offlineBanner='';node.setAttribute('role','status');node.setAttribute('aria-live','polite');document.body.append(node);node.addEventListener('click',function(event){if(event.target.closest('[data-offline-send]'))flushQueue();else if(event.target.closest('[data-offline-retry]'))flushQueue({retryBlocked:true});else if(event.target.closest('[data-offline-refresh]'))location.reload()})}return node;
  }
  function formatDate(value){try{return new Date(value).toLocaleString('fr-BE',{dateStyle:'short',timeStyle:'short'})}catch(_){return String(value||'')}}
  function escapeHtml(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function renderBanner(items){
    var node=banner();if(!node)return;var scope=currentScope(),rows=scope?(items||[]):[],pending=rows.filter(function(row){return row.status==='pending'}),blocked=rows.filter(function(row){return row.status==='blocked'}),parts=[],online=navigator.onLine;
    if(authLocked)parts.push('Compte local verrouillé · rechargez la page pour confirmer votre connexion.');
    if(!online){parts.push('<strong>Hors connexion</strong>');parts.push(scope?(lastServedAt?'données du '+escapeHtml(formatDate(lastServedAt)):'compte confirmé dans cette page'):'Compte non confirmé dans cette page · reconnectez-vous avant de consulter les données locales.')}
    if(pending.length){parts.push(pending.length+' note(s) en attente');if(online)parts.push('<button type="button" class="btn" data-offline-send>Envoyer</button>')}
    if(blocked.length){parts.push('<details data-offline-resolution><summary>'+blocked.length+' note(s) à résoudre</summary>'+blocked.map(function(row){return '<p>'+escapeHtml(row.projectName||'Chantier')+' · '+escapeHtml(row.text)+'<br>'+escapeHtml(row.lastError||'Envoi refusé.')+'</p>'}).join('')+(online?'<button type="button" class="btn" data-offline-retry>Réessayer après vérification</button>':'')+'</details>')}
    if(!parts.length&&online&&node.dataset.wasOffline==='true')parts.push('<button type="button" class="btn" data-offline-refresh>Actualiser</button>');node.dataset.wasOffline=online?'false':'true';node.hidden=!parts.length;node.innerHTML=parts.join(' · ');
  }

  /* ---------- formulaire de note ---------- */

  function injectNotePanel() {
    if (typeof view === 'undefined' || view !== 'jobWorkspace') return;
    if (typeof currentJobId === 'undefined' || !currentJobId) return;
    if (document.querySelector('[data-offline-note-panel]')) return;
    var main = document.querySelector('#main');
    if (!main) return;
    var projectId = String(currentJobId);
    var job = (typeof jobs !== 'undefined' && Array.isArray(jobs) ? jobs : []).find(function (item) { return String(item.id) === projectId; });
    var section = document.createElement('section');
    section.className = 'panel sx-offline-note';
    section.dataset.offlineNotePanel = '';
    section.innerHTML =
      '<div class="panel-head"><h2>Note de chantier</h2></div>' +
      '<form data-offline-note-form>' +
      '<div class="sx-offline-note-categories" role="group" aria-label="Type de note">' +
      CATEGORIES.map(function (label) {
        return '<button type="button" class="sx-journal-chip" aria-pressed="' + (label === 'Avancement' ? 'true' : 'false') + '" data-offline-category="' + escapeHtml(label) + '">' + escapeHtml(label) + '</button>';
      }).join('') +
      '</div>' +
      '<label>Note<textarea name="text" rows="3" maxlength="250" placeholder="Ce qui a été fait, ce qui bloque, ce qui a été livré…"></textarea></label>' +
      '<p data-offline-note-status role="status" aria-live="polite">La note part dès que le réseau le permet.</p>' +
      '<div class="modal-actions"><button class="btn primary" type="submit">Enregistrer la note</button></div>' +
      '</form>';
    main.append(section);
    var form = section.querySelector('[data-offline-note-form]');
    var status = section.querySelector('[data-offline-note-status]');
    var chosen = 'Avancement';
    section.querySelectorAll('[data-offline-category]').forEach(function (button) {
      button.addEventListener('click', function () {
        chosen = button.dataset.offlineCategory;
        section.querySelectorAll('[data-offline-category]').forEach(function (other) {
          other.setAttribute('aria-pressed', String(other === button));
        });
      });
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var text = String(form.querySelector('[name="text"]').value || '').trim();
      if (!text) { status.textContent = 'Écrivez une note avant d’enregistrer.'; return; }
      queueNote({ projectId: projectId, projectName: job ? job.name : '', category: chosen, text: text })
        .then(function () {
          form.querySelector('[name="text"]').value = '';
          status.textContent = navigator.onLine ? 'Note enregistrée, envoi en cours…' : 'Note gardée sur ce téléphone, elle partira au retour du réseau.';
          if (navigator.onLine) flushQueue();
        })
        .catch(function (error) { status.textContent = error.message || 'La note n’a pas pu être gardée.'; });
    });
  }

  /* ---------- cycle de vie ---------- */

  function enhance() {
    installRenderHook();
    try { injectNotePanel(); } catch (_) {}
    notify();
    maybeFlush();
  }

  /* Le module est charge avant les scripts de l'application : render n'existe
     pas encore. On pose le crochet plus tard, et on le repose si render a ete
     remplace entre-temps par un autre module. */
  function installRenderHook() {
    var current = globalThis.render;
    if (typeof current !== 'function' || current.__offlineWrapped) return;
    var wrapped = function () {
      var result = current.apply(this, arguments);
      enhance();
      return result;
    };
    wrapped.__offlineWrapped = true;
    globalThis.render = wrapped;
  }

  window.addEventListener('online', function () { notify(); flushQueue(); });
  window.addEventListener('offline', function () { notify(); });
  document.addEventListener('DOMContentLoaded', function () { enhance(); if (navigator.onLine) flushQueue(); });
  enhance();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/offline-sw.js', { scope: '/' }).catch(function () {});
    });
  }

  globalThis.socleOffline = {
    saveSnapshot: saveSnapshot,
    readSnapshot: readSnapshot,
    queueNote: queueNote,
    listQueue: listQueue,
    flushQueue: flushQueue,
    clearAll: function () { return Promise.reject(Error('La purge est réservée à une déconnexion confirmée.')); },
    onQueueChange: onQueueChange
  };
})();
