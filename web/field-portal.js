const fieldPortalState=new Map();
const fieldPortalStockState=new Map();
const fieldPortalRequests=new Map();
let fieldPortalVisibleKey='',fieldPortalActions=0;
function fieldPortalScope(){const access=globalThis.socleCurrentAccess||{},preview=globalThis.socleAccessPreview||{};return JSON.stringify([String(typeof activeSocleOrganizationId!=='undefined'?activeSocleOrganizationId:localStorage.getItem('socle.activeOrganizationId')||''),access.userId||'',access.roleCode||'',(access.permissions||[]).slice().sort(),preview.userId||'',preview.roleCode||''])}
function fieldPortalBusy(){return fieldPortalActions>0||Boolean(document.querySelector('#modal[open]')||document.activeElement?.closest('input,textarea,select,[contenteditable="true"]'))}
function fieldPortalVisible(){return typeof view!=='undefined'&&view==='jobWorkspace'&&currentJobId&&document.visibilityState!=='hidden'&&Boolean(document.querySelector('[data-field-portal]:not(.v3-context-hidden)'))}
function fieldPortalComparable(data){const {generatedAt,...content}=data||{};return JSON.stringify(content)}
function fieldPortalPaint(projectId){
  if(view!=='jobWorkspace'||String(currentJobId||'')!==String(projectId))return;
  const old=document.querySelector('[data-field-portal]');if(!old)return;
  const opened=new Set([...old.querySelectorAll('details[open]')].map(e=>e.querySelector('summary')?.textContent));
  const x=scrollX,y=scrollY,main=document.querySelector('#main'),mainTop=main?.scrollTop||0;
  // Run the normal render chain so later portal extensions remain present.
  if(typeof render==='function')render();
  for(const detail of document.querySelectorAll('[data-field-portal] details'))detail.open=opened.has(detail.querySelector('summary')?.textContent);
  if(main)main.scrollTop=mainTop;window.scrollTo(x,y);
}
function fieldPortalRefreshVisible(){if(fieldPortalVisible()&&!fieldPortalBusy())return loadFieldPortal(String(currentJobId),true,{quiet:true})}
window.addEventListener('focus',()=>fieldPortalRefreshVisible());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')fieldPortalRefreshVisible()});
setInterval(()=>fieldPortalRefreshVisible(),15000);
const fieldPortalInline=value=>esc(JSON.stringify(value));

function fieldPortalKey(prefix){
  return String(prefix||'field')+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
}
function fieldPortalClock(){
  const date=new Date();
  return String(date.getHours()).padStart(2,'0')+':'+String(date.getMinutes()).padStart(2,'0');
}
function fieldPortalPersonName(data,personId){
  return data.team?.members?.find(item=>String(item.personId)===String(personId))?.name||String(personId||'');
}
function fieldPortalPhotoHtml(ids){
  if(!Array.isArray(ids)||!ids.length)return '';
  return '<div class="field-photo-strip">'+ids.map(id=>'<a href="/api/documents/'+encodeURIComponent(id)+'/preview" target="_blank" rel="noopener"><img src="/api/documents/'+encodeURIComponent(id)+'/preview" alt="Photo chantier"></a>').join('')+'</div>';
}
function fieldPortalGroup(title,content,{open=false,wide=false}={}){
  const safeTitle=esc(title);
  if(matchMedia('(max-width:760px)').matches)return '<details class="field-accordion '+(wide?'field-wide':'')+'" '+(open?'open':'')+'><summary>'+safeTitle+'</summary><div class="field-accordion-body">'+content+'</div></details>';
  return '<section class="'+(wide?'field-wide':'')+'"><h3>'+safeTitle+'</h3>'+content+'</section>';
}
function fieldPortalTaskHtml(task,data){
  const canUpdate=data.capabilities.manageTasks||String(task.assignedTo||'')===String(data.currentUser.userId||'');
  const checklist=(task.checklist||[]).map((item,index)=>{
    const disabled=canUpdate?'':' disabled';
    return '<label class="field-check"><input type="checkbox" '+(item.done?'checked ':'')+disabled+' onchange="fieldPortalToggleChecklist('+fieldPortalInline(task.id)+','+index+',this.checked)"> <span>'+esc(item.label)+'</span></label>';
  }).join('');
  const actions=[];
  if(canUpdate&&task.status==='todo')actions.push('<button class="btn small" onclick="fieldPortalSetTaskStatus('+fieldPortalInline(task.id)+','+fieldPortalInline('in_progress')+')">Commencer</button>');
  if(canUpdate&&task.status==='in_progress'){actions.push('<button class="btn small" onclick="fieldPortalSetTaskStatus('+fieldPortalInline(task.id)+','+fieldPortalInline('done')+')">Terminer</button>');actions.push('<button class="btn small ghost" onclick="fieldPortalSetTaskStatus('+fieldPortalInline(task.id)+','+fieldPortalInline('blocked')+')">Bloqué</button>')}
  if(canUpdate&&task.status==='blocked')actions.push('<button class="btn small" onclick="fieldPortalSetTaskStatus('+fieldPortalInline(task.id)+','+fieldPortalInline('in_progress')+')">Reprendre</button>');
  if(data.capabilities.manageTasks&&task.status==='done'&&!task.validatedAt)actions.push('<button class="btn small" onclick="fieldPortalValidateTask('+fieldPortalInline(task.id)+')">Valider</button>');
  const meta=[({low:'Basse',normal:'Normale',high:'Haute',urgent:'Urgente'})[task.priority]||task.priority,task.dueAt?'Échéance '+task.dueAt:'',task.assignedTo?'Responsable '+(data.team.members.find(item=>String(item.userId)===String(task.assignedTo))?.name||task.assignedTo):'',task.validatedAt?'Validée':''].filter(Boolean).join(' · ');
  const materials=(task.materials||[]).length?'<small>Matériaux : '+esc(task.materials.map(item=>item.name+(item.quantity!=null?' '+item.quantity+(item.unit||''):'')).join(', '))+'</small>':'';
  return '<article class="field-card '+(task.kind==='problem'?'field-problem':'')+'"><div class="field-card-head"><strong>'+esc(task.title)+'</strong><span class="badge">'+esc(({todo:'À faire',in_progress:'En cours',blocked:'Bloquée',done:'Terminée'})[task.status]||task.status)+'</span></div><p>'+esc(task.description||'')+'</p><small>'+esc(meta)+'</small>'+materials+checklist+fieldPortalPhotoHtml(task.photoDocumentIds)+'<div class="field-actions">'+actions.join('')+'</div></article>';
}
function fieldPortalNoteHtml(note){
  const buttons=note.canEdit?'<div class="field-actions"><button class="btn small ghost" onclick="fieldPortalEditNote('+fieldPortalInline(note.id)+')">Modifier</button><button class="btn small ghost" onclick="fieldPortalDeleteNote('+fieldPortalInline(note.id)+')">Supprimer</button></div>':'';
  return '<article class="field-card"><div class="field-card-head"><strong>'+esc(note.author||'Terrain')+'</strong><small>'+esc(note.date||'')+'</small></div><p>'+esc(note.text||'')+'</p>'+fieldPortalPhotoHtml(note.photoDocumentIds)+buttons+'</article>';
}
function fieldPortalQuoteHtml(quote,data){
  const lines=(quote.lines||[]).map(line=>{
    const price=data.capabilities.viewQuotePrices&&line.price!==undefined?' · '+Number(line.price).toLocaleString('fr-BE',{style:'currency',currency:'EUR'}):'';
    return '<li><strong>'+esc(line.label||'')+'</strong> · '+esc(String(line.qty??''))+' '+esc(line.unit||'')+price+(line.description?'<small>'+esc(line.description)+'</small>':'')+'</li>';
  }).join('');
  return '<article class="field-card"><strong>'+esc(quote.reference||quote.title||'Devis')+'</strong><ul class="field-technical-lines">'+lines+'</ul></article>';
}
function fieldPortalPanel(projectId){
  const cached=fieldPortalState.get(String(projectId)),state=cached?.scope===fieldPortalScope()?cached:null;
  if(cached&&!state)fieldPortalState.delete(String(projectId));
  if(!state||state.status==='loading')return '<section class="panel field-portal" data-field-portal><p class="eyebrow">TERRAIN</p><h2>Chantier du jour</h2><p class="subtle">Chargement du portail terrain…</p></section>';
  if(state.status==='error')return '<section class="panel field-portal" data-field-portal><p class="eyebrow">TERRAIN</p><h2>Chantier du jour</h2><p class="notice">'+esc(state.error||'Portail terrain indisponible.')+'</p><button class="btn" onclick="loadFieldPortal('+fieldPortalInline(projectId)+',true)">Réessayer</button></section>';
  const data=state.data,project=data.project||{},address=project.address||{},addressText=[address.street,address.postalCode,address.city].filter(Boolean).join(' · ');
  const assignment=data.team?.assignments?.[0],open=data.time?.openForCurrentUser;
  const topActions=[];
  if(data.capabilities.clockTeam&&assignment) {
    const teamPeople=(assignment.people||[]).map(String),openPeople=new Set((data.time?.entries||[]).filter(entry=>!entry.departure&&String(entry.teamId||entry.team||'')===String(assignment.teamId||'')).flatMap(entry=>(entry.people||[]).map(String)));
    if(teamPeople.some(personId=>!openPeople.has(personId)))topActions.push('<button class="btn" onclick="fieldPortalOpenTeamClock('+fieldPortalInline(projectId)+',\'arrival\')">Pointer l’arrivée de l’équipe</button>');
    if(teamPeople.some(personId=>openPeople.has(personId)))topActions.push('<button class="btn" onclick="fieldPortalOpenTeamClock('+fieldPortalInline(projectId)+',\'departure\')">Pointer le départ de l’équipe</button>');
  } else {
    if(data.capabilities.clockOwn&&data.currentUser.personId&&assignment&&!open)topActions.push('<button class="btn" onclick="fieldPortalClockIn('+fieldPortalInline(projectId)+')">Pointer mon arrivée</button>');
    if(data.capabilities.clockOwn&&open)topActions.push('<button class="btn" onclick="fieldPortalClockOut('+fieldPortalInline(projectId)+')">Pointer mon départ</button>');
  }
  if(data.capabilities.createNotes)topActions.push('<button class="btn ghost" onclick="fieldPortalOpenNote('+fieldPortalInline(projectId)+')">Ajouter une remarque</button>');
  if(data.capabilities.reportProblems)topActions.push('<button class="btn ghost" onclick="fieldPortalOpenProblem('+fieldPortalInline(projectId)+')">Signaler un problème</button>');
  if(data.capabilities.manageTasks)topActions.push('<button class="btn ghost" onclick="fieldPortalOpenTask('+fieldPortalInline(projectId)+')">Créer une tâche</button>');
  if(data.capabilities.consumeStock)topActions.push('<button class="btn ghost" onclick="fieldPortalOpenStockConsume('+fieldPortalInline(projectId)+')">📦 Prendre du stock</button>');
  const members=(data.team?.members||[]).map(member=>'<span class="field-chip">'+esc(member.name)+'</span>').join('');
  const timeRows=(data.time?.entries||[]).map(entry=>'<div class="detail-row"><span>'+esc((entry.people||[]).map(id=>fieldPortalPersonName(data,id)).join(', '))+'</span><b>'+esc(entry.arrival||'')+(entry.departure?' → '+esc(entry.departure):' · en cours')+'</b></div>').join('')||'<p class="subtle">Aucun pointage visible aujourd’hui.</p>';
  const activeTasks=(data.tasks||[]).filter(task=>task.status!=='done'),doneTasks=(data.tasks||[]).filter(task=>task.status==='done');
  const tasks=(activeTasks.map(task=>fieldPortalTaskHtml(task,data)).join('')||'<p class="subtle">Aucune étape à faire.</p>')+(doneTasks.length?'<details><summary>'+doneTasks.length+' étape(s) terminée(s)</summary>'+doneTasks.map(task=>fieldPortalTaskHtml(task,data)).join('')+'</details>':'');
  const notes=(data.notes||[]).map(fieldPortalNoteHtml).join('')||'<p class="subtle">Aucune remarque terrain.</p>';
  const materials=(data.materials||[]).map(item=>'<div class="detail-row"><span>'+esc(item.name)+'</span><b>'+item.delivered+'/'+item.quantity+' '+esc(item.unit||'')+'</b></div>').join('')||'<p class="subtle">Aucun besoin matériel renseigné.</p>';
  const assets=(data.assets||[]).map(item=>'<article class="field-card"><strong>'+esc(item.name)+'</strong><small>'+esc([item.group,item.condition,item.attached].filter(Boolean).join(' · '))+'</small>'+(item.issues||[]).map(issue=>'<p class="notice">'+esc(issue.severity+' · '+issue.description)+'</p>').join('')+'</article>').join('')||'<p class="subtle">Aucun matériel affecté visible.</p>';
  const assignmentMeans=data.capabilities.viewAssets?(data.team?.assignments||[]).map(a=>'<div class="field-card"><strong>'+esc(a.teamName||'Équipe')+'</strong><p>'+esc((a.resources||[]).map(r=>r.name+(r.known===false?' · référence non vérifiée':r.archived?' · archivé':(r.blocked||r.availability==='blocked')?' · indisponible':'')).join(', ')||'Aucun moyen renseigné')+'</p><button class="btn" onclick="openAssignmentAssets('+fieldPortalInline(a.id)+')">Véhicules et outillage du créneau</button></div>').join(''):'';
  const documents=(data.documents?.items||[]).map(doc=>'<a class="field-doc" href="/api/documents/'+encodeURIComponent(doc.id)+'/preview" target="_blank" rel="noopener">'+esc(doc.title||'Document')+'</a>').join('')||'<p class="subtle">Aucun document autorisé.</p>';
  const photos=fieldPortalPhotoHtml((data.photos?.items||[]).map(photo=>photo.id));
  const quotes=(data.quotes||[]).map(quote=>fieldPortalQuoteHtml(quote,data)).join('')||'<p class="subtle">Aucun devis technique autorisé.</p>';
  const alerts=(data.notifications||[]).map(item=>'<div class="notice"><strong>'+esc(item.title)+'</strong> · '+esc(item.text)+'</div>').join('');
  return '<section class="panel field-portal" data-field-portal>'+
    '<div class="panel-head"><div><p class="eyebrow">TERRAIN · '+esc(({OWNER:'Patron',WORKER:'Ouvrier',TEAM_LEAD:'Chef d’équipe',SECRETARY:'Administration',ACCOUNTING:'Comptabilité'})[String(data.currentUser.role||'').toUpperCase()]||data.currentUser.role||'')+'</p><h2>'+esc(project.name||'Chantier')+'</h2><span>'+esc(project.reference||'')+(addressText?' · '+esc(addressText):'')+'</span></div><div class="field-actions"><span class="badge">'+esc(navigator.onLine===false?'Hors ligne':'Journée du '+String(data.date||new Date().toLocaleDateString('fr-CA')))+' </span><button class="btn ghost" data-field-refresh onclick="loadFieldPortal('+fieldPortalInline(projectId)+',true)">Actualiser le terrain</button></div></div>'+
    (alerts?'<div class="field-alerts">'+alerts+'</div>':'')+
    '<div class="field-actions field-primary-actions">'+topActions.join('')+'</div>'+
    '<p class="subtle" role="status" data-field-queue data-project-id="'+esc(projectId)+'" data-field-scope="'+esc(fieldPortalScope())+'">Vérification des notes en attente…</p>'+
    '<div class="field-portal-grid">'+
      fieldPortalGroup('Équipe du jour','<div class="field-chips">'+members+'</div><div class="field-time-list">'+timeRows+'</div>',{open:true})+
      fieldPortalGroup('Étapes du chantier','<div class="field-stack">'+tasks+'</div>',{open:true})+
      fieldPortalGroup('Remarques & photos',photos+'<div class="field-stack">'+notes+'</div>')+
      fieldPortalGroup('Matériaux',materials)+
      fieldPortalGroup('Matériel sur chantier',assignmentMeans+'<div class="field-stack">'+assets+'</div>')+
      fieldPortalGroup('Documents utiles','<div class="field-docs">'+documents+'</div>')+
      fieldPortalGroup('Devis technique','<div class="field-stack">'+quotes+'</div>',{wide:true})+
    '</div></section>';
}
async function loadFieldPortal(projectId,force=false,{quiet=false}={}){
  const key=String(projectId||'');if(!key)return;
  const scope=fieldPortalScope(),current=fieldPortalState.get(key);
  const pending=fieldPortalRequests.get(key);if(pending?.scope===scope){if(!force||quiet)return pending.promise;await pending.promise;if(scope===fieldPortalScope())return loadFieldPortal(key,true,{quiet});return;}
  if(!force&&current?.scope===scope&&current.status==='ready')return;
  if(current?.scope!==scope)fieldPortalState.delete(key);
  if(!quiet&&current?.scope!==scope)fieldPortalState.set(key,{status:'loading',scope});
  const request={scope};fieldPortalRequests.set(key,request);
  request.promise=(async()=>{
    try{
      const data=await serverJson('/api/projects/'+encodeURIComponent(key)+'/field-portal');
      if(scope!==fieldPortalScope()||fieldPortalRequests.get(key)!==request)return;
      // A background read must never replace a form or a checklist mid-edit.
      if(quiet&&fieldPortalBusy())return;
      const changed=current?.scope!==scope||current?.status!=='ready'||fieldPortalComparable(current.data)!==fieldPortalComparable(data);
      fieldPortalState.set(key,{status:'ready',data,scope});
      if(changed)fieldPortalPaint(key);
    }catch(error){
      if(scope!==fieldPortalScope()||fieldPortalRequests.get(key)!==request)return;
      fieldPortalState.set(key,{status:'error',error:error.message||'Portail terrain indisponible.',scope});
      if(!quiet||!fieldPortalBusy())fieldPortalPaint(key);
    }finally{if(fieldPortalRequests.get(key)===request)fieldPortalRequests.delete(key)}
  })();
  return request.promise;
}
async function fieldPortalAction(action,projectId){
  fieldPortalActions++;
  try{await action();await loadFieldPortal(projectId,true);if(typeof toast==='function')toast('Enregistré.')}
  catch(error){if(typeof toast==='function')toast(error.message||'Action refusée.');else alert(error.message||'Action refusée.')}
  finally{fieldPortalActions--}
}
async function fieldPortalClockIn(projectId){
  const data=fieldPortalState.get(String(projectId))?.data,personId=data?.currentUser?.personId,assignment=(data?.team?.assignments||[]).find(item=>(item.people||[]).map(String).includes(String(personId)));
  if(!personId||!assignment){if(typeof toast==='function')toast('Aucune affectation du jour pour ce chantier.');return}
  await fieldPortalAction(()=>serverJson('/api/time-entries/arrival',{method:'POST',body:JSON.stringify({projectId:String(projectId),teamId:String(assignment.teamId||''),date:data.date,people:[{personId:String(personId),arrival:fieldPortalClock()}],note:''})}),projectId);
}
async function fieldPortalClockOut(projectId){
  const data=fieldPortalState.get(String(projectId))?.data,entry=data?.time?.openForCurrentUser,personId=data?.currentUser?.personId;
  if(!entry||!personId)return;
  await fieldPortalAction(()=>serverJson('/api/time-entries/'+encodeURIComponent(entry.id)+'/departure',{method:'POST',body:JSON.stringify({departure:fieldPortalClock(),personIds:[String(personId)],note:''})}),projectId);
}
function fieldPortalOpenTeamClock(projectId,direction){
  const data=fieldPortalState.get(String(projectId))?.data,assignment=(data?.team?.assignments||[])[0];if(!data||!assignment)return;
  const memberMap=new Map((data.team?.members||[]).map(member=>[String(member.personId),member.name||String(member.personId)])),entries=(data.time?.entries||[]).filter(entry=>!entry.departure&&String(entry.teamId||entry.team||'')===String(assignment.teamId||'')),openByPerson=new Map();
  for(const entry of entries)for(const personId of entry.people||[])openByPerson.set(String(personId),entry);
  const ids=(assignment.people||[]).map(String).filter(personId=>direction==='arrival'?!openByPerson.has(personId):openByPerson.has(personId));if(!ids.length)return;
  const actionLabel=direction==='arrival'?'Pointer les personnes présentes':'Pointer les départs sélectionnés',options=ids.map(personId=>'<label class="field-check"><input type="checkbox" name="personIds" value="'+esc(personId)+'" checked> <span>'+esc(memberMap.get(personId)||personId)+'</span></label>').join('');
  fieldPortalDialog('<form class="stack" id="field-team-clock-form" onsubmit="fieldPortalSubmitTeamClock(event)"><h2>'+actionLabel+'</h2><p class="subtle">Coche uniquement les personnes concernées. Tu peux laisser décochée une personne absente ou avec un horaire différent.</p><input type="hidden" name="projectId" value="'+esc(projectId)+'"><input type="hidden" name="direction" value="'+direction+'"><input type="hidden" name="teamId" value="'+esc(assignment.teamId||'')+'"><label>Heure<input name="time" type="time" value="'+fieldPortalClock()+'" required></label><div class="field-stack">'+options+'</div><label>Note facultative<textarea name="note" rows="2" maxlength="500"></textarea></label><button class="btn" type="submit">Confirmer le pointage</button></form>');
}
async function fieldPortalSubmitTeamClock(event){
  event.preventDefault();const form=event.currentTarget,data=new FormData(form),projectId=String(data.get('projectId')||''),state=fieldPortalState.get(projectId)?.data,assignment=(state?.team?.assignments||[]).find(item=>String(item.teamId||'')===String(data.get('teamId')||'')),selected=[...new Set(data.getAll('personIds').map(String))];if(!assignment||!selected.length)return;
  const time=String(data.get('time')||''),note=String(data.get('note')||'').trim(),direction=String(data.get('direction')||'');if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)){if(typeof toast==='function')toast('Choisis une heure valide.');return}
  const allowed=new Set((assignment.people||[]).map(String));if(selected.some(personId=>!allowed.has(personId))){if(typeof toast==='function')toast('La sélection ne correspond plus à l’équipe affectée. Recharge le chantier.');return}
  const button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;
  try{
    if(direction==='arrival')await serverJson('/api/time-entries/arrival',{method:'POST',body:JSON.stringify({projectId,teamId:String(assignment.teamId||''),date:state.date,people:selected.map(personId=>({personId,arrival:time})),note})});
    else if(direction==='departure'){
      const openByEntry=new Map();for(const entry of state.time?.entries||[]){if(entry.departure)continue;const people=(entry.people||[]).map(String).filter(personId=>selected.includes(personId));if(!people.length)continue;const ids=openByEntry.get(entry.id)||[];ids.push(...people);openByEntry.set(entry.id,ids)}
      for(const [entryId,personIds] of openByEntry)await serverJson('/api/time-entries/'+encodeURIComponent(entryId)+'/departure',{method:'POST',body:JSON.stringify({departure:time,personIds,note})});
    } else return;
    document.querySelector('#modal')?.close();await loadFieldPortal(projectId,true);if(typeof toast==='function')toast('Pointage de l’équipe enregistré.');
  }catch(error){if(typeof toast==='function')toast(error.message||'Pointage refusé.');else alert(error.message||'Pointage refusé.');if(button)button.disabled=false}
}
async function fieldPortalSetTaskStatus(taskId,status){
  const entry=[...fieldPortalState.entries()].find(([,value])=>value.data?.tasks?.some(task=>String(task.id)===String(taskId)));if(!entry)return;
  await fieldPortalAction(()=>serverJson('/api/tasks/'+encodeURIComponent(taskId),{method:'PATCH',body:JSON.stringify({status})}),entry[0]);
}
async function fieldPortalToggleChecklist(taskId,index,done){
  const entry=[...fieldPortalState.entries()].find(([,value])=>value.data?.tasks?.some(task=>String(task.id)===String(taskId)));if(!entry)return;
  const task=entry[1].data.tasks.find(item=>String(item.id)===String(taskId)),checklist=(task.checklist||[]).map((item,i)=>({...item,done:i===index?Boolean(done):Boolean(item.done)}));
  await fieldPortalAction(()=>serverJson('/api/tasks/'+encodeURIComponent(taskId),{method:'PATCH',body:JSON.stringify({checklist})}),entry[0]);
}
async function fieldPortalValidateTask(taskId){
  const entry=[...fieldPortalState.entries()].find(([,value])=>value.data?.tasks?.some(task=>String(task.id)===String(taskId)));if(!entry)return;
  await fieldPortalAction(()=>serverJson('/api/tasks/'+encodeURIComponent(taskId)+'/validate',{method:'POST',body:'{}'}),entry[0]);
}
function fieldPortalDialog(html){
  const dialog=document.querySelector('#modal'),body=document.querySelector('#modalbody');if(!dialog||!body)return;body.innerHTML=html;dialog.showModal();
}
async function fieldPortalOpenStockConsume(projectId){
  const key=String(projectId),operationKey=fieldPortalKey('stock-consume');
  fieldPortalStockState.set(key,{options:[],query:''});
  fieldPortalDialog('<form class="stack" id="field-stock-consume-form" onsubmit="fieldPortalSubmitStockConsume(event)"><h2>📦 Prendre du stock</h2><input type="hidden" name="projectId" value="'+esc(projectId)+'"><input type="hidden" name="operationKey" value="'+esc(operationKey)+'"><label>Rechercher par nom ou référence<div class="field-actions"><input name="query" autocomplete="off" placeholder="Ex. ardoise"><button class="btn ghost" type="button" onclick="fieldPortalSearchStockFromForm('+fieldPortalInline(projectId)+')">Rechercher</button></div></label><label>Article<select name="stockItemId" required onchange="fieldPortalStockItemChanged('+fieldPortalInline(projectId)+')"><option value="">Chargement…</option></select></label><label>Entrepôt<select name="sourceLocationId" required onchange="fieldPortalStockLocationChanged('+fieldPortalInline(projectId)+')"></select></label><p class="subtle" data-stock-availability>Disponibilité en cours de chargement…</p><label>Quantité<input name="quantity" type="number" min="0.001" step="0.001" inputmode="decimal" required></label><label>Note facultative<textarea name="note" rows="3" maxlength="500"></textarea></label><p class="notice" data-stock-result hidden></p><button class="btn" type="submit">Confirmer la sortie chantier</button></form>');
  await fieldPortalSearchStock(projectId,'');
}
function fieldPortalStockForm(){return document.querySelector('#field-stock-consume-form')}
async function fieldPortalSearchStockFromForm(projectId){const form=fieldPortalStockForm();if(!form)return;await fieldPortalSearchStock(projectId,String(new FormData(form).get('query')||''))}
async function fieldPortalSearchStock(projectId,query){
  const key=String(projectId),state=fieldPortalStockState.get(key)||{options:[]};state.query=String(query||'');fieldPortalStockState.set(key,state);
  try{
    const result=await serverJson('/api/projects/'+encodeURIComponent(key)+'/stock-consume/options?q='+encodeURIComponent(state.query)),next=fieldPortalStockState.get(key);
    if(!next||next.query!==state.query)return;
    next.options=Array.isArray(result.options)?result.options:[];fieldPortalStockState.set(key,next);fieldPortalRenderStockOptions(projectId);
  }catch(error){const form=fieldPortalStockForm();if(form){const info=form.querySelector('[data-stock-availability]');if(info)info.textContent=error.message||'Stock indisponible.'}}
}
function fieldPortalRenderStockOptions(projectId){
  const form=fieldPortalStockForm(),state=fieldPortalStockState.get(String(projectId));if(!form||!state)return;
  const itemSelect=form.elements.stockItemId,previous=String(itemSelect.value||''),items=new Map();
  for(const option of state.options||[])if(!items.has(String(option.id)))items.set(String(option.id),option);
  itemSelect.innerHTML=items.size?[...items.values()].map(item=>'<option value="'+esc(item.id)+'">'+esc(item.name)+(item.reference?' · '+esc(item.reference):'')+' · '+esc(item.unit||'')+'</option>').join(''):'<option value="">Aucun article disponible</option>';
  if(previous&&items.has(previous))itemSelect.value=previous;
  fieldPortalStockItemChanged(projectId);
}
function fieldPortalStockItemChanged(projectId){
  const form=fieldPortalStockForm(),state=fieldPortalStockState.get(String(projectId));if(!form||!state)return;
  const itemId=String(form.elements.stockItemId.value||''),locations=(state.options||[]).filter(option=>String(option.id)===itemId),select=form.elements.sourceLocationId;
  select.innerHTML=locations.map(option=>'<option value="'+esc(option.location.id)+'">'+esc(option.location.name)+' · disponible '+esc(String(option.available))+' '+esc(option.unit||'')+'</option>').join('')||'<option value="">Aucun entrepôt autorisé</option>';
  fieldPortalStockLocationChanged(projectId);
}
function fieldPortalStockLocationChanged(projectId){
  const form=fieldPortalStockForm(),state=fieldPortalStockState.get(String(projectId));if(!form||!state)return;
  const itemId=String(form.elements.stockItemId.value||''),locationId=String(form.elements.sourceLocationId.value||''),option=(state.options||[]).find(item=>String(item.id)===itemId&&String(item.location?.id)===locationId),info=form.querySelector('[data-stock-availability]');
  if(info)info.textContent=option?option.name+(option.reference?' · '+option.reference:'')+' · '+option.available+' '+(option.unit||'')+' disponible(s) à '+option.location.name:'Aucun stock autorisé pour cette sélection.';
}
async function fieldPortalSubmitStockConsume(event){
  event.preventDefault();const form=event.currentTarget,data=new FormData(form),projectId=String(data.get('projectId')||''),button=form.querySelector('button[type="submit"]'),resultNode=form.querySelector('[data-stock-result]'),quantity=Number(data.get('quantity'));
  if(!Number.isFinite(quantity)||quantity<=0){if(resultNode){resultNode.hidden=false;resultNode.textContent='Quantité invalide.'}return}
  button.disabled=true;
  try{
    const payload={stockItemId:String(data.get('stockItemId')||''),sourceLocationId:String(data.get('sourceLocationId')||''),quantity,note:String(data.get('note')||''),operationKey:String(data.get('operationKey')||'')},result=await serverJson('/api/projects/'+encodeURIComponent(projectId)+'/stock-consume',{method:'POST',body:JSON.stringify(payload)});
    if(resultNode){resultNode.hidden=false;resultNode.textContent=result.replayed?'Sortie déjà enregistrée — aucune duplication.':'Sortie chantier enregistrée.'}
    form.elements.quantity.value='';form.elements.note.value='';form.elements.operationKey.value=fieldPortalKey('stock-consume');
    await fieldPortalSearchStock(projectId,String(form.elements.query.value||''));await loadFieldPortal(projectId,true);
    if(typeof toast==='function')toast(result.replayed?'Stock déjà enregistré.':'Stock pris pour ce chantier.');
  }catch(error){if(resultNode){resultNode.hidden=false;resultNode.textContent=error.message||'Sortie de stock refusée.'}else if(typeof toast==='function')toast(error.message||'Sortie de stock refusée.')}
  finally{button.disabled=false}
}
function fieldPortalOpenNote(projectId){
  fieldPortalDialog('<form class="stack" data-sx-managed-save="true" data-sx-draft-identity="field-note-'+esc(projectId)+'" onsubmit="fieldPortalSubmitNote(event)"><h2>Remarque chantier</h2><input type="hidden" name="projectId" value="'+esc(projectId)+'"><label>Remarque<textarea name="text" rows="4"></textarea></label><label>Photos<input type="file" name="photos" accept="image/*" multiple></label><p class="notice" role="status" data-field-save-status hidden></p><button class="btn" type="submit">Enregistrer</button></form>');
}
function fieldPortalOpenProblem(projectId){
  fieldPortalDialog('<form class="stack" data-sx-managed-save="true" data-sx-draft-identity="field-problem-'+esc(projectId)+'" onsubmit="fieldPortalSubmitProblem(event)"><h2>Signaler un problème</h2><input type="hidden" name="projectId" value="'+esc(projectId)+'"><label>Catégorie<select name="category"><option value="equipment">Matériel cassé</option><option value="materials">Manque de matériaux</option><option value="safety">Sécurité</option><option value="site_error">Erreur chantier</option><option value="technical">Problème technique</option><option value="other">Autre</option></select></label><label>Commentaire<textarea name="comment" rows="4" required></textarea></label><label>Photos<input type="file" name="photos" accept="image/*" multiple></label><p class="notice" role="status" data-field-save-status hidden></p><button class="btn" type="submit">Signaler</button></form>');
}
function fieldPortalOpenTask(projectId){
  const data=fieldPortalState.get(String(projectId))?.data,members=(data?.team?.members||[]).filter(item=>item.userId);
  const options='<option value="">Non attribuée</option>'+members.map(item=>'<option value="'+esc(item.userId)+'">'+esc(item.name)+'</option>').join('');
  fieldPortalDialog('<form class="stack" data-sx-managed-save="true" data-sx-draft-identity="field-task-'+esc(projectId)+'" onsubmit="fieldPortalSubmitTask(event)"><h2>Nouvelle étape du chantier</h2>'+fieldPreparationTemplatesHtml()+'<input type="hidden" name="projectId" value="'+esc(projectId)+'"><label>Titre<input name="title" required></label><label>Description<textarea name="description" rows="3"></textarea></label><label>Responsable<select name="assignedTo">'+options+'</select></label><label>Priorité<select name="priority"><option value="normal">Normale</option><option value="high">Haute</option><option value="urgent">Urgente</option><option value="low">Basse</option></select></label><label>Échéance<input name="dueAt" type="date"></label><label>Checklist — une ligne par élément<textarea name="checklist" rows="4"></textarea></label><label>Matériaux nécessaires — une ligne par matériau<textarea name="materials" rows="3"></textarea></label><p class="notice" role="status" data-field-save-status hidden></p><button class="btn" type="submit">Créer l’étape</button></form>');
}
async function fieldPortalUploadPhotos(projectId,files,prefix,assertCurrent=()=>{}){
  const ids=[];let index=0;
  for(const file of files){if(!file||!file.size)continue;assertCurrent();const form=new FormData();form.append('file',file);form.append('title',file.name);form.append('operationKey',prefix+'-photo-'+index++);const result=await serverJson('/api/projects/'+encodeURIComponent(projectId)+'/field-photos',{method:'POST',body:form});ids.push(result.document.id)}
  return ids;
}
const fieldPortalOperations=new Map();
function fieldPortalOperationKey(kind,scope,data){
 const signature=JSON.stringify([kind,scope,...Array.from(data.entries()).map(([name,value])=>[name,typeof value==='string'?value:[value.name,value.size,value.lastModified]])]);
 if(!fieldPortalOperations.has(signature)){fieldPortalOperations.set(signature,fieldPortalKey(kind));if(fieldPortalOperations.size>64)fieldPortalOperations.delete(fieldPortalOperations.keys().next().value)}
 return fieldPortalOperations.get(signature);
}
async function fieldPortalSaveForm(event,kind,perform){
 event.preventDefault();
 const form=event.currentTarget;if(form.dataset.fieldSaving==='true')return;
 const data=new FormData(form),projectId=String(data.get('projectId')||''),scope=fieldPortalScope(),record=fieldPortalState.get(projectId);
 const capability={note:'createNotes',problem:'reportProblems',task:'manageTasks'}[kind];
 const current=()=>scope===fieldPortalScope()&&form.isConnected&&document.querySelector('#modal')?.open;
 const status=form.querySelector('[data-field-save-status]');
 if(!record||record.scope!==scope||!record.data?.capabilities?.[capability]){if(status){status.hidden=false;status.textContent='Actualisez le chantier pour confirmer vos accès.'}return}
 const prefix=fieldPortalOperationKey(kind,scope,data),controls=Array.from(form.querySelectorAll('button,input,select,textarea')).map(node=>[node,node.disabled]);
 const assertCurrent=()=>{if(!current())throw Object.assign(Error('Le formulaire ou l’entreprise a changé. Aucune nouvelle action n’a été envoyée.'),{name:'AbortError'})};
 globalThis.sxSaveFormDraft?.(form);
 form.dataset.fieldSaving='true';fieldPortalActions++;controls.forEach(([node])=>node.disabled=true);if(status){status.hidden=false;status.textContent='Enregistrement en cours…'}
 try{
  await perform({data,projectId,prefix,assertCurrent});
  if(!current())return;
  globalThis.sxAcknowledgeForm?.(form);closeModal();
  if(scope===fieldPortalScope())await loadFieldPortal(projectId,true);
  if(scope===fieldPortalScope()&&typeof toast==='function')toast('Enregistré.');
 }catch(error){
  if(current()){if(status){status.hidden=false;status.textContent=error.message||'L’enregistrement n’a pas été confirmé. Votre saisie est conservée.'}else if(typeof toast==='function')toast(error.message||'Enregistrement refusé.')}
 }finally{fieldPortalActions--;form.dataset.fieldSaving='false';controls.forEach(([node,disabled])=>node.disabled=disabled)}
}
async function fieldPortalSubmitNote(event){
 return fieldPortalSaveForm(event,'note',async({data,projectId,prefix,assertCurrent})=>{
  const photoDocumentIds=await fieldPortalUploadPhotos(projectId,data.getAll('photos'),prefix,assertCurrent);assertCurrent();
  await serverJson('/api/projects/'+encodeURIComponent(projectId)+'/notes',{method:'POST',body:JSON.stringify({text:String(data.get('text')||''),visibility:'Équipe et patron',photoDocumentIds,operationKey:prefix+'-note'})});
 });
}
async function fieldPortalSubmitProblem(event){
 return fieldPortalSaveForm(event,'problem',async({data,projectId,prefix,assertCurrent})=>{
  const photoDocumentIds=await fieldPortalUploadPhotos(projectId,data.getAll('photos'),prefix,assertCurrent);assertCurrent();
  await serverJson('/api/projects/'+encodeURIComponent(projectId)+'/problems',{method:'POST',body:JSON.stringify({category:String(data.get('category')),comment:String(data.get('comment')||''),photoDocumentIds,operationKey:prefix+'-problem'})});
 });
}
async function fieldPortalSubmitTask(event){
 return fieldPortalSaveForm(event,'task',async({data,projectId,prefix,assertCurrent})=>{
  const checklist=String(data.get('checklist')||'').split('\n').map(value=>value.trim()).filter(Boolean).map((label,index)=>({id:'check-'+index,label,done:false})),materials=String(data.get('materials')||'').split('\n').map(value=>value.trim()).filter(Boolean).map(name=>({name}));
  assertCurrent();
  await serverJson('/api/projects/'+encodeURIComponent(projectId)+'/tasks',{method:'POST',body:JSON.stringify({title:String(data.get('title')||''),description:String(data.get('description')||''),assignedTo:String(data.get('assignedTo')||''),priority:String(data.get('priority')||'normal'),dueAt:String(data.get('dueAt')||''),checklist,materials,operationKey:prefix})});
 });
}
async function fieldPortalEditNote(noteId){
  const entry=[...fieldPortalState.entries()].find(([,value])=>value.data?.notes?.some(note=>String(note.id)===String(noteId)));if(!entry)return;const note=entry[1].data.notes.find(item=>String(item.id)===String(noteId)),text=prompt('Modifier la remarque',note.text||'');if(text===null)return;
  await fieldPortalAction(()=>serverJson('/api/projects/'+encodeURIComponent(entry[0])+'/notes/'+encodeURIComponent(noteId),{method:'PATCH',body:JSON.stringify({text})}),entry[0]);
}
async function fieldPortalDeleteNote(noteId){
  const entry=[...fieldPortalState.entries()].find(([,value])=>value.data?.notes?.some(note=>String(note.id)===String(noteId)));if(!entry||!confirm('Supprimer cette remarque ?'))return;
  await fieldPortalAction(()=>serverJson('/api/projects/'+encodeURIComponent(entry[0])+'/notes/'+encodeURIComponent(noteId),{method:'DELETE'}),entry[0]);
}

const renderBeforeFieldPortal=render;
render=function(){
  renderBeforeFieldPortal();
  if(view!=='jobWorkspace'||!currentJobId){fieldPortalVisibleKey='';return;}
  const main=document.querySelector('#main');if(!main||main.querySelector('[data-field-portal]'))return;
  const key=String(currentJobId),hub=main.querySelector('[data-project-hub]'),html=fieldPortalPanel(key);
  if(hub)hub.insertAdjacentHTML('beforebegin',html);else main.insertAdjacentHTML('beforeend',html);
  const visibleKey=typeof jobWorkspaceTab==='string'&&jobWorkspaceTab==='field'?fieldPortalScope()+'|'+key:'';
  const returned=visibleKey&&visibleKey!==fieldPortalVisibleKey;fieldPortalVisibleKey=visibleKey;
  if(!fieldPortalState.has(key)||fieldPortalState.get(key)?.scope!==fieldPortalScope())queueMicrotask(()=>loadFieldPortal(key));
  else if(returned)queueMicrotask(()=>loadFieldPortal(key,true,{quiet:true}));
};
const fieldPreparationTemplates=Object.freeze({
 toiture:{label:'Préparation toiture',title:'Préparer le chantier de toiture',description:'Préparation à adapter au dossier, au métré et aux conditions du chantier. Les quantités et les choix de produits restent à valider.',checklist:['Relire le devis, les plans et le métré validés','Vérifier les accès, les protections prévues et les contraintes du site','Confirmer l’équipe, le créneau et les moyens nécessaires','Vérifier les matériaux disponibles et les livraisons attendues','Préparer les documents et les consignes à transmettre'],materials:['Couverture à confirmer selon le devis','Sous-toiture, bois et accessoires à vérifier sur le métré','Fixations et finitions à confirmer']},
 renovation:{label:'Préparation rénovation',title:'Préparer le chantier de rénovation',description:'Préparation à relire avant planification et commande. Adapter les étapes aux travaux convenus avec le client.',checklist:['Vérifier le périmètre du devis et les documents disponibles','Confirmer l’accès au bâtiment et les contraintes d’occupation','Organiser les interventions et les moyens nécessaires','Rapprocher les besoins du stock et des livraisons','Préparer un état initial et les consignes de chantier'],materials:[]},
 intervention:{label:'Intervention courte',title:'Préparer l’intervention',description:'Préparation d’une intervention à confirmer avant le départ.',checklist:['Confirmer le besoin et le contact sur place','Vérifier le rendez-vous et l’accès','Préparer l’outillage et les consommables utiles','Prévoir les photos et le compte rendu de fin d’intervention'],materials:[]}
});
function fieldPreparationTemplatesHtml(){
 return '<details class="preparation-search"><summary>Partir d’un modèle de préparation</summary><label>Modèle<select data-field-template><option value="">Choisir un modèle</option>'+Object.entries(fieldPreparationTemplates).map(([id,item])=>'<option value="'+esc(id)+'">'+esc(item.label)+'</option>').join('')+'</select></label><button type="button" class="btn" onclick="applyFieldPreparationTemplate(this.form)">Ajouter au brouillon</button><p class="subtle">Relisez et adaptez la proposition avant de créer l’étape. Les commandes et les réservations restent à effectuer dans leurs écrans.</p></details>';
}
function applyFieldPreparationTemplate(form){
 const template=fieldPreparationTemplates[form.querySelector('[data-field-template]')?.value];if(!template)return;
 const additions={title:template.title,description:template.description,checklist:template.checklist.join('\n'),materials:template.materials.join('\n')};
 for(const [name,value] of Object.entries(additions)){
  const field=form.elements.namedItem(name);if(!field||!value)continue;
  if(name==='title'){if(!field.value.trim())field.value=value}
  else if(name==='description'){if(!field.value.includes(value))field.value=[field.value.trim(),value].filter(Boolean).join('\n\n')}
  else {const lines=new Set(field.value.split('\n').map(line=>line.trim()).filter(Boolean));value.split('\n').forEach(line=>lines.add(line));field.value=Array.from(lines).join('\n')}
  field.dispatchEvent(new Event('input',{bubbles:true}));
 }
 form.elements.namedItem('title')?.focus();if(typeof toast==='function')toast('Modèle ajouté au brouillon. Relisez les étapes et les matériaux.');
}
function fieldPortalQueueStatus(items){
 const scope=fieldPortalScope();
 document.querySelectorAll('[data-field-queue]').forEach(node=>{
  if(node.dataset.fieldScope!==scope)return;
  const rows=items.filter(item=>String(item.projectId)===node.dataset.projectId),blocked=rows.filter(item=>item.status==='blocked').length,pending=rows.length-blocked;
  node.textContent=rows.length?[pending?pending+' note(s) à envoyer':'',blocked?blocked+' note(s) à vérifier':''].filter(Boolean).join(' · '):'Aucune note en attente d’envoi pour ce chantier.';
 });
}
globalThis.socleOffline?.onQueueChange?.(fieldPortalQueueStatus);
