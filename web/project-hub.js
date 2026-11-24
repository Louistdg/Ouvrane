// Hub chantier en lecture seule : toutes les données et permissions viennent du serveur.
const projectHubUiState=new Map();
let projectHubLastAccessKey='';
function projectHubAccessKey(){
  const access=globalThis.socleCurrentAccess||{},organization=typeof activeSocleOrganizationId==='undefined'?globalThis.socleCurrentOrganizationId||access.organizationId:activeSocleOrganizationId;
  const key=JSON.stringify([organization||'',access.userId||'',access.roleCode||'',access.permissions||[],globalThis.socleAccessPreview||null,Boolean(globalThis.socleLimitedSession)]);
  if(key!==projectHubLastAccessKey){projectHubUiState.clear();projectHubLastAccessKey=key}
  return key;
}

function projectHubDate(value){
  if(!value)return '';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?String(value):date.toLocaleString('fr-BE',{dateStyle:'short',timeStyle:'short'});
}
function projectHubCount(value){return value===null||value===undefined?'—':String(value)}
function projectHubMoney(cents){return cents===null||cents===undefined?'À compléter':new Intl.NumberFormat('fr-BE',{style:'currency',currency:'EUR'}).format(Number(cents)/100)}
function projectHubForecastPanel(state){
  if(!state.hub.capabilities?.viewFinancial)return '';
  if(state.forecastStatus==='loading')return '<section class="v3-project-finance"><h3>Rentabilité prévisionnelle</h3><p>Calcul en cours…</p></section>';
  if(state.forecastStatus==='error')return '<section class="v3-project-finance"><h3>Rentabilité prévisionnelle</h3><p>Les chiffres de rentabilité ne sont pas disponibles pour ce chantier.</p></section>';
  const f=state.forecast;if(!f)return '';
  const labels={STOCK_COST_PROVENANCE_INCOMPLETE:'Origine des coûts de stock à vérifier',BASELINE_MISSING:'Prévisions de coûts à compléter',LABOUR_HOURLY_COST_MISSING:'Coût horaire manquant',LABOUR_TIME_ENTRIES_MISSING:'Pointages de main-d’œuvre manquants',TIME_CORRECTIONS_PENDING:'Corrections d’heures à valider',SUPPLIER_DELIVERIES_PENDING:'Livraisons fournisseur encore attendues',SUPPLIER_PRICE_VARIANCE:'Écart de prix commande/facture à vérifier',SUPPLIER_INVOICE_MATCHING_INCOMPLETE:'Lignes de facture fournisseur à rapprocher',BUDGET_MATERIALS_MISSING:'Budget matériaux manquant',BUDGET_SUBCONTRACTING_MISSING:'Budget sous-traitance manquant',BUDGET_EQUIPMENT_MISSING:'Budget matériel manquant',BUDGET_OTHER_MISSING:'Autres budgets manquants',LABOUR_RAD_UNKNOWN:'Heures restantes non estimées',UNCLASSIFIED_COSTS:'Certains coûts ou engagements restent à classer'};
  const confidence={HIGH:'Données suffisamment complètes',MEDIUM:'Estimation à compléter',LOW:'Marge impossible à établir'}[f.quality?.confidence]||'Qualité à vérifier';
  const reasons=(f.quality?.reasons||[]).map(x=>labels[x]||'Données complémentaires nécessaires');
  return `<section class="v3-project-finance" aria-label="Rentabilité prévisionnelle"><div class="v3-project-finance-head"><div><p class="eyebrow">PRÉVISION · HTVA</p><h3>Rentabilité prévisionnelle</h3></div><span class="v3-quality" data-quality="${esc(f.quality?.confidence||'LOW')}">${esc(confidence)}</span></div><div class="v3-project-finance-grid"><div><span>Marché accepté</span><strong>${projectHubMoney(f.revenue?.totalContractCents)}</strong></div><div><span>Coûts déjà constatés</span><strong>${projectHubMoney(f.totals?.costToDateCents)}</strong></div><div><span>Coût prévu à la fin</span><strong>${projectHubMoney(f.totals?.catCents)}</strong></div><div class="v3-project-margin"><span>Marge estimée</span><strong>${projectHubMoney(f.totals?.projectedMarginCents)}</strong></div></div>${reasons.length?`<p class="v3-project-finance-quality">À compléter : ${esc([...new Set(reasons)].join(' · '))}.</p>`:'<p class="v3-project-finance-quality">Les budgets et les coûts connus sont pris en compte dans cette estimation.</p>'}<p class="v3-project-finance-foot">Cette marge estimée se distingue des factures émises et de l’argent encaissé.</p></section>`;
}
function projectHubTimelineRows(events){
  if(!events?.length)return '<div class="empty">Aucun événement visible avec vos permissions.</div>';
  return events.map(event=>`<div class="detail-row"><span><strong>${esc(event.title||event.type||'Événement')}</strong><small>${esc(event.description||event.entityType||'')} · ${esc(projectHubDate(event.occurredAt))}</small></span></div>`).join('');
}

function projectHubStatusLabel(value){return ({active:'En cours',planned:'À préparer',completed:'Terminé',closed:'Clôturé',archived:'Archivé',cancelled:'Annulé'})[value]||value||'';}
function projectHubNextActionList(state){
 if(!state||state.status!=='ready'||!state.hub)return [];
 const hub=state.hub,cap=hub.capabilities||{},list=[],add=(key,title,detail,label,kind,id,priority)=>list.push({key,title,detail,label,kind,id:String(id||''),priority});
 if(cap.viewTasks)for(const task of hub.tasks?.items||[]){
  if(!['todo','in_progress','blocked'].includes(task.status))continue;
  add('task:'+task.id,task.title||'Étape du chantier',task.status==='blocked'?'Étape bloquée : vérifier la consigne et les échanges.':task.dueAt?'Échéance : '+projectHubDate(task.dueAt):'Étape en cours de préparation ou d’exécution.','Fiches terrain','task',task.id,task.status==='blocked'?0:task.priority==='urgent'?1:4);
 }
 if(cap.viewProcurement)for(const order of hub.procurement?.purchaseOrders?.items||[]){
  const status=String(order.status||'').toLocaleLowerCase('fr-BE');
  if(!['commandée','partiellement reçue','ordered','partially_received'].includes(status))continue;
  add('order:'+order.id,'Livraison à suivre · '+(order.reference||'Commande'),order.expectedDate?'Prévue le '+projectHubDate(order.expectedDate):'Une réception reste à vérifier.','Ouvrir la commande','order',order.id,2);
 }
 if(cap.viewCommercial)for(const quote of hub.commercial?.quotes?.items||[]){
  const status=String(quote.status||'').toLocaleLowerCase('fr-BE');
  if(!['brouillon','à présenter','draft','sent'].includes(status))continue;
  add('quote:'+quote.id,(status==='brouillon'||status==='draft'?'Préparer le devis · ':'Suivre le devis · ')+(quote.reference||quote.title||'Devis'),quote.title||'Vérifier le contenu et le suivi du devis.','Ouvrir le devis','quote',quote.id,5);
 }
 if(cap.viewFinancial&&state.forecastStatus==='ready'){
  const reasons=new Set(state.forecast?.quality?.reasons||[]);
  if(reasons.has('TIME_CORRECTIONS_PENDING'))add('time-review','Vérifier les corrections d’heures','Des corrections attendent une décision.','Voir les pointages','time','',1);
  if(reasons.has('UNCLASSIFIED_COSTS'))add('cost-classification','Classer les coûts du chantier','Certains coûts ne sont pas encore classés dans la prévision.','Voir les chiffres','finance','',3);
  if(['BASELINE_MISSING','BUDGET_MATERIALS_MISSING','BUDGET_SUBCONTRACTING_MISSING','BUDGET_EQUIPMENT_MISSING','BUDGET_OTHER_MISSING','LABOUR_RAD_UNKNOWN','LABOUR_HOURLY_COST_MISSING'].some(code=>reasons.has(code)))add('forecast','Compléter la prévision','Budget ou estimation du travail restant à compléter.','Voir la prévision','finance','',6);
 }
 return list.sort((a,b)=>a.priority-b.priority||a.key.localeCompare(b.key)).slice(0,6);
}
function projectHubNextActionsPanel(state,projectId){
 const list=projectHubNextActionList(state),id=esc(String(projectId));
 return '<section class="panel project-next-actions" data-project-next-actions><div class="panel-head"><div><h2>Prochaines actions</h2><p>Les points à traiter dans ce chantier.</p></div><button class="btn" type="button" data-project-id="'+id+'" onclick="projectHubRefresh(this.dataset.projectId)">Actualiser</button></div>'+
 (list.length?'<div class="project-next-list">'+list.map(action=>'<article class="project-next-row"><div><strong>'+esc(action.title)+'</strong><p>'+esc(action.detail)+'</p></div><button class="btn" type="button" data-project-id="'+id+'" data-action-key="'+esc(action.key)+'" onclick="projectHubRunAction(this)">'+esc(action.label)+'</button></article>').join('')+'</div>':'<p class="project-next-empty">Aucun point prioritaire repéré parmi les éléments chargés.</p>')+
 '<p class="project-next-foot">Aperçu des éléments visibles avec vos droits. Les rubriques du chantier donnent accès au détail complet.</p></section>';
}
function projectHubRefresh(projectId){
 const key=String(projectId||'');projectHubAccessKey();
 if(typeof view==='undefined'||view!=='jobWorkspace'||String(currentJobId||'')!==key)return;
 projectHubUiState.delete(key);render();
}
function projectHubRunAction(button){
 const key=String(button?.dataset?.projectId||''),accessKey=projectHubAccessKey(),state=projectHubUiState.get(key);
 if(typeof view==='undefined'||view!=='jobWorkspace'||String(currentJobId||'')!==key||!state||state.accessKey!==accessKey)return;
 const action=projectHubNextActionList(state).find(item=>item.key===button.dataset.actionKey);if(!action)return;
 if(action.kind==='task'&&typeof openWorkPacketHistory==='function')return openWorkPacketHistory(action.id);
 if(action.kind==='order'&&typeof iaAShowPurchaseOrder==='function'&&typeof purchaseOrders!=='undefined'&&purchaseOrders.some(item=>String(item.id)===action.id))return iaAShowPurchaseOrder(action.id);
 if(action.kind==='quote'&&typeof showQuote==='function'&&typeof quotes!=='undefined'){
  const quote=quotes.find(item=>String(item.id)===action.id);if(quote)return showQuote(quote.id);
 }
 const route=({order:'purchases',quote:'quotes',time:'timeEntries'})[action.kind];
 if(route&&typeof canViewModule==='function'&&canViewModule(route))return navigate(route);
 if(action.kind==='finance'){jobWorkspaceTab='finance';render();}
}

function projectHubOperationalTasks(state){
  const source=state?.hub?.tasks;if(!source)return '';
  const items=[...(source.items||[])].sort((a,b)=>String(a.dueAt||'').localeCompare(String(b.dueAt||''))||String(a.title).localeCompare(String(b.title)));
  const open=state.hub.summary?.openTasksCount;
  return '<section class="panel" data-project-operational-tasks><div class="panel-head"><div><h2>Étapes du chantier</h2><p>Travail des équipes enregistré dans ce chantier.</p></div><span class="badge">'+esc(String(open??'—'))+' ouverte(s)</span></div>'+(items.length?items.map(task=>'<div class="detail-row"><span><strong>'+esc(task.title)+'</strong><small>'+esc(projectHubDate(task.dueAt))+' · '+esc(({todo:'À faire',in_progress:'En cours',blocked:'Bloquée',done:'Terminée'})[task.status]||task.status)+'</small></span><button type="button" class="btn" onclick="openWorkPacketHistory(\''+jsString(String(task.id))+'\')">Fiches terrain</button></div>').join(''):'<p>Aucune étape visible dans ce chantier.</p>')+(source.pageInfo?.hasMore?'<button type="button" class="btn" onclick="navigate(\'actions\')">Voir toutes les tâches autorisées</button>':'')+'</section>';
}
function projectHubReadOnlyPanel(projectId){
  projectHubAccessKey();
  const state=projectHubUiState.get(String(projectId));
  if(!state||state.status==='loading')return `<section class="panel" data-project-hub><div class="panel-head"><div><p class="eyebrow">HUB CHANTIER</p><h2>Vue transversale</h2></div></div><p class="subtle">Chargement des données autorisées…</p></section>`;
  if(state.status==='error')return `<section class="panel" data-project-hub><div class="panel-head"><div><p class="eyebrow">HUB CHANTIER</p><h2>Vue transversale</h2></div></div><p class="notice">${esc(state.error||'Hub chantier indisponible.')}</p></section>`;
  const hub=state.hub,timeline=state.timeline,summary=hub.summary||{};
  return `<section class="panel" data-project-hub>
    <div class="panel-head"><div><p class="eyebrow">DOSSIER DU CHANTIER</p><h2>${esc(hub.identity?.name||'Chantier')}</h2><span>${esc(hub.identity?.reference||'')} ${hub.identity?.status?'· '+esc(projectHubStatusLabel(hub.identity.status)):''}</span></div><span class="badge green">Données enregistrées</span></div>
    <div class="detail-row"><span>Devis visibles</span><b>${projectHubCount(summary.quotesCount)}</b></div>
    <div class="detail-row"><span>Factures clients visibles</span><b>${projectHubCount(summary.clientInvoicesCount)}</b></div>
    <div class="detail-row"><span>Commandes fournisseur visibles</span><b>${projectHubCount(summary.purchaseOrdersCount)}</b></div>
    <div class="detail-row"><span>Livraisons visibles</span><b>${projectHubCount(summary.deliveriesCount)}</b></div>
    <div class="detail-row"><span>Tâches ouvertes visibles</span><b>${projectHubCount(summary.openTasksCount)}</b></div>
    <div class="detail-row"><span>Documents visibles</span><b>${projectHubCount(summary.documentsCount)}</b></div>
    ${projectHubForecastPanel(state)}
    <div class="panel-head" style="margin-top:22px"><div><h3>Derniers événements</h3><span>Activité visible pour votre compte.</span></div></div>
    ${projectHubTimelineRows(timeline.events)}
  </section>`;
}
async function loadProjectHubReadOnly(projectId){
  const key=String(projectId||'');if(!key)return;
  const accessKey=projectHubAccessKey();
  const existing=projectHubUiState.get(key);if(existing?.status==='loading'||existing?.status==='ready')return;
  const state={status:'loading',accessKey};projectHubUiState.set(key,state);
  const current=()=>accessKey===projectHubAccessKey()&&projectHubUiState.get(key)===state;
  try{
    const [hub,timeline]=await Promise.all([
      serverJson('/api/projects/'+encodeURIComponent(key)+'/hub?limit=5'),
      serverJson('/api/projects/'+encodeURIComponent(key)+'/timeline?limit=10')
    ]);
    if(!current())return;
    Object.assign(state,{status:'ready',hub,timeline,forecastStatus:hub.capabilities?.viewFinancial?'loading':'hidden'});
    if(hub.capabilities?.viewFinancial){try{const forecast=await serverJson('/api/projects/'+encodeURIComponent(key)+'/financial-forecast');if(!current())return;state.forecast=forecast;state.forecastStatus='ready'}catch{if(!current())return;state.forecastStatus='error'}}
  }catch(error){
    if(!current())return;Object.assign(state,{status:'error',error:error.message||'Hub chantier indisponible.'});
  }
  if(current()&&typeof render==='function'&&view==='jobWorkspace'&&String(currentJobId||'')===key)render();
}
const renderBeforeProjectHub=render;
render=function(){
  projectHubAccessKey();
  renderBeforeProjectHub();
  if(view!=='jobWorkspace'||!currentJobId)return;
  const main=document.querySelector('#main');if(!main||main.querySelector('[data-project-hub]'))return;
  const key=String(currentJobId),state=projectHubUiState.get(key);
  // Legacy reminders and canonical project tasks are separate sources.
  // Label the old counter honestly and expose the server's scoped task list.
  for(const label of main.querySelectorAll('.job-workspace-kpis small'))if(label.textContent.trim()==='Tâches ouvertes')label.textContent='Rappels ouverts';
  const reminderHeading=[...main.querySelectorAll('.panel-head h2')].find(node=>node.textContent.trim().startsWith('À gérer maintenant'));
  if(reminderHeading){
    reminderHeading.textContent='Rappels du chantier';
    const create=reminderHeading.closest('.panel')?.querySelector('button[onclick*="reminderForm"]');
    if(create){create.removeAttribute('onclick');create.onclick=()=>reminderForm('','job',key)}
  }
  if(state?.status==='ready'&&(typeof jobWorkspaceTab==='undefined'||jobWorkspaceTab==='summary')){
    const kpis=main.querySelector('.job-workspace-kpis');
    if(kpis)kpis.insertAdjacentHTML('beforebegin',projectHubNextActionsPanel(state,key));
  }
  if(state?.status==='ready'&&state.hub?.tasks){
    const kpis=main.querySelector('.job-workspace-kpis');
    if(kpis)kpis.insertAdjacentHTML('beforebegin',projectHubOperationalTasks(state));
  }
  main.insertAdjacentHTML('beforeend',projectHubReadOnlyPanel(key));
  if(!state)queueMicrotask(()=>loadProjectHubReadOnly(key));
};
