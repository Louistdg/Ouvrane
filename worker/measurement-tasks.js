import {requireCommercialVisitScope} from './commercial-scope.js';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');
export function measurementTaskMaterials(needs,codes,basis){
 if(!['required','packaged'].includes(basis))fail('Choisissez les besoins calculés ou les quantités conditionnées.');
 if(!Array.isArray(codes)||!codes.length||codes.length>60||new Set(codes).size!==codes.length||codes.some(c=>!needs.some(n=>n.code===c)))fail('Choisissez des besoins distincts de ce métré.');
 return needs.filter(n=>codes.includes(n.code)).map(n=>{const quantity=Number(basis==='required'?n.requiredQuantity:n.orderedQuantity);if(!Number.isFinite(quantity)||quantity<=0)fail('Quantité du métré invalide.');return {name:n.label,quantity,unit:n.unit}});
}
// Deliberately omit input/result JSON: it contains quote prices and financial assumptions.
export async function taskMeasurementSource(env,ctx,task,{currentVersion=false}={}){
 const row=await env.DB.prepare('SELECT source_json,materials_json,visit_id FROM task_measurement_sources WHERE organization_id=? AND task_id=?').bind(ctx.organizationId,task.id).first();
 if(!row)return null;
 const source=JSON.parse(row.source_json),version=currentVersion?await env.DB.prepare('SELECT MAX(version) version FROM measurement_snapshots WHERE organization_id=? AND visit_id=?').bind(ctx.organizationId,row.visit_id).first():null;
 return {...source,materialsChanged:JSON.stringify(JSON.parse(task.materials_json||'[]'))!==JSON.stringify(JSON.parse(row.materials_json)),...(currentVersion?{latestVersion:version.version,newerVersionAvailable:version.version>source.version}:{})};
}
export async function measurementTasksRoute(request,url,env,ctx,measurementId,h){
 await h.requirePermission(env,ctx,'quotes.view');await h.requireQuotePriceRead(env,ctx);await h.requirePermission(env,ctx,'tasks.manage.project');
 const m=await env.DB.prepare('SELECT * FROM measurement_snapshots WHERE organization_id=? AND id=?').bind(ctx.organizationId,measurementId).first();if(!m)fail('Métré introuvable.',404);
 const visit=await env.DB.prepare('SELECT quote_id FROM quote_site_visits WHERE organization_id=? AND id=?').bind(ctx.organizationId,m.visit_id).first();
 const quote=await requireCommercialVisitScope(env,ctx,visit,h);
 if(quote?.project_id){await h.requireFinanceProjectScope(env,ctx,quote.project_id);await h.requireProjectScope(env,ctx,quote.project_id);await h.relationExists(env,ctx,'project',quote.project_id)}
 const head=await env.DB.prepare('SELECT MAX(version) version FROM measurement_snapshots WHERE organization_id=? AND visit_id=?').bind(ctx.organizationId,m.visit_id).first();
 const needs=JSON.parse(m.result_json).materialNeeds.map(n=>({code:n.code,label:n.label,unit:n.unit,requiredQuantity:n.requiredQuantity,orderedQuantity:n.orderedQuantity,packageSize:n.packageSize}));
 const context={measurementId:m.id,version:m.version,headVersion:head.version,visitId:m.visit_id,quoteId:quote?.id||null,projectId:quote?.project_id?String(quote.project_id):null,sourceLabel:m.source_label,needs};
 const previewSignature=await hash(context);
 if(request.method==='GET')return h.json({...context,previewSignature,canCreate:!!context.projectId});
 if(request.method!=='POST')return h.json({error:'Méthode non autorisée.'},405);
 if(!context.projectId)fail('Rattachez d’abord le devis de cette visite à un chantier. Aucun chantier ne sera choisi automatiquement.',409);
 const data=await h.body(request,12000),operationKey=String(data.operationKey||'');if(!/^[A-Za-z0-9._:-]{8,120}$/.test(operationKey))fail('Clé d’enregistrement invalide.');
 const title=String(data.title||'').trim(),description=String(data.description||'').trim();if(!title||title.length>240||description.length>4000)fail('Titre obligatoire (240 caractères maximum) et description de 4 000 caractères maximum.');
 const codes=Array.isArray(data.codes)?[...data.codes].sort():data.codes,materials=measurementTaskMaterials(needs,codes,data.quantityBasis);
 const normalized={measurementId,title,description,codes,quantityBasis:data.quantityBasis,previewSignature:String(data.previewSignature||''),confirmOlderVersion:data.confirmOlderVersion===true},requestJson=JSON.stringify(normalized);
 async function replay(){const row=await env.DB.prepare('SELECT task_id,request_json FROM task_measurement_sources WHERE organization_id=? AND created_by=? AND operation_key=?').bind(ctx.organizationId,ctx.uid,operationKey).first();if(!row)return null;if(row.request_json!==requestJson)fail('Cette clé correspond à une autre création de tâche.',409);const task=await h.taskById(env,ctx,row.task_id);if(!task)fail('La tâche créée a été archivée. Consultez son historique.',409);await h.requireProjectScope(env,ctx,task.project_id);return h.json({task:h.taskJson(task),replayed:true},200)}
 const prior=await replay();if(prior)return prior;
 if(data.previewSignature!==previewSignature)fail('Le métré ou son chantier a changé. Rechargez l’aperçu avant de créer la tâche.',409);
 if(m.version!==head.version&&!normalized.confirmOlderVersion)fail('Une version plus récente existe. Confirmez explicitement l’utilisation de cette ancienne version.',409);
 const source={measurementId:m.id,version:m.version,sourceLabel:m.source_label,quantityBasis:data.quantityBasis,materials,needs:needs.filter(n=>codes.includes(n.code))};
 try{
  const result=await h.createTaskRecord(env,ctx,context.projectId,{title,description,materials,operationKey:'measurement-task-'+crypto.randomUUID()},{atomicStatements:({taskId,stamp,materials:canonical})=>[
   env.DB.prepare('INSERT INTO task_measurement_sources(organization_id,task_id,measurement_id,visit_id,quote_id,project_id,expected_head_version,materials_json,source_json,operation_key,request_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(ctx.organizationId,taskId,m.id,m.visit_id,quote.id,context.projectId,head.version,JSON.stringify(canonical),JSON.stringify(source),operationKey,requestJson,ctx.uid,stamp),
   h.auditStatement(env,ctx,'measurement.task_created','project_task',taskId,{measurement_id:m.id,version:m.version,quantity_basis:data.quantityBasis})
  ]});if(result.error)return result.error;
  return h.json({task:h.taskJson(result.task),replayed:result.replayed},result.replayed?200:201);
 }catch(e){const prior=await replay();if(prior)return prior;if(String(e).includes('measurement_task_stale'))fail('Le métré ou son chantier a changé pendant l’enregistrement. Rechargez l’aperçu.',409);throw e}
}
