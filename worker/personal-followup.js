import {buildPersonalFollowup} from './personal-followup-policy.js';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const list=value=>Array.isArray(value)?value:[];
const same=(a,b)=>String(a??'')===String(b??'');
const parse=value=>{try{return JSON.parse(value||'[]')}catch{return[]}};
const stamp=h=>typeof h.clock==='function'?h.clock():new Date().toISOString();
function object(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('Données de rappel invalides.');return value}
function instant(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))fail('Choisissez une date et une heure de rappel avec fuseau.');
 const d=new Date(value),day=new Date(value.slice(0,10)+'T12:00:00Z');if(!Number.isFinite(d.getTime())||!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==value.slice(0,10))fail('Date du rappel invalide.');return d.toISOString();
}
const rowValue=r=>({id:r.id,organizationId:r.organization_id,userId:r.user_id,kind:r.source_kind,sourceId:r.source_id,remindAt:r.remind_at,version:r.version,status:r.cancelled_at?'cancelled':'active',cancelledAt:r.cancelled_at});
async function records(statement){const r=await statement.all();return r.results||r}
async function context(env,ctx,h){
 const state=await h.organizationWorkspaceState(env,ctx.organizationId,{readOnly:true})||{},personId=String(await h.currentPersonId(env,ctx)||''),manages=await h.canManageProjectTasks(env,ctx);
 const taskView=ctx.roleCode==='OWNER'||manages||await h.allowed(env,ctx,'tasks.view.assigned');
 const reminderView=ctx.roleCode==='OWNER'||await h.allowed(env,ctx,'ui.module.personal.view')||await h.allowed(env,ctx,'ui.module.actions.view');
 const messageView=ctx.roleCode==='OWNER'||await h.allowed(env,ctx,'messages.view');
 return {state,personId,manages,taskView,reminderView,messageView,projectIds:new Set()};
}
async function projectAllowed(env,ctx,h,c,id){if(!id)return true;const allowed=await h.hasProjectScope(env,ctx,String(id));if(allowed)c.projectIds.add(String(id));return allowed}
async function source(env,ctx,h,c,kind,id){
 if(kind==='task'){
  if(!c.taskView)return null;
  const t=await h.taskById(env,ctx,String(id));if(!t||t.archived_at||!await projectAllowed(env,ctx,h,c,t.project_id))return null;
  const people=list(parse(t.people_json)).map(String);if(!c.manages&&!same(t.assigned_to,ctx.uid)&&!people.includes(String(ctx.uid)))return null;
  return {id:t.id,organizationId:ctx.organizationId,projectId:t.project_id,title:t.title,status:t.status,assignedTo:t.assigned_to,people,dueAt:t.due_at};
 }
 if(kind==='reminder'){
  if(!c.reminderView)return null;
  const r=list(c.state.reminders).find(r=>same(r.id,id));if(!r)return null;
  const recipientIds=list(r.recipientIds).map(String);if(r.linkType==='person')recipientIds.push(String(r.linkId));
  const personal=c.personId&&(same(r.assigneeId,c.personId)||recipientIds.includes(c.personId));
  const byUser=same(r.assigneeUserId,ctx.uid)||list(r.recipientUserIds).some(x=>same(x,ctx.uid));
  if(ctx.roleCode!=='OWNER'&&!personal&&!byUser)return null;
  const projectId=r.linkType==='job'?String(r.linkId):null;if(!await projectAllowed(env,ctx,h,c,projectId))return null;
  return {id:r.id,organizationId:ctx.organizationId,projectId,title:r.title,state:r.state,date:r.date,assigneeId:r.assigneeId,assigneeUserId:r.assigneeUserId,recipientIds,recipientUserIds:r.recipientUserIds};
 }
 if(kind==='message'){
  if(!c.messageView)return null;
  const m=await env.DB.prepare('SELECT m.id,m.body,m.sender_id,m.conversation_id,c.kind,c.project_id,c.scope_project_id,c.team_id,EXISTS(SELECT 1 FROM personal_message_notifications n WHERE n.organization_id=m.organization_id AND n.message_id=m.id AND n.recipient_user_id=?) notified FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.organization_id=m.organization_id WHERE m.id=? AND m.organization_id=? AND m.archived_at IS NULL AND c.archived_at IS NULL').bind(ctx.uid,String(id),ctx.organizationId).first();
  if(!m)return null;
  const conversation={...m,id:m.conversation_id};if(!await h.conversationCanAccess(env,ctx,conversation,c.state,c.personId))return null;
  const projectId=m.scope_project_id||m.project_id;if(!await projectAllowed(env,ctx,h,c,projectId))return null;
  return {id:m.id,organizationId:ctx.organizationId,projectId,title:String(m.body||'Message').slice(0,240),notifyRecipient:!!m.notified,recipientUserIds:m.notified?[ctx.uid]:[],senderId:m.sender_id,conversationId:m.conversation_id};
 }
 return null;
}
export async function personalFollowupFeed(env,ctx,h){
 const c=await context(env,ctx,h),followRows=await records(env.DB.prepare('SELECT * FROM personal_followup_reminders WHERE organization_id=? AND user_id=? ORDER BY remind_at,id LIMIT 501').bind(ctx.organizationId,ctx.uid)),tasks=[],reminders=[],messages=[],followups=[];
 const cache=new Map();async function load(kind,id){const key=kind+':'+id;if(!cache.has(key))cache.set(key,await source(env,ctx,h,c,kind,id));return cache.get(key)}
 if(c.taskView){
  const candidates=await records(env.DB.prepare("SELECT t.id FROM project_tasks t WHERE t.organization_id=? AND t.archived_at IS NULL AND t.status<>'done' AND (t.assigned_to=? OR EXISTS(SELECT 1 FROM json_each(t.people_json) p WHERE CAST(p.value AS TEXT)=?) OR EXISTS(SELECT 1 FROM personal_followup_reminders f WHERE f.organization_id=t.organization_id AND f.user_id=? AND f.source_kind='task' AND f.source_id=t.id AND f.cancelled_at IS NULL)) ORDER BY COALESCE(t.due_at,'9999'),t.id LIMIT 501").bind(ctx.organizationId,ctx.uid,ctx.uid,ctx.uid));
  for(const row of candidates.slice(0,500)){const t=await load('task',row.id);if(t)tasks.push(t)}
 }
 for(const raw of list(c.state.reminders)){const r=await load('reminder',raw.id);if(r)reminders.push(r)}
 if(c.messageView){
  const ids=await records(env.DB.prepare('SELECT message_id FROM personal_message_notifications WHERE organization_id=? AND recipient_user_id=? ORDER BY created_at DESC,message_id LIMIT 501').bind(ctx.organizationId,ctx.uid));
  for(const row of ids.slice(0,500)){const m=await load('message',row.message_id);if(m)messages.push(m)}
 }
 for(const row of followRows.slice(0,500)){
  const target=await load(row.source_kind,row.source_id);if(!target)continue;
  followups.push({...rowValue(row),sourceTitle:target.title});
  const targetList=row.source_kind==='task'?tasks:row.source_kind==='reminder'?reminders:messages;if(!targetList.some(x=>same(x.id,target.id)))targetList.push(target);
 }
 const documents=[];
 if(c.personId&&c.reminderView){
  const person=list(c.state.people).find(p=>same(p.id,c.personId));
  if(person&&person.active!==false)for(const [i,permit] of list(person.hr?.permits).entries())documents.push({id:'permit:'+c.personId+':'+i,organizationId:ctx.organizationId,title:String(permit.name||'Habilitation'),personId:c.personId,expiresOn:permit.expires||''});
 }
 const appointments=ctx.roleCode==='OWNER'?(await records(env.DB.prepare('SELECT * FROM personal_calendar_events WHERE organization_id=? AND user_id=? AND cancelled_at IS NULL AND remind_at IS NOT NULL AND remind_at<=? AND ends_at>=? ORDER BY starts_at,id LIMIT 501').bind(ctx.organizationId,ctx.uid,stamp(h),stamp(h)))).map(e=>({id:e.id,organizationId:e.organization_id,userId:e.user_id,title:e.title,startsAt:e.starts_at,endsAt:e.ends_at,remindAt:e.remind_at})):[];
 const receipts=(await records(env.DB.prepare('SELECT * FROM personal_notification_receipts WHERE organization_id=? AND user_id=?').bind(ctx.organizationId,ctx.uid))).map(r=>({organizationId:r.organization_id,userId:r.user_id,key:r.source_key,revision:r.source_revision,readAt:r.read_at}));
 const model=buildPersonalFollowup({organizationId:ctx.organizationId,userId:ctx.uid,roleCode:ctx.roleCode,personId:c.personId,now:stamp(h),allowedProjectIds:[...c.projectIds],tasks,reminders,messages,documents,followups,appointments,receipts});
 return {...model,items:model.items.slice(0,100),truncated:model.items.length>100||followRows.length>500,followups,unreadCount:model.items.filter(i=>!i.readAt).length};
}
export async function personalFollowupRoute(request,url,env,ctx,h,action=null,id=null){
 if(!ctx?.uid||!ctx.organizationId)fail('Authentification requise.',401);
 if(ctx.preview&&request.method!=='GET')fail('Les modifications sont désactivées dans cet aperçu.',403);
 if(action==='notification-options'){
  if(request.method!=='GET')return h.json({error:'Méthode non autorisée.'},405);
  if(ctx.roleCode!=='OWNER')fail('Seul le patron peut préparer ces notifications.',403);
  const c=await context(env,ctx,h),conversation=await env.DB.prepare('SELECT id,kind,project_id,scope_project_id,team_id FROM conversations WHERE id=? AND organization_id=? AND archived_at IS NULL').bind(String(id),ctx.organizationId).first();
  if(!conversation||!await h.conversationCanAccess(env,ctx,conversation,c.state,c.personId))fail('Conversation introuvable.',404);
  const candidates=await records(env.DB.prepare("SELECT om.user_id,om.role_id,r.code role_code,p.first_name,p.last_name FROM organization_members om JOIN roles r ON r.id=om.role_id AND r.organization_id=om.organization_id JOIN profiles p ON p.id=om.user_id WHERE om.organization_id=? AND om.status='active' AND om.user_id<>? ORDER BY p.last_name,p.first_name,om.user_id LIMIT 501").bind(ctx.organizationId,ctx.uid)),recipients=[];
  for(const member of candidates.slice(0,500)){
   const rc={uid:member.user_id,organizationId:ctx.organizationId,roleId:member.role_id,roleCode:member.role_code};
   if(!await h.allowed(env,rc,'messages.view'))continue;
   if(!await h.conversationCanAccess(env,rc,conversation,c.state,await h.currentPersonId(env,rc)))continue;
   const projectId=conversation.scope_project_id||conversation.project_id;if(projectId&&!await h.hasProjectScope(env,rc,String(projectId)))continue;
   recipients.push({userId:member.user_id,name:[member.first_name,member.last_name].filter(Boolean).join(' ')||'Membre'});
  }
  return h.json({recipients,truncated:candidates.length>500,maximumSelection:50});
 }
 if(action==='notify-message'){
  if(request.method!=='POST')return h.json({error:'Méthode non autorisée.'},405);
  if(ctx.roleCode!=='OWNER')fail('Seul le patron peut demander cette notification.',403);
  const data=object(await h.body(request,12000),['recipientUserIds']);
  if(!Array.isArray(data.recipientUserIds)||!data.recipientUserIds.length||data.recipientUserIds.length>50||data.recipientUserIds.some(v=>typeof v!=='string'||!v))fail('Choisissez de 1 à 50 destinataires.');
  const recipients=[...new Set(data.recipientUserIds)];if(recipients.length!==data.recipientUserIds.length)fail('Un destinataire est sélectionné deux fois.');
  const c=await context(env,ctx,h),m=await source(env,ctx,h,c,'message',id);if(!m||!same(m.senderId,ctx.uid))fail('Message introuvable ou non envoyé par vous.',404);
  const statements=[];
  for(const uid of recipients){
   const member=await env.DB.prepare("SELECT om.role_id,r.code role_code FROM organization_members om JOIN roles r ON r.id=om.role_id AND r.organization_id=om.organization_id WHERE om.organization_id=? AND om.user_id=? AND om.status='active'").bind(ctx.organizationId,uid).first();
   if(!member)fail('Un destinataire n’appartient pas à cette entreprise.',403);
   const recipientCtx={uid,organizationId:ctx.organizationId,roleId:member.role_id,roleCode:member.role_code},rc=await context(env,recipientCtx,h);if(!await source(env,recipientCtx,h,rc,'message',id))fail('Un destinataire ne peut pas consulter ce message.',403);
   statements.push(env.DB.prepare('INSERT OR IGNORE INTO personal_message_notifications(organization_id,message_id,recipient_user_id,requested_by,created_at) VALUES(?,?,?,?,?)').bind(ctx.organizationId,String(id),uid,ctx.uid,stamp(h)));
  }
  const results=await h.dbBatch(env,statements);return h.json({notified:recipients.length,replayed:results.every(r=>Number(r?.meta?.changes??r?.changes??0)===0)});
 }
 if(action==='read'){
  if(request.method!=='POST')return h.json({error:'Méthode non autorisée.'},405);
  const data=object(await h.body(request,5000),['key','revision','read']);if(typeof data.key!=='string'||typeof data.revision!=='string'||typeof data.read!=='boolean')fail('État de lecture invalide.');
  const feed=await personalFollowupFeed(env,ctx,h),item=feed.items.find(i=>i.key===data.key);if(!item)fail('Rappel introuvable.',404);if(item.revision!==data.revision)fail('Le rappel a changé. Rechargez-le.',409);
  if(data.read)await env.DB.prepare('INSERT INTO personal_notification_receipts(organization_id,user_id,source_key,source_revision,read_at) VALUES(?,?,?,?,?) ON CONFLICT(organization_id,user_id,source_key) DO UPDATE SET source_revision=excluded.source_revision,read_at=CASE WHEN personal_notification_receipts.source_revision=excluded.source_revision THEN personal_notification_receipts.read_at ELSE excluded.read_at END').bind(ctx.organizationId,ctx.uid,data.key,data.revision,stamp(h)).run();
  else await env.DB.prepare('DELETE FROM personal_notification_receipts WHERE organization_id=? AND user_id=? AND source_key=? AND source_revision=?').bind(ctx.organizationId,ctx.uid,data.key,data.revision).run();
  return h.json({key:data.key,read:data.read});
 }
 if(request.method==='GET'&&!id)return h.json(await personalFollowupFeed(env,ctx,h));
 if(request.method==='POST'&&!id){
  const data=object(await h.body(request,5000),['kind','sourceId','remindAt','expectedVersion']);if(!['task','reminder','message'].includes(data.kind)||typeof data.sourceId!=='string'||!data.sourceId.trim())fail('Source de rappel invalide.');
  const c=await context(env,ctx,h);if(!await source(env,ctx,h,c,data.kind,data.sourceId))fail('Source du rappel introuvable.',404);
  const remindAt=instant(data.remindAt),expected=data.expectedVersion??0;if(!Number.isInteger(expected)||expected<0)fail('Version du rappel invalide.');
  const existing=await env.DB.prepare('SELECT * FROM personal_followup_reminders WHERE organization_id=? AND user_id=? AND source_kind=? AND source_id=?').bind(ctx.organizationId,ctx.uid,data.kind,data.sourceId).first();
  if(existing){
   if(!existing.cancelled_at&&existing.remind_at===remindAt)return h.json({followup:rowValue(existing),replayed:true});
   if(existing.version!==expected)fail('Votre rappel a changé. Rechargez-le.',409);
   const r=await env.DB.prepare('UPDATE personal_followup_reminders SET remind_at=?,cancelled_at=NULL,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND user_id=? AND version=?').bind(remindAt,stamp(h),existing.id,ctx.organizationId,ctx.uid,expected).run();
   if(Number(r?.meta?.changes??r?.changes??0)!==1)fail('Votre rappel a changé. Rechargez-le.',409);
   const row=await env.DB.prepare('SELECT * FROM personal_followup_reminders WHERE id=? AND organization_id=? AND user_id=?').bind(existing.id,ctx.organizationId,ctx.uid).first();return h.json({followup:rowValue(row),replayed:false});
  }
  if(expected!==0)fail('Ce rappel n’existe plus. Rechargez-le.',409);
  const fid='personal-followup-'+crypto.randomUUID(),now=stamp(h);await env.DB.prepare('INSERT OR IGNORE INTO personal_followup_reminders(id,organization_id,user_id,source_kind,source_id,remind_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(fid,ctx.organizationId,ctx.uid,data.kind,data.sourceId,remindAt,now,now).run();
  const row=await env.DB.prepare('SELECT * FROM personal_followup_reminders WHERE organization_id=? AND user_id=? AND source_kind=? AND source_id=?').bind(ctx.organizationId,ctx.uid,data.kind,data.sourceId).first();if(!row||row.remind_at!==remindAt||row.cancelled_at)fail('Un autre rappel vient d’être enregistré. Rechargez-le.',409);
  return h.json({followup:rowValue(row),replayed:row.id!==fid},row.id===fid?201:200);
 }
 if(request.method==='DELETE'&&id){
  const data=object(await h.body(request,2000),['expectedVersion']);if(!Number.isInteger(data.expectedVersion))fail('Version du rappel requise.');
  const row=await env.DB.prepare('SELECT * FROM personal_followup_reminders WHERE id=? AND organization_id=? AND user_id=?').bind(String(id),ctx.organizationId,ctx.uid).first();if(!row)fail('Rappel introuvable.',404);if(row.cancelled_at)return h.json({cancelled:true,replayed:true});
  const r=await env.DB.prepare('UPDATE personal_followup_reminders SET cancelled_at=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND user_id=? AND version=? AND cancelled_at IS NULL').bind(stamp(h),stamp(h),String(id),ctx.organizationId,ctx.uid,data.expectedVersion).run();if(Number(r?.meta?.changes??r?.changes??0)!==1)fail('Votre rappel a changé. Rechargez-le.',409);
  return h.json({cancelled:true,replayed:false});
 }
 return h.json({error:'Méthode non autorisée.'},405);
}
