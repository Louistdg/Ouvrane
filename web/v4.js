/* OUVRANE — existing tools and explicit preparation of future integrations.
   The original presentation classes remain shared with the existing themes. */
(function(){
'use strict';
var escFn=function(value){return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]})};
var v4FinanceOpen=false,v4NavButton=null,choiceSequence=0,homeVisits={key:'',status:'idle',count:null},presentationSignatures=new WeakMap();
function ready(){return !globalThis.socleWorkspaceLoading&&(typeof storageReady!=='undefined'&&storageReady===true||globalThis.socleAccessPreviewVerified===true)}
function permission(code){var access=globalThis.socleCurrentAccess||{};return Boolean(access.owner||access.roleCode==='OWNER'||(access.permissions||[]).includes(code))}
function moduleView(name){try{return ready()&&typeof canModuleAction==='function'&&canModuleAction(name,'view')}catch(_){return false}}
function catalogueAllowed(){return ['jobs','quotes','documents','fleet','accounting','actions'].some(moduleView)}
function mayPlans(){return moduleView('documents')&&permission('documents.secure.manage')}
function mayMeasurements(){return moduleView('quotes')&&permission('quotes.view')&&permission('quotes.prices.view')}
function mayImports(){return permission('purchase_orders.manage')&&permission('stock.view')&&permission('quotes.prices.view')&&ready()}
function mayTriage(){return moduleView('accounting')&&typeof socleCanTriageExpenses==='function'&&socleCanTriageExpenses()}
function mayTime(){return ready()&&['time_entries.view.own','time_entries.view.team','time_entries.view.all','time_entries.create.own','time_entries.create.team'].some(permission)}
function mayEditPreparation(){return moduleView('accounting')&&typeof canModuleAction==='function'&&canModuleAction('company','edit')}
function org(){return String(globalThis.socleCurrentOrganizationId||'')}
function accessScope(){var access=globalThis.socleCurrentAccess||{};return JSON.stringify([org(),access.userId,access.roleCode,(access.permissions||[]).slice().sort(),globalThis.socleAccessPreview?.userId||''])}
function capabilitySignature(){return JSON.stringify([accessScope(),ready(),['jobs','quotes','documents','fleet','accounting','actions','planning'].map(moduleView),mayPlans(),mayMeasurements(),mayImports(),mayTriage(),mayTime(),mayEditPreparation()])}
function present(main,selector,signature,html){var root=main.querySelector(selector);if(root&&presentationSignatures.get(root)===signature)return;main.innerHTML=html();root=main.querySelector(selector);if(root)presentationSignatures.set(root,signature)}
function badge(label,kind){return '<span class="badge '+(kind||'neutral')+'">'+escFn(label)+'</span>'}
function note(value){return '<div class="v4-note">'+value+'</div>'}
function head(title,detail){return '<div class="panel-head"><div><h2>'+escFn(title)+'</h2>'+(detail?'<span class="subtle">'+escFn(detail)+'</span>':'')+'</div></div>'}
function action(name,label,allowed,attributes){return allowed?'<button type="button" class="btn" data-v5-action="'+escFn(name)+'"'+(attributes||'')+'>'+escFn(label)+'</button>':''}
function stateLabel(allowed){return !ready()?'Chargement':allowed?'Disponible':'Accès réservé'}
function capability(id,logo,title,detail,allowed,actionName,label,unconfigured){
 var state=unconfigured?'not-configured':!ready()?'loading':allowed?'available':'restricted';
 return '<article class="v4-connector" data-v5-capability="'+id+'" data-capability-state="'+state+'"><span class="logo">'+logo+'</span><span class="info"><b>'+escFn(title)+'</b><small>'+escFn(detail)+'</small></span>'+badge(unconfigured?'Non opérationnel':stateLabel(allowed),unconfigured?'warn':allowed?'info':'neutral')+action(actionName,label,allowed&&!unconfigured)+'</article>';
}
function ensureNavButton(){
 var nav=document.querySelector('#nav');if(!nav)return;
 if(!catalogueAllowed()){if(v4NavButton)v4NavButton.remove();return}
 if(!v4NavButton||!v4NavButton.isConnected){
  v4NavButton=document.createElement('button');v4NavButton.type='button';v4NavButton.dataset.navRoute='connecteurs';v4NavButton.dataset.navGroup='settings';
  v4NavButton.innerHTML='<span class="nav-pictogram">⇄</span><span class="nav-label">Outils & imports</span><span class="v4-new">V5</span>';
  v4NavButton.addEventListener('click',function(){navigate('connecteurs')});nav.append(v4NavButton);
 }
 v4NavButton.classList.toggle('active',view==='connecteurs');
 if(view==='connecteurs')nav.querySelectorAll('[data-nav-route]').forEach(function(button){if(button!==v4NavButton){button.classList.remove('active');button.removeAttribute('aria-current')}});
 if(view==='connecteurs')v4NavButton.setAttribute('aria-current','page');else v4NavButton.removeAttribute('aria-current');
}
function connectorsScreen(){
 return heading('Outils & imports','Retrouvez les outils disponibles et les étapes à préparer dans votre entreprise.',false)+
 '<div id="v5ToolsCatalogue" class="v4-grid v4-g2">'+
 '<section class="panel">'+head('Plans, mesures et visites','Choisissez un dossier réel avant de travailler.')+
 capability('plans','PDF','Plans PDF et annotations','Plans privés par révision, page et repère.',mayPlans(),'plans','Choisir un dossier')+
 capability('measurements','M²','Métrés et besoins','Mesures versionnées d’une visite, puis reprise dans le devis et les achats.',mayMeasurements(),'measurements','Choisir une visite')+
 capability('field','CH','Dossiers de chantier','Photos, notes, tâches et fiches de travail selon vos accès.',moduleView('jobs'),'field','Choisir un chantier')+'</section>'+
 '<section class="panel">'+head('Catalogue et documents fournisseurs','Import contrôlé, fichier original et validation humaine.')+
 capability('supplier-prices','CSV','Tarifs CSV / XLSX','Tarifs datés, correspondances de références et aperçu avant enregistrement.',mayImports(),'supplier-prices','Ouvrir les tarifs')+
 capability('ocr','OCR','Lecture locale des pièces','Texte PDF ou Tesseract local pour préparer une facture, un reçu ou un bon.',mayTriage(),'ocr','Préparer une pièce')+
 capability('assets','MAT','Parc et moyens réservés','Actifs existants, affectations, prises, retours et indisponibilités.',moduleView('fleet')&&permission('assets.view'),'assets','Ouvrir le parc')+'</section>'+
 '<section class="panel">'+head('Échanges externes à préparer','Aucun envoi externe n’est déclenché par ces informations.')+
 capability('invoicing','PE','Facturation électronique Peppol','Aucun opérateur connecté dans cette version. Les factures OUVRANE restent enregistrées en interne.',false,'','',true)+
 action('electronic-preparation','Voir la préparation Peppol',moduleView('accounting'))+
 capability('onss','PT','Déclarations de présence externes','Les pointages OUVRANE ne sont pas transmis à l’ONSS par cette application.',false,'','',true)+
 action('time-entries','Ouvrir les pointages OUVRANE',mayTime())+'</section>'+
 '<section class="panel">'+head('Données spécialisées','Conservez le contexte et les documents dans le dossier de chantier.')+
 capability('equipment-data','EXT','Données des fabricants et équipements','Aucune connexion de télématique, de capteur ou de caméra n’est configurée ici.',false,'','',true)+
 capability('ifc','3D','IFC et dossier de réception automatisé','Aucun lecteur IFC ni export DOE automatique disponible. Les plans PDF et documents restent accessibles.',false,'','',true)+
 action('documents','Ouvrir les documents',moduleView('documents'))+'</section></div>'+
 note('Les disponibilités ci-dessus décrivent les outils de cette version et vos accès. Une préparation ou un fichier importé ne constitue pas une connexion à un service externe.');
}
function injectFinanceTab(main){
 var bar=main.querySelector('.v3-section-tabs');if(!bar||bar.querySelector('.v4-tab-peppol')||!moduleView('accounting'))return;
 var button=document.createElement('button');button.type='button';button.className='v4-tab-peppol';button.textContent='Préparation Peppol';
 button.addEventListener('click',function(){v4FinanceOpen=true;render()});bar.append(button);
}
function financePanelHTML(){
 var config=typeof electronicInvoiceSettings==='function'?electronicInvoiceSettings():null;
 return heading('Facturation électronique','Préparez vos informations ; les factures enregistrées restent dans la comptabilité.',false)+
 '<div class="v4-peppol-tabs"><button type="button" data-v5-action="finance-back">← Factures et paiements</button><button type="button" class="active" aria-current="page">Préparation Peppol</button></div>'+
 '<section id="v5ElectronicInvoicePreparation" class="v4-grid v4-g23"><div class="panel">'+head('Opérateur Peppol','Aucune transmission ni réception Peppol dans cette version.')+badge('Non configuré','warn')+
 '<p>Renseigner un identifiant de point d’accès prépare le dossier. Cela ne connecte pas un opérateur et ne vérifie pas cet identifiant.</p>'+
 '<div class="v5-tools-actions">'+action('electronic-settings','Renseigner les informations',mayEditPreparation())+action('finance-back','Retrouver les factures enregistrées',moduleView('accounting'))+'</div></div>'+
 '<div class="panel">'+head('Informations de préparation')+'<p>'+escFn(config&&config.enabled?'Informations marquées comme préparées dans votre dossier.':'Informations à préparer.')+'</p><p>Les statuts de paiement et les montants des factures proviennent de la comptabilité SOCLE. Aucun statut de livraison sur un réseau externe n’est affiché ici.</p></div></section>';
}
globalThis.v4FinanceBack=function(){v4FinanceOpen=false;render()};
function timeEntriesPanel(){
 return '<section id="v5TimeTrackingLinks" class="panel">'+head('Pointages et transmission externe','Les arrivées, départs et corrections ci-dessus sont conservés dans SOCLE.')+
 '<div class="v4-connector"><span class="logo">PT</span><span class="info"><b>Déclarations ONSS</b><small>Aucun service de déclaration externe n’est connecté. Les heures enregistrées ne constituent pas une déclaration transmise.</small></span>'+badge('Non configuré','warn')+'</div>'+
 '<div class="v5-tools-actions">'+action('planning','Consulter les affectations',moduleView('planning'))+action('tools','Voir les outils disponibles',catalogueAllowed())+'</div></section>';
}
function fleetPanel(){
 return '<section id="v5AssetTools" class="panel">'+head('Préparer le matériel pour l’équipe','Le parc, les réservations et les retours utilisent les mêmes actifs.')+
 '<div class="v4-grid v4-g2"><div><h3>Du planning au retour</h3><p>Ouvrez une affectation pour choisir les moyens, confirmer leur prise et enregistrer leur retour. Les indisponibilités sont suivies dans la fiche de l’actif.</p>'+
 action('planning','Ouvrir le planning',moduleView('planning'))+'</div><div><h3>Documents et données externes</h3><p>Aucun compteur, position ou état fabricant n’est synchronisé ici. Retrouvez les notices et contrôles dans les documents autorisés.</p>'+
 action('documents','Retrouver les documents',moduleView('documents'))+'</div></div></section>';
}
function quotesPanel(){
 return '<section id="v5MeasurementTools" class="panel">'+head('Plans, métrés et préparation des achats','Travaillez depuis une visite et ses sources enregistrées.')+
 '<div class="v4-grid v4-g2"><div><h3>Mesures et versions</h3><p>Ouvrez une visite réelle pour saisir les dimensions, vérifier les hypothèses et retrouver les versions de son métré.</p>'+
 '<div class="v5-tools-actions">'+action('measurements','Choisir une visite pour le métré',mayMeasurements())+action('plans','Ouvrir les plans PDF',mayPlans())+'</div></div>'+
 '<div><h3>Tarifs et besoins</h3><p>Les tarifs fournisseurs importés et les quantités enregistrées alimentent la préparation des achats. Les commandes restent à vérifier avant enregistrement.</p>'+
 action('supplier-prices','Consulter les tarifs CSV / XLSX',mayImports())+'</div></div></section>';
}
function jobHubHTML(){
 var job=(typeof jobs!=='undefined'?jobs:[]).find(function(item){return String(item.id)===String(currentJobId)});
 if(!job)return heading('Dossier de chantier','Choisissez un chantier autorisé.',false)+action('jobs','Ouvrir les chantiers',moduleView('jobs'));
 var id=escFn(job.id),attrs=' data-project-id="'+id+'"',tabs=[['summary','Résumé'],['planning','Planning & équipe'],['field','Terrain'],['documents','Documents'],['finance','Achats & rentabilité'],['history','Historique'],['v4hub','Dossier & outils']];
 var state=typeof fieldPortalState!=='undefined'?fieldPortalState.get(String(job.id)):null;
 return '<div class="job-workspace-head">'+action('jobs','← Tous les chantiers',moduleView('jobs'))+'<div>'+badge(job.phase||'À préparer')+'<h1>'+escFn(job.name)+'</h1><p>'+escFn([job.client,job.address||job.town].filter(Boolean).join(' · '))+'</p></div></div>'+
 '<nav class="job-workspace-tabs" aria-label="Sections du chantier">'+tabs.filter(function(tab){return jobTabAllowed(tab[0])}).map(function(tab){return '<button type="button" class="'+(tab[0]==='v4hub'?'selected':'')+'" data-v5-action="job-tab" data-tab="'+tab[0]+'"'+attrs+'>'+tab[1]+'</button>'}).join('')+'</nav>'+
 '<section id="v5JobTools" data-project-id="'+id+'"><div class="v4-grid v4-g2">'+
 '<div class="panel">'+head('Plans et documents','Les fichiers restent liés à ce chantier.')+'<div class="v5-tools-actions">'+action('project-plans','Ouvrir les plans PDF',mayPlans(),attrs)+action('project-documents','Retrouver les documents',moduleView('documents'),attrs)+'</div></div>'+
 '<div class="panel">'+head('Photos et retours terrain','Consultez les photos, notes et problèmes enregistrés.')+'<p>'+escFn(state&&state.status==='ready'?'Le portail terrain dispose de données chargées pour ce chantier.':state&&state.status==='error'?'Les données terrain sont indisponibles. Ouvrez le portail pour réessayer.':'Le portail charge les informations autorisées de ce chantier.')+'</p>'+
 action('project-field','Ouvrir les photos et retours',moduleView('jobs'),attrs)+'</div>'+
 '<div class="panel">'+head('Tâches, équipe et moyens','Préparation et fiches de travail enregistrées dans SOCLE.')+'<p>Retrouvez les tâches du chantier et leurs fiches, puis les moyens liés au créneau de l’équipe.</p><div class="v5-tools-actions">'+action('project-field','Ouvrir les tâches et fiches',moduleView('jobs'),attrs)+action('project-planning','Voir l’équipe et le planning',moduleView('planning'),attrs)+'</div></div>'+
 '<div class="panel">'+head('Dossier de fin de chantier','Retrouvez les pièces conservées et leurs révisions.')+'<p>La lecture de maquette IFC et la génération automatique d’un DOE ne sont pas disponibles. Les documents et plans existants restent consultables.</p>'+action('project-documents','Consulter les pièces du dossier',moduleView('documents'),attrs)+'</div></div></section>';
}
function injectJobTab(main){
 var bar=main.querySelector('.job-workspace-tabs');if(!bar||bar.querySelector('.v4-job-tab')||!moduleView('jobs'))return;
 var button=document.createElement('button');button.type='button';button.className='v4-job-tab';button.dataset.v5Action='job-tab';button.dataset.tab='v4hub';button.dataset.projectId=String(currentJobId);button.textContent='Dossier & outils';bar.append(button);
}
function metric(id,label,loaded,values,loading){
 var count=Array.isArray(values)?values.length:values,valid=loaded&&Number.isInteger(count)&&count>=0,state=valid?'ready':!ready()||loading?'loading':'not-loaded';
 return '<span class="v5-tools-metric" data-v5-metric="'+id+'" data-state="'+state+'"><b>'+escFn(valid?String(count):state==='loading'?'Chargement':'Données non chargées')+'</b><small>'+escFn(label)+'</small></span>';
}
function readHomeVisits(){
 if(!moduleView('quotes')||!permission('quotes.view')||typeof serverJson!=='function')return;
 var key=accessScope();if(homeVisits.key===key&&homeVisits.status!=='idle')return;
 var request={key:key,status:'loading',count:null};homeVisits=request;
 // Read only: the visit module also synchronizes local drafts when opened.
 // A home counter must not trigger that synchronization.
 Promise.resolve().then(function(){return serverJson('/api/quote-visits')}).then(function(data){
  if(homeVisits!==request||accessScope()!==key||!moduleView('quotes')||!permission('quotes.view'))return;
  if(!Array.isArray(data.visits))throw Error('Liste des visites non chargée.');request.count=data.visits.length;request.status='ready';
 }).catch(function(){if(homeVisits===request)request.status='error'}).finally(function(){if(homeVisits===request&&accessScope()===key&&view==='home'&&ready())render()});
}
function homeStrip(main){
 if(main.querySelector('[data-v5-workspace-summary]'))return;
 readHomeVisits();
 var values='';
 if(moduleView('jobs'))values+=metric('projects','Chantiers visibles',ready(),typeof jobs!=='undefined'?jobs:null);
 if(moduleView('fleet')&&permission('assets.view'))values+=metric('assets','Actifs visibles',typeof serverFieldDataReady!=='undefined'&&serverFieldDataReady,typeof assets!=='undefined'?assets:null);
 if(moduleView('quotes')&&permission('quotes.view'))values+=metric('visits','Visites enregistrées visibles',homeVisits.key===accessScope()&&homeVisits.status==='ready',homeVisits.count,homeVisits.status==='loading');
 if(!values)return;var strip=document.createElement('section');strip.className='v4-strip';strip.dataset.v5WorkspaceSummary='';strip.setAttribute('aria-label','Dossiers chargés dans votre espace');strip.innerHTML=values;var heading=main.querySelector('.heading,.ui-page-header');if(heading)heading.after(strip);else main.prepend(strip);
}
function homeConnectedCard(main){
 if(main.querySelector('[data-v5-home-overview]')||!catalogueAllowed())return;
 var card=document.createElement('section');card.className='panel v4-home-connected';card.dataset.v5HomeOverview='';
 card.innerHTML=head('Vos outils de travail','Plans PDF, métrés, tarifs fournisseurs et documents.')+
 '<div class="v4-grid v4-g2"><div><p>Retrouvez les outils disponibles pour vos dossiers. Les imports et les actions terrain restent soumis à vos droits et à votre confirmation.</p>'+
 '<div class="v5-tools-actions">'+action('tools','Ouvrir les outils & imports',true)+action('measurements','Ouvrir les métrés',mayMeasurements())+action('plans','Ouvrir les plans PDF',mayPlans())+'</div></div>'+
 '<div><h3>Échanges externes</h3><p>Peppol, ONSS et les données des fabricants ne sont pas connectés dans cette version. Les factures, pointages et moyens OUVRANE restent accessibles dans leurs modules.</p>'+badge('Non configurés','neutral')+'</div></div>';main.append(card);
}
function pendingChoice(){
 return {sequence:++choiceSequence,view:view,scope:accessScope(),origin:document.querySelector('#modalbody')?.firstElementChild,open:Boolean(document.querySelector('#modal')?.open)};
}
function currentChoice(ticket){return ticket.sequence===choiceSequence&&ticket.view===view&&ticket.scope===accessScope()&&ticket.origin===document.querySelector('#modalbody')?.firstElementChild&&(!ticket.open||document.querySelector('#modal')?.open)}
function choiceButton(actionName,item,kind){
 var value=kind==='project'?item.id:item.id,title=kind==='project'?item.name:item.place,ref=kind==='project'?item.reference:'',attr=' data-'+kind+'-id="'+escFn(value)+'" data-choice-search="'+escFn([title,ref,value].filter(Boolean).join(' ').toLocaleLowerCase('fr'))+'"';
 return '<button type="button" class="v5-dossier-choice" data-v5-action="'+actionName+'"'+attr+'><strong>'+escFn(title||value)+'</strong><small>'+escFn([ref,kind==='project'?'Chantier':'Visite',value].filter(Boolean).join(' · '))+'</small></button>';
}
async function chooseDossier(mode){
 if(mode==='measurements'?!mayMeasurements():mode==='plans'?!mayPlans():!moduleView('jobs'))return denied();
 var ticket=pendingChoice(),includeVisits=mode!=='field'&&moduleView('quotes')&&permission('quotes.view'),visitError='';
 if(includeVisits&&typeof loadQuoteVisits==='function'&&(typeof quoteVisitsLoadState==='undefined'||quoteVisitsLoadState!=='ready')){
  await loadQuoteVisits({quiet:true});if(!currentChoice(ticket))return;
  if(quoteVisitsLoadState!=='ready')visitError=quoteVisitsLoadState==='loading'?'Les visites sont en cours de chargement. Fermez ce choix puis réessayez.':typeof quoteVisitsLoadError==='string'&&quoteVisitsLoadError?quoteVisitsLoadError:'Les visites ne sont pas disponibles.';
 }
 if(!currentChoice(ticket))return;
 var projectRows=mode!=='measurements'&&moduleView('jobs')&&typeof jobs!=='undefined'?jobs:[],visits=includeVisits&&typeof quoteVisitsLoadState!=='undefined'&&quoteVisitsLoadState==='ready'&&typeof quoteDrafts!=='undefined'?quoteDrafts.filter(function(v){return v.serverBacked}):[];
 var content='<section id="v5DossierChooser" data-choice-mode="'+mode+'"><p>'+escFn(mode==='measurements'?'Choisissez la visite à laquelle rattacher les mesures.':'Choisissez un chantier ou une visite autorisés pour conserver le bon contexte.')+'</p><label for="v5DossierSearch">Rechercher un dossier</label><input id="v5DossierSearch" type="search" maxlength="140" autocomplete="off" placeholder="Nom ou référence"><div class="v4-grid v4-g2">';
 if(mode!=='measurements')content+='<section><h3>Chantiers</h3>'+projectRows.map(function(j){return choiceButton(mode==='plans'?'project-plans':'project-field',j,'project')}).join('')+(!projectRows.length?'<p>Aucun chantier chargé avec vos droits.</p>':'')+'</section>';
 if(includeVisits)content+='<section><h3>Visites enregistrées</h3>'+visits.map(function(v){return choiceButton(mode==='plans'?'visit-plans':'visit-measurements',v,'visit')}).join('')+(!visits.length?'<p>Aucune visite enregistrée disponible.</p>':'')+(visitError?note(escFn(visitError)):'')+action('new-visit','Créer une visite',permission('quotes.create')&&typeof quoteDraftForm==='function')+'</section>';
 content+='</div><p id="v5DossierChoiceStatus" role="status" aria-live="polite"></p></section>';modal(mode==='measurements'?'Métrés · choisir une visite':mode==='plans'?'Plans PDF · choisir un dossier':'Terrain · choisir un chantier',content);
}
function denied(){if(typeof denyAccess==='function')denyAccess('Cet outil n’est pas disponible avec vos droits actuels.');else toast('Cet outil n’est pas disponible avec vos droits actuels.')}
function jobTabAllowed(tab){return moduleView('jobs')&&(tab==='planning'?moduleView('planning'):tab==='documents'?moduleView('documents'):tab==='finance'?moduleView('accounting'):['summary','field','history','v4hub'].includes(tab))}
function openProject(id,tab){
 var job=jobTabAllowed(tab)&&typeof jobs!=='undefined'?jobs.find(function(j){return String(j.id)===String(id)}):null;if(!job)return denied();
 if(document.querySelector('#modal')?.open)closeModal();currentJobId=job.id;jobWorkspaceTab=tab;view='jobWorkspace';render();
}
function runAction(name,element){
 var projectId=element.dataset.projectId,visitId=element.dataset.visitId;
 if(name==='tools'){if(catalogueAllowed())navigate('connecteurs');else denied()}
 else if(name==='finance-back'){v4FinanceOpen=false;render()}
 else if(name==='electronic-preparation'){if(!moduleView('accounting'))return denied();if(view!=='accounting')navigate('accounting');v4FinanceOpen=true;render()}
 else if(name==='electronic-settings'){if(mayEditPreparation()&&typeof electronicInvoiceForm==='function')electronicInvoiceForm();else denied()}
 else if(name==='plans'||name==='measurements'||name==='field')chooseDossier(name).catch(function(e){toast(e.message||'Les dossiers ne sont pas disponibles.')});
 else if(name==='project-plans'){if(moduleView('jobs')&&mayPlans()&&typeof openPlanList==='function'&&typeof jobs!=='undefined'&&jobs.some(function(j){return String(j.id)===projectId}))openPlanList({projectId:projectId});else denied()}
 else if(name==='visit-plans'||name==='visit-measurements'){
  var visit=typeof quoteDrafts!=='undefined'?quoteDrafts.find(function(v){return v.serverBacked&&String(v.id)===visitId}):null;
  if(!visit||!moduleView('quotes')||!permission('quotes.view'))return denied();if(name==='visit-plans'&&mayPlans()&&typeof openPlanList==='function')openPlanList({visitId:visitId});else if(name==='visit-measurements'&&mayMeasurements()&&typeof openMeasurementDesk==='function')openMeasurementDesk(visitId);else denied();
 }
 else if(name==='new-visit'){if(moduleView('quotes')&&permission('quotes.create')&&typeof quoteDraftForm==='function')quoteDraftForm();else denied()}
 else if(name==='supplier-prices'){if(mayImports()&&typeof openSupplierImports==='function')openSupplierImports();else denied()}
 else if(name==='ocr'){if(mayTriage()&&typeof openSocleDocumentTriage==='function')openSocleDocumentTriage();else denied()}
 else if(name==='project-field')openProject(projectId,'field');
 else if(name==='project-documents'){if(moduleView('documents'))openProject(projectId,'documents');else denied()}
 else if(name==='project-planning'){if(moduleView('planning'))openProject(projectId,'planning');else denied()}
 else if(name==='job-tab'){var tab=element.dataset.tab;if(['summary','planning','field','documents','finance','history','v4hub'].includes(tab))openProject(projectId,tab)}
 else{
  var route={planning:'planning',documents:'documents',assets:'fleet',jobs:'jobs','time-entries':'timeEntries'}[name];
  if(route&&(name==='time-entries'?mayTime():moduleView(route))){if(document.querySelector('#modal')?.open)closeModal();navigate(route)}else denied();
 }
}
document.addEventListener('click',function(event){var button=event.target.closest?.('[data-v5-action]');if(!button||button.disabled)return;event.preventDefault();choiceSequence++;runAction(button.dataset.v5Action,button)});
document.addEventListener('input',function(event){
 if(event.target.id!=='v5DossierSearch')return;var root=event.target.closest('#v5DossierChooser'),q=event.target.value.trim().toLocaleLowerCase('fr'),visible=0;
 root.querySelectorAll('[data-choice-search]').forEach(function(node){node.hidden=Boolean(q)&&!node.dataset.choiceSearch.includes(q);if(!node.hidden)visible++});root.querySelector('#v5DossierChoiceStatus').textContent=visible+' dossier(s) affiché(s).';
});
var baseNavigate=globalThis.navigate;
globalThis.navigate=function(route){choiceSequence++;if(route==='connecteurs'){if(!catalogueAllowed())return denied();view='connecteurs';v4FinanceOpen=false;render();return}if(route==='home')homeVisits={key:'',status:'idle',count:null};v4FinanceOpen=false;var result=baseNavigate.apply(this,arguments);enhance();queueMicrotask(enhance);return result};
var enhancing=false;
function enhance(){
 if(enhancing)return;enhancing=true;
 try{
  var main=document.querySelector('#main');if(!main)return;ensureNavButton();
  if(view==='connecteurs'){if(catalogueAllowed())present(main,'#v5ToolsCatalogue',capabilitySignature(),connectorsScreen);else main.innerHTML=heading('Outils & imports','Les outils de cet espace ne sont pas disponibles avec vos droits actuels.',false);document.title='OUVRANE · Outils & imports'}
  else if(view==='accounting'&&v4FinanceOpen&&moduleView('accounting')){var config=typeof electronicInvoiceSettings==='function'?electronicInvoiceSettings():null;present(main,'#v5ElectronicInvoicePreparation',JSON.stringify([capabilitySignature(),Boolean(config&&config.enabled)]),financePanelHTML);document.title='OUVRANE · Préparation Peppol'}
  else if(view==='jobWorkspace'&&typeof jobWorkspaceTab==='string'&&jobWorkspaceTab==='v4hub'){var job=typeof jobs!=='undefined'?jobs.find(function(item){return String(item.id)===String(currentJobId)}):null,field=typeof fieldPortalState!=='undefined'?fieldPortalState.get(String(currentJobId)):null;present(main,'#v5JobTools',JSON.stringify([capabilitySignature(),currentJobId,job&&[job.name,job.phase,job.client,job.address,job.town],field&&field.status]),jobHubHTML);document.title='OUVRANE · Dossier & outils'}
  else if(view==='home'){homeStrip(main);homeConnectedCard(main)}
  else if(view==='accounting')injectFinanceTab(main);
  else if(view==='timeEntries'&&!main.querySelector('.v4-pointages')){var time=document.createElement('div');time.className='v4-pointages';time.innerHTML=timeEntriesPanel();main.append(time)}
  else if(view==='fleet'&&!main.querySelector('.v4-fleet')){var fleet=document.createElement('div');fleet.className='v4-fleet';fleet.innerHTML=fleetPanel();main.append(fleet)}
  else if(view==='quotes'&&!main.querySelector('.v4-quotes')){var quotes=document.createElement('div');quotes.className='v4-quotes';quotes.innerHTML=quotesPanel();main.append(quotes)}
  else if(view==='jobWorkspace')injectJobTab(main);
 }finally{enhancing=false}
}
var baseRender=globalThis.render;
globalThis.render=function(){if(view==='connecteurs'){enhance();return}var result=baseRender.apply(this,arguments);enhance();queueMicrotask(enhance);return result};
// The active invoice form is supplied by onboarding.js after blank-workspace.js.
// Keep that real form and its persistence, while preventing preparation data
// from presenting an unavailable delivery channel as connected.
var baseInvoiceForm=globalThis.invoiceForm;
if(typeof baseInvoiceForm==='function')globalThis.invoiceForm=function(){
 var result=baseInvoiceForm.apply(this,arguments),select=document.querySelector('#modalbody [name="deliveryFormat"]');if(!select)return result;
 Array.from(select.options).forEach(function(option){if(/peppol/i.test(option.value+' '+option.textContent)){option.disabled=true;option.selected=false;option.textContent='Peppol · opérateur non connecté'}});
 if(!select.selectedOptions.length||select.selectedOptions[0].disabled)select.value=select.options[0]?.value||'';
 return result;
};
function boot(){
 var brand=document.querySelector('.brand');if(brand){var label=brand.querySelector('.v3-version,.v4-version');if(!label){label=document.createElement('span');brand.append(label)}brand.querySelectorAll('.v3-version,.v4-version').forEach(function(other){if(other!==label)other.remove()});label.classList.add('v4-version');label.textContent='';label.title='OUVRANE'}enhance();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
