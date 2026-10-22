import {taskPreparationSnapshot} from './task-preparations.js';
import {Big} from './measurement-engine.js';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const rows=async q=>(await q.all()).results;
export const stockUnit=u=>({m2:'m2','m²':'m2',pc:'pc','pièce':'pc','pièces':'pc'}[String(u||'').trim().toLowerCase()]||String(u||'').trim().toLowerCase());
export function stockMilli(value){const s=String(value??'');if(!/^\d+(?:\.\d{1,3})?$/.test(s))fail('Quantité positive avec trois décimales maximum.');const q=Number(new Big(s).times(1000).toString());if(!Number.isSafeInteger(q)||q<=0||q>1e15)fail('Quantité hors limites.');return q}
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const op=data=>{const k=String(data?.operationKey||'');if(!/^[A-Za-z0-9._:-]{8,120}$/.test(k))fail('Clé d’opération invalide.');return k};
export function taskStockErrorMessage(e){
 const s=String(e);for(const [key,text] of Object.entries({task_stock_material_history:'Un matériau déjà consommé doit conserver sa place, son nom, son unité et une quantité au moins égale à la consommation réelle.',task_stock_need_exceeded:'Le total réservé et déjà consommé dépasse le besoin de ce matériau.',task_stock_insufficient:'Stock disponible insuffisant dans cet emplacement ou pour cet article.',task_stock_reserved:'Cette quantité est réservée. Libérez sa réservation avant de modifier le stock ou son emplacement.',task_stock_unit:'Les unités du matériau et du stock doivent être identiques. Aucune conversion automatique.',task_stock_cost_stale:'Le coût de cet article a changé. Rechargez avant de confirmer la sortie.',task_stock_event_stale:'La réservation a changé ou ne peut plus être consommée. Rechargez.',task_stock_packet_stale:'Les réservations ont changé. Recalculez l’aperçu de la fiche.',task_stock_stale:'La tâche ou sa préparation a changé. Rechargez.'}))if(s.includes(key))return text;
 return 'Opération de réservation refusée par les contrôles de cohérence.';
}
function value(r){const material=JSON.parse(r.materials_json)[r.material_index];return {id:r.id,materialIndex:r.material_index,materialName:material.name,stockItemId:r.stock_item_id,itemName:r.item_name,locationId:r.location_id,locationName:r.location_name,unit:r.unit,quantity:r.quantity_milli/1000,remaining:r.remaining_milli/1000,remainingMilli:r.remaining_milli,consumed:r.consumed_milli/1000,preparationId:r.preparation_id,createdAt:r.created_at}}
export async function taskStockSnapshot(env,ctx,taskId){
 const active=await rows(env.DB.prepare('SELECT * FROM task_stock_remaining WHERE organization_id=? AND task_id=? AND remaining_milli>0 ORDER BY id').bind(ctx.organizationId,taskId));return {value:active.map(value),guard:active.map(r=>({id:r.id,remainingMilli:r.remaining_milli}))};
}
export async function taskStockRoute(request,url,env,ctx,taskId,action,h){
 const t=await h.taskById(env,ctx,taskId);if(!t)fail('Tâche introuvable.',404);await h.requireProjectScope(env,ctx,t.project_id);await h.relationExists(env,ctx,'project',t.project_id);
 const has=async p=>ctx.roleCode==='OWNER'||await h.allowed(env,ctx,p),manages=await has('tasks.manage.project');
 if(!manages){await h.requirePermission(env,ctx,'tasks.view.assigned');if(!h.taskIsParticipant(t,ctx.uid))fail('Tâche introuvable.',404)}
 const canReserve=manages&&await has('planning.assignments.manage')&&await has('stock.move')&&await has('stock.view');
 const materials=JSON.parse(t.materials_json||'[]'),state=await h.organizationWorkspaceState(env,ctx.organizationId,{readOnly:ctx.preview});
 if(!ctx.preview)await h.ensureLegacyFieldDataImported(env,ctx,state);
 const current=await taskPreparationSnapshot(env,ctx,t.id),materialsSignature=await digest(t.materials_json),assignmentSignature=current.assignment?await digest(current.assignment.guard_json):null;
 async function mayConsume(r){
  if(canReserve)return true;
  try{const c=await h.requireStockConsumeContext(env,ctx,t.project_id,state);return !!current.assignment&&current.binding?.id===r.preparation_id&&!current.value?.unavailable&&current.assignment.assignment_date===c.date&&JSON.parse(current.assignment.people_json).map(String).includes(String(c.personId))}catch(e){if([403,404].includes(e.status))return false;throw e}
 }
 if(request.method==='GET'){
  if(action==='options'){
   if(!canReserve)fail('La réservation nécessite les droits de gestion des tâches, du planning et du stock.',403);
   const i=Number(url.searchParams.get('materialIndex')),m=materials[i];if(!Number.isInteger(i)||!m||!stockUnit(m.unit)||!(m.quantity>0))fail('Indiquez une quantité et une unité pour ce matériau avant de réserver.');
   const search=String(url.searchParams.get('q')||'').trim();if(search.length>120)fail('Recherche trop longue.');
   const candidates=await rows(env.DB.prepare("SELECT i.id,i.name,i.reference,i.unit,i.quantity,i.reserved,b.quantity physical,l.id location_id,l.name location_name,l.type,COALESCE((SELECT SUM(remaining_milli)/1000.0 FROM task_stock_remaining r WHERE r.organization_id=i.organization_id AND r.stock_item_id=i.id AND r.location_id=l.id),0) held FROM field_stock_items i JOIN stock_balances b ON b.organization_id=i.organization_id AND b.stock_item_id=i.id JOIN stock_locations l ON l.organization_id=b.organization_id AND l.id=b.location_id WHERE i.organization_id=? AND i.archived_at IS NULL AND l.status='active' AND (?='' OR instr(lower(i.name),lower(?))>0 OR instr(lower(COALESCE(i.reference,'')),lower(?))>0) AND CASE lower(trim(i.unit)) WHEN 'm²' THEN 'm2' WHEN 'pièce' THEN 'pc' WHEN 'pièces' THEN 'pc' ELSE lower(trim(i.unit)) END=? ORDER BY i.name,l.name LIMIT 101").bind(ctx.organizationId,search,search,search,stockUnit(m.unit)));
   return h.json({options:candidates.slice(0,100).map(r=>({stockItemId:r.id,name:r.name,reference:r.reference,unit:r.unit,locationId:r.location_id,locationName:r.location_name,locationType:r.type,physical:r.physical,available:Math.max(0,Math.min(r.physical-r.held,r.quantity-r.reserved))})),truncated:candidates.length>100});
  }
  if(action)return h.json({error:'Méthode non autorisée.'},405);
  const allocations=await rows(env.DB.prepare('SELECT * FROM task_stock_remaining WHERE organization_id=? AND task_id=? ORDER BY (remaining_milli>0) DESC,created_at DESC,id LIMIT 201').bind(ctx.organizationId,t.id)),reservations=[];
  for(const r of allocations.slice(0,200))reservations.push({...value(r),canConsume:r.remaining_milli>0&&t.status!=='done'&&!current.value?.unavailable&&await mayConsume(r)});
  const usage=await rows(env.DB.prepare('SELECT material_index materialIndex,SUM(remaining_milli+consumed_milli)/1000.0 used FROM task_stock_remaining WHERE organization_id=? AND task_id=? GROUP BY material_index').bind(ctx.organizationId,t.id));
  const events=await rows(env.DB.prepare('SELECT e.id,e.kind,e.quantity_milli,e.note,e.created_at,e.created_by,e.movement_id FROM task_stock_events e JOIN task_stock_reservations r ON r.organization_id=e.organization_id AND r.id=e.reservation_id WHERE r.organization_id=? AND r.task_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT 50').bind(ctx.organizationId,t.id));
  return h.json({task:h.taskJson(t),canReserve,preparationId:current.binding?.id||null,assignmentSignature,materialsSignature,ready:!!current.assignment&&!current.value?.unavailable&&t.status!=='done',date:h.socleBusinessDate(state),usage,reservations,truncated:allocations.length>200,events:events.map(e=>({id:e.id,kind:e.kind,quantity:e.quantity_milli/1000,note:e.note,createdAt:e.created_at,movementId:e.movement_id}))});
 }
 if(request.method!=='POST'||!['reserve','release','consume'].includes(action))return h.json({error:'Méthode non autorisée.'},405);
 const data=await h.body(request,12000),key=op(data),stamp=new Date().toISOString();
 if(action==='reserve'){
  if(!canReserve)fail('La réservation nécessite les droits de gestion des tâches, du planning et du stock.',403);
  const quantityMilli=stockMilli(data.quantity),index=data.materialIndex;
  if(!Number.isInteger(index)||!materials[index])fail('Matériau inconnu.');
  const normalized={taskId:t.id,materialIndex:index,stockItemId:String(data.stockItemId||''),locationId:String(data.locationId||''),quantityMilli,preparationId:String(data.preparationId||''),assignmentSignature:String(data.assignmentSignature||''),materialsSignature:String(data.materialsSignature||'')},requestJson=JSON.stringify(normalized);
  async function replay(){const r=await env.DB.prepare('SELECT id,created_by,request_json FROM task_stock_reservations WHERE organization_id=? AND operation_key=?').bind(ctx.organizationId,key).first();if(!r)return null;if(r.created_by!==ctx.uid||r.request_json!==requestJson)fail('Cette clé correspond à une autre réservation.',409);return h.json({id:r.id,replayed:true},200)}
  const old=await replay();if(old)return old;
  if(!current.assignment||current.value?.unavailable||data.preparationId!==current.binding.id||data.assignmentSignature!==assignmentSignature||data.materialsSignature!==materialsSignature)fail('Reliez la tâche à une affectation active et rechargez sa préparation.',409);
  const item=await env.DB.prepare('SELECT name,unit FROM field_stock_items WHERE organization_id=? AND id=? AND archived_at IS NULL').bind(ctx.organizationId,normalized.stockItemId).first(),location=await env.DB.prepare("SELECT name FROM stock_locations WHERE organization_id=? AND id=? AND status='active'").bind(ctx.organizationId,normalized.locationId).first();if(!item||!location)fail('Article ou emplacement introuvable.',404);
  if(!stockUnit(materials[index].unit)||stockUnit(item.unit)!==stockUnit(materials[index].unit))fail('Unités incompatibles. Aucune conversion automatique.');
  const id='task-stock-'+crypto.randomUUID();
  try{await h.dbBatch(env,[env.DB.prepare('INSERT INTO task_stock_reservations(organization_id,id,task_id,project_id,preparation_id,assignment_id,assignment_guard_json,materials_json,material_index,stock_item_id,location_id,unit,item_name,location_name,quantity_milli,operation_key,request_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(ctx.organizationId,id,t.id,t.project_id,current.binding.id,current.assignment.id,current.assignment.guard_json,t.materials_json,index,normalized.stockItemId,normalized.locationId,stockUnit(item.unit),item.name,location.name,quantityMilli,key,requestJson,ctx.uid,stamp),h.auditStatement(env,ctx,'task.stock_reserved','task',t.id,{reservation_id:id,stock_item_id:normalized.stockItemId,location_id:normalized.locationId,quantity:quantityMilli/1000})])}catch(e){const old=await replay();if(old)return old;if(String(e).includes('task_stock_'))fail(taskStockErrorMessage(e),409);throw e}
  return h.json({id},201);
 }
 const reservationId=String(data.reservationId||''),r=await env.DB.prepare('SELECT * FROM task_stock_remaining WHERE organization_id=? AND task_id=? AND id=?').bind(ctx.organizationId,t.id,reservationId).first();if(!r)fail('Réservation introuvable.',404);
 const expected=data.expectedRemainingMilli;if(!Number.isSafeInteger(expected)||expected<0)fail('État de réservation invalide.');
 const note=String(data.note||'').trim();if(note.length>500)fail('Note limitée à 500 caractères.');
 if(action==='release'){
  if(!canReserve)fail('La libération est réservée au bureau autorisé.',403);
  const requestJson=JSON.stringify({taskId:t.id,reservationId,expectedRemainingMilli:expected,note});
  async function replay(){const e=await env.DB.prepare('SELECT id,created_by,request_json FROM task_stock_events WHERE organization_id=? AND operation_key=?').bind(ctx.organizationId,key).first();if(!e)return null;if(e.created_by!==ctx.uid||e.request_json!==requestJson)fail('Cette clé correspond à une autre libération.',409);return h.json({id:e.id,replayed:true})}const old=await replay();if(old)return old;
  const id='stock-release-'+crypto.randomUUID();try{await h.dbBatch(env,[env.DB.prepare("INSERT INTO task_stock_events VALUES(?,?,?,'release',?,?,NULL,?,?,?,?,?)").bind(ctx.organizationId,id,r.id,expected,expected,key,requestJson,note||'Libération par le bureau',ctx.uid,stamp),h.auditStatement(env,ctx,'task.stock_released','task',t.id,{reservation_id:r.id,quantity:expected/1000})])}catch(e){const old=await replay();if(old)return old;if(String(e).includes('task_stock_')||expected===0)fail(taskStockErrorMessage(e),409);throw e}return h.json({id},201);
 }
 await h.requirePermission(env,ctx,canReserve?'stock.move':'stock.consume.assigned');
 const quantityMilli=stockMilli(data.quantity);if(r.unit==='pc'&&quantityMilli%1000!==0)fail('Les pièces se prennent à l’unité entière.');const movementKey='task-stock:'+await digest(ctx.uid+':'+key);
 const prior=await env.DB.prepare('SELECT id,task_reservation_id,task_reservation_expected_milli,quantity,reason FROM field_stock_movements WHERE organization_id=? AND idempotency_key=?').bind(ctx.organizationId,movementKey).first();
 const reason=note||'Sortie du stock réservé à la tâche';
 if(prior){if(prior.task_reservation_id!==r.id||prior.task_reservation_expected_milli!==expected||Math.round(prior.quantity*1000)!==quantityMilli||prior.reason!==reason)fail('Cette clé correspond à une autre sortie.',409);return h.json({id:prior.id,replayed:true})}
 if(!await mayConsume(r))fail('Seule une personne de l’affectation du jour peut prendre ce stock pour cette tâche.',403);
 try{const result=await h.executeStockMovement(env,ctx,{state,itemId:r.stock_item_id,type:'sortie chantier',quantity:quantityMilli/1000,date:h.socleBusinessDate(state),projectId:t.project_id,reason,reference:'TACHE '+t.id,operationKey:movementKey,sourceLocationId:r.location_id,reservationId:r.id,reservationExpectedMilli:expected});return h.json({id:result.id,replayed:result.replayed,date:result.date},result.status)}catch(e){if(String(e).includes('task_stock_'))fail(taskStockErrorMessage(e),409);throw e}
}
