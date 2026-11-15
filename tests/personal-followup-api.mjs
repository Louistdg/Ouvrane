import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {personalFollowupRoute} from '../worker/personal-followup.js';
const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE organizations(id TEXT PRIMARY KEY);CREATE TABLE profiles(id TEXT PRIMARY KEY);
CREATE TABLE roles(id TEXT PRIMARY KEY,organization_id TEXT,code TEXT);
CREATE TABLE organization_members(organization_id TEXT,user_id TEXT,role_id TEXT,status TEXT);
CREATE TABLE project_tasks(id TEXT PRIMARY KEY,organization_id TEXT,project_id TEXT,title TEXT,status TEXT,assigned_to TEXT,people_json TEXT,due_at TEXT,archived_at TEXT);
CREATE TABLE conversations(id TEXT PRIMARY KEY,organization_id TEXT,kind TEXT,project_id TEXT,scope_project_id TEXT,team_id TEXT,archived_at TEXT);
CREATE TABLE messages(id TEXT PRIMARY KEY,organization_id TEXT,conversation_id TEXT,sender_id TEXT,body TEXT,created_at TEXT,archived_at TEXT);
INSERT INTO organizations VALUES('org'),('foreign');
INSERT INTO profiles VALUES('boss'),('boss2'),('chief-a'),('chief-b'),('worker-a'),('worker-b'),('accountant'),('secretary'),('outsider');
INSERT INTO roles VALUES('owner-role','org','OWNER'),('worker-role','org','WORKER');
INSERT INTO organization_members VALUES('org','boss','owner-role','active'),('org','boss2','owner-role','active'),('org','worker-a','worker-role','active'),('org','worker-b','worker-role','active');
INSERT INTO project_tasks VALUES('task-a','org','A','Préparer le chantier A','todo','worker-a','["worker-a"]','2026-10-26',NULL),('task-b','org','B','Secret chantier B','todo','worker-b','["worker-b"]','2026-10-26',NULL),('foreign-task','foreign','F','Secret autre entreprise','todo','worker-a','["worker-a"]',NULL,NULL);
INSERT INTO conversations VALUES('direct','org','direct',NULL,NULL,NULL,NULL),('project-a','org','project','A','A',NULL,NULL),('foreign-convo','foreign','company',NULL,NULL,NULL,NULL);
INSERT INTO messages VALUES('message-direct','org','direct','boss','Consigne confidentielle A','2026-10-24',NULL),('message-project','org','project-a','boss','Message chantier A','2026-10-24',NULL),('message-worker','org','direct','worker-a','Retour ouvrier','2026-10-24',NULL),('message-foreign','foreign','foreign-convo','outsider','Autre entreprise','2026-10-24',NULL);
`);db.exec("ALTER TABLE profiles ADD COLUMN first_name TEXT;ALTER TABLE profiles ADD COLUMN last_name TEXT;UPDATE profiles SET first_name=id;");db.exec(readFileSync(new URL('../drizzle/0066_personal_followup.sql',import.meta.url),'utf8'));
const env={DB:{prepare(sql){
 return {bind(...args){
  const s=db.prepare(sql);
  return {
   first:async()=>s.get(...args)||null,
   all:async()=>({results:s.all(...args)}),
   run:()=>({meta:{changes:Number(s.run(...args).changes)}})
  };
 }};
}}};
const contexts={boss:{uid:'boss',roleCode:'OWNER',organizationId:'org'},boss2:{uid:'boss2',roleCode:'OWNER',organizationId:'org'},'worker-a':{uid:'worker-a',roleCode:'WORKER',organizationId:'org'},'worker-b':{uid:'worker-b',roleCode:'WORKER',organizationId:'org'},'chief-a':{uid:'chief-a',roleCode:'TEAM_LEAD',organizationId:'org'},'chief-b':{uid:'chief-b',roleCode:'TEAM_LEAD',organizationId:'org'},accountant:{uid:'accountant',roleCode:'ACCOUNTING',organizationId:'org'},secretary:{uid:'secretary',roleCode:'SECRETARY',organizationId:'org'}};
const projectScopes={boss:new Set(['A','B']),boss2:new Set(['A','B']),'worker-a':new Set(['A']),'worker-b':new Set(['B']),'chief-a':new Set(['A']),'chief-b':new Set(['B']),accountant:new Set(['A','B']),secretary:new Set(['A','B'])};
const state={people:[{id:'pa',active:true,hr:{permits:[{name:'Habilitation A',expires:'2026-10-30'}]}},{id:'pb',active:true,hr:{permits:[{name:'Secret habilitation B',expires:'2026-10-30'}]}}],reminders:[{id:'reminder-a',title:'Fournir document A',date:'2026-10-28',state:'todo',recipientIds:['pa']},{id:'reminder-b',title:'Secret rappel B',date:'2026-10-28',state:'todo',recipientIds:['pb']},{id:'old-global',title:'Ancien rappel entreprise',date:'2026-10-28',state:'todo',owner:'boss'}]};
const disabled=new Set();
const h={clock:()=> '2026-10-24T10:00:00.000Z',body:async r=>r.json(),json:(data,status=200)=>new Response(JSON.stringify(data),{status}),organizationWorkspaceState:async()=>state,currentPersonId:async(e,c)=>c.uid==='worker-a'?'pa':c.uid==='worker-b'?'pb':null,canManageProjectTasks:async(e,c)=>['OWNER','SECRETARY','TEAM_LEAD'].includes(c.roleCode),allowed:async(e,c,p)=>!disabled.has(c.uid+':'+p)&&(p==='tasks.view.assigned'?c.roleCode!=='ACCOUNTING':true),hasProjectScope:async(e,c,id)=>projectScopes[c.uid]?.has(id)||false,taskById:async(e,c,id)=>e.DB.prepare('SELECT * FROM project_tasks WHERE id=? AND organization_id=?').bind(id,c.organizationId).first(),conversationCanAccess:async(e,c,v)=>v.kind==='direct'?['boss','worker-a'].includes(c.uid):v.kind==='project'?projectScopes[c.uid]?.has(v.project_id):v.kind==='company',dbBatch:async(e,statements)=>{db.exec('BEGIN');try{const out=statements.map(s=>s.run());db.exec('COMMIT');return out}catch(err){db.exec('ROLLBACK');throw err}}};
async function api(actor,method,path='',body){const ctx=typeof actor==='string'?contexts[actor]:actor,url=new URL('https://test.invalid'+(path.startsWith('/api/')?path:'/api/me/follow-up'+path)),request=new Request(url,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});let action=null,id=null;if(url.pathname.endsWith('/read'))action='read';else if(/^\/api\/conversations\//.test(url.pathname)){action='notification-options';id=url.pathname.split('/')[3]}else if(/^\/api\/messages\//.test(url.pathname)){action='notify-message';id=url.pathname.split('/')[3]}else id=url.pathname.split('/')[4]||null;try{const r=await personalFollowupRoute(request,url,env,ctx,h,action,id);return {status:r.status,data:await r.json()}}catch(e){return {status:e.status||500,error:e.message}}}
const checks=[];async function check(label,fn){await fn();checks.push(label)}
await check('Ouvrier reçoit ses trois sujets utiles, sans doublon d’attribution',async()=>{const r=await api('worker-a','GET');assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.items.length,3);assert.equal(new Set(r.data.items.map(x=>x.key)).size,3)});
await check('Aucune donnée d’un autre ouvrier ni d’un autre chantier',async()=>assert.ok(!/Secret|autre entreprise/.test(JSON.stringify((await api('worker-a','GET')).data))));
for(const role of ['boss','boss2','chief-a','chief-b','accountant','secretary'])await check(role+' ne reçoit pas automatiquement les tâches du personnel',async()=>assert.equal((await api(role,'GET')).data.items.length,0));
await check('Retirer l’accès aux rappels personnels retire aussi les habilitations du suivi',async()=>{disabled.add('worker-a:ui.module.personal.view');disabled.add('worker-a:ui.module.actions.view');try{const r=await api('worker-a','GET');assert.equal(r.data.items.some(v=>v.kind==='document'||v.kind==='reminder'),false)}finally{disabled.delete('worker-a:ui.module.personal.view');disabled.delete('worker-a:ui.module.actions.view')}});
await check('Un nom libre ne suffit pas à notifier le patron',async()=>assert.ok(!(await api('boss','GET')).data.items.some(x=>x.key==='reminder:old-global')));
const request={kind:'task',sourceId:'task-a',remindAt:'2026-10-24T09:00:00Z',expectedVersion:0};let followupId;
await check('Rappel patron choisi sur une tâche déléguée',async()=>{const r=await api('boss','POST','',request);assert.equal(r.status,201,JSON.stringify(r));followupId=r.data.followup.id;assert.equal((await api('boss','GET')).data.items[0].key,'task:task-a')});
await check('Rejeu d’enregistrement sans seconde ligne',async()=>{const r=await api('boss','POST','',request);assert.equal(r.status,200);assert.equal(r.data.replayed,true);assert.equal(r.data.followup.id,followupId)});
await check('L’autre patron ne reçoit pas le rappel choisi',async()=>assert.equal((await api('boss2','GET')).data.items.length,0));
await check('Impossible de choisir le propriétaire par le JSON',async()=>assert.equal((await api('boss','POST','',{...request,userId:'worker-a'})).status,400));
await check('L’ouvrier ne suit pas la tâche d’un collègue hors de ses droits',async()=>assert.equal((await api('worker-a','POST','',{...request,sourceId:'task-b'})).status,404));
await check('Source d’une autre entreprise refusée',async()=>assert.equal((await api('boss','POST','',{...request,sourceId:'foreign-task'})).status,404));
await check('Aperçu interdit à l’écriture',async()=>assert.equal((await api({...contexts.boss,preview:true},'POST','',request)).status,403));
await check('Horodatage sans fuseau refusé',async()=>assert.equal((await api('boss','POST','',{...request,remindAt:'2026-10-25T09:00:00'})).status,400));
await check('Modification avec version obsolète refusée',async()=>assert.equal((await api('boss','POST','',{...request,remindAt:'2026-10-26T09:00:00Z',expectedVersion:0})).status,409));
await check('Un rappel futur ne revient pas avant son heure',async()=>{const r=await api('boss','POST','',{...request,remindAt:'2026-10-26T09:00:00Z',expectedVersion:1});assert.equal(r.status,200);assert.equal((await api('boss','GET')).data.items.length,0)});
await check('Deux onglets ne peuvent pas remplacer la même version',async()=>{const r=await Promise.all([api('boss','POST','',{...request,remindAt:'2026-10-24T08:00:00Z',expectedVersion:2}),api('boss','POST','',{...request,remindAt:'2026-10-24T08:30:00Z',expectedVersion:2})]);assert.deepEqual(r.map(x=>x.status).sort(),[200,409])});
let n=(await api('worker-a','GET')).data.items.find(x=>x.key==='task:task-a');
await check('Lecture enregistrée uniquement pour son propre suivi',async()=>{assert.equal((await api('worker-a','POST','/read',{key:n.key,revision:n.revision,read:true})).status,200);assert.ok((await api('worker-a','GET')).data.items.find(x=>x.key===n.key).readAt);assert.equal((await api('boss','GET')).data.items.find(x=>x.key===n.key).readAt,null)});
await check('Rejeu de lecture ne crée pas plusieurs accusés',async()=>{await api('worker-a','POST','/read',{key:n.key,revision:n.revision,read:true});assert.equal(db.prepare("SELECT COUNT(*) n FROM personal_notification_receipts WHERE user_id='worker-a'").get().n,1)});
await check('Marquer non lu reste personnel',async()=>{await api('worker-a','POST','/read',{key:n.key,revision:n.revision,read:false});assert.equal((await api('worker-a','GET')).data.items.find(x=>x.key===n.key).readAt,null)});
await check('Lecture d’un sujet invisible refusée',async()=>assert.equal((await api('worker-b','POST','/read',{key:n.key,revision:n.revision,read:true})).status,404));
await check('Lecture obsolète après nouvelle échéance refusée',async()=>{db.prepare("UPDATE project_tasks SET due_at='2026-10-27' WHERE id='task-a'").run();assert.equal((await api('worker-a','POST','/read',{key:n.key,revision:n.revision,read:true})).status,409)});
await check('Retrait de périmètre retire aussi le rappel privé du patron',async()=>{projectScopes.boss.delete('A');const r=await api('boss','GET');assert.equal(r.data.items.length,0);assert.equal(r.data.followups.length,0);projectScopes.boss.add('A')});
await check('Désattribution et perte de gestion retirent le droit à la source',async()=>{const r=await api({...contexts.boss,roleCode:'WORKER'},'GET');assert.equal(r.data.items.length,0);assert.equal(r.data.followups.length,0)});
await check('Choix des notifications limité aux lecteurs autorisés de la conversation',async()=>{const r=await api('boss','GET','/api/conversations/direct/notification-options');assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(r.data.recipients.map(r=>r.userId),['worker-a'])});
await check('Un ouvrier ne choisit pas les destinataires au nom du patron',async()=>assert.equal((await api('worker-a','GET','/api/conversations/direct/notification-options')).status,403));
await check('Une conversation extérieure ne révèle aucun membre',async()=>assert.equal((await api('boss','GET','/api/conversations/foreign-convo/notification-options')).status,404));
await check('Message envoyé sans demande ne notifie personne',async()=>assert.ok(!(await api('worker-a','GET')).data.items.some(x=>x.kind==='message')));
await check('Notification explicite à un destinataire du message',async()=>{const r=await api('boss','POST','/api/messages/message-direct/notify',{recipientUserIds:['worker-a']});assert.equal(r.status,200,JSON.stringify(r));assert.ok((await api('worker-a','GET')).data.items.some(x=>x.key==='message:message-direct'));assert.ok(!(await api('boss','GET')).data.items.some(x=>x.kind==='message'))});
await check('Rejeu de notification de message sans doublon',async()=>{const r=await api('boss','POST','/api/messages/message-direct/notify',{recipientUserIds:['worker-a']});assert.equal(r.data.replayed,true);assert.equal(db.prepare('SELECT COUNT(*) n FROM personal_message_notifications').get().n,1)});
await check('Un destinataire extérieur à la conversation ne reçoit rien',async()=>assert.equal((await api('boss','POST','/api/messages/message-direct/notify',{recipientUserIds:['worker-b']})).status,403));
await check('Destinataire étranger à l’entreprise refusé',async()=>assert.equal((await api('boss','POST','/api/messages/message-direct/notify',{recipientUserIds:['outsider']})).status,403));
await check('Validation de tous les destinataires avant une écriture',async()=>{const r=await api('boss','POST','/api/messages/message-project/notify',{recipientUserIds:['worker-a','worker-b']});assert.equal(r.status,403);assert.equal(db.prepare("SELECT COUNT(*) n FROM personal_message_notifications WHERE message_id='message-project'").get().n,0)});
await check('L’ouvrier ne notifie pas à la place du patron',async()=>assert.equal((await api('worker-a','POST','/api/messages/message-worker/notify',{recipientUserIds:['boss']})).status,403));
await check('Le patron ne notifie pas un message qu’il n’a pas envoyé',async()=>assert.equal((await api('boss','POST','/api/messages/message-worker/notify',{recipientUserIds:['worker-a']})).status,404));
await check('Message d’une autre entreprise refusé',async()=>assert.equal((await api('boss','POST','/api/messages/message-foreign/notify',{recipientUserIds:['worker-a']})).status,404));
await check('Perte du droit de messagerie retire la notification',async()=>{disabled.add('worker-a:messages.view');assert.ok(!(await api('worker-a','GET')).data.items.some(x=>x.kind==='message'));disabled.delete('worker-a:messages.view')});
await check('Annulation du rappel par l’autre patron refusée',async()=>assert.equal((await api('boss2','DELETE','/'+followupId,{expectedVersion:3})).status,404));
await check('Annulation avec version obsolète refusée',async()=>assert.equal((await api('boss','DELETE','/'+followupId,{expectedVersion:1})).status,409));
await check('Annulation personnelle supprime le rappel sans toucher la tâche',async()=>{const r=await api('boss','DELETE','/'+followupId,{expectedVersion:3});assert.equal(r.status,200);assert.equal((await api('boss','GET')).data.items.length,0);assert.equal(db.prepare("SELECT assigned_to FROM project_tasks WHERE id='task-a'").get().assigned_to,'worker-a')});
await check('Rejeu d’annulation sans doublon',async()=>assert.equal((await api('boss','DELETE','/'+followupId,{expectedVersion:3})).data.replayed,true));
await check('Rechargements répétés ne réarment pas les messages',async()=>{const a=(await api('worker-a','GET')).data,b=(await api('worker-a','GET')).data;assert.deepEqual(a,b);assert.equal(a.items.filter(x=>x.kind==='message').length,1)});
assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');db.close();console.log(JSON.stringify({status:'PASS',checks:checks.length,scenarios:checks},null,2));
