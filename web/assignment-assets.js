/* One assignment, the existing field_assets IDs, and dated custody events. */
(function(){
 'use strict';
 let sequence=0,activeDesk=null;
 const retryKeys=new Map();
 const dialog=()=>document.querySelector('#modal');
 const body=()=>document.querySelector('#modalbody');
 const text=value=>String(value??'');
 const html=value=>text(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const organization=()=>text(globalThis.socleCurrentOrganizationId||(typeof activeSocleOrganizationId!=='undefined'?activeSocleOrganizationId:''));
 const currentView=()=>typeof view==='undefined'?'':view;
 const unique=values=>[...new Set((Array.isArray(values)?values:[]).map(String).filter(Boolean))];
 const assignmentUrl=id=>'/api/assignments/'+encodeURIComponent(id)+'/assets';
 const availabilityUrl=id=>'/api/assets/'+encodeURIComponent(id)+'/availability';
 const rootSelector=type=>type==='assignment'?'#assignmentAssetsDesk':'#assignmentAssetAvailabilityDesk';
 const request=(url,options={},org=organization())=>serverJson(url,{...options,...(org?{socleOrganizationId:org}:{})});
 const statusLabels={planned:'Prévue',confirmed:'Confirmée',blocked:'Bloquée',cancelled:'Annulée'};
 const kindLabels={unknown:'Référence historique',vehicle:'Véhicule',vehicles:'Véhicule',pack:'Pack',tools:'Outillage',tool:'Outil',extra:'Moyen complémentaire'};
 const availabilityLabels={available:'Disponible sur ce créneau',blocked:'Indisponible sur ce créneau',out:'Prise non clôturée'};
 const referenceLabel=r=>(r.reference?'Réf. '+r.reference+' · ID OUVRANE ':'ID OUVRANE ')+text(r.id);
 function moment(value,timeZone=activeDesk?.data.timeZone||'Europe/Brussels'){
  if(!value)return 'Date non renseignée';
  const raw=text(value),local=raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/);
  if(local)return local[3]+'/'+local[2]+'/'+local[1]+' · '+local[4];
  const date=new Date(raw);if(Number.isNaN(date.getTime()))return raw;
  return new Intl.DateTimeFormat('fr-BE',{dateStyle:'short',timeStyle:'short',timeZone}).format(date);
 }
 function isCurrent(desk){return activeDesk===desk&&desk.sequence===sequence&&desk.root.isConnected&&document.querySelector(rootSelector(desk.type))===desk.root&&dialog()?.open&&desk.view===currentView()&&desk.organization===organization()}
 function invalidate(){sequence++;activeDesk=null}
 function ticket(){return {sequence:++sequence,origin:body()?.firstElementChild,view:currentView(),organization:organization(),open:!!dialog()?.open}}
 function validTicket(t){return t.sequence===sequence&&t.origin===body()?.firstElementChild&&t.view===currentView()&&t.organization===organization()&&(!t.open||dialog()?.open)}
 function deskFor(type,id,data,root,restore=false){
  let saved={};if(restore)try{saved=JSON.parse(root.dataset.assetDraft||'{}')}catch(_){}
  const desk={type,id:text(id),data,root,sequence,organization:organization(),view:currentView(),query:saved.query||'',selected:new Set(unique(saved.selected||data.extras)),returnNotes:saved.returnNotes||{},resolveNotes:saved.resolveNotes||{},blockDraft:saved.blockDraft||{},message:'',busy:false,loading:false,mustRefresh:false,readSequence:0};
  root.dataset[type==='assignment'?'assignmentId':'assetId']=desk.id;activeDesk=desk;persist(desk);return desk;
 }
 function persist(desk){
  desk.root.dataset.assetState=JSON.stringify(desk.data);desk.root.dataset.assetOrganization=desk.organization;
  desk.root.dataset.assetDraft=JSON.stringify({query:desk.query,selected:[...desk.selected],returnNotes:desk.returnNotes,resolveNotes:desk.resolveNotes,blockDraft:desk.blockDraft});
 }
 function resources(desk){
  const result=new Map();for(const r of desk.data.resources||[]){const id=text(r.id),old=result.get(id);if(!old||r.fixed===true||r.fixed===undefined&&(r.kind==='vehicle'||r.kind==='pack'))result.set(id,{...r,id})}return [...result.values()];
 }
 function fixedResources(desk){return resources(desk).filter(r=>r.fixed===true||r.fixed===undefined&&(r.kind==='vehicle'||r.kind==='pack'))}
 function findAsset(desk,id){return resources(desk).find(r=>r.id===text(id))||(desk.data.options||[]).find(r=>text(r.id)===text(id))||{id:text(id),name:'Matériel '+id,known:false}}
 function fixedIds(desk){return new Set(fixedResources(desk).map(r=>r.id))}
 function selectedExtras(desk){const fixed=fixedIds(desk);return [...desk.selected].filter(id=>!fixed.has(id)).sort()}
 function blocked(desk){return desk.busy||desk.loading||desk.mustRefresh}
 function disabled(value){return value?' disabled':''}
 function badge(resource){
  const missing=resource.known===false,archived=resource.archived===true,unavailable=resource.blocked===true||resource.availability==='blocked',value=missing?'Référence introuvable':archived?'Matériel archivé':unavailable?availabilityLabels.blocked+(resource.availability==='out'?' · prise non clôturée':''):availabilityLabels[resource.availability]||'Disponibilité à confirmer';
  const state=missing||archived?'unknown':unavailable?'blocked':resource.availability||'unknown';
  return '<span class="assignment-assets-badge" data-availability="'+html(state)+'">'+html(value)+'</span>';
 }
 function blocksHtml(blocks){
  return (blocks||[]).filter(b=>!b.resolved).map(b=>'<li><strong>'+html(b.reason||'Indisponibilité')+'</strong><br>'+html(moment(b.startsAt))+' → '+html(b.endsAt?moment(b.endsAt):'fin non définie')+'</li>').join('');
 }
 function resourceHtml(desk,r){
  const id=html(r.id),notes=desk.returnNotes[r.id]||'',canAvailability=desk.data.canManageAvailability===true&&r.known!==false&&!r.archived;
  return '<article class="assignment-assets-card" data-resource-id="'+id+'"><div class="assignment-assets-card-heading"><div><h4>'+html(r.name||'Matériel '+r.id)+'</h4><p class="assignment-assets-meta">'+html(kindLabels[r.kind]||r.kind||'Moyen')+' · '+html(referenceLabel(r))+'</p></div>'+badge(r)+'</div>'+
   (r.known===false?'<p class="assignment-assets-warning">Cette référence est conservée dans l’affectation mais ne correspond pas à un actif connu. Le bureau doit corriger la préparation.</p>':'')+
   (r.archived?'<p class="assignment-assets-warning">Cet actif est archivé. Vérifiez son remplacement avec le bureau.</p>':'')+
   ((r.blocks||[]).some(b=>!b.resolved)?'<ul class="assignment-assets-blocks">'+blocksHtml(r.blocks)+'</ul>':'')+
   (r.custody?'<p>Prise enregistrée le '+html(moment(r.custody.takenAt))+(text(r.custody.assignmentId)!==desk.id?' · pour une autre affectation':'')+'. Le retour reste à confirmer.</p>':'')+
   '<div class="assignment-assets-actions">'+(r.canTake===true?'<button type="button" class="btn primary" data-action="take" data-asset-id="'+id+'"'+disabled(blocked(desk))+'>Confirmer la prise</button>':'')+
   (canAvailability?'<button type="button" class="btn" data-action="availability" data-asset-id="'+id+'"'+disabled(desk.busy)+'>Gérer les indisponibilités</button>':'')+'</div>'+
   (r.canReturn===true?'<div class="assignment-assets-return"><label>Note de retour (facultative)<input data-return-note data-asset-id="'+id+'" maxlength="500" value="'+html(notes)+'"'+disabled(blocked(desk))+'></label><button type="button" class="btn primary" data-action="return" data-asset-id="'+id+'"'+disabled(blocked(desk)||!r.custody?.takeId)+'>Confirmer le retour</button></div>':'')+'</article>';
 }
 function historyHtml(desk,events,availability=false){
  const labels=availability?{block:'Indisponibilité enregistrée',resolve:'Indisponibilité clôturée'}:{reserve:'Réservation mise à jour',take:'Prise confirmée',return:'Retour confirmé'};
  return '<details class="assignment-assets-history"><summary>Historique récent ('+(events||[]).length+')</summary>'+((events||[]).length?'<ol>'+events.map(e=>{
   const ids=e.assetId?[e.assetId]:e.assetIds||[],names=availability?'':ids.map(id=>findAsset(desk,id).name||id).join(', ');
   return '<li><strong>'+html(labels[e.kind]||e.kind)+'</strong> · '+html(moment(e.createdAt))+(names?'<br>'+html(names):'')+(e.note?'<p>'+html(e.note)+'</p>':'')+'</li>';
  }).join('')+'</ol>':'<p>Aucun événement enregistré.</p>')+(desk.data.historyTruncated?'<p class="assignment-assets-warning">L’historique affiché est limité aux événements récents.</p>':'')+'</details>';
 }
 function renderAssignment(desk){
  if(!isCurrent(desk))return;
  const d=desk.data,a=d.assignment||{},fixed=fixedResources(desk),fixedSet=fixedIds(desk),extras=resources(desk).filter(r=>!fixedSet.has(r.id)),cancelled=a.status==='cancelled';
  desk.root.innerHTML='<header class="assignment-assets-summary"><div><p class="eyebrow">MOYENS DE L’ÉQUIPE</p><h3>'+html(a.date)+' · '+html(a.startTime)+'–'+html(a.endTime)+'</h3><p>Affectation '+html(a.id)+' · '+html(statusLabels[a.status]||a.status)+(d.timeZone?' · '+html(d.timeZone):'')+'</p></div><button type="button" class="btn" data-action="reload"'+disabled(desk.busy||desk.loading)+'>Actualiser</button></header>'+
   (cancelled?'<p class="assignment-assets-warning">Cette affectation est annulée. Les retours encore autorisés restent accessibles.</p>':'')+
   '<p>'+(d.canManage===true?'Réservez les moyens pour ce créneau, puis confirmez leur prise et leur retour.':'Consultez les moyens prévus et confirmez leur prise ou leur retour avec les actions autorisées.')+' Une réservation et une prise sont deux événements distincts.</p>'+
   '<section aria-labelledby="assignmentAssetsLegacyTitle"><h3 id="assignmentAssetsLegacyTitle">Véhicule et pack du planning</h3>'+(fixed.length?'<div class="assignment-assets-grid">'+fixed.map(r=>resourceHtml(desk,r)).join('')+'</div>':'<p>Aucun véhicule ou pack indiqué dans cette affectation.</p>')+'</section>'+
   '<section aria-labelledby="assignmentAssetsExtraTitle"><h3 id="assignmentAssetsExtraTitle">Moyens complémentaires réservés</h3>'+(extras.length?'<div class="assignment-assets-grid">'+extras.map(r=>resourceHtml(desk,r)).join('')+'</div>':'<p>Aucun moyen complémentaire réservé.</p>')+'</section>'+
   (d.canManage===true?'<section class="assignment-assets-picker" aria-labelledby="assignmentAssetsPickerTitle"><h3 id="assignmentAssetsPickerTitle">Préparer les moyens complémentaires</h3><p>Le véhicule et le pack ci-dessus sont conservés. Chaque actif est compté une seule fois dans la réservation.</p><label for="assignmentAssetsSearch">Rechercher parmi les moyens proposés</label><input id="assignmentAssetsSearch" type="search" maxlength="140" value="'+html(desk.query)+'" placeholder="Nom ou référence" autocomplete="off"><p id="assignmentAssetsOptionsCount" class="assignment-assets-meta" role="status"></p><div id="assignmentAssetsOptions"></div>'+(d.optionsTruncated?'<p class="assignment-assets-warning" data-options-truncated>Seuls les 200 premiers moyens sont proposés. La recherche filtre cette liste ; elle ne consulte pas les moyens non chargés.</p>':'')+'<div id="assignmentAssetsSelected"></div><button id="assignmentAssetsReserve" type="button" class="btn primary" data-action="reserve"'+disabled(blocked(desk)||cancelled)+'>Enregistrer la réservation</button></section>':'<p class="assignment-assets-meta">La réservation des moyens est gérée par le bureau. Les actions de prise et retour dépendent de vos droits et de l’affectation.</p>')+
   '<p id="assignmentAssetsStatus" class="assignment-assets-status" role="status" aria-live="polite">'+html(desk.message)+'</p>'+historyHtml(desk,d.history);
  renderSelection(desk);persist(desk);
 }
 function renderSelection(desk){
  if(!isCurrent(desk)||desk.type!=='assignment')return;
  const optionsRoot=desk.root.querySelector('#assignmentAssetsOptions');if(!optionsRoot)return;
  const fixed=fixedIds(desk),all=new Map();for(const r of desk.data.options||[])if(!fixed.has(text(r.id)))all.set(text(r.id),r);
  const q=desk.query.trim().toLocaleLowerCase('fr'),options=[...all.values()].filter(r=>!q||[r.name,r.id,r.reference,kindLabels[r.kind]||r.kind].join(' ').toLocaleLowerCase('fr').includes(q));
  optionsRoot.innerHTML=options.length?options.map(r=>{
   const id=text(r.id),selected=desk.selected.has(id),unavailable=r.known===false||r.archived===true||r.blocked===true||r.availability==='blocked',reasons=(r.blocks||[]).filter(b=>!b.resolved).map(b=>b.reason).filter(Boolean);
   return '<label class="assignment-assets-option"><input type="checkbox" data-asset-id="'+html(id)+'" value="'+html(id)+'"'+(selected?' checked':'')+disabled(blocked(desk)||desk.data.assignment?.status==='cancelled'||unavailable&&!selected)+'><span><strong>'+html(r.name||id)+'</strong><small>'+html(kindLabels[r.kind]||r.kind||'Moyen')+' · '+html(referenceLabel(r))+'</small>'+badge(r)+(reasons.length?'<span class="assignment-assets-option-reason">'+html(reasons.join(' · '))+'</span>':'')+'</span></label>';
  }).join(''):'<p>Aucun moyen proposé ne correspond à cette recherche.</p>';
  const selected=selectedExtras(desk),selectedRoot=desk.root.querySelector('#assignmentAssetsSelected');
  selectedRoot.innerHTML='<h4>'+selected.length+' moyen(s) complémentaire(s) sélectionné(s)</h4>'+(selected.length?'<ul>'+selected.map(id=>{const r=findAsset(desk,id);return '<li><span>'+html(r.name||id)+' · '+html(referenceLabel(r))+(r.known===false?' · référence introuvable':'')+'</span><button class="btn" type="button" data-action="remove-extra" data-asset-id="'+html(id)+'" aria-label="Retirer '+html(r.name||id)+'"'+disabled(blocked(desk)||desk.data.assignment?.status==='cancelled')+'>Retirer</button></li>'}).join('')+'</ul>':'<p>Ajoutez des moyens avec les cases ci-dessus.</p>');
  desk.root.querySelector('#assignmentAssetsOptionsCount').textContent=options.length+' résultat(s) dans les '+all.size+' moyens chargés.';
  persist(desk);
 }
 function renderAvailability(desk){
  if(!isCurrent(desk))return;
  const d=desk.data,asset=d.asset||{},manage=d.canManage===true,draft=desk.blockDraft;
  if(!draft.startsAt)draft.startsAt=d.businessDate?d.businessDate+'T07:00':'';
  desk.root.innerHTML='<section id="assignmentAssetAvailability"><header class="assignment-assets-summary"><div><p class="eyebrow">DISPONIBILITÉS</p><h3>'+html(asset.name||'Matériel '+desk.id)+'</h3><p>Réf. '+html(asset.id||desk.id)+' · '+html(d.timeZone||'Heure locale de l’entreprise')+'</p></div><button type="button" class="btn" data-action="reload"'+disabled(desk.busy||desk.loading)+'>Actualiser</button></header><p>Enregistrez les périodes de réparation, d’entretien ou d’indisponibilité de cet actif.</p>'+
   '<div class="assignment-assets-block-list">'+((d.blocks||[]).length?d.blocks.map(b=>'<article class="assignment-assets-card" data-block-id="'+html(b.id)+'"><h4>'+html(b.reason||'Indisponibilité')+'</h4><p>'+html(moment(b.startsAt))+' → '+html(b.endsAt?moment(b.endsAt):'fin non définie')+'</p><p class="assignment-assets-meta">'+(b.resolved?'Clôturée'+(b.resolvedAt?' le '+html(moment(b.resolvedAt)):''):'Indisponibilité active')+'</p>'+(b.resolutionNote?'<p>'+html(b.resolutionNote)+'</p>':'')+(manage&&!b.resolved?'<label>Note de remise à disposition (facultative)<input maxlength="500" data-resolve-note data-block-id="'+html(b.id)+'" value="'+html(desk.resolveNotes[b.id]||'')+'"'+disabled(blocked(desk))+'></label><button type="button" class="btn" data-action="resolve" data-block-id="'+html(b.id)+'"'+disabled(blocked(desk))+'>Remettre à disposition</button>':'')+'</article>').join(''):'<p>Aucune période d’indisponibilité enregistrée.</p>')+'</div>'+
   (manage?'<form data-asset-block-form class="assignment-assets-block-form"><h3>Ajouter une indisponibilité</h3><div class="assignment-assets-date-grid"><label for="assignmentAssetsBlockStart">Début<input id="assignmentAssetsBlockStart" name="startsAt" type="datetime-local" required value="'+html(draft.startsAt)+'"'+disabled(blocked(desk))+'></label><label for="assignmentAssetsBlockEnd">Fin (facultative)<input id="assignmentAssetsBlockEnd" name="endsAt" type="datetime-local" value="'+html(draft.endsAt||'')+'"'+disabled(blocked(desk))+'></label></div><label for="assignmentAssetsBlockReason">Motif<input id="assignmentAssetsBlockReason" name="reason" required maxlength="500" value="'+html(draft.reason||'')+'" placeholder="Réparation, contrôle, entretien…"'+disabled(blocked(desk))+'></label><p class="assignment-assets-meta">Sans date de fin, l’indisponibilité reste ouverte jusqu’à sa clôture. Horaires en '+html(d.timeZone||'heure locale de l’entreprise')+'.</p><button type="submit" class="btn primary" data-action="block"'+disabled(blocked(desk))+'>Enregistrer l’indisponibilité</button></form>':'<p class="assignment-assets-meta">La modification des indisponibilités est réservée au bureau autorisé.</p>')+
   '<p id="assignmentAssetsStatus" class="assignment-assets-status" role="status" aria-live="polite">'+html(desk.message)+'</p>'+historyHtml(desk,d.history,true)+'</section>';
  persist(desk);
 }
 function render(desk){if(desk.type==='assignment')renderAssignment(desk);else renderAvailability(desk)}
 async function open(type,id){
  id=text(id);if(!id)return;
  const previous=activeDesk,t=ticket(),url=type==='assignment'?assignmentUrl(id):availabilityUrl(id);
  try{
   const data=await request(url,{},t.organization);if(!validTicket(t))return;
   let root=document.querySelector(rootSelector(type));
   if(!root||root.dataset[type==='assignment'?'assignmentId':'assetId']!==id){modal(type==='assignment'?'Moyens de l’affectation':'Disponibilités du matériel','<section id="'+(type==='assignment'?'assignmentAssetsDesk':'assignmentAssetAvailabilityDesk')+'"></section>');root=document.querySelector(rootSelector(type))}
   const desk=deskFor(type,id,data,root);render(desk);
  }catch(error){if(validTicket(t)){if(previous?.root.isConnected){previous.sequence=sequence;activeDesk=previous;render(previous)}if(typeof toast==='function')toast(error.message||'Chargement impossible.')}}
 }
 async function refresh(desk,{preserveDraft=false}={}){
  if(!isCurrent(desk))return false;
  const read=++desk.readSequence;desk.loading=true;render(desk);
  try{
   const data=await request(desk.type==='assignment'?assignmentUrl(desk.id):availabilityUrl(desk.id),{},desk.organization);
   if(!isCurrent(desk)||read!==desk.readSequence)return false;
   desk.data=data;if(!preserveDraft)desk.selected=new Set(unique(data.extras));desk.mustRefresh=false;desk.loading=false;persist(desk);render(desk);return true;
  }catch(error){if(isCurrent(desk)&&read===desk.readSequence){desk.loading=false;desk.mustRefresh=true;desk.message=error.message||'Actualisation impossible. Réessayez.';render(desk)}return false}
 }
 function operationKey(desk,url,payload){
  const signature=JSON.stringify([desk.organization,url,payload]);let key=retryKeys.get(signature);
  if(!key){key='assignment-assets-'+crypto.randomUUID();retryKeys.set(signature,key)}return {key,signature};
 }
 async function mutate(desk,url,payload,message){
  if(!isCurrent(desk)||blocked(desk))return;
  const operation=operationKey(desk,url,payload);desk.busy=true;desk.message='Enregistrement en cours…';render(desk);
  try{
   await request(url,{method:'POST',body:JSON.stringify({...payload,operationKey:operation.key})},desk.organization);retryKeys.delete(operation.signature);
   if(!isCurrent(desk))return;
   desk.message=message;const fresh=await refresh(desk);if(!isCurrent(desk))return;
   desk.busy=false;
   if(!fresh){desk.mustRefresh=true;desk.message=message+' L’enregistrement est confirmé, mais l’actualisation a échoué. Actualisez avant une autre action.'}
   else if(payload.action==='block')desk.blockDraft={};
   render(desk);
  }catch(error){
   if(!isCurrent(desk))return;desk.busy=false;
   desk.message=error.message||'Enregistrement impossible. Réessayez avec les mêmes informations.';
   if(error.status===409||error.status===403){desk.mustRefresh=true;desk.message+=' Actualisez les moyens avant de poursuivre.'}
   render(desk);
  }
 }
 function action(desk,button){
  const name=button.dataset.action,id=button.dataset.assetId;
  if(name==='reload'){if(!desk.busy){desk.message='Actualisation…';refresh(desk,{preserveDraft:true}).then(ok=>{if(ok&&isCurrent(desk)){desk.message='Moyens actualisés.';render(desk)}})}return}
  if(name==='availability'){open('availability',id);return}
  if(blocked(desk))return;
  if(name==='remove-extra'){desk.selected.delete(text(id));renderSelection(desk);return}
  if(name==='reserve'&&desk.type==='assignment'&&desk.data.canManage===true&&desk.data.assignment?.status!=='cancelled'){
   mutate(desk,assignmentUrl(desk.id),{action:'reserve',assetIds:selectedExtras(desk),expectedVersion:desk.data.expectedVersion,assignmentSignature:desk.data.assignmentSignature},'Réservation enregistrée.');return;
  }
  if(name==='take'||name==='return'){
   const resource=resources(desk).find(r=>r.id===text(id));if(!resource)return;
   if(name==='take'&&resource.canTake===true)mutate(desk,assignmentUrl(desk.id),{action:'take',assetId:text(id),assignmentSignature:desk.data.assignmentSignature},'Prise du matériel enregistrée.');
   if(name==='return'&&resource.canReturn===true&&resource.custody?.takeId)mutate(desk,assignmentUrl(desk.id),{action:'return',assetId:text(id),takeId:resource.custody.takeId,note:text(desk.returnNotes[id]).trim()},'Retour du matériel enregistré.');return;
  }
  if(name==='resolve'&&desk.type==='availability'&&desk.data.canManage===true){
   const block=(desk.data.blocks||[]).find(b=>text(b.id)===button.dataset.blockId);if(!block||block.resolved)return;
   mutate(desk,availabilityUrl(desk.id),{action:'resolve',blockId:block.id,note:text(desk.resolveNotes[block.id]).trim()},'Matériel remis à disposition.');
  }
 }
 document.addEventListener('click',event=>{
  const entry=event.target.closest?.('[data-assignment-assets-open], [data-asset-availability-open]');
  if(entry){event.preventDefault();if(entry.hasAttribute('data-assignment-assets-open'))open('assignment',entry.dataset.assignmentId);else open('availability',entry.dataset.assetId);return}
  const button=event.target.closest?.('[data-action]'),desk=activeDesk;if(!button||!desk||!isCurrent(desk)||!desk.root.contains(button)||button.disabled)return;
  if(button.dataset.action==='block')return;event.preventDefault();action(desk,button);
 });
 document.addEventListener('input',event=>{
  const input=event.target,desk=activeDesk;if(!desk||!isCurrent(desk)||!desk.root.contains(input))return;
  if(input.id==='assignmentAssetsSearch'){desk.query=input.value;renderSelection(desk)}
  else if(input.hasAttribute('data-return-note'))desk.returnNotes[input.dataset.assetId]=input.value;
  else if(input.hasAttribute('data-resolve-note'))desk.resolveNotes[input.dataset.blockId]=input.value;
  else if(input.closest('[data-asset-block-form]'))desk.blockDraft[input.name]=input.value;
  persist(desk);
 });
 document.addEventListener('change',event=>{
  const input=event.target,desk=activeDesk;if(!desk||desk.type!=='assignment'||!isCurrent(desk)||!desk.root.contains(input)||input.type!=='checkbox'||!input.dataset.assetId||blocked(desk))return;
  if(input.checked)desk.selected.add(input.dataset.assetId);else desk.selected.delete(input.dataset.assetId);renderSelection(desk);
 });
 document.addEventListener('submit',event=>{
  const form=event.target,desk=activeDesk;if(!form.matches?.('[data-asset-block-form]')||!desk||!isCurrent(desk)||!desk.root.contains(form))return;event.preventDefault();
  if(desk.data.canManage!==true||blocked(desk)||!form.reportValidity())return;
  const values=new FormData(form),startsAt=text(values.get('startsAt')),endsAt=text(values.get('endsAt'))||null,reason=text(values.get('reason')).trim();
  if(!reason||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startsAt)||endsAt&&endsAt<=startsAt){desk.message='Renseignez un début, un motif et une fin postérieure au début si elle est connue.';render(desk);return}
  mutate(desk,availabilityUrl(desk.id),{action:'block',startsAt,endsAt,reason},'Indisponibilité enregistrée.');
 });
 function restore(){
  const root=document.querySelector('#assignmentAssetsDesk, #assignmentAssetAvailabilityDesk');if(!root||!dialog()?.open)return;
  if(root.dataset.assetOrganization!==organization()){root.textContent='L’entreprise active a changé. Rouvrez les moyens depuis le dossier concerné.';return}
  try{
   const data=JSON.parse(root.dataset.assetState),type=root.id==='assignmentAssetsDesk'?'assignment':'availability',id=root.dataset[type==='assignment'?'assignmentId':'assetId'],desk=deskFor(type,id,data,root,true);
   render(desk);refresh(desk,{preserveDraft:true});
  }catch(_){root.textContent='Rouvrez les moyens pour charger les informations actuelles.'}
 }
 const closeBefore=closeModal;closeModal=function(...args){invalidate();return closeBefore(...args)};
 const backBefore=backModal;backModal=function(...args){invalidate();const result=backBefore(...args);restore();return result};
 dialog()?.addEventListener('cancel',invalidate);
 dialog()?.addEventListener('close',()=>{if(!dialog()?.open)invalidate()});
 window.openAssignmentAssets=id=>open('assignment',id);
 window.openAssetAvailability=id=>open('availability',id);
 if(typeof iaBOpenAssignment==='function'){
  const original=iaBOpenAssignment;iaBOpenAssignment=function(id='',...args){const result=original(id,...args),root=body()?.querySelector('.modal-inner');if(id&&root&&!root.querySelector('[data-assignment-assets-open]')){const button=document.createElement('button');button.type='button';button.className='btn assignment-assets-entry';button.textContent='Moyens réservés, prise et retour';button.dataset.assignmentAssetsOpen='';button.dataset.assignmentId=text(id);root.append(button)}return result};
 }
 if(typeof showAsset==='function'){
  const original=showAsset;showAsset=function(id,...args){const result=original(id,...args),root=body()?.querySelector('.modal-inner');if(root&&!root.querySelector('[data-asset-availability-open]')){const button=document.createElement('button');button.type='button';button.className='btn assignment-assets-entry';button.textContent='Disponibilités et entretien';button.dataset.assetAvailabilityOpen='';button.dataset.assetId=text(id);root.append(button)}return result};
 }
})();
