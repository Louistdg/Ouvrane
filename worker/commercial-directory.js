// Contacts remain authoritative for linked customers. A customer created
// independently through /customers remains independent; labels never join IDs.
const failure=(message,status=409,code='commercial_directory_conflict')=>Object.assign(Error(message),{status,code});
const text=(value,max=240)=>String(value??'').trim().slice(0,max);
const hasClient=contact=>Array.isArray(contact.roles)&&contact.roles.includes('Client');
const active=contact=>contact.active!==false&&contact.active!==0&&!['inactive','archived','deleted'].includes(String(contact.status||'').toLowerCase());
function contactMap(state){
 if(!Array.isArray(state?.contacts))throw failure('L’annuaire du dossier est invalide.',400);
 const map=new Map();
 for(const contact of state.contacts){
  if(!contact||typeof contact!=='object'||!['string','number'].includes(typeof contact.id))throw failure('Une fiche annuaire n’a pas d’identifiant valide.',400);
  const key=String(contact.id);if(!key||key.length>180||map.has(key))throw failure('Les identifiants des fiches doivent être uniques.',400);
  map.set(key,contact);
 }
 return map;
}
function paymentDays(contact){
 if(Number.isInteger(contact.paymentTermsDays)&&contact.paymentTermsDays>=0&&contact.paymentTermsDays<=3650)return contact.paymentTermsDays;
 const match=/^(\d{1,4})\s*(?:j|jours?)$/i.exec(text(contact.paymentTerms));
 // Complex conditions remain verbatim in the source and API. Never interpret
 // a supplier's usualDelayDays as credit terms or guess a financial calendar.
 return match&&Number(match[1])<=3650?Number(match[1]):30;
}
function projection(contact){
 const individual=contact.entityType==='particulier';
 return [individual?'individual':'company',individual?null:text(contact.company||contact.legalName||contact.name)||null,individual?text(contact.firstName||contact.name,120)||null:null,individual?text(contact.lastName,120)||null:null,text(contact.bce,80)||null,text(contact.vat,80)||null,text(contact.email)||null,text(contact.phone,80)||null,text(contact.billingAddress||contact.address)||null,text(contact.postalCode,40)||null,text(contact.city||contact.town,120)||null,text(contact.country||'BE',2).toUpperCase(),text(contact.notes,2000),paymentDays(contact)];
}
export function commercialDirectoryHooks(hooks){
 const {rows,id,now,requirePermission,auditStatement,dbBatch,body,exactObject}=hooks;
 const enabled=(env,ctx)=>env.DB.prepare('SELECT 1 ok FROM commercial_directories WHERE organization_id=?').bind(ctx.organizationId).first();
 const links=(env,ctx)=>rows(env.DB.prepare('SELECT * FROM commercial_contact_customers WHERE organization_id=? ORDER BY contact_id').bind(ctx.organizationId));
 const linkedCustomer=(env,ctx,customerId)=>env.DB.prepare('SELECT contact_id,source_version,workspace_revision FROM commercial_contact_customers WHERE organization_id=? AND customer_id=?').bind(ctx.organizationId,String(customerId)).first();
 const customerColumns='id,organization_id,type,company_name,first_name,last_name,enterprise_number,vat_number,email,phone,street,postal_code,city,country,notes,payment_terms_days,created_at,updated_at,archived_at';
 function guard(env,ctx,revision,operationId){return env.DB.prepare('INSERT INTO commercial_directory_write_guards(operation_id,organization_id,expected_revision) VALUES(?,?,?)').bind(operationId,ctx.organizationId,revision)}
 function release(env,operationId){return env.DB.prepare('DELETE FROM commercial_directory_write_guards WHERE operation_id=?').bind(operationId)}
 async function syncStatements(env,ctx,state,revision,stamp,{initial=false}={}){
  if(!initial&&!await enabled(env,ctx))return {statements:[],linkedCount:0};
  const contacts=contactMap(state),existing=await links(env,ctx),mapping=new Map(existing.map(row=>[row.contact_id,row])),statements=[];
  for(const row of existing)if(!contacts.has(row.contact_id))throw failure('Cette fiche est liée aux devis. Désactivez-la plutôt que de la supprimer ou fusionner.');
  for(const [contactId,contact] of contacts){
   const old=mapping.get(contactId);if(!old&&!hasClient(contact))continue;
   const source=JSON.stringify(contact),archived=hasClient(contact)&&active(contact)?null:stamp;
   if(old&&old.source_json===source)continue;
   const customerId=old?.customer_id||id('customer'),fields=projection(contact);
   if(old){
    statements.push(env.DB.prepare('UPDATE customers SET type=?,company_name=?,first_name=?,last_name=?,enterprise_number=?,vat_number=?,email=?,phone=?,street=?,postal_code=?,city=?,country=?,notes=?,payment_terms_days=?,updated_at=?,archived_at=? WHERE organization_id=? AND id=?').bind(...fields,stamp,archived,ctx.organizationId,customerId));
    statements.push(env.DB.prepare('UPDATE commercial_contact_customers SET source_json=?,source_version=source_version+1,workspace_revision=?,updated_at=? WHERE organization_id=? AND contact_id=?').bind(source,revision,stamp,ctx.organizationId,contactId));
   }else{
    statements.push(env.DB.prepare('INSERT INTO customers('+customerColumns+') VALUES('+Array(19).fill('?').join(',')+')').bind(customerId,ctx.organizationId,...fields,stamp,stamp,archived));
    statements.push(env.DB.prepare('INSERT INTO commercial_contact_customers(organization_id,contact_id,customer_id,source_json,source_version,workspace_revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?)').bind(ctx.organizationId,contactId,customerId,source,revision,stamp,stamp));
   }
   statements.push(auditStatement(env,ctx,old?'customer.contact.updated':'customer.contact.linked','customer',customerId,{contact_id:contactId,source_version:(old?.source_version||0)+1,archived:Boolean(archived),workspace_revision:revision}));
  }
  return {statements,linkedCount:existing.length+[...contacts].filter(([key,c])=>!mapping.has(key)&&hasClient(c)).length};
 }
 async function saveWorkspace(env,ctx,state,revision,{extraStatements=[]}={}){
  const stamp=now(),operationId=id('directory-write'),sync=await syncStatements(env,ctx,state,revision+1,stamp);
  const write=revision===0?env.DB.prepare('INSERT INTO organization_workspace_state(organization_id,payload,revision,source_user_id,created_at,updated_at) VALUES(?,?,1,?,?,?)').bind(ctx.organizationId,JSON.stringify(state),ctx.uid,stamp,stamp):env.DB.prepare('UPDATE organization_workspace_state SET payload=?,revision=revision+1,source_user_id=?,updated_at=? WHERE organization_id=? AND revision=?').bind(JSON.stringify(state),ctx.uid,stamp,ctx.organizationId,revision);
  await dbBatch(env,[guard(env,ctx,revision,operationId),write,...sync.statements,...extraStatements,release(env,operationId)]);
  return {revision:revision+1};
 }
 async function directoryRoute(request,env,ctx,{bootstrap=false}={}){
  await requirePermission(env,ctx,'customers.view');
  if(!bootstrap){
   if(request.method!=='GET')throw failure('Méthode non autorisée.',405);
   const row=await env.DB.prepare('SELECT revision FROM organization_workspace_state WHERE organization_id=?').bind(ctx.organizationId).first();
   return {status:200,data:{initialized:Boolean(await enabled(env,ctx)),revision:row?.revision||0,links:(await links(env,ctx)).map(row=>({contactId:row.contact_id,customerId:row.customer_id,version:row.source_version,workspaceRevision:row.workspace_revision}))}};
  }
  if(request.method!=='POST')throw failure('Méthode non autorisée.',405);
  if(ctx.roleCode!=='OWNER')throw failure('Seul le propriétaire peut raccorder les fiches existantes.',403);
  const data=exactObject(await body(request,10000),['revision','operationKey']);
  if(!data||Object.keys(data).some(key=>!['revision','operationKey'].includes(key))||!Number.isInteger(data.revision)||data.revision<1||!/^[-A-Za-z0-9_.:]{8,120}$/.test(data.operationKey||''))throw failure('Révision et clé d’opération requises.',400);
  const requestJson=JSON.stringify({action:'bootstrap',revision:data.revision});
  async function replay(){const row=await env.DB.prepare('SELECT request_json,response_json FROM commercial_directory_operations WHERE organization_id=? AND operation_key=?').bind(ctx.organizationId,data.operationKey).first();if(!row)return null;if(row.request_json!==requestJson)throw failure('Cette opération a déjà servi avec des données différentes.');return {status:200,data:{...JSON.parse(row.response_json),replayed:true}}}
  const prior=await replay();if(prior)return prior;
  if(await enabled(env,ctx))throw failure('L’annuaire est déjà raccordé. Rechargez les fiches.');
  const row=await env.DB.prepare('SELECT payload,revision FROM organization_workspace_state WHERE organization_id=?').bind(ctx.organizationId).first();
  if(!row||row.revision!==data.revision)throw failure('Le dossier a changé. Rechargez avant de raccorder les fiches.');
  const stamp=now(),operationId=id('directory-bootstrap'),sync=await syncStatements(env,ctx,JSON.parse(row.payload),row.revision,stamp,{initial:true}),result={initialized:true,revision:row.revision,linkedCount:sync.linkedCount};
  try{await dbBatch(env,[guard(env,ctx,row.revision,operationId),env.DB.prepare('INSERT INTO commercial_directories(organization_id,created_by,created_at) VALUES(?,?,?)').bind(ctx.organizationId,ctx.uid,stamp),...sync.statements,env.DB.prepare('INSERT INTO commercial_directory_operations(organization_id,operation_key,request_json,response_json,created_by,created_at) VALUES(?,?,?,?,?,?)').bind(ctx.organizationId,data.operationKey,requestJson,JSON.stringify(result),ctx.uid,stamp),auditStatement(env,ctx,'commercial_directory.initialized','organization',ctx.organizationId,{linked_count:sync.linkedCount,workspace_revision:row.revision}),release(env,operationId)])}catch(error){const duplicate=await replay();if(duplicate)return duplicate;if(await enabled(env,ctx))throw failure('L’annuaire a été raccordé dans une autre fenêtre. Rechargez.');throw error}
  return {status:201,data:result};
 }
 async function contactRoute(request,env,ctx,contactId=null){
  await requirePermission(env,ctx,'customers.view');
  if(request.method==='GET'){
   const row=await env.DB.prepare('SELECT payload,revision FROM organization_workspace_state WHERE organization_id=?').bind(ctx.organizationId).first();
   if(!row)throw failure('Dossier introuvable.',404);
   const map=contactMap(JSON.parse(row.payload));
   if(contactId&&!map.has(contactId))throw failure('Fiche annuaire introuvable.',404);
   return {status:200,data:contactId?{contact:map.get(contactId),revision:row.revision}:{contacts:[...map.values()],revision:row.revision,initialized:Boolean(await enabled(env,ctx))}};
  }
  if(!['POST','PATCH'].includes(request.method))throw failure('Méthode non autorisée.',405);
  if(request.method==='POST'&&contactId||request.method==='PATCH'&&!contactId)throw failure('Cible de fiche invalide.',400);
  await requirePermission(env,ctx,request.method==='POST'?'customers.create':'customers.edit');
  if(!await enabled(env,ctx))throw failure('Le propriétaire doit d’abord raccorder les fiches clients existantes.');
  const data=exactObject(await body(request,50000),['revision','operationKey','contact']);
  if(!Number.isInteger(data.revision)||data.revision<1||!/^[-A-Za-z0-9_.:]{8,120}$/.test(data.operationKey||'')||!data.contact||typeof data.contact!=='object'||Array.isArray(data.contact))throw failure('Révision, clé d’opération et fiche requises.',400);
  const requestJson=JSON.stringify({action:request.method,contactId,revision:data.revision,contact:data.contact});
  async function replay(){const row=await env.DB.prepare('SELECT request_json,response_json FROM commercial_directory_operations WHERE organization_id=? AND operation_key=?').bind(ctx.organizationId,data.operationKey).first();if(!row)return null;if(row.request_json!==requestJson)throw failure('Cette opération a déjà servi avec des données différentes.');return {status:200,data:{...JSON.parse(row.response_json),replayed:true}}}
  const prior=await replay();if(prior)return prior;
  if(Object.hasOwn(data.contact,'active')&&typeof data.contact.active!=='boolean')throw failure('L’état actif de la fiche doit être un booléen.',400);
  const row=await env.DB.prepare('SELECT payload,revision FROM organization_workspace_state WHERE organization_id=?').bind(ctx.organizationId).first();
  if(!row||row.revision!==data.revision)throw failure('Le dossier a changé. Rechargez la fiche avant de reprendre.');
  const state=JSON.parse(row.payload),map=contactMap(state),old=contactId?map.get(contactId):null;
  if(contactId&&!old)throw failure('Fiche annuaire introuvable.',404);
  if(Object.hasOwn(data.contact,'id')&&(!old||String(data.contact.id)!==contactId))throw failure('L’identifiant de la fiche est conservé.');
  for(const key of ['history','documents','createdAt','updatedAt'])if(Object.hasOwn(data.contact,key)&&JSON.stringify(data.contact[key])!==JSON.stringify(old?.[key]))throw failure('L’historique et les pièces de la fiche sont conservés.');
  const stamp=now(),contact={...old,...data.contact,id:old?.id||id('contact')};
  if(typeof contact.name!=='string'||!contact.name.trim()||contact.name.length>240||!Array.isArray(contact.roles)||!contact.roles.length||contact.roles.length>30||contact.roles.some(role=>typeof role!=='string'||!role.trim()||role.length>100))throw failure('Nom et rôles valides obligatoires.',400);
  if(!old&&(typeof contact.reference!=='string'||!contact.reference.trim()))throw failure('Référence interne obligatoire.',400);
  contact.name=contact.name.trim();contact.roles=[...new Set(contact.roles)];
  if(contact.reference&&[...map.values()].some(other=>String(other.id)!==String(contact.id)&&String(other.reference||'').trim().toLowerCase()===String(contact.reference).trim().toLowerCase()))throw failure('Cette référence annuaire existe déjà.');
  contact.history=[...(Array.isArray(old?.history)?old.history:[]),{date:stamp,action:old?'Fiche modifiée':'Fiche créée'}];
  if(!old){contact.documents=[];state.contacts.push(contact)}else state.contacts=state.contacts.map(item=>String(item.id)===contactId?contact:item);
  const result={contact,revision:row.revision+1},extraStatements=[
   env.DB.prepare('INSERT INTO commercial_directory_operations(organization_id,operation_key,request_json,response_json,created_by,created_at) VALUES(?,?,?,?,?,?)').bind(ctx.organizationId,data.operationKey,requestJson,JSON.stringify(result),ctx.uid,stamp),
   auditStatement(env,ctx,old?'contact.updated':'contact.created','contact',String(contact.id),{source_revision:result.revision,roles:contact.roles},old?{roles:old.roles}:null)
  ];
  try{await saveWorkspace(env,ctx,state,row.revision,{extraStatements})}catch(error){const duplicate=await replay();if(duplicate)return duplicate;throw error}
  return {status:old?200:201,data:result};
 }
 return {directoryRoute,saveWorkspace,linkedCustomer,contactRoute};
}
