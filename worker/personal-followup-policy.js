// Recipient policy for personal in-app follow-up. Inputs must also be scoped by
// the server's project/document/message permissions before reaching this module.
const list=value=>Array.isArray(value)?value:[];
const same=(a,b)=>String(a??'')===String(b??'');
const done=value=>['done','completed','cancelled','archived'].includes(String(value||'').toLowerCase());
const instant=value=>{const n=Date.parse(String(value||''));return Number.isFinite(n)?n:null};
const isoDay=value=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return false;
 const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
};
export function followupBusinessDate(now){
 const date=new Date(now);if(!Number.isFinite(date.getTime()))throw new TypeError('Invalid follow-up clock');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).filter(p=>['year','month','day'].includes(p.type)).map(p=>[p.type,p.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}
export function buildPersonalFollowup(input){
 const {organizationId,userId,personId,roleCode}=input||{};
 if(!organizationId||!userId||!roleCode)throw new TypeError('Authenticated organization and user required');
 const now=input.now??new Date().toISOString(),clock=instant(now);if(clock===null)throw new TypeError('Invalid follow-up clock');
 const today=followupBusinessDate(now),cutoff=new Date(today+'T12:00:00Z');cutoff.setUTCDate(cutoff.getUTCDate()+14);const until=cutoff.toISOString().slice(0,10);
 const scoped=item=>item&&String(item.id||'').trim()&&same(item.organizationId,organizationId)&&!item.archivedAt;
 const projects=new Set(list(input.allowedProjectIds).map(String));
 const canProject=item=>!item.projectId||projects.has(String(item.projectId));
 const items=new Map();
 function add(kind,item,title,dueAt,reason){
  const key=kind+':'+String(item.id),old=items.get(key);
  if(old){if(!old.reasons.includes(reason))old.reasons.push(reason);return}
  const revision=JSON.stringify([String(title),String(dueAt||''),kind==='task'?String(item.assignedTo||''):null]);
  const receipt=list(input.receipts).find(r=>same(r.organizationId,organizationId)&&same(r.userId,userId)&&r.key===key&&r.revision===revision);
  items.set(key,{key,kind,sourceId:String(item.id),title:String(title),dueAt:dueAt||null,projectId:item.projectId?String(item.projectId):null,reasons:[reason],revision,readAt:receipt?.readAt||null});
 }
 const tasks=list(input.tasks).filter(t=>scoped(t)&&canProject(t)&&!done(t.status));
 for(const task of tasks)if(roleCode!=='OWNER'&&(same(task.assignedTo,userId)||list(task.people).some(id=>same(id,userId))))add('task',task,task.title,task.dueAt,'assigned');
 const reminders=list(input.reminders).filter(r=>scoped(r)&&canProject(r)&&!done(r.state));
 for(const reminder of reminders){
  const ownPerson=personId&&(same(reminder.assigneeId,personId)||list(reminder.recipientIds).some(id=>same(id,personId)));
  const ownUser=same(reminder.assigneeUserId,userId)||list(reminder.recipientUserIds).some(id=>same(id,userId));
  if(roleCode!=='OWNER'&&(ownPerson||ownUser))add('reminder',reminder,reminder.title,reminder.dueAt||reminder.date,'recipient');
 }
 for(const document of list(input.documents)){
  if(!scoped(document)||!canProject(document))continue;
  const owns=same(document.ownerUserId,userId)||personId&&same(document.personId,personId);
  if(owns&&isoDay(document.expiresOn)&&document.expiresOn<=until)add('document',document,document.title,document.expiresOn,'expiry');
 }
 for(const message of list(input.messages))if(scoped(message)&&canProject(message)&&message.notifyRecipient===true&&list(message.recipientUserIds).some(id=>same(id,userId)))add('message',message,message.title||'Un message demande votre attention',null,'requested');
 const sources={task:tasks,reminder:reminders,message:list(input.messages).filter(m=>scoped(m)&&canProject(m))};
 for(const followup of list(input.followups)){
  if(!scoped(followup)||!same(followup.userId,userId)||done(followup.status))continue;
  const when=instant(followup.remindAt);if(when===null||when>clock)continue;
  const source=list(sources[followup.kind]).find(s=>same(s.id,followup.sourceId));
  if(source)add(followup.kind,source,source.title||'Rappel personnel',source.dueAt||source.date,'self');
 }
 // An appointment is private. Creating it does not implicitly opt its owner in
 // to a notification: remindAt must have been explicitly chosen.
 for(const event of list(input.appointments)){
  if(roleCode!=='OWNER'||!scoped(event)||!same(event.userId,userId)||done(event.status))continue;
  const when=instant(event.remindAt),ends=instant(event.endsAt);
  if(when!==null&&when<=clock&&(ends===null||ends>=clock))add('appointment',event,event.title,event.startsAt,'self');
 }
 return {today,items:[...items.values()].sort((a,b)=>String(a.dueAt||'9999').localeCompare(String(b.dueAt||'9999'))||a.key.localeCompare(b.key))};
}
