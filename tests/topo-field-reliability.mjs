import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {checkHealth} from '../scripts/health-probe.mjs';
let checks=0;const check=(value,message)=>{assert.ok(value,message);checks++};
for(const [status,body,expected] of [[200,'{"status":"ok"}',true],[503,'{"status":"ok"}',false],[200,'<html>login</html>',false],[200,'{"status":"stopping"}',false]]){
 check(await checkHealth(undefined,{fetchImpl:async()=>new Response(body,{status})})===expected,'health requires HTTP 200 and status ok');
}
check(await checkHealth('https://external.invalid/health',{fetchImpl:()=>{throw Error('must not fetch external')}})===false,'health probe restricted to loopback');
check(await checkHealth(undefined,{fetchImpl:async()=>{throw Error('offline')}})===false,'network failure unhealthy');
const source=await readFile(new URL('../web/field-portal.js',import.meta.url),'utf8');
const submit=source.slice(source.indexOf('const fieldPortalOperations='),source.indexOf('async function fieldPortalEditNote('));
const template=source.slice(source.indexOf('const fieldPreparationTemplates='));
let serial=0;
class Data{
 constructor(form){this.data=form.data}
 get(name){return this.data[name]??''}
 getAll(name){const item=this.data[name];return Array.isArray(item)?item:item?[item]:[]}
 *entries(){for(const [key,value] of Object.entries(this.data))if(Array.isArray(value)){for(const item of value)yield [key,item]}else yield [key,value]}
}
function setup(){
 const status={hidden:true,textContent:''},controls=[{disabled:false},{disabled:true}],dialog={open:true};
 const form={data:{projectId:'job-a',title:'Ma préparation',description:'Texte conservé',checklist:'Vérifier le stock',materials:'Ardoises',priority:'normal'},dataset:{},isConnected:true,querySelector:()=>status,querySelectorAll:()=>controls};
 const ctx=vm.createContext({Map,JSON,Array,Object,String,Error,Promise,Event,FormData:Data,fieldPortalActions:0,scope:'scope-a',fieldPortalState:new Map([['job-a',{scope:'scope-a',data:{capabilities:{manageTasks:true,createNotes:true,reportProblems:true}}}]]),fieldPortalScope:()=>ctx.scope,fieldPortalKey:kind=>kind+'-'+(++serial),document:{querySelector:()=>dialog,querySelectorAll:()=>[]},loadFieldPortal:async()=>{},fieldPortalUploadPhotos:async()=>[],toast:()=>{},closed:0,acknowledged:0,closeModal:()=>{ctx.closed++;dialog.open=false},sxAcknowledgeForm:()=>{ctx.acknowledged++}});
 vm.runInContext(submit,ctx);return {ctx,form,status,controls,dialog,event:{currentTarget:form,preventDefault(){}}};
}
let {ctx,form,status,controls,event}=setup();const sent=[];
ctx.serverJson=async(url,options)=>{sent.push(JSON.parse(options.body));throw Error('Échec simulé')};
await ctx.fieldPortalSubmitTask(event);
check(ctx.closed===0&&ctx.acknowledged===0,'failed task keeps form open and dirty');
check(form.data.description==='Texte conservé'&&status.textContent==='Échec simulé','failed task preserves content and displays error');
check(controls[0].disabled===false&&controls[1].disabled===true,'original control states restored');
ctx.serverJson=async(url,options)=>{sent.push(JSON.parse(options.body));return {task:{id:'task-a'}}};
await ctx.fieldPortalSubmitTask(event);
check(ctx.closed===1&&ctx.acknowledged===1,'successful task acknowledged before closing');
check(sent[0].operationKey===sent[1].operationKey,'retry preserves operation identity for unchanged form');
({ctx,form,status,event}=setup());
let release;ctx.serverJson=()=>new Promise(resolve=>release=resolve);
const pending=ctx.fieldPortalSubmitTask(event);
await Promise.resolve();form.isConnected=false;release({});
await pending;
check(ctx.closed===0&&ctx.acknowledged===0,'late success cannot close or acknowledge another form');
({ctx,form,event}=setup());ctx.scope='scope-b';let calls=0;ctx.serverJson=async()=>{calls++};
await ctx.fieldPortalSubmitTask(event);
check(calls===0&&ctx.closed===0,'stale access scope blocks write');
({ctx,form,event}=setup());let finish;calls=0;ctx.serverJson=()=>{calls++;return new Promise(resolve=>finish=resolve)};
const one=ctx.fieldPortalSubmitTask(event),two=ctx.fieldPortalSubmitTask(event);await Promise.resolve();finish({});await Promise.all([one,two]);
check(calls===1,'double submit sends one request');
const fields=Object.fromEntries(['title','description','checklist','materials'].map(name=>[name,{value:name==='title'?'Titre personnel':name==='checklist'?'Ma vérification':'',dispatchEvent(){},focus(){}}]));
const templateForm={elements:{namedItem:name=>fields[name]},querySelector:()=>({value:'toiture'})};
vm.runInContext(template,ctx);
ctx.applyFieldPreparationTemplate(templateForm);const firstChecklist=fields.checklist.value;
ctx.applyFieldPreparationTemplate(templateForm);
check(fields.title.value==='Titre personnel','template preserves custom title');
check(fields.checklist.value===firstChecklist&&firstChecklist.startsWith('Ma vérification'),'template appends without duplicates or replacing custom work');
check(fields.description.value.includes('à valider')&&fields.materials.value.includes('à confirmer'),'template leaves quantities and product decisions for review');
console.log(JSON.stringify({status:'PASS',checks,scope:'health truth, field form errors, scope, double submission, preparation templates'}));
