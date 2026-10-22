const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const rows=async q=>(await q.all()).results;
const parse=value=>JSON.parse(value);
const blockedConditions=new Set(['Immobilisé','Réparation nécessaire','Hors service','Indisponible']);
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const has=async(env,ctx,h,p)=>ctx.roleCode==='OWNER'||await h.allowed(env,ctx,p);
function key(data){const value=String(data?.operationKey||'');if(!/^[A-Za-z0-9._:-]{8,160}$/.test(value))fail('Clé d’opération invalide.');return value}
function note(data){const value=String(data?.note||'').trim();if(value.length>500)fail('Note limitée à 500 caractères.');return value}
function assignmentValue(a){return{id:String(a.id),projectId:String(a.project_id),teamId:String(a.team_id),date:a.assignment_date,startTime:a.start_time||'07:00',endTime:a.end_time||'16:00',status:a.status}}
function localTime(value){const s=String(value||'');if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(s))fail('Date et heure locales requises.');const day=s.slice(0,10),d=new Date(day+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==day)fail('Date locale invalide.');return s}
export function assignmentAssetsErrorMessage(error){const s=String(error);for(const [code,message]of Object.entries({assignment_asset_conflict:'Ce moyen est déjà réservé sur un créneau qui chevauche cette affectation.',assignment_asset_blocked:'Un moyen est archivé ou indisponible sur ce créneau.',assignment_asset_unknown:'Choisissez uniquement des moyens connus et actifs de cette entreprise.',assignment_asset_out:'Ce moyen a été pris et doit être retourné avant de retirer sa réservation ou de l’archiver.',assignment_asset_return_stale:'Cette prise a déjà été retournée ou a changé.',assignment_asset_unavailable:'Ce moyen ne peut plus être pris. Rechargez les disponibilités.',assignment_asset_packet_stale:'Les moyens ou leurs indisponibilités ont changé. Recalculez l’aperçu.',assignment_asset_stale:'L’affectation ou la réservation a changé. Rechargez.',assignment_asset_immutable:'Cet historique ne peut pas être modifié.'}))if(s.includes(code))return message;return 'Opération de moyens refusée par les contrôles de cohérence.'}
async function rawGuard(env,ctx,id){return env.DB.prepare('SELECT guard_json FROM assignment_asset_guards WHERE organization_id=? AND assignment_id=?').bind(ctx.organizationId,String(id)).first()}
function safeResource(row,out){const blocks=parse(row.blocks_json||'[]').map(b=>({id:b.id,startsAt:b.startsAt,endsAt:b.endsAt,reason:b.reason,resolved:!!b.resolutionId}));const blocked=!!row.archived||blockedConditions.has(row.asset_condition)||blocks.some(b=>!b.resolved);return{id:String(row.asset_id),name:row.name,reference:row.reference||'',kind:row.kind,known:!!row.known,archived:!!row.archived,blocked,availability:out?'out':blocked||!row.known?'blocked':'available',blocks,...(out?{custody:{takeId:out.id,assignmentId:out.assignment_id,takenAt:out.created_at}}:{})}}
export async function assignmentAssetSnapshot(env,ctx,assignmentId){
 const g=await rawGuard(env,ctx,assignmentId);if(!g)return{value:[],guard:null};
 const data=await rows(env.DB.prepare('SELECT * FROM assignment_asset_resource_details WHERE organization_id=? AND assignment_id=? ORDER BY asset_id').bind(ctx.organizationId,String(assignmentId))),out=await rows(env.DB.prepare('SELECT * FROM assignment_asset_out WHERE organization_id=?').bind(ctx.organizationId));
 const guard=parse(g.guard_json);return{value:data.map(r=>{const legacyRoles=[...(guard.assignment.vehicleId===r.asset_id?['vehicle']:[]),...(guard.assignment.packId===r.asset_id?['pack']:[])];return{...safeResource(r,out.find(o=>o.asset_id===r.asset_id)),fixed:legacyRoles.length>0,legacyRoles}}),guard};
}
async function assetOptions(env,ctx,a){
 const start=a.assignment_date+'T'+(a.start_time||'07:00'),end=a.assignment_date+'T'+(a.end_time||'16:00');
 const [candidates,blocks,out,occupied]=await Promise.all([
  rows(env.DB.prepare("SELECT id,payload_json FROM field_assets WHERE organization_id=? AND archived_at IS NULL ORDER BY json_extract(payload_json,'$.name'),id LIMIT 201").bind(ctx.organizationId)),
  rows(env.DB.prepare('SELECT b.id,b.asset_id,b.starts_at,b.ends_at,b.reason FROM asset_availability_blocks b WHERE b.organization_id=? AND b.starts_at<? AND (b.ends_at IS NULL OR b.ends_at>?) AND NOT EXISTS(SELECT 1 FROM asset_availability_resolutions r WHERE r.organization_id=b.organization_id AND r.block_id=b.id) ORDER BY b.starts_at,b.id').bind(ctx.organizationId,end,start)),
  rows(env.DB.prepare('SELECT asset_id FROM assignment_asset_out WHERE organization_id=?').bind(ctx.organizationId)),
  rows(env.DB.prepare("SELECT DISTINCT l.asset_id FROM assignment_asset_links l JOIN field_assignments x ON x.organization_id=l.organization_id AND x.id=l.assignment_id WHERE l.organization_id=? AND x.id<>? AND x.status<>'cancelled' AND x.assignment_date=? AND x.start_time<? AND x.end_time>?").bind(ctx.organizationId,a.id,a.assignment_date,a.end_time||'16:00',a.start_time||'07:00'))
 ]),taken=new Set(out.map(o=>o.asset_id)),reserved=new Set(occupied.map(o=>o.asset_id));
 return candidates.map(f=>{const p=parse(f.payload_json),holds=blocks.filter(b=>b.asset_id===f.id),blocked=!!holds.length||reserved.has(f.id)||blockedConditions.has(p.condition||p.status);return{id:f.id,name:p.name||f.id,reference:p.reference||'',kind:p.group||'unknown',known:true,archived:false,blocked,availability:taken.has(f.id)?'out':blocked?'blocked':'available',blocks:holds.map(b=>({id:b.id,startsAt:b.starts_at,endsAt:b.ends_at,reason:b.reason})),canTake:false,canReturn:false}});
}
async function replay(env,ctx,h,table,op,requestJson){
 const old=await env.DB.prepare('SELECT id,created_by,request_json FROM '+table+' WHERE organization_id=? AND operation_key=?').bind(ctx.organizationId,op).first();
 if(!old)return null;if(old.created_by!==ctx.uid||old.request_json!==requestJson)fail('Cette clé correspond à une autre opération.',409);return h.json({id:old.id,replayed:true},200);
}
async function write(env,ctx,h,table,op,requestJson,statements){try{await h.dbBatch(env,statements)}catch(error){const old=await replay(env,ctx,h,table,op,requestJson);if(old)return old;if(String(error).includes('assignment_asset_'))fail(assignmentAssetsErrorMessage(error),409);if(String(error).includes('UNIQUE constraint'))fail('Une opération concurrente a déjà modifié cet état. Rechargez.',409);throw error}return null}
async function workspace(env,ctx,h){const state=await h.organizationWorkspaceState(env,ctx.organizationId,{readOnly:ctx.preview});if(!state)fail('Espace entreprise introuvable.',404);if(!ctx.preview)await h.ensureLegacyFieldDataImported(env,ctx,state);return state}
async function mayScope(env,ctx,h,projectId){try{await h.requireProjectScope(env,ctx,projectId);return true}catch(e){if([403,404].includes(e.status))return false;throw e}}
export async function assignmentAssetsRoute(request,url,env,ctx,assignmentId,h){
 const state=await workspace(env,ctx,h),a=await env.DB.prepare('SELECT * FROM field_assignments WHERE organization_id=? AND id=?').bind(ctx.organizationId,String(assignmentId)).first();if(!a)fail('Affectation introuvable.',404);
 const manager=await has(env,ctx,h,'planning.assignments.manage'),personId=await h.currentPersonId(env,ctx),field=await has(env,ctx,h,'assets.view'),participants=parse(a.people_json).map(String),member=!!personId&&participants.includes(String(personId));
 const today=h.socleBusinessDate(state),canManageAvailability=await has(env,ctx,h,'assets.manage');
 if(request.method==='POST'){
  if(ctx.preview)fail('Le mode test est en lecture seule.',403);
  const data=await h.body(request,22000),action=String(data.action||''),op=key(data),stamp=new Date().toISOString();
  if(action==='return'){
   const assetId=String(data.assetId||''),takeId=String(data.takeId||''),text=note(data),t=await env.DB.prepare("SELECT * FROM assignment_asset_events WHERE organization_id=? AND id=? AND assignment_id=? AND asset_id=? AND kind='take'").bind(ctx.organizationId,takeId,a.id,assetId).first();if(!t)fail('Prise introuvable.',404);
   if(!(manager||field&&personId&&parse(t.participants_json).map(String).includes(String(personId))))fail('Seules les personnes de l’affectation au moment de la prise peuvent retourner ce moyen.',403);
   await h.requireProjectScope(env,ctx,t.project_id);
   const requestJson=JSON.stringify({assignmentId:a.id,assetId,takeId,note:text}),old=await replay(env,ctx,h,'assignment_asset_events',op,requestJson);if(old)return old;
   const id='asset-return-'+crypto.randomUUID(),result=await write(env,ctx,h,'assignment_asset_events',op,requestJson,[env.DB.prepare('INSERT INTO assignment_asset_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(ctx.organizationId,id,a.id,assetId,'return',takeId,t.project_id,t.participants_json,t.assignment_snapshot_json,'null',today,op,requestJson,text,personId,ctx.uid,stamp),h.auditStatement(env,ctx,'assignment.asset_returned','assignment',a.id,{asset_id:assetId,take_id:takeId,project_id:t.project_id,note:text})]);if(result)return result;return h.json({id},201);
  }
  await h.requireProjectScope(env,ctx,a.project_id);
  if(action==='reserve'){
   if(!manager)fail('La réservation des moyens est réservée au bureau autorisé.',403);
   if(!Array.isArray(data.assetIds)||data.assetIds.length>100||data.assetIds.some(v=>typeof v!=='string'||!v))fail('Liste de moyens invalide.');const ids=[...new Set(data.assetIds)].sort();
   if(!Number.isSafeInteger(data.expectedVersion)||data.expectedVersion<0)fail('Version de réservation invalide.');
   const signature=String(data.assignmentSignature||''),requestJson=JSON.stringify({assignmentId:a.id,assetIds:ids,expectedVersion:data.expectedVersion,assignmentSignature:signature}),old=await replay(env,ctx,h,'assignment_asset_versions',op,requestJson);if(old)return old;
   const g=await rawGuard(env,ctx,a.id);if(!g||await digest(g.guard_json)!==signature)fail('L’affectation ou ses moyens ont changé. Rechargez.',409);
   const id='asset-reserve-'+crypto.randomUUID(),result=await write(env,ctx,h,'assignment_asset_versions',op,requestJson,[env.DB.prepare('INSERT INTO assignment_asset_versions VALUES(?,?,?,?,?,?,?,?,?,?)').bind(ctx.organizationId,id,a.id,data.expectedVersion+1,JSON.stringify(ids),g.guard_json,op,requestJson,ctx.uid,stamp),h.auditStatement(env,ctx,'assignment.assets_reserved','assignment',a.id,{asset_ids:ids,version:data.expectedVersion+1,project_id:a.project_id})]);if(result)return result;return h.json({id,version:data.expectedVersion+1},201);
  }
  if(action!=='take')fail('Action de moyens inconnue.');
  if(!(manager||field&&member))fail('Seules les personnes prévues peuvent prendre ce moyen.',403);
  const assetId=String(data.assetId||''),signature=String(data.assignmentSignature||''),requestJson=JSON.stringify({assignmentId:a.id,assetId,assignmentSignature:signature}),old=await replay(env,ctx,h,'assignment_asset_events',op,requestJson);if(old)return old;
  if(a.assignment_date!==today)fail('La prise est réservée au jour de l’affectation.',409);
  const g=await rawGuard(env,ctx,a.id);if(!g||await digest(g.guard_json)!==signature)fail('L’affectation ou ses moyens ont changé. Rechargez.',409);
  const id='asset-take-'+crypto.randomUUID(),result=await write(env,ctx,h,'assignment_asset_events',op,requestJson,[env.DB.prepare('INSERT INTO assignment_asset_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(ctx.organizationId,id,a.id,assetId,'take',null,a.project_id,a.people_json,JSON.stringify(assignmentValue(a)),g.guard_json,today,op,requestJson,'',personId,ctx.uid,stamp),h.auditStatement(env,ctx,'assignment.asset_taken','assignment',a.id,{asset_id:assetId,project_id:a.project_id})]);if(result)return result;return h.json({id,takeId:id},201);
 }
 if(request.method!=='GET')return h.json({error:'Méthode non autorisée.'},405);
 const currentScope=await mayScope(env,ctx,h,a.project_id),currentView=currentScope&&(manager||field&&member);
 const takes=await rows(env.DB.prepare('SELECT * FROM assignment_asset_out WHERE organization_id=? AND assignment_id=? ORDER BY created_at DESC,id').bind(ctx.organizationId,a.id)),ownTakes=field&&personId?takes.filter(t=>parse(t.participants_json).map(String).includes(String(personId))):[];
 if(!currentView){
  const permitted=[];for(const t of ownTakes)if(await mayScope(env,ctx,h,t.project_id))permitted.push(t);if(!permitted.length)fail('Affectation introuvable.',404);
  const resources=[];for(const t of permitted){const f=await env.DB.prepare('SELECT payload_json,archived_at FROM field_assets WHERE organization_id=? AND id=?').bind(ctx.organizationId,t.asset_id).first(),p=f?parse(f.payload_json):{};resources.push({id:t.asset_id,name:p.name||t.asset_id,reference:p.reference||'',kind:p.group||'unknown',known:!!f,archived:!!f?.archived_at,fixed:false,legacyRoles:[],availability:'out',blocked:false,blocks:[],custody:{takeId:t.id,assignmentId:a.id,takenAt:t.created_at},canTake:false,canReturn:true})}
  return h.json({assignment:parse(permitted[0].assignment_snapshot_json),assignmentSignature:null,expectedVersion:0,canManage:false,canManageAvailability:false,resources,extras:[],options:[],optionsTruncated:false,history:[],businessDate:today,timeZone:h.socleBusinessTimeZone(state),returnOnly:true});
 }
 const snap=await assignmentAssetSnapshot(env,ctx,a.id),guard=await rawGuard(env,ctx,a.id),extras=await env.DB.prepare('SELECT asset_ids_json FROM assignment_asset_versions WHERE organization_id=? AND assignment_id=? ORDER BY version DESC LIMIT 1').bind(ctx.organizationId,a.id).first();
 const resources=snap.value.map(r=>({...r,canTake:(manager||field&&member)&&a.assignment_date===today&&a.status!=='cancelled'&&r.known&&!r.archived&&r.availability==='available',canReturn:!!r.custody&&r.custody.assignmentId===a.id&&(manager||ownTakes.some(t=>t.id===r.custody.takeId))}));
 const historyRows=[];
 if(manager){
  const candidates=await rows(env.DB.prepare("SELECT id,'reserve' kind,NULL asset_id,asset_ids_json,created_at,'' note,json_extract(assignment_guard_json,'$.assignment.projectId') historical_project_id FROM assignment_asset_versions WHERE organization_id=? AND assignment_id=? UNION ALL SELECT id,kind,asset_id,NULL,created_at,note,project_id historical_project_id FROM assignment_asset_events WHERE organization_id=? AND assignment_id=? ORDER BY created_at DESC,id DESC LIMIT 101").bind(ctx.organizationId,a.id,ctx.organizationId,a.id)),scopes=new Map();
  for(const event of candidates){const projectId=event.historical_project_id;if(!projectId)continue;if(!scopes.has(projectId))scopes.set(projectId,await mayScope(env,ctx,h,projectId));if(scopes.get(projectId))historyRows.push(event)}
 }
 const options=manager?await assetOptions(env,ctx,a):[];
 return h.json({assignment:assignmentValue(a),assignmentSignature:await digest(guard.guard_json),expectedVersion:snap.guard.version,canManage:manager,canManageAvailability,resources,extras:extras?parse(extras.asset_ids_json):[],options:options.slice(0,200),optionsTruncated:options.length>200,history:historyRows.slice(0,100).map(r=>({id:r.id,kind:r.kind,...(r.asset_id?{assetId:r.asset_id}:{}),...(r.asset_ids_json?{assetIds:parse(r.asset_ids_json)}:{}),createdAt:r.created_at,note:r.note})),historyTruncated:historyRows.length>100,businessDate:today,timeZone:h.socleBusinessTimeZone(state)});
}
export function assetIssueBlockStatement(env,ctx,{assetId,issueId,description,createdAt,businessDate,startLocal}){
 const startsAt=localTime(startLocal||businessDate+'T00:00'),id='issue-block:'+issueId;
 return env.DB.prepare('INSERT INTO asset_availability_blocks VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(ctx.organizationId,id,String(assetId),startsAt,null,String(description||'Immobilisé').slice(0,500),String(issueId),id,'{}',ctx.uid,createdAt);
}
export async function assetAvailabilityRoute(request,url,env,ctx,assetId,h){
 const state=await workspace(env,ctx,h),canManage=await has(env,ctx,h,'assets.manage');if(!canManage&&!await has(env,ctx,h,'assets.view'))fail('Accès aux moyens non autorisé.',403);
 const asset=await env.DB.prepare('SELECT payload_json,archived_at FROM field_assets WHERE organization_id=? AND id=?').bind(ctx.organizationId,String(assetId)).first();if(!asset)fail('Moyen introuvable.',404);const p=parse(asset.payload_json);
 if(request.method==='GET'){
  const data=await rows(env.DB.prepare('SELECT b.*,r.id resolution_id,r.created_at resolved_at,r.note resolution_note FROM asset_availability_blocks b LEFT JOIN asset_availability_resolutions r ON r.organization_id=b.organization_id AND r.block_id=b.id WHERE b.organization_id=? AND b.asset_id=? ORDER BY b.starts_at DESC,b.id DESC LIMIT 201').bind(ctx.organizationId,String(assetId)));
  return h.json({asset:{id:String(assetId),name:p.name||String(assetId),reference:p.reference||'',kind:p.group||'unknown',archived:!!asset.archived_at},blocks:data.slice(0,200).map(b=>({id:b.id,startsAt:b.starts_at,endsAt:b.ends_at,reason:b.reason,resolved:!!b.resolution_id,resolvedAt:b.resolved_at||null,resolutionNote:b.resolution_note||''})),history:data.slice(0,200).flatMap(b=>[{id:b.id,kind:'block',createdAt:b.created_at,note:b.reason},...(b.resolution_id?[{id:b.resolution_id,kind:'resolve',createdAt:b.resolved_at,note:b.resolution_note}]:[])]).sort((x,y)=>y.createdAt.localeCompare(x.createdAt)),truncated:data.length>200,canManage,timeZone:h.socleBusinessTimeZone(state),businessDate:h.socleBusinessDate(state)});
 }
 if(request.method!=='POST')return h.json({error:'Méthode non autorisée.'},405);if(ctx.preview||!canManage)fail('Seul le bureau autorisé peut gérer les indisponibilités.',403);
 const data=await h.body(request,10000),op=key(data),stamp=new Date().toISOString();
 if(data.action==='block'){
  const startsAt=localTime(data.startsAt),endsAt=data.endsAt?localTime(data.endsAt):null,reason=String(data.reason||'').trim();if(!reason||reason.length>500||endsAt&&endsAt<=startsAt)fail('Période ou motif d’indisponibilité invalide.');
  const requestJson=JSON.stringify({assetId:String(assetId),startsAt,endsAt,reason}),old=await replay(env,ctx,h,'asset_availability_blocks',op,requestJson);if(old)return old;
  const id='asset-block-'+crypto.randomUUID(),result=await write(env,ctx,h,'asset_availability_blocks',op,requestJson,[env.DB.prepare('INSERT INTO asset_availability_blocks VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(ctx.organizationId,id,String(assetId),startsAt,endsAt,reason,null,op,requestJson,ctx.uid,stamp),h.auditStatement(env,ctx,'asset.availability_blocked','asset',String(assetId),{block_id:id,starts_at:startsAt,ends_at:endsAt,reason})]);if(result)return result;return h.json({id},201);
 }
 if(data.action!=='resolve')fail('Action d’indisponibilité inconnue.');
 const blockId=String(data.blockId||''),text=note(data),b=await env.DB.prepare('SELECT id FROM asset_availability_blocks WHERE organization_id=? AND id=? AND asset_id=?').bind(ctx.organizationId,blockId,String(assetId)).first();if(!b)fail('Indisponibilité introuvable.',404);
 const requestJson=JSON.stringify({assetId:String(assetId),blockId,note:text}),old=await replay(env,ctx,h,'asset_availability_resolutions',op,requestJson);if(old)return old;
 if(await env.DB.prepare('SELECT 1 FROM asset_availability_resolutions WHERE organization_id=? AND block_id=?').bind(ctx.organizationId,blockId).first())fail('Cette indisponibilité est déjà résolue.',409);
 const id='asset-resolution-'+crypto.randomUUID(),result=await write(env,ctx,h,'asset_availability_resolutions',op,requestJson,[env.DB.prepare('INSERT INTO asset_availability_resolutions VALUES(?,?,?,?,?,?,?,?)').bind(ctx.organizationId,id,blockId,op,requestJson,text,ctx.uid,stamp),h.auditStatement(env,ctx,'asset.availability_resolved','asset',String(assetId),{block_id:blockId,note:text})]);if(result)return result;return h.json({id},201);
}
