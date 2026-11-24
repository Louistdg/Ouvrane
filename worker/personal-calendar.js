const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
function object(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('Données du rendez-vous invalides.');return value}
function iso(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))fail('Date et fuseau explicites requis.');
 const date=new Date(value),day=new Date(value.slice(0,10)+'T12:00:00Z');
 if(!Number.isFinite(date.getTime())||!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==value.slice(0,10))fail('Date du rendez-vous invalide.');
 return date.toISOString();
}
function fields(data,old={}){
 const title=data.title===undefined?old.title:String(data.title||'').trim(),notes=data.notes===undefined?(old.notes||''):String(data.notes||'').trim();
 if(!title||title.length>240||notes.length>2000)fail('Titre ou note du rendez-vous invalide.');
 const startsAt=iso(data.startsAt??old.starts_at),endsAt=iso(data.endsAt??old.ends_at);
 if(endsAt<=startsAt||Date.parse(endsAt)-Date.parse(startsAt)>31*86400000)fail('La fin doit suivre le début, sur une durée maximale de 31 jours.');
 const timeZone=data.timeZone??old.time_zone??'Europe/Brussels';if(timeZone!=='Europe/Brussels')fail('Le calendrier utilise le fuseau Europe/Brussels.');
 const rawRemind=data.remindAt===undefined?old.remind_at:data.remindAt,remindAt=rawRemind===undefined||rawRemind===null||rawRemind===''?null:iso(rawRemind);
 if(remindAt&&remindAt>startsAt)fail('Le rappel doit précéder le rendez-vous ou avoir lieu à son début.');
 return {title,startsAt,endsAt,timeZone,notes,remindAt};
}
function value(row){return {id:row.id,title:row.title,startsAt:row.starts_at,endsAt:row.ends_at,timeZone:row.time_zone,notes:row.notes,remindAt:row.remind_at,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,cancelledAt:row.cancelled_at}}
async function first(env,ctx,id){return env.DB.prepare('SELECT * FROM personal_calendar_events WHERE id=? AND organization_id=? AND user_id=?').bind(String(id),ctx.organizationId,ctx.uid).first()}
export async function personalCalendarRoute(request,url,env,ctx,h,eventId=null){
 if(!ctx?.uid||!ctx.organizationId)fail('Authentification requise.',401);
 if(ctx.roleCode!=='OWNER')fail('Cet agenda personnel est réservé au patron.',403);
 if(ctx.preview&&request.method!=='GET')fail('Les modifications sont désactivées dans cet aperçu.',403);
 if(!eventId&&request.method==='GET'){
  const from=iso(url.searchParams.get('from')||new Date().toISOString()),to=iso(url.searchParams.get('to')||new Date(Date.parse(from)+31*86400000).toISOString());
  if(to<=from||Date.parse(to)-Date.parse(from)>93*86400000)fail('Choisissez une période de calendrier de 93 jours au maximum.');
  const rows=await env.DB.prepare('SELECT * FROM personal_calendar_events WHERE organization_id=? AND user_id=? AND cancelled_at IS NULL AND starts_at<? AND ends_at>? ORDER BY starts_at,id LIMIT 501').bind(ctx.organizationId,ctx.uid,to,from).all();
  const events=rows.results||rows;return h.json({events:events.slice(0,500).map(value),truncated:events.length>500,from,to,timeZone:'Europe/Brussels'});
 }
 if(!eventId&&request.method==='POST'){
  const data=object(await h.body(request,14000),['title','startsAt','endsAt','timeZone','notes','remindAt','operationKey']);
  const operation=String(data.operationKey||'');if(!/^[A-Za-z0-9._:-]{8,120}$/.test(operation))fail('Clé d’enregistrement du rendez-vous invalide.');
  const normalized=fields(data),canonical=JSON.stringify(normalized),id='personal-event-'+crypto.randomUUID(),stamp=new Date().toISOString();
  const inserted=await env.DB.prepare('INSERT OR IGNORE INTO personal_calendar_events(id,organization_id,user_id,title,starts_at,ends_at,time_zone,notes,remind_at,operation_key,request_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,ctx.organizationId,ctx.uid,normalized.title,normalized.startsAt,normalized.endsAt,normalized.timeZone,normalized.notes,normalized.remindAt,operation,canonical,stamp,stamp).run();
  const row=await env.DB.prepare('SELECT * FROM personal_calendar_events WHERE organization_id=? AND user_id=? AND operation_key=?').bind(ctx.organizationId,ctx.uid,operation).first();
  if(!row||row.request_json!==canonical)fail('Cette clé correspond à un autre rendez-vous.',409);
  const replayed=Number(inserted?.meta?.changes??inserted?.changes??0)===0;return h.json({event:value(row),replayed},replayed?200:201);
 }
 if(!eventId)return h.json({error:'Méthode non autorisée.'},405);
 const old=await first(env,ctx,eventId);if(!old)fail('Rendez-vous introuvable.',404);
 if(request.method==='GET')return h.json({event:value(old)});
 if(request.method==='PATCH'){
  if(old.cancelled_at)fail('Ce rendez-vous est annulé.',409);
  const data=object(await h.body(request,14000),['title','startsAt','endsAt','timeZone','notes','remindAt','expectedVersion']);
  if(!Number.isInteger(data.expectedVersion)||data.expectedVersion!==old.version)fail('Le rendez-vous a changé. Rechargez-le.',409);
  const n=fields(data,old),stamp=new Date().toISOString();
  const result=await env.DB.prepare('UPDATE personal_calendar_events SET title=?,starts_at=?,ends_at=?,time_zone=?,notes=?,remind_at=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND user_id=? AND version=? AND cancelled_at IS NULL').bind(n.title,n.startsAt,n.endsAt,n.timeZone,n.notes,n.remindAt,stamp,String(eventId),ctx.organizationId,ctx.uid,data.expectedVersion).run();
  if(Number(result?.meta?.changes??result?.changes??0)!==1)fail('Le rendez-vous a changé. Rechargez-le.',409);
  return h.json({event:value(await first(env,ctx,eventId))});
 }
 if(request.method==='DELETE'){
  const data=object(await h.body(request,2000),['expectedVersion']);if(!Number.isInteger(data.expectedVersion))fail('Version du rendez-vous requise.');
  if(old.cancelled_at)return h.json({event:value(old),replayed:true});
  const stamp=new Date().toISOString(),result=await env.DB.prepare('UPDATE personal_calendar_events SET cancelled_at=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND user_id=? AND version=? AND cancelled_at IS NULL').bind(stamp,stamp,String(eventId),ctx.organizationId,ctx.uid,data.expectedVersion).run();
  if(Number(result?.meta?.changes??result?.changes??0)!==1)fail('Le rendez-vous a changé. Rechargez-le.',409);
  return h.json({event:value(await first(env,ctx,eventId)),replayed:false});
 }
 return h.json({error:'Méthode non autorisée.'},405);
}
