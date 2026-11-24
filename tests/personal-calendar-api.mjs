import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {personalCalendarRoute} from '../worker/personal-calendar.js';
const db=new DatabaseSync(':memory:');db.exec("PRAGMA foreign_keys=ON;CREATE TABLE organizations(id TEXT PRIMARY KEY);CREATE TABLE profiles(id TEXT PRIMARY KEY);CREATE TABLE messages(id TEXT PRIMARY KEY);INSERT INTO organizations VALUES('org'),('foreign');INSERT INTO profiles VALUES('boss'),('other-boss'),('worker');");db.exec(readFileSync(new URL('../drizzle/0066_personal_followup.sql',import.meta.url),'utf8'));
const env={DB:{prepare(sql){
 return {bind(...args){
  const s=db.prepare(sql);
  return {
   first:async()=>s.get(...args)||null,
   all:async()=>({results:s.all(...args)}),
   run:async()=>({meta:{changes:Number(s.run(...args).changes)}})
  };
 }};
}}};
const h={body:async r=>r.json(),json:(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}})};
const boss={uid:'boss',organizationId:'org',roleCode:'OWNER'};
async function api(method,path,data,ctx=boss){const url=new URL('https://test.invalid/api/me/calendar'+path),request=new Request(url,{method,...(data===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(data)})});try{const r=await personalCalendarRoute(request,url,env,ctx,h,url.pathname.split('/').slice(4).join('/')||null);return {status:r.status,data:await r.json()}}catch(e){return {status:e.status||500,error:e.message}}}
const checks=[];async function check(label,fn){await fn();checks.push(label)}
const appointment={title:'Rendez-vous privé',startsAt:'2026-10-25T01:30:00+02:00',endsAt:'2026-10-25T02:30:00+02:00',notes:'Note privée du patron',operationKey:'calendar-test-create'};let id;
await check('Création privée sans rappel implicite',async()=>{const r=await api('POST','',appointment);assert.equal(r.status,201,JSON.stringify(r));id=r.data.event.id;assert.equal(r.data.event.remindAt,null)});
await check('Fuseau explicite converti en instant UTC',async()=>assert.equal((await api('GET','/'+id)).data.event.startsAt,'2026-10-24T23:30:00.000Z'));
await check('Rejeu identique sans doublon',async()=>{const r=await api('POST','',appointment);assert.equal(r.status,200);assert.equal(r.data.event.id,id);assert.equal(r.data.replayed,true);assert.equal(db.prepare('SELECT COUNT(*) n FROM personal_calendar_events').get().n,1)});
await check('Même clé, contenu changé refusé',async()=>assert.equal((await api('POST','',{...appointment,title:'Autre rendez-vous'})).status,409));
await check('Liste limitée au propriétaire et à sa période',async()=>{const r=await api('GET','?from=2026-10-24T00:00:00Z&to=2026-10-27T00:00:00Z');assert.equal(r.status,200);assert.equal(r.data.events.length,1);assert.equal(r.data.events[0].notes,appointment.notes)});
await check('Autre patron de la même entreprise ne lit pas l’agenda privé',async()=>assert.equal((await api('GET','/'+id,undefined,{...boss,uid:'other-boss'})).status,404));
await check('Liste de l’autre patron vide',async()=>assert.equal((await api('GET','?from=2026-10-24T00:00:00Z&to=2026-10-27T00:00:00Z',undefined,{...boss,uid:'other-boss'})).data.events.length,0));
await check('Autre entreprise ne lit pas le rendez-vous',async()=>assert.equal((await api('GET','/'+id,undefined,{...boss,organizationId:'foreign'})).status,404));
await check('Ouvrier refusé sur le calendrier patron',async()=>assert.equal((await api('GET','/'+id,undefined,{...boss,uid:'worker',roleCode:'WORKER'})).status,403));
await check('Identité absente refusée',async()=>assert.equal((await api('GET','/'+id,undefined,{...boss,uid:null})).status,401));
await check('Aperçu interdit à l’écriture',async()=>assert.equal((await api('POST','',{...appointment,operationKey:'preview-test-key'},{...boss,preview:true})).status,403));
await check('Un client ne choisit pas le propriétaire de son rendez-vous',async()=>assert.equal((await api('POST','',{...appointment,userId:'other-boss'})).status,400));
await check('Date impossible refusée',async()=>assert.equal((await api('POST','',{...appointment,startsAt:'2026-02-30T10:00:00Z',operationKey:'impossible-date'})).status,400));
await check('Date sans fuseau refusée',async()=>assert.equal((await api('POST','',{...appointment,startsAt:'2026-10-25T01:30:00',operationKey:'missing-time-zone'})).status,400));
await check('Fin avant le début refusée',async()=>assert.equal((await api('POST','',{...appointment,endsAt:'2026-10-24T10:00:00Z',operationKey:'negative-duration'})).status,400));
await check('Rappel après le rendez-vous refusé',async()=>assert.equal((await api('POST','',{...appointment,remindAt:'2026-10-25T10:00:00Z',operationKey:'bad-reminder-time'})).status,400));
await check('Période trop large refusée',async()=>assert.equal((await api('GET','?from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z')).status,400));
await check('Modification privée et rappel choisi persistants',async()=>{const r=await api('PATCH','/'+id,{title:'Visite client',remindAt:'2026-10-24T22:30:00Z',expectedVersion:1});assert.equal(r.status,200);assert.equal(r.data.event.version,2);assert.equal(r.data.event.remindAt,'2026-10-24T22:30:00.000Z')});
await check('Onglet obsolète ne remplace pas une modification',async()=>assert.equal((await api('PATCH','/'+id,{title:'Ancien onglet',expectedVersion:1})).status,409));
await check('Autre patron ne modifie pas le rendez-vous',async()=>assert.equal((await api('PATCH','/'+id,{title:'Intrusion',expectedVersion:2},{...boss,uid:'other-boss'})).status,404));
await check('Deux versions simultanées ne passent pas ensemble',async()=>{const replies=await Promise.all([api('PATCH','/'+id,{notes:'Version A',expectedVersion:2}),api('PATCH','/'+id,{notes:'Version B',expectedVersion:2})]);assert.deepEqual(replies.map(r=>r.status).sort(),[200,409])});
await check('Suppression avec version obsolète refusée',async()=>assert.equal((await api('DELETE','/'+id,{expectedVersion:2})).status,409));
await check('Annulation personnelle et retrait de la liste',async()=>{const r=await api('DELETE','/'+id,{expectedVersion:3});assert.equal(r.status,200);assert.ok(r.data.event.cancelledAt);assert.equal((await api('GET','?from=2026-10-24T00:00:00Z&to=2026-10-27T00:00:00Z')).data.events.length,0)});
await check('Rejeu d’annulation sans seconde suppression',async()=>{const r=await api('DELETE','/'+id,{expectedVersion:3});assert.equal(r.status,200);assert.equal(r.data.replayed,true)});
await check('Rendez-vous annulé non modifiable',async()=>assert.equal((await api('PATCH','/'+id,{title:'Réouvrir silencieusement',expectedVersion:4})).status,409));
assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');db.close();console.log(JSON.stringify({status:'PASS',checks:checks.length,scenarios:checks},null,2));
