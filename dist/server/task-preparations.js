import {assignmentAssetSnapshot} from './assignment-assets.js';
import {taskMeasurementSource} from './measurement-tasks.js';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const rows=async stmt=>(await stmt.all()).results;
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const manages=async(env,ctx,h)=>ctx.roleCode==='OWNER'||await h.allowed(env,ctx,'tasks.manage.project');
async function mayPrepare(env,ctx,h){return await manages(env,ctx,h)&&(ctx.roleCode==='OWNER'||await h.allowed(env,ctx,'planning.assignments.manage'))}
async function task(env,ctx,id,h){const t=await h.taskById(env,ctx,id);if(!t)fail('Tâche introuvable.',404);await h.requireProjectScope(env,ctx,t.project_id);await h.relationExists(env,ctx,'project',t.project_id);return t}
async function current(env,ctx,taskId){return env.DB.prepare('SELECT * FROM task_preparations WHERE organization_id=? AND task_id=? ORDER BY version DESC LIMIT 1').bind(ctx.organizationId,taskId).first()}
async function assignment(env,ctx,id){return env.DB.prepare('SELECT a.*,g.guard_json FROM field_assignments a JOIN task_preparation_assignment_guards g ON g.organization_id=a.organization_id AND g.id=a.id WHERE a.organization_id=? AND a.id=?').bind(ctx.organizationId,id).first()}
async function assignmentValue(env,ctx,row,assetSnapshot=null){
 if(!row)return null;
 const team=await env.DB.prepare('SELECT name,active FROM hr_teams WHERE organization_id=? AND id=?').bind(ctx.organizationId,row.team_id).first();
 const ids=JSON.parse(row.people_json),people=[];for(const id of ids){const person=await env.DB.prepare('SELECT display_name,active FROM hr_people WHERE organization_id=? AND id=?').bind(ctx.organizationId,String(id)).first();people.push({personId:String(id),name:person?.display_name||'Personne '+id,active:person?.active===1})}
 const resources=(assetSnapshot||await assignmentAssetSnapshot(env,ctx,row.id)).value;
 return {id:row.id,projectId:String(row.project_id),date:row.assignment_date,teamId:String(row.team_id),teamName:team?.name||'Équipe '+row.team_id,teamActive:team?.active===1,people,startTime:row.start_time||'07:00',endTime:row.end_time||'16:00',status:row.status,resources,updatedAt:row.updated_at};
}
// Financial asset fields, pay, absences and global stock are never included in this snapshot.
export async function taskPreparationSnapshot(env,ctx,taskId){
 const binding=await current(env,ctx,taskId),a=binding?.assignment_id?await assignment(env,ctx,binding.assignment_id):null;
 const ownerTask=await env.DB.prepare('SELECT project_id FROM project_tasks WHERE organization_id=? AND id=?').bind(ctx.organizationId,taskId).first(),wrongProject=!!a&&(String(a.project_id)!==String(binding.project_id)||String(a.project_id)!==String(ownerTask?.project_id));
 const unavailable=!!binding?.assignment_id&&(!a||a.status==='cancelled'||wrongProject);
 const assetSnapshot=a&&!wrongProject?await assignmentAssetSnapshot(env,ctx,a.id):null;
 return {value:binding?{bindingId:binding.id,version:binding.version,linkedAt:binding.created_at,assignment:wrongProject?null:await assignmentValue(env,ctx,a,assetSnapshot),unavailable}:null,guard:{bindingId:binding?.id||null,assignment:a?JSON.parse(a.guard_json):null,assets:assetSnapshot?.guard||null},binding,assignment:a};
}
function validRange(from,to){return /^\d{4}-\d{2}-\d{2}$/.test(from)&&/^\d{4}-\d{2}-\d{2}$/.test(to)&&Number.isFinite(Date.parse(from))&&Number.isFinite(Date.parse(to))&&new Date(from).toISOString().slice(0,10)===from&&new Date(to).toISOString().slice(0,10)===to&&to>=from&&(Date.parse(to)-Date.parse(from))/86400000<=62}
export async function taskPreparationsRoute(request,url,env,ctx,taskId,h){
 const t=await task(env,ctx,taskId,h),office=await manages(env,ctx,h),edit=await mayPrepare(env,ctx,h);
 if(!office){await h.requirePermission(env,ctx,'tasks.view.assigned');if(!h.taskIsParticipant(t,ctx.uid))fail('Tâche introuvable.',404)}
 if(request.method==='GET'){
  const snap=await taskPreparationSnapshot(env,ctx,t.id),result={task:h.taskJson(t),measurementSource:await taskMeasurementSource(env,ctx,t,{currentVersion:true}),canPrepare:edit,current:snap.value,expectedVersion:snap.binding?.version||0};
  if(result.current?.assignment&&!edit&&ctx.roleCode!=='OWNER'&&!await h.allowed(env,ctx,'assets.view')){result.current.assignment.resources=[];result.current.assignment.resourcesHidden=true}
  if(edit){const state=await h.organizationWorkspaceState(env,ctx.organizationId,{readOnly:ctx.preview});if(!ctx.preview){await h.ensureLegacyFieldDataImported(env,ctx,state);await h.ensureLegacyHrImported(env,ctx,state,{includeEmployment:false})}const businessDate=h.socleBusinessDate(state),from=url.searchParams.get('from')||businessDate,to=url.searchParams.get('to')||(Number.isFinite(Date.parse(from))?new Date(Date.parse(from)+28*86400000).toISOString().slice(0,10):'');if(!validRange(from,to))fail('Choisissez une période de 62 jours maximum.');
   const candidates=await rows(env.DB.prepare("SELECT a.*,g.guard_json FROM field_assignments a JOIN task_preparation_assignment_guards g ON g.organization_id=a.organization_id AND g.id=a.id WHERE a.organization_id=? AND a.project_id=? AND a.status<>'cancelled' AND a.assignment_date>=? AND a.assignment_date<=? ORDER BY a.assignment_date,a.start_time,a.id LIMIT 101").bind(ctx.organizationId,t.project_id,from,to));
   result.assignments=[];for(const row of candidates.slice(0,100))result.assignments.push({...await assignmentValue(env,ctx,row),signature:await digest(row.guard_json)});result.range={from,to,truncated:candidates.length>100};
   result.history=(await rows(env.DB.prepare('SELECT id,version,assignment_id,created_at FROM task_preparations WHERE organization_id=? AND task_id=? ORDER BY version DESC LIMIT 20').bind(ctx.organizationId,t.id))).map(r=>({id:r.id,version:r.version,assignmentId:r.assignment_id,createdAt:r.created_at}));
  }
  return h.json(result);
 }
 if(request.method!=='POST')return h.json({error:'Méthode non autorisée.'},405);
 if(!edit)fail('La préparation nécessite les droits de gestion des tâches et du planning.',403);
 const data=await h.body(request,8000),op=String(data?.operationKey||'');if(!/^[A-Za-z0-9._:-]{8,120}$/.test(op))fail('Clé d’enregistrement invalide.');if(!Number.isInteger(data.expectedVersion)||data.expectedVersion<0)fail('Version de préparation invalide.');
 const assignmentId=data.assignmentId===null?null:String(data.assignmentId||'');if(assignmentId==='')fail('Choisissez une affectation ou retirez explicitement la liaison.');
 const normalized={taskId:t.id,assignmentId,expectedVersion:data.expectedVersion,assignmentSignature:assignmentId?String(data.assignmentSignature||''):null},requestJson=JSON.stringify(normalized);
 async function replay(){const old=await env.DB.prepare('SELECT * FROM task_preparations WHERE organization_id=? AND operation_key=?').bind(ctx.organizationId,op).first();if(!old)return null;if(old.request_json!==requestJson)fail('Cette clé correspond à une autre préparation.',409);return h.json({id:old.id,version:old.version,replayed:true})}
 const old=await replay();if(old)return old;
 if(t.status==='done')fail('Rouvrez la tâche avant de préparer une mission.',409);
 const latest=await current(env,ctx,t.id);if((latest?.version||0)!==data.expectedVersion)fail('La préparation a changé. Rechargez.',409);
 let a=null;if(assignmentId){a=await assignment(env,ctx,assignmentId);if(!a||String(a.project_id)!==String(t.project_id))fail('Affectation introuvable sur ce chantier.',404);if(a.status==='cancelled'||await digest(a.guard_json)!==normalized.assignmentSignature)fail('L’affectation a changé. Rechargez le planning.',409)}
 const id='task-prep-'+crypto.randomUUID(),version=data.expectedVersion+1,createdAt=new Date().toISOString();
 try{await h.dbBatch(env,[env.DB.prepare('INSERT INTO task_preparations VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(ctx.organizationId,id,t.id,t.project_id,version,assignmentId,a?.guard_json||'null',op,requestJson,ctx.uid,createdAt),h.auditStatement(env,ctx,'task.preparation.linked','task',t.id,{preparation_id:id,version,assignment_id:assignmentId})])}catch(e){const replayed=await replay();if(replayed)return replayed;if(/preparation_stale|preparation_assignment_stale|UNIQUE constraint/.test(String(e)))fail('La tâche ou le planning a changé. Rechargez.',409);throw e}
 return h.json({id,version},201);
}
