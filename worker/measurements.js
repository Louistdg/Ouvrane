import {requireCommercialVisitScope} from './commercial-scope.js';
import {planSourcesForMeasurement} from './plans.js';
import {estimate,Big} from './measurement-engine.js';
const labels={SLATE_PIECES:'Ardoises',UNDERLAY:'Sous-toiture',BATTENS:'Liteaux',COUNTER_BATTENS:'Contre-liteaux',GUTTERS:'Gouttières',FLASHINGS:'Solins et raccords'};
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const payload=row=>({id:row.id,visitId:row.visit_id,version:row.version,input:JSON.parse(row.input_json),result:JSON.parse(row.result_json),sourceLabel:row.source_label,sourceDocumentId:row.source_document_id,createdAt:row.created_at});
function decimal(value,name,{positive=false}={}){
 if(!/^(?:0|[1-9]\d*)(?:\.\d{1,5})?$/.test(String(value))||new Big(value).gt(1000000)||(positive&&new Big(value).lte(0)))fail(name+' : nombre décimal invalide.');
 return new Big(value);
}
export function materialNeeds(result,packages={}){
 if(!packages||typeof packages!=='object'||Array.isArray(packages))fail('Conditionnements invalides.');
 if(Object.keys(packages).some(code=>!result.items.some(x=>x.code===code)))fail('Article inconnu dans les conditionnements.');
 return result.items.filter(x=>new Big(x.quantity).gt(0)).map(item=>{
  const size=decimal(packages[item.code]??'1','Conditionnement',{positive:true});
  const count=new Big(item.quantity).div(size).round(0,Big.roundUp);
  return {code:item.code,label:labels[item.code],unit:item.unit,requiredQuantity:item.quantity,packageSize:size.toString(),packages:count.toString(),orderedQuantity:count.times(size).toString()};
 });
}
export async function measurementRoute(request,url,env,ctx,measurementId,h){
 const {json,body,requirePermission,requireQuotePriceRead,requireQuoteVisitWrite,requireFinanceProjectScope,dbBatch,auditStatement}=h;
 await requirePermission(env,ctx,'quotes.view');await requireQuotePriceRead(env,ctx);
 async function visitScope(visitId){
  const visit=await env.DB.prepare('SELECT * FROM quote_site_visits WHERE organization_id=? AND id=?').bind(ctx.organizationId,visitId).first();
  if(!visit)fail('Visite introuvable.',404);
  await requireCommercialVisitScope(env,ctx,visit,h);
  return visit;
 }
 const old=measurementId?await env.DB.prepare('SELECT * FROM measurement_snapshots WHERE organization_id=? AND id=?').bind(ctx.organizationId,measurementId).first():null;
 if(measurementId&&!old)fail('Métré introuvable.',404);
 if(request.method==='GET'){
  if(old){await visitScope(old.visit_id);return json({measurement:payload(old)})}
  const visitId=url.searchParams.get('visitId');if(!visitId)fail('Visite obligatoire.');await visitScope(visitId);
  const rows=await env.DB.prepare('SELECT * FROM measurement_snapshots WHERE organization_id=? AND visit_id=? ORDER BY version DESC').bind(ctx.organizationId,visitId).all();
  return json({measurements:rows.results.map(payload)});
 }
 if(request.method!=='POST')return json({error:'Méthode non autorisée.'},405);
 await requireQuoteVisitWrite(env,ctx);
 const data=await body(request,100000);
 if(old){
  await requirePermission(env,ctx,'quotes.edit');const visit=await visitScope(old.visit_id);
  const quote=await env.DB.prepare('SELECT * FROM quotes_server WHERE organization_id=? AND id=? AND archived_at IS NULL').bind(ctx.organizationId,String(data.quoteId||'')).first();
  if(!quote)fail('Devis introuvable.',404);
  if(quote.project_id)await requireFinanceProjectScope(env,ctx,quote.project_id);
  if(visit.quote_id!==quote.id)fail('Rattachez d’abord la visite à ce devis.',409);
  const previous=await env.DB.prepare('SELECT 1 ok FROM measurement_quote_links WHERE organization_id=? AND measurement_id=? AND quote_id=?').bind(ctx.organizationId,old.id,quote.id).first();
  if(previous)return json({applied:true,replayed:true,quoteId:quote.id});
  if(quote.status!=='draft')fail('Seul un devis brouillon peut recevoir ce métré.',409);
  if(data.expectedLinesJson!==quote.lines_json)fail('Le devis a changé. Rechargez son aperçu.',409);
  const record=payload(old),vat=record.input.vatRate;
  if(![0,6,12,21].includes(vat))fail('Choisissez explicitement la TVA avant de chiffrer.');
  if(!record.result.pricingComplete)fail('Complétez tous les prix du métré avant transfert.');
  const added=record.result.items.filter(x=>new Big(x.quantity).gt(0)).map(x=>({label:labels[x.code],description:`Métré ${old.id} · version ${old.version} · ${old.source_label}`,qty:Number(x.quantity),unit:x.unit,price:Number(x.unitPrice),vat}));
  const lines=JSON.parse(quote.lines_json);if(lines.length+added.length>500)fail('Trop de lignes de devis.');
  const stamp=new Date().toISOString();
  try{await dbBatch(env,[env.DB.prepare('INSERT INTO measurement_quote_links(organization_id,measurement_id,quote_id,expected_lines_json,added_lines_json,new_lines_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(ctx.organizationId,old.id,quote.id,quote.lines_json,JSON.stringify(added),JSON.stringify([...lines,...added]),ctx.uid,stamp),auditStatement(env,ctx,'measurement.applied','quote',quote.id,{measurement_id:old.id,version:old.version})])}
  catch(e){if(String(e).includes('measurement_quote_stale')||String(e).includes('UNIQUE constraint'))fail('Ce devis a changé ou le métré a déjà été ajouté. Rechargez.',409);throw e}
  return json({applied:true,quoteId:quote.id,addedLines:added.length});
 }
 const visit=await visitScope(String(data.visitId||''));
 const source=String(data.sourceLabel||'').trim();if(!source||source.length>200)fail('Indiquez une origine du relevé (200 caractères maximum).');
 if(!/^[A-Za-z0-9._:-]{8,120}$/.test(String(data.operationKey||'')))fail('Clé d’enregistrement invalide.');
 const input=data.input;if(!input||typeof input!=='object'||Array.isArray(input))fail('Mesures obligatoires.');
 const requestJson=JSON.stringify(input);
 const previous=await env.DB.prepare('SELECT * FROM measurement_snapshots WHERE organization_id=? AND operation_key=?').bind(ctx.organizationId,data.operationKey).first();
 if(previous){if(previous.visit_id!==visit.id||(previous.request_json??previous.input_json)!==requestJson||previous.source_label!==source||String(previous.source_document_id||'')!==String(data.sourceDocumentId||''))fail('Cette clé correspond à un autre métré.',409);return json({measurement:payload(previous),replayed:true})}
 if(data.sourceDocumentId){const doc=await env.DB.prepare("SELECT 1 ok FROM quote_site_visit_documents v JOIN secure_documents d ON d.id=v.document_id AND d.organization_id=v.organization_id WHERE v.organization_id=? AND v.visit_id=? AND v.document_id=? AND d.archived_at IS NULL AND d.status='available'").bind(ctx.organizationId,visit.id,String(data.sourceDocumentId)).first();if(!doc)fail('Document source indisponible dans cette visite.',404)}
 if(![null,undefined,0,6,12,21].includes(input.vatRate))fail('TVA invalide.');
 await planSourcesForMeasurement(env,ctx,visit,input,h);
 let result;try{result=estimate(input)}catch(e){fail(e.message)}
 result.materialNeeds=materialNeeds(result,input.packages||{});
 const inputJson=JSON.stringify(input);
 const head=await env.DB.prepare('SELECT MAX(version) version FROM measurement_snapshots WHERE organization_id=? AND visit_id=?').bind(ctx.organizationId,visit.id).first();
 const version=Number(head?.version||0)+1;
 if(Number(data.expectedVersion)!==version-1)fail('Une nouvelle version existe. Rechargez le métré.',409);
 const id='metre-'+crypto.randomUUID(),stamp=new Date().toISOString();
 try{await dbBatch(env,[env.DB.prepare('INSERT INTO measurement_snapshots(organization_id,id,visit_id,version,operation_key,input_json,result_json,source_label,source_document_id,created_by,created_at,request_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(ctx.organizationId,id,visit.id,version,data.operationKey,inputJson,JSON.stringify(result),source,data.sourceDocumentId||null,ctx.uid,stamp,requestJson),auditStatement(env,ctx,'measurement.created','measurement',id,{visit_id:visit.id,version})])}
 catch(e){if(String(e).includes('UNIQUE constraint')||String(e).includes('measurement_plan_stale'))fail('Une version concurrente du métré ou du plan existe. Rechargez.',409);throw e}
 return json({measurement:payload(await env.DB.prepare('SELECT * FROM measurement_snapshots WHERE organization_id=? AND id=?').bind(ctx.organizationId,id).first())},201);
}
