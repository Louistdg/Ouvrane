import {requireCommercialVisitScope} from './commercial-scope.js';
import {calculatePlanPage} from './plan-geometry.js';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const key=data=>{if(!/^[A-Za-z0-9._:-]{8,120}$/.test(String(data.operationKey||'')))fail('Clé d’enregistrement invalide.');return data.operationKey};
const snapshot=row=>({id:row.id,planVersionId:row.plan_version_id,pageNumber:row.page_number,version:row.version,input:JSON.parse(row.input_json),result:JSON.parse(row.result_json),createdAt:row.created_at});
export async function planScope(env,ctx,plan,h){
 await h.requirePermission(env,ctx,'documents.secure.manage');
 if(plan.visit_id){await h.requirePermission(env,ctx,'quotes.view');const visit=await env.DB.prepare('SELECT quote_id FROM quote_site_visits WHERE organization_id=? AND id=?').bind(ctx.organizationId,plan.visit_id).first();if(!visit)fail('Visite introuvable.',404);await requireCommercialVisitScope(env,ctx,visit,h)}
 if(plan.project_id)await h.relationExists(env,ctx,'project',plan.project_id);
}
export async function planDocumentAllowed(env,ctx,documentId,h){
 const plans=(await env.DB.prepare('SELECT DISTINCT p.* FROM plan_sets p JOIN plan_file_versions v ON v.organization_id=p.organization_id AND v.plan_id=p.id WHERE v.organization_id=? AND v.document_id=?').bind(ctx.organizationId,documentId).all()).results;
 if(!plans.length)return null;try{for(const plan of plans)await planScope(env,ctx,plan,h);return true}catch(e){if([403,404].includes(e.status))return false;throw e}
}
async function document(env,ctx,id,h){const d=await env.DB.prepare("SELECT * FROM secure_documents WHERE organization_id=? AND id=? AND status='available' AND archived_at IS NULL AND content_type='application/pdf'").bind(ctx.organizationId,String(id||'')).first();if(!d||!d.checksum_sha256)fail('PDF privé disponible requis.',404);await h.requireDocumentView(env,ctx,d);return d}
async function getPlan(env,ctx,id,h){const p=await env.DB.prepare('SELECT * FROM plan_sets WHERE organization_id=? AND id=?').bind(ctx.organizationId,id).first();if(!p)fail('Plan introuvable.',404);await planScope(env,ctx,p,h);const current=await env.DB.prepare('SELECT d.* FROM plan_file_versions v JOIN secure_documents d ON d.organization_id=v.organization_id AND d.id=v.document_id WHERE v.organization_id=? AND v.plan_id=? ORDER BY v.version DESC LIMIT 1').bind(ctx.organizationId,p.id).first();if(current)await h.requireDocumentView(env,ctx,current);return p}
export async function planSourcesForMeasurement(env,ctx,visit,input,h){
 if(input.planSources===undefined)return null;
 if(!Array.isArray(input.planes))fail('Versants invalides.');
 if(!Array.isArray(input.planSources)||!input.planSources.length||input.planSources.length>20)fail('Sources de plan invalides.');
 const links=[],targets=new Set();
 for(const source of input.planSources){
  if(!source||!Number.isInteger(source.planeIndex)||source.planeIndex<0||source.planeIndex>=input.planes.length||!input.planes[source.planeIndex]||typeof input.planes[source.planeIndex]!=='object'||Array.isArray(input.planes[source.planeIndex])||!['eaveLengthM','developedSlopeM','openingsM2'].includes(source.field))fail('Destination de la mesure invalide.');
  if(source.field==='developedSlopeM'&&source.developedSlopeConfirmed!==true)fail('Confirmez que la cote est développée sur le rampant, et non projetée.');
  const target=source.planeIndex+':'+source.field;if(targets.has(target))fail('Deux mesures ciblent le même champ.');targets.add(target);
  const row=await env.DB.prepare('SELECT * FROM plan_annotation_snapshots WHERE organization_id=? AND id=?').bind(ctx.organizationId,String(source.snapshotId||'')).first();if(!row)fail('Mesure de plan introuvable.',404);
  const v=await env.DB.prepare('SELECT * FROM plan_file_versions WHERE organization_id=? AND id=?').bind(ctx.organizationId,row.plan_version_id).first(),p=await getPlan(env,ctx,v.plan_id,h);
  const quote=visit.quote_id?await env.DB.prepare('SELECT project_id FROM quotes_server WHERE organization_id=? AND id=?').bind(ctx.organizationId,visit.quote_id).first():null;
  let sourceProject=p.project_id;if(p.visit_id&&p.visit_id!==visit.id){const originVisit=await env.DB.prepare('SELECT q.project_id FROM quote_site_visits v JOIN quotes_server q ON q.organization_id=v.organization_id AND q.id=v.quote_id WHERE v.organization_id=? AND v.id=?').bind(ctx.organizationId,p.visit_id).first();sourceProject=originVisit?.project_id}if(p.visit_id!==visit.id&&(!sourceProject||!quote?.project_id||quote.project_id!==sourceProject))fail('Ce plan ne concerne pas cette visite.',404);
  await document(env,ctx,v.document_id,h);const pageHead=await env.DB.prepare('SELECT MAX(version) version FROM plan_annotation_snapshots WHERE organization_id=? AND plan_version_id=? AND page_number=?').bind(ctx.organizationId,v.id,row.page_number).first();if(row.version!==pageHead.version)fail('Les annotations de cette page ont changé. Vérifiez la mesure.',409);const latest=await env.DB.prepare('SELECT MAX(version) version FROM plan_file_versions WHERE organization_id=? AND plan_id=?').bind(ctx.organizationId,p.id).first();if(v.version!==latest.version)fail('Une nouvelle révision du plan existe. Vérifiez ses mesures.',409);
  const measure=JSON.parse(row.result_json).annotations.find(a=>a.id===source.annotationId),area=source.field==='openingsM2';if(!measure||!measure.quantity||(area?!['area','opening'].includes(measure.kind):measure.kind!=='length'))fail('Mesure incompatible avec ce champ.');
  input.planes[source.planeIndex][source.field]=measure.quantity;
  links.push({snapshotId:row.id,annotationId:measure.id,planeIndex:source.planeIndex,field:source.field,developedSlopeConfirmed:source.field==='developedSlopeM',planId:p.id,planVersion:v.version,documentId:v.document_id,checksum:v.checksum_sha256,pageNumber:row.page_number,annotationVersion:row.version,label:measure.label,quantity:measure.quantity,unit:measure.unit});
 }
 input.planSources=links;return links;
}
export async function plansRoute(request,url,env,ctx,planId,action,h){
 await h.requirePermission(env,ctx,'documents.secure.manage');
 const p=planId?await getPlan(env,ctx,planId,h):null;
 if(request.method==='GET'){
  if(p){let versions=(await env.DB.prepare('SELECT v.*,d.original_name,d.status,d.archived_at FROM plan_file_versions v JOIN secure_documents d ON d.organization_id=v.organization_id AND d.id=v.document_id WHERE v.organization_id=? AND v.plan_id=? ORDER BY v.version DESC').bind(ctx.organizationId,p.id).all()).results;const permitted=[];for(const version of versions){const d=await env.DB.prepare('SELECT * FROM secure_documents WHERE organization_id=? AND id=?').bind(ctx.organizationId,version.document_id).first();try{await h.requireDocumentView(env,ctx,d);permitted.push(version)}catch(e){if(![403,404].includes(e.status))throw e}}versions=permitted;const visibleVersionIds=new Set(versions.map(v=>v.id));
   const annotations=(await env.DB.prepare('SELECT a.* FROM plan_annotation_snapshots a JOIN plan_file_versions v ON v.organization_id=a.organization_id AND v.id=a.plan_version_id WHERE a.organization_id=? AND v.plan_id=? ORDER BY a.created_at DESC,a.version DESC').bind(ctx.organizationId,p.id).all()).results;return h.json({plan:{id:p.id,title:p.title,visitId:p.visit_id,projectId:p.project_id},versions:versions.map(v=>({id:v.id,version:v.version,documentId:v.document_id,checksum:v.checksum_sha256,changeNote:v.change_note,filename:v.original_name,status:v.status,archived:!!v.archived_at,createdAt:v.created_at})),annotations:annotations.filter(a=>visibleVersionIds.has(a.plan_version_id)).map(snapshot)})}
  const visitId=url.searchParams.get('visitId'),projectId=url.searchParams.get('projectId');if(!visitId&&!projectId)fail('Visite ou chantier obligatoire.');
  await planScope(env,ctx,{visit_id:visitId,project_id:projectId},h);
  let relatedProject=projectId;if(visitId){const q=await env.DB.prepare('SELECT q.project_id FROM quote_site_visits v JOIN quotes_server q ON q.organization_id=v.organization_id AND q.id=v.quote_id WHERE v.organization_id=? AND v.id=?').bind(ctx.organizationId,visitId).first();relatedProject=q?.project_id||null}
  const rows=(await env.DB.prepare('SELECT DISTINCT p.* FROM plan_sets p LEFT JOIN quote_site_visits v ON v.organization_id=p.organization_id AND v.id=p.visit_id LEFT JOIN quotes_server q ON q.organization_id=v.organization_id AND q.id=v.quote_id WHERE p.organization_id=? AND (p.visit_id=? OR p.project_id=? OR (? IS NOT NULL AND q.project_id=?)) ORDER BY p.created_at DESC').bind(ctx.organizationId,visitId,relatedProject,projectId,projectId).all()).results,visible=[];
  for(const row of rows){try{await getPlan(env,ctx,row.id,h);visible.push({id:row.id,title:row.title,visitId:row.visit_id,projectId:row.project_id})}catch(e){if(![403,404].includes(e.status))throw e}}
  return h.json({plans:visible});
 }
 if(request.method!=='POST')return h.json({error:'Méthode non autorisée.'},405);
 const data=await h.body(request,200000),op=key(data),stamp=new Date().toISOString();
 if(action==='annotations'&&p){
  const v=await env.DB.prepare('SELECT * FROM plan_file_versions WHERE organization_id=? AND plan_id=? AND id=?').bind(ctx.organizationId,p.id,String(data.planVersionId||'')).first();if(!v)fail('Révision introuvable.',404);await document(env,ctx,v.document_id,h);
  const calculated=calculatePlanPage(data),inputJson=JSON.stringify(calculated.input),resultJson=JSON.stringify(calculated.result);
  const old=await env.DB.prepare('SELECT * FROM plan_annotation_snapshots WHERE organization_id=? AND operation_key=?').bind(ctx.organizationId,op).first();if(old){if(old.plan_version_id!==v.id||old.input_json!==inputJson)fail('Cette clé correspond à une autre annotation.',409);return h.json({snapshot:snapshot(old),replayed:true})}
  const fileHead=await env.DB.prepare('SELECT MAX(version) version FROM plan_file_versions WHERE organization_id=? AND plan_id=?').bind(ctx.organizationId,p.id).first();if(v.version!==fileHead.version)fail('Cette révision du plan est historique. Annotez la révision courante.',409);
  const head=await env.DB.prepare('SELECT MAX(version) version FROM plan_annotation_snapshots WHERE organization_id=? AND plan_version_id=? AND page_number=?').bind(ctx.organizationId,v.id,data.pageNumber).first();const version=Number(head.version||0)+1;if(data.expectedVersion!==version-1)fail('Cette page a été modifiée. Rechargez ses annotations.',409);
  const id='plan-note-'+crypto.randomUUID();try{await h.dbBatch(env,[env.DB.prepare('INSERT INTO plan_annotation_snapshots VALUES(?,?,?,?,?,?,?,?,?,?)').bind(ctx.organizationId,id,v.id,data.pageNumber,version,inputJson,resultJson,op,ctx.uid,stamp),h.auditStatement(env,ctx,'plan.annotated','plan',p.id,{plan_version_id:v.id,page:data.pageNumber,version})])}catch(e){if(String(e).includes('UNIQUE constraint')||String(e).includes('plan_document_unavailable'))fail('Le plan ou son document a changé. Rechargez.',409);throw e}
  return h.json({snapshot:snapshot(await env.DB.prepare('SELECT * FROM plan_annotation_snapshots WHERE organization_id=? AND id=?').bind(ctx.organizationId,id).first())},201);
 }
 if(action&&action!=='versions')return h.json({error:'Action inconnue.'},404);
 const d=await document(env,ctx,data.documentId,h),note=String(data.changeNote||'').trim();if(!note||note.length>500)fail('Indiquez le motif de cette révision (500 caractères maximum).');
 let plan=p,version=1,statements=[];
 if(!plan){
  const title=String(data.title||'').trim();if(!title||title.length>180)fail('Titre du plan obligatoire.');const visitId=data.visitId?String(data.visitId):null,projectId=data.projectId?String(data.projectId):null;if(!visitId&&!projectId)fail('Visite ou chantier obligatoire.');if(visitId&&projectId)fail('Choisissez une visite ou un chantier ; le devis relie ensuite les deux.');
  await planScope(env,ctx,{visit_id:visitId,project_id:projectId},h);if(visitId)await h.requireQuoteVisitWrite(env,ctx);
  const old=await env.DB.prepare('SELECT * FROM plan_sets WHERE organization_id=? AND operation_key=?').bind(ctx.organizationId,op).first();if(old){const first=await env.DB.prepare('SELECT * FROM plan_file_versions WHERE organization_id=? AND plan_id=? AND version=1').bind(ctx.organizationId,old.id).first();if(old.title!==title||old.visit_id!==visitId||old.project_id!==projectId||first.document_id!==d.id||first.change_note!==note)fail('Cette clé correspond à un autre plan.',409);return h.json({id:old.id,versionId:first.id,version:1,replayed:true})}
  plan={id:'plan-'+crypto.randomUUID()};statements.push(env.DB.prepare('INSERT INTO plan_sets VALUES(?,?,?,?,?,?,?,?)').bind(ctx.organizationId,plan.id,visitId,projectId,title,op,ctx.uid,stamp));
 }else{
  const old=await env.DB.prepare('SELECT * FROM plan_file_versions WHERE organization_id=? AND operation_key=?').bind(ctx.organizationId,op).first();if(old){if(old.plan_id!==plan.id||old.document_id!==d.id||old.change_note!==note)fail('Cette clé correspond à une autre révision.',409);return h.json({id:plan.id,versionId:old.id,version:old.version,replayed:true})}
  const head=await env.DB.prepare('SELECT MAX(version) version FROM plan_file_versions WHERE organization_id=? AND plan_id=?').bind(ctx.organizationId,plan.id).first();version=Number(head.version||0)+1;if(data.expectedVersion!==version-1)fail('Une nouvelle révision existe. Rechargez le plan.',409);
 }
 const id='plan-file-'+crypto.randomUUID();statements.push(env.DB.prepare('INSERT INTO plan_file_versions VALUES(?,?,?,?,?,?,?,?,?,?)').bind(ctx.organizationId,id,plan.id,version,d.id,d.checksum_sha256,note,op,ctx.uid,stamp),h.auditStatement(env,ctx,'plan.version.created','plan',plan.id,{version,document_id:d.id,checksum:d.checksum_sha256}));
 try{await h.dbBatch(env,statements)}catch(e){if(String(e).includes('UNIQUE constraint')||String(e).includes('plan_document_unavailable'))fail('Le plan ou son document a changé. Rechargez.',409);throw e}
 return h.json({id:plan.id,versionId:id,version},201);
}
