/* Private IFC models. Loaded after v4.js; no route, document or plan is replaced. */
(function(){
'use strict';
let session=null,epoch=0,viewerModule=null,observedMain=null;
const API='/api/project-models';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const organization=()=>String(typeof activeSocleOrganizationId!=='undefined'?activeSocleOrganizationId:globalThis.socleCurrentOrganizationId||'');
const project=()=>String(typeof currentJobId!=='undefined'?currentJobId:'');
const route=()=>JSON.stringify([typeof view!=='undefined'?view:'',typeof jobWorkspaceTab!=='undefined'?jobWorkspaceTab:'',project()]);
function context(){
 const access=globalThis.socleCurrentAccess||{},preview=globalThis.socleAccessPreview;
 return JSON.stringify([organization(),access.userId||'',access.roleCode||'',Boolean(access.owner),(access.permissions||[]).slice().sort(),preview?[preview.userId||'',preview.roleCode||'',preview.memberKey||'']:null,Boolean(globalThis.socleWorkspaceLoading),Boolean(globalThis.socleLimitedSession),typeof storageReady!=='undefined'?storageReady:null,route()]);
}
function eligible(){
 const access=globalThis.socleCurrentAccess||{};
 return typeof view!=='undefined'&&view==='jobWorkspace'&&['documents','v4hub'].includes(typeof jobWorkspaceTab==='undefined'?'':jobWorkspaceTab)&&organization()&&project()&&!globalThis.socleWorkspaceLoading&&(typeof storageReady!=='undefined'&&storageReady===true||globalThis.socleAccessPreviewVerified===true)&&Boolean(access.owner||access.roleCode==='OWNER'||(access.permissions||[]).includes('documents.secure.view'));
}
function current(s){return session===s&&s.epoch===epoch&&s.context===context()&&s.dialog.isConnected&&s.dialog.open&&eligible()}
function cancelled(){return Object.assign(Error('Opération annulée.'),{name:'AbortError'})}
function assertCurrent(s){if(!current(s))throw cancelled()}
function canManage(s){return current(s)&&s.canManage===true&&!globalThis.socleAccessPreview&&!globalThis.socleLimitedSession}
function status(s,message,error=false){if(!current(s))return;const node=s.dialog.querySelector('[data-model-status]');node.textContent=message;node.setAttribute('role',error?'alert':'status');node.classList.toggle('project-models-error',error)}
function report(s,error){if(error.name==='AbortError'||!current(s))return;if(error.status===403){s.canManage=false;applyManagement(s)}status(s,error.message||'Les modèles ne sont pas disponibles.',true)}
function operationKey(){return 'ifc-'+crypto.randomUUID()}
function bytes(value){return new Intl.NumberFormat('fr-BE',{maximumFractionDigits:2}).format(Number(value||0)/1000000)+' Mo'}
function date(value){const d=new Date(value);return Number.isNaN(d.getTime())?'Date inconnue':d.toLocaleString('fr-BE',{dateStyle:'short',timeStyle:'short'})}
function releasePreview(s){
 s.previewSequence++;
 if(s.viewer){s.viewer.removeAttribute('src');s.viewer.remove();s.viewer=null}
 if(s.previewUrl){URL.revokeObjectURL(s.previewUrl);s.previewUrl=null}
 const stage=s.dialog.querySelector('[data-model-stage]');if(stage)stage.replaceChildren();
}
function dispose(s){
 if(!s||s.disposed)return;s.disposed=true;s.controller.abort();releasePreview(s);
 for(const url of s.downloads)URL.revokeObjectURL(url);s.downloads.clear();
 if(session===s){session=null;epoch++}
 s.dialog.remove();
 if(s.returnFocus?.isConnected&&s.context===context())s.returnFocus.focus({preventScroll:true});
}
function dismiss(){const s=session;if(!s){epoch++;return}if(s.dialog.open)s.dialog.close();dispose(s)}
async function request(s,path,options={}){
 assertCurrent(s);
 const headers=new Headers(options.headers||{});headers.set('x-socle-organization-id',s.organizationId);
 if(s.previewUserId)headers.set('x-socle-access-preview-user-id',s.previewUserId);
 const response=await fetch(API+path,{...options,headers,credentials:'same-origin',cache:'no-store',redirect:'error',signal:s.controller.signal});
 assertCurrent(s);
 if(!response.ok){const data=await response.json().catch(()=>({}));assertCurrent(s);const error=Error(data.error||({403:'Accès refusé. Actualisez vos droits.',404:'Ce modèle ou cette version est indisponible.',409:'Le modèle a été modifié. Actualisez la liste avant de réessayer.',413:'La limite de stockage ou de taille est atteinte.',422:'Ce fichier IFC ne peut pas être converti.',503:'La conversion est momentanément indisponible. Réessayez.'}[response.status]||'Le serveur ne répond pas.'));error.status=response.status;throw error}
 return response;
}
async function json(s,path,options){const response=await request(s,path,options),data=await response.json();assertCurrent(s);return data}
function applyManagement(s){s.dialog.querySelectorAll('[data-model-manage]').forEach(node=>{node.hidden=!canManage(s)});s.dialog.querySelectorAll('[data-model-mutation]').forEach(node=>{node.disabled=!canManage(s)||s.saving});s.dialog.querySelectorAll('[data-model-open],[data-model-refresh]').forEach(node=>{node.disabled=s.saving})}
function modelPath(id){return '/'+encodeURIComponent(id)}
function versionPath(modelId,versionId,kind){return modelPath(modelId)+'/versions/'+encodeURIComponent(versionId)+'/'+kind}
function assertModel(s,model){if(!model||String(model.projectId)!==s.projectId||!model.id)throw Error('Le modèle reçu ne correspond pas à ce chantier.')}
function fillList(s){
 const list=s.dialog.querySelector('[data-model-list]');
 list.innerHTML=s.models.length?s.models.map(model=>'<article class="project-models-row"><div><strong>'+escape(model.title)+'</strong><small>Version '+escape(model.latestVersion)+' · '+escape(date(model.createdAt))+'</small></div><button type="button" class="btn" data-model-open="'+escape(model.id)+'">Versions et aperçu</button></article>').join(''):'<p class="project-models-empty">Aucun modèle IFC conservé pour ce chantier.</p>';
 s.dialog.querySelector('[data-model-limit]').textContent='Import pilote IFC4 · '+bytes(s.maxSourceBytes)+' maximum par fichier. Aperçu 3D, sans métrés automatiques ni import SketchUp.';
 applyManagement(s);
}
async function loadList(s){
 const sequence=++s.listSequence;s.dialog.dataset.modelState='loading';status(s,'Chargement des modèles autorisés…');
 try{
 const data=await json(s,'?projectId='+encodeURIComponent(s.projectId));
 if(sequence!==s.listSequence)return;
 if(data.enabled!==true)throw Error('Les modèles IFC ne sont pas activés pour cette entreprise.');
 if(!Array.isArray(data.models))throw Error('La liste des modèles est invalide.');
 data.models.forEach(model=>assertModel(s,model));
 s.models=data.models;s.canManage=data.canManage===true;s.maxSourceBytes=Number(data.limits?.maxSourceBytes)||1800000;
 fillList(s);s.dialog.dataset.modelState='ready';status(s,s.models.length+' modèle(s) disponible(s).');
 }catch(error){if(sequence===s.listSequence){if(current(s))s.dialog.dataset.modelState='error';throw error}}
}
function clearDetail(s){
 s.detailSequence++;s.detail=null;s.selectedVersion=null;releasePreview(s);
 const detail=s.dialog.querySelector('[data-model-detail]');detail.hidden=true;detail.replaceChildren();
 s.dialog.querySelector('[data-model-upload]').replaceChildren();
}
async function openModel(s,id,afterSave=false){
 assertCurrent(s);if(s.saving&&!afterSave)return;
 clearDetail(s);const sequence=s.detailSequence;status(s,'Chargement des versions…');
 try{
 const data=await json(s,modelPath(id));if(sequence!==s.detailSequence)return;
 assertModel(s,data.model);if(String(data.model.id)!==String(id)||!Array.isArray(data.versions))throw Error('Historique du modèle invalide.');
 s.detail=data;s.canManage=data.canManage===true;
 const root=s.dialog.querySelector('[data-model-detail]');root.hidden=false;
 root.innerHTML='<div class="project-models-heading"><div><p class="eyebrow">MODÈLE PRIVÉ</p><h3>'+escape(data.model.title)+'</h3></div><div class="project-models-actions" data-model-manage><button type="button" class="btn" data-model-revision data-model-mutation>Ajouter une révision</button><button type="button" class="btn" data-model-archive data-model-mutation>Archiver le modèle</button></div></div><label class="project-models-version">Version à consulter<select data-model-version><option value="">Choisir une version enregistrée</option>'+data.versions.map(version=>'<option value="'+escape(version.id)+'">Version '+escape(version.version)+' · '+escape(version.filename)+' · '+escape(date(version.createdAt))+'</option>').join('')+'</select></label><p data-model-version-info>Choisissez explicitement la version à afficher ou à télécharger.</p><div class="project-models-actions"><button type="button" class="btn primary" data-model-preview disabled>Afficher cette version en 3D</button><button type="button" class="btn" data-model-source disabled>Télécharger la source IFC</button></div><p class="subtle">Rotation : glisser avec un doigt ou la souris. Zoom : pincer ou utiliser la molette. Déplacement : deux doigts ou Maj + glisser.</p><div class="project-models-stage" data-model-stage></div>';
 applyManagement(s);status(s,'Historique chargé. Choisissez une version.');
 }catch(error){if(sequence===s.detailSequence)throw error}
}
function chooseVersion(s,value){
 if(!s.detail)return;releasePreview(s);
 s.selectedVersion=s.detail.versions.find(version=>String(version.id)===String(value))||null;
 const selected=s.selectedVersion,root=s.dialog.querySelector('[data-model-detail]');
 root.querySelector('[data-model-preview]').disabled=!selected;root.querySelector('[data-model-source]').disabled=!selected;
 root.querySelector('[data-model-version-info]').textContent=selected?'Version '+selected.version+(Number(selected.version)<Number(s.detail.model.latestVersion)?' · HISTORIQUE':' · dernière version enregistrée')+' · '+selected.schema+' · '+bytes(selected.sourceBytes)+' · '+Number(selected.objectCount||0)+' objet(s). Importée le '+date(selected.createdAt)+'.':'Choisissez explicitement la version à afficher ou à télécharger.';
 status(s,selected?'Version '+selected.version+' sélectionnée. Lancez l’aperçu ou téléchargez sa source.':'Choisissez une version.');
}
async function checkHash(buffer,expected){
 if(!/^[a-f0-9]{64}$/i.test(String(expected||'')))throw Error('Empreinte de cette version absente : fichier refusé.');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),value=>value.toString(16).padStart(2,'0')).join('');
 if(hash!==expected.toLowerCase())throw Error('Le fichier ne correspond pas à l’empreinte enregistrée. Téléchargement et aperçu refusés.');
}
function checkGlb(buffer){
 const view=new DataView(buffer);
 if(buffer.byteLength<20||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==buffer.byteLength)throw Error('Aperçu GLB invalide.');
 const length=view.getUint32(12,true);if(length%4||length>buffer.byteLength-20||view.getUint32(16,true)!==0x4e4f534a)throw Error('Structure GLB invalide.');
 const manifest=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,length)));
 if(manifest.asset?.version!=='2.0'||!Array.isArray(manifest.scenes)||!Array.isArray(manifest.meshes))throw Error('Contenu GLB non pris en charge.');
 const blocked=['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'];
 if([...(manifest.extensionsUsed||[]),...(manifest.extensionsRequired||[])].some(item=>blocked.includes(item)))throw Error('Cet aperçu requiert un décodeur externe et ne peut pas être ouvert.');
 const pending=[manifest];while(pending.length){const value=pending.pop();if(!value||typeof value!=='object')continue;for(const [key,child] of Object.entries(value)){if(key==='uri')throw Error('Une ressource externe est présente dans l’aperçu : ouverture refusée.');if(child&&typeof child==='object')pending.push(child)}}
 return manifest;
}
function viewerURL(value){
 let url;try{url=new URL(String(value),location.href)}catch{throw Error('Adresse de ressource 3D invalide.')}
 const local=['https:','http:'].includes(url.protocol)&&url.origin===location.origin&&!url.username&&!url.password;
 if(local||url.protocol==='blob:'&&url.origin===location.origin||url.protocol==='data:')return url.href;
 throw Error('Une ressource 3D externe a été refusée.');
}
function disableViewerCodecs(Viewer){
 // In 4.4.0 the element constructor resets these paths. Apply AFTER construction,
 // before src/connection. No codec is supplied: compressed GLB is rejected above.
 Viewer.dracoDecoderLocation='/__project-model-codecs-disabled__/draco/';
 Viewer.ktx2TranscoderLocation='/__project-model-codecs-disabled__/ktx2/';
 Viewer.lottieLoaderLocation='/__project-model-codecs-disabled__/lottie.js';
 // Never assign meshoptDecoderLocation: its setter eagerly injects a script.
}
async function loadViewer(){
 if(!viewerModule)viewerModule=import('./model-viewer.min.js').catch(error=>{viewerModule=null;throw error});
 await viewerModule;const Viewer=customElements.get('model-viewer');if(!Viewer)throw Error('Le lecteur 3D local est indisponible.');
 if(typeof Viewer.mapURLs!=='function')throw Error('Le lecteur 3D local ne permet pas de filtrer ses ressources.');
 Viewer.modelCacheSize=0;
 Viewer.mapURLs(viewerURL);
 return Viewer;
}
async function showPreview(s){
 assertCurrent(s);const version=s.selectedVersion,model=s.detail?.model;if(!version||!model)return;
 releasePreview(s);const sequence=s.previewSequence;status(s,'Chargement privé et vérification de la version '+version.version+'…');
 const owns=()=>current(s)&&s.previewSequence===sequence&&s.selectedVersion===version;
 try{
  const response=await request(s,versionPath(model.id,version.id,'preview'));
  if(!owns())return;
  const contentType=response.headers.get('content-type')||'';if(!/^model\/gltf-binary(?:;|$)/i.test(contentType))throw Error('Le serveur n’a pas fourni un aperçu GLB.');
  const buffer=await response.arrayBuffer();if(!owns())return;
  if(buffer.byteLength>8388608||buffer.byteLength!==Number(version.previewBytes))throw Error('Taille de l’aperçu incohérente.');
  await checkHash(buffer,version.previewSha256);if(!owns())return;checkGlb(buffer);
  const Viewer=await loadViewer();if(!owns())return;
  const node=document.createElement('model-viewer');s.viewer=node;disableViewerCodecs(Viewer);
  node.setAttribute('camera-controls','');node.setAttribute('touch-action','pan-y');node.setAttribute('interaction-prompt','none');node.setAttribute('environment-image','neutral');node.setAttribute('shadow-intensity','0');node.setAttribute('alt',model.title+' · version '+version.version);node.setAttribute('aria-label',model.title+' · version '+version.version);node.setAttribute('tabindex','0');
  node.addEventListener('load',()=>{if(owns())status(s,'Version '+version.version+' affichée · empreinte vérifiée. Faites pivoter la maquette pour l’inspecter.')},{once:true});
  node.addEventListener('error',()=>{if(!owns())return;releasePreview(s);status(s,'Le lecteur 3D ne peut pas afficher cette version. Sa source IFC reste téléchargeable.',true)},{once:true});
  s.previewUrl=URL.createObjectURL(new Blob([buffer],{type:'model/gltf-binary'}));node.setAttribute('src',s.previewUrl);s.dialog.querySelector('[data-model-stage]').append(node);status(s,'Version vérifiée. Initialisation du rendu 3D…');
 }catch(error){if(owns()){releasePreview(s);report(s,error)}}
}
async function downloadSource(s,button){
 assertCurrent(s);const version=s.selectedVersion,model=s.detail?.model;if(!version||!model)return;const sequence=s.detailSequence;
 const owns=()=>current(s)&&s.detailSequence===sequence&&s.selectedVersion===version;
 button.disabled=true;status(s,'Vérification de la source IFC privée…');
 try{
  const response=await request(s,versionPath(model.id,version.id,'source')),buffer=await response.arrayBuffer();if(!owns())return;
  if(buffer.byteLength!==Number(version.sourceBytes)||buffer.byteLength>s.maxSourceBytes)throw Error('Taille de la source IFC incohérente.');
  await checkHash(buffer,version.sourceSha256);if(!owns())return;
  const url=URL.createObjectURL(new Blob([buffer],{type:'application/x-step'})),link=document.createElement('a');s.downloads.add(url);link.href=url;link.download=String(version.filename||'modele.ifc').replace(/[\\/\x00-\x1f]/g,'_');s.dialog.append(link);link.click();link.remove();
  setTimeout(()=>{URL.revokeObjectURL(url);s.downloads.delete(url)},1000);status(s,'Téléchargement de la source de version '+version.version+' demandé · empreinte vérifiée.');
 }catch(error){if(owns())report(s,error)}finally{if(owns())button.disabled=false}
}
function uploadForm(s,revision){
 if(!canManage(s)||s.saving)return;
 const model=revision?s.detail?.model:null;if(revision&&!model)return;
 const target=s.dialog.querySelector('[data-model-upload]');
 target.innerHTML='<form class="project-models-import" data-model-form><h3>'+(model?'Nouvelle révision · '+escape(model.title):'Nouveau modèle IFC')+'</h3><p>Le fichier et son aperçu sont conservés dans ce chantier. Une révision ajoute une version sans remplacer l’historique.</p>'+(!model?'<label>Nom du modèle<input name="title" required maxlength="160" autocomplete="off" placeholder="Ex. Structure — bâtiment A"></label>':'')+'<label>Source IFC4<input name="file" type="file" accept=".ifc,application/x-step" required></label><p class="subtle">'+bytes(s.maxSourceBytes)+' maximum. La conversion peut prendre jusqu’à 30 secondes.</p><div class="project-models-actions"><button type="submit" class="btn primary" data-model-mutation>Importer et conserver '+(model?'la révision':'le modèle')+'</button><button type="button" class="btn" data-model-cancel-upload>Annuler</button></div><p data-model-form-status role="status" aria-live="polite"></p></form>';
 const form=target.firstElementChild;form.modelTarget=model?{id:String(model.id),title:String(model.title),expectedVersion:Number(model.latestVersion)}:{expectedVersion:0};
 form.querySelector('input').focus();
}
async function upload(s,form){
 if(!canManage(s)||s.saving||!form.isConnected)return;
 const file=form.elements.file.files[0],target=form.modelTarget,title=target.title||String(form.elements.title?.value||'').trim(),formStatus=form.querySelector('[data-model-form-status]');
 if(!file||!file.size||file.size>s.maxSourceBytes||!file.name.toLowerCase().endsWith('.ifc')){formStatus.textContent='Choisissez un fichier .ifc de '+bytes(s.maxSourceBytes)+' maximum.';return}
 if(!title){formStatus.textContent='Donnez un nom à ce modèle.';return}
 const fingerprint=JSON.stringify([title,file.name,file.size,file.lastModified,target.id||'',target.expectedVersion]);
 if(form.operationFingerprint!==fingerprint){form.operationFingerprint=fingerprint;form.operationKey=operationKey()}
 s.saving=true;applyManagement(s);form.querySelector('[data-model-cancel-upload]').disabled=true;form.querySelectorAll('input').forEach(node=>node.disabled=true);formStatus.textContent='Conversion IFC4 et enregistrement privés en cours…';
 try{
  const headers={'content-type':'application/x-step','x-model-project-id':s.projectId,'x-model-title':encodeURIComponent(title),'x-model-filename':encodeURIComponent(file.name),'x-model-operation-key':form.operationKey,'x-model-expected-version':String(target.expectedVersion)};
  const result=await json(s,target.id?modelPath(target.id)+'/versions':'',{method:'POST',headers,body:file});assertModel(s,result.model);
  if(!result.version?.id)throw Error('Le serveur n’a pas confirmé la version enregistrée.');
  clearDetail(s);await loadList(s);await openModel(s,result.model.id,true);chooseVersion(s,String(result.version.id));status(s,'Version '+result.version.version+' enregistrée'+(result.replayed?' · opération déjà reçue.':'.')+' Lancez l’aperçu pour la consulter.');
 }catch(error){if(current(s)){s.saving=false;applyManagement(s);if(form.isConnected){form.querySelector('[data-model-cancel-upload]').disabled=false;form.querySelectorAll('input').forEach(node=>node.disabled=false);formStatus.textContent=error.message||'Import impossible. Vous pouvez réessayer le même fichier.'}report(s,error)}}
 finally{if(current(s)){s.saving=false;applyManagement(s)}}
}
function archivePrompt(s){
 if(!canManage(s)||!s.detail||s.saving)return;
 const root=s.dialog.querySelector('[data-model-upload]');root.innerHTML='<div class="project-models-import"><h3>Archiver '+escape(s.detail.model.title)+' ?</h3><p>Le modèle et ses fichiers ne seront plus consultables. Son historique restera conservé dans le stockage privé.</p><div class="project-models-actions"><button type="button" class="btn" data-model-confirm-archive data-model-mutation>Confirmer l’archivage</button><button type="button" class="btn" data-model-cancel-upload>Annuler</button></div></div>';
 s.archiveKey=operationKey();root.querySelector('button').focus();
}
async function archive(s){
 if(!canManage(s)||!s.detail||s.saving)return;
 const model=s.detail.model;s.saving=true;applyManagement(s);
 try{await json(s,modelPath(model.id)+'/archive',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedVersion:Number(model.latestVersion),operationKey:s.archiveKey})});clearDetail(s);await loadList(s);status(s,'Modèle archivé. Son historique reste conservé dans le stockage privé.')}
 catch(error){report(s,error)}finally{if(current(s)){s.saving=false;applyManagement(s)}}
}
async function action(s,event){
 const button=event.target.closest?.('button');if(!button||button.disabled||!current(s))return;
 if(button.hasAttribute('data-model-close')){dismiss();return}
 try{
  if(button.hasAttribute('data-model-refresh')){if(s.saving)return;clearDetail(s);await loadList(s)}
  else if(button.hasAttribute('data-model-open'))await openModel(s,button.dataset.modelOpen);
  else if(button.hasAttribute('data-model-new'))uploadForm(s,false);
  else if(button.hasAttribute('data-model-revision'))uploadForm(s,true);
  else if(button.hasAttribute('data-model-preview'))await showPreview(s);
  else if(button.hasAttribute('data-model-source'))await downloadSource(s,button);
  else if(button.hasAttribute('data-model-archive'))archivePrompt(s);
  else if(button.hasAttribute('data-model-confirm-archive'))await archive(s);
  else if(button.hasAttribute('data-model-cancel-upload')&&!s.saving)s.dialog.querySelector('[data-model-upload]').replaceChildren();
 }catch(error){report(s,error)}
}
function open(){
 if(!eligible())return;dismiss();
 const dialog=document.createElement('dialog');dialog.id='projectModelsDialog';dialog.className='project-models-dialog';dialog.setAttribute('aria-labelledby','projectModelsTitle');
 const job=typeof jobs!=='undefined'?jobs.find(item=>String(item.id)===project()):null;
 dialog.innerHTML='<div class="project-models-top"><div><p class="eyebrow">DOCUMENTS DU CHANTIER · IFC4</p><h2 id="projectModelsTitle">Modèles 3D privés</h2><p>'+escape(job?.name||'Chantier')+'</p></div><button type="button" class="btn" data-model-close aria-label="Fermer les modèles 3D">Fermer</button></div><p data-model-limit>Import pilote IFC4. Chargement des limites…</p><div class="project-models-actions"><button type="button" class="btn primary" data-model-new data-model-manage data-model-mutation hidden>Importer un modèle IFC</button><button type="button" class="btn" data-model-refresh>Actualiser la liste</button></div><p data-model-status role="status" aria-live="polite">Chargement…</p><div data-model-list></div><section data-model-detail class="project-models-detail" hidden></section><div data-model-upload data-model-manage hidden></div>';
 const s={dialog,epoch:++epoch,context:context(),organizationId:organization(),projectId:project(),previewUserId:String(globalThis.socleAccessPreview?.userId||''),controller:new AbortController(),returnFocus:document.activeElement,canManage:false,saving:false,models:[],maxSourceBytes:1800000,listSequence:0,detailSequence:0,previewSequence:0,downloads:new Set()};
 session=s;document.body.append(dialog);dialog.addEventListener('close',()=>dispose(s),{once:true});dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss()});dialog.addEventListener('click',event=>{if(event.target===dialog){const bounds=dialog.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dismiss();return}action(s,event)});
 dialog.addEventListener('change',event=>{if(current(s)&&event.target.hasAttribute('data-model-version'))chooseVersion(s,event.target.value)});
 dialog.addEventListener('submit',event=>{if(event.target.hasAttribute('data-model-form')){event.preventDefault();upload(s,event.target)}});
 dialog.showModal();dialog.querySelector('[data-model-close]').focus();loadList(s).catch(error=>report(s,error));
}
function enhance(){
 if(session&&!current(session))dismiss();
 const main=document.querySelector('#main');if(!main)return;
 if(observedMain!==main){observer.disconnect();observer.observe(main,{childList:true,subtree:true});observedMain=main}
 const existing=main.querySelector('[data-project-models-entry]');
 if(!eligible()){if(existing)existing.remove();return}
 if(existing&&existing.dataset.projectId===project())return;
 if(existing)existing.remove();
 const section=document.createElement('section');section.className='panel project-models-entry';section.dataset.projectModelsEntry='';section.dataset.projectId=project();section.innerHTML='<div><p class="eyebrow">DOCUMENTS DU CHANTIER</p><h2>Modèles IFC privés</h2><p>Sources IFC4, versions conservées et aperçu 3D du chantier. Aucun métré automatique.</p></div><button type="button" class="btn" data-project-models-open>Ouvrir les modèles 3D</button>';
 const tools=main.querySelector('#v5JobTools');if(tools){const grid=tools.querySelector('.v4-grid');if(grid)grid.prepend(section);else tools.append(section);for(const paragraph of tools.querySelectorAll('p'))if(paragraph.textContent==='La lecture de maquette IFC et la génération automatique d’un DOE ne sont pas disponibles. Les documents et plans existants restent consultables.')paragraph.textContent='Les modèles IFC4 privés se consultent dans « Modèles IFC privés ». Les pièces et leurs révisions restent accessibles ; le DOE automatique n’est pas disponible.'}
 else{const panel=main.querySelector('.panel');if(panel)panel.after(section);else main.append(section)}
}
const observer=new MutationObserver(()=>enhance());
document.addEventListener('click',event=>{if(event.target.closest?.('[data-project-models-open]')){event.preventDefault();open()}});
const baseRender=globalThis.render;if(typeof baseRender==='function')globalThis.render=function(){const result=baseRender.apply(this,arguments);enhance();queueMicrotask(enhance);return result};
for(const name of ['navigate','setActiveSocleOrganizationId','loadWorkspace']){const base=globalThis[name];if(typeof base==='function')globalThis[name]=function(){dismiss();return base.apply(this,arguments)}}
globalThis.addEventListener('pagehide',dismiss);
globalThis.socleProjectModels=Object.freeze({open,close:dismiss,refresh:enhance});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',enhance,{once:true});else enhance();
})();
