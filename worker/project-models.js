import {inspectModelGlb} from './model-glb.js';
export const MODEL_LIMITS=Object.freeze({maxSourceBytes:1800000,maxPreviewBytes:8388608,maxMetadataBytes:524288,maxOrganizationBytes:67108864,maxModelsPerProject:32,maxVersions:50,chunkBytes:262144,formats:['IFC4']});
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const all=async statement=>(await statement.all()).results||[];
const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))].map(x=>x.toString(16).padStart(2,'0')).join('');
const uid=prefix=>prefix+'-'+crypto.randomUUID();
const key=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9:_-]{12,160}$/.test(value))fail('Clé d’opération du modèle invalide.');return value;};
function decodedHeader(request,name,max){let value;try{value=decodeURIComponent(request.headers.get(name)||'');}catch{fail('Nom ou titre du modèle invalide.');}if(!value||value!==value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))fail('Nom ou titre du modèle invalide.');return value;}
const numberHeader=request=>{const raw=request.headers.get('x-model-expected-version');if(raw===null||!/^\d{1,2}$/.test(raw))fail('Version attendue obligatoire.');return Number(raw);};

// Same project scope as the application, re-evaluated against current membership.
// No cached OWNER/permission snapshot survives conversion or byte retrieval.
function accessSql(write=false){return `EXISTS(SELECT 1 FROM organization_members m JOIN roles r ON r.id=m.role_id AND r.organization_id=m.organization_id
 WHERE m.organization_id=? AND m.user_id=? AND m.status='active'
 AND (r.code='OWNER' OR EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.role_id=m.role_id AND rp.permission_code='documents.secure.view'))
 ${write?"AND (r.code='OWNER' OR EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.role_id=m.role_id AND rp.permission_code='documents.secure.manage'))":''}
 AND (r.code='OWNER' OR EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.role_id=m.role_id AND rp.permission_code='projects.view.all') OR (EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.role_id=m.role_id AND rp.permission_code='projects.view.assigned') AND EXISTS(SELECT 1 FROM project_access pa WHERE pa.organization_id=m.organization_id AND pa.user_id=m.user_id AND pa.project_id=?)))
 AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.organization_id=m.organization_id AND p.id=? AND p.archived_at IS NOT NULL)
 AND (EXISTS(SELECT 1 FROM projects p WHERE p.organization_id=m.organization_id AND p.id=? AND p.archived_at IS NULL) OR EXISTS(SELECT 1 FROM organization_workspace_state ws,json_each(ws.payload,'$.jobs') j WHERE ws.organization_id=m.organization_id AND CAST(json_extract(j.value,'$.id') AS TEXT)=? AND COALESCE(json_extract(j.value,'$.archived'),0)=0 AND json_extract(j.value,'$.archived_at') IS NULL)))`;}
const accessValues=(ctx,projectId)=>[ctx.organizationId,ctx.uid,projectId,projectId,projectId,projectId];
async function authorize(env,ctx,projectId,write=false){
 if(!projectId||String(projectId).length>200)fail('Chantier obligatoire.');
 if(write&&ctx.preview)fail('La prévisualisation des droits est en lecture seule.',403);
 const row=await env.DB.prepare('SELECT '+accessSql(write)+' ok').bind(...accessValues(ctx,projectId)).first();if(!row?.ok)fail('Modèle ou chantier inaccessible.',404);
 const manage=write||!ctx.preview&&Boolean((await env.DB.prepare('SELECT '+accessSql(true)+' ok').bind(...accessValues(ctx,projectId)).first())?.ok);
 return {canManage:manage};
}
async function model(env,ctx,id,write=false){const row=await env.DB.prepare('SELECT * FROM project_models WHERE organization_id=? AND id=? AND archived_at IS NULL').bind(ctx.organizationId,id).first();if(!row)fail('Modèle introuvable.',404);const access=await authorize(env,ctx,row.project_id,write);return {row,...access};}
function modelJson(row){return {id:row.id,projectId:row.project_id,title:row.title,latestVersion:Number(row.latest_version),createdAt:row.created_at};}
function versionJson(row){const m=JSON.parse(row.metadata_json);return {id:row.id,version:Number(row.version),filename:row.filename,sourceBytes:Number(row.source_bytes),previewBytes:Number(row.preview_bytes),sourceSha256:row.source_sha256,previewSha256:row.preview_sha256,createdAt:row.created_at,createdBy:row.created_by,schema:'IFC4',objectCount:m.objectCount,dimensions:m.dimensions};}
async function sourceBytes(request){
 const declared=request.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MODEL_LIMITS.maxSourceBytes)){await request.body?.cancel().catch(()=>{});fail('Le fichier IFC dépasse la limite de 1 800 000 octets.',413);}
 if(!request.body)fail('Fichier IFC manquant.');const reader=request.body.getReader(),chunks=[];let total=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>MODEL_LIMITS.maxSourceBytes){await reader.cancel().catch(()=>{});fail('Le fichier IFC dépasse la limite de 1 800 000 octets.',413);}chunks.push(value);}}finally{reader.releaseLock();}
 if(!total)fail('Fichier IFC vide.');const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}return bytes;
}
function guard(env,ctx,projectId,id,condition='1',values=[]){return env.DB.prepare('INSERT INTO project_model_guards(id,valid) VALUES(?,CASE WHEN '+accessSql(true)+' AND ('+condition+') THEN 1 ELSE 0 END)').bind(id,...accessValues(ctx,projectId),...values);}
const drop=(env,id)=>env.DB.prepare('DELETE FROM project_model_guards WHERE id=?').bind(id);
const chunks=(env,ctx,versionId,kind,bytes)=>{const statements=[];for(let offset=0,index=0;offset<bytes.byteLength;offset+=MODEL_LIMITS.chunkBytes,index++)statements.push(env.DB.prepare('INSERT INTO project_model_chunks(organization_id,version_id,kind,chunk_index,content) VALUES(?,?,?,?,?)').bind(ctx.organizationId,versionId,kind,index,bytes.slice(offset,offset+MODEL_LIMITS.chunkBytes)));return statements;};
function privateHeaders(type,filename){const h={'content-type':type,'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','cross-origin-resource-policy':'same-origin','content-security-policy':"default-src 'none'; sandbox"};if(filename)h['content-disposition']="attachment; filename*=UTF-8''"+encodeURIComponent(filename);return h;}
async function artifact(request,env,ctx,id,versionId,kind){
 const {row}=await model(env,ctx,id);const v=await env.DB.prepare('SELECT * FROM project_model_versions WHERE organization_id=? AND id=? AND model_id=?').bind(ctx.organizationId,versionId,id).first();if(!v)fail('Révision introuvable.',404);
 if(kind==='metadata'){await model(env,ctx,id);return new Response(request.method==='HEAD'?null:v.metadata_json,{headers:privateHeaders('application/json;charset=utf-8')});}
 const stored=await all(env.DB.prepare('SELECT chunk_index,content FROM project_model_chunks WHERE organization_id=? AND version_id=? AND kind=? ORDER BY chunk_index').bind(ctx.organizationId,versionId,kind));
 const expected=kind==='source'?Number(v.source_bytes):Number(v.preview_bytes),result=new Uint8Array(expected);let offset=0;
 for(let i=0;i<stored.length;i++){const bytes=stored[i].content instanceof ArrayBuffer?new Uint8Array(stored[i].content):new Uint8Array(stored[i].content.buffer,stored[i].content.byteOffset,stored[i].content.byteLength);if(Number(stored[i].chunk_index)!==i||offset+bytes.length>expected)fail('Le fichier stocké est incomplet. Aucun aperçu chargé.',409);result.set(bytes,offset);offset+=bytes.length;}
 if(offset!==expected||await sha(result)!==(kind==='source'?v.source_sha256:v.preview_sha256))fail('L’empreinte du fichier stocké est invalide. Aucun aperçu chargé.',409);
 await model(env,ctx,id); // Revocation/archive during DB reads or SHA is effective before response.
 const headers=privateHeaders(kind==='source'?'application/x-step':'model/gltf-binary',kind==='source'?v.filename:null);headers['content-length']=String(result.byteLength);
 return new Response(request.method==='HEAD'?null:result,{headers});
}
async function upload(request,env,ctx,h,id){
 const existing=id?await model(env,ctx,id,true):null,projectId=String(request.headers.get('x-model-project-id')||existing?.row.project_id||'');await authorize(env,ctx,projectId,true);
 if(existing&&existing.row.project_id!==projectId)fail('Une révision ne peut pas changer de chantier.',409);
 if((request.headers.get('content-type')||'').split(';')[0].trim()!=='application/x-step')fail('Envoyez un fichier IFC brut.',415);
 const filename=decodedHeader(request,'x-model-filename',180),title=decodedHeader(request,'x-model-title',180),expected=numberHeader(request),operation=key(request.headers.get('x-model-operation-key'));
 if(!/\.ifc$/i.test(filename)||/[\\/]/.test(filename)||existing&&title!==existing.row.title)fail('Nom IFC ou titre de révision invalide.');
 const source=await sourceBytes(request),sourceHash=await sha(source),head=new TextDecoder().decode(source.subarray(0,65536));
 if(!head.startsWith('ISO-10303-21;')||!new RegExp("FILE_SCHEMA\\s*\\(\\s*\\(\\s*'IFC4'\\s*\\)\\s*\\)",'i').test(head))fail('Seuls les fichiers IFC4 STEP sont admis dans ce premier import.',422);
 const fingerprint=await sha(JSON.stringify({projectId,id:id||null,title,filename,expected,sourceHash}));
 const replay=async prior=>{if(prior.request_hash!==fingerprint)fail('Cette clé correspond à un autre import.',409);const live=await model(env,ctx,prior.model_id,true);return h.json({model:modelJson(live.row),version:versionJson(prior),replayed:true});};
 let prior=await env.DB.prepare('SELECT * FROM project_model_versions WHERE organization_id=? AND operation_key=?').bind(ctx.organizationId,operation).first();if(prior)return replay(prior);
 if(expected!==(existing?Number(existing.row.latest_version):0)||expected>=MODEL_LIMITS.maxVersions)fail('Le modèle a changé ou sa limite de versions est atteinte. Rechargez son historique.',409);
 if(existing){const last=await env.DB.prepare('SELECT source_sha256 FROM project_model_versions WHERE organization_id=? AND model_id=? AND version=?').bind(ctx.organizationId,id,expected).first();if(last?.source_sha256===sourceHash)fail('Ce fichier correspond déjà à la révision courante.',409);}
 if(typeof env.MODELS?.convert!=='function')fail('Le convertisseur IFC de ce serveur reste à activer.',503);
 let converted;try{converted=await env.MODELS.convert(source);}catch(error){throw Object.assign(Error(error?.status===409?'Une conversion IFC est déjà en cours. Réessayez dans quelques instants.':error?.status===413?'Le modèle est trop complexe pour les limites de cet import.':'Ce fichier IFC n’a pas pu être converti. Aucun modèle enregistré.'),{status:[409,413,422,503,504].includes(error?.status)?error.status:422});}
 const preview=converted?.preview instanceof ArrayBuffer?new Uint8Array(converted.preview):converted?.preview,metadata=converted?.metadata;
 if(!(preview instanceof Uint8Array)||preview.length<20||preview.length>MODEL_LIMITS.maxPreviewBytes)fail('Aperçu 3D hors limites.',413);
 const dv=new DataView(preview.buffer,preview.byteOffset,preview.byteLength);if(dv.getUint32(0,true)!==0x46546c67||dv.getUint32(4,true)!==2||dv.getUint32(8,true)!==preview.byteLength)fail('Aperçu GLB invalide.',422);
 const inspected=inspectModelGlb(preview),previewHash=await sha(preview);if(!metadata||metadata.schema!=='IFC4'||metadata.sourceSha256!==sourceHash||metadata.previewSha256!==previewHash||metadata.objectCount!==inspected.objectCount||!Array.isArray(metadata.dimensions)||metadata.dimensions.length!==3||metadata.dimensions.some((v,i)=>!Number.isFinite(v)||Math.abs(v-inspected.dimensions[i])>1e-5))fail('La provenance du modèle ne peut pas être vérifiée.',422);
 const metadataJson=JSON.stringify(metadata),metadataBytes=new TextEncoder().encode(metadataJson).length;if(metadataBytes>MODEL_LIMITS.maxMetadataBytes)fail('Métadonnées du modèle hors limites.',413);
 await authorize(env,ctx,projectId,true);if(existing)await model(env,ctx,id,true);
 const modelId=id||uid('project-model'),versionId=uid('model-version'),version=expected+1,stamp=new Date().toISOString(),g=uid('model-guard'),cost=source.length+preview.length+metadataBytes,statements=[];
 const condition="COALESCE((SELECT SUM(source_bytes+preview_bytes+metadata_bytes) FROM project_model_versions WHERE organization_id=?),0)+?<=? AND "+(existing?"EXISTS(SELECT 1 FROM project_models WHERE organization_id=? AND id=? AND archived_at IS NULL AND latest_version=?)":"(SELECT COUNT(*) FROM project_models WHERE organization_id=? AND project_id=?)<?");
 const values=[ctx.organizationId,cost,MODEL_LIMITS.maxOrganizationBytes,...(existing?[ctx.organizationId,id,expected]:[ctx.organizationId,projectId,MODEL_LIMITS.maxModelsPerProject])];
 statements.push(guard(env,ctx,projectId,g,condition,values));
 if(!existing)statements.push(env.DB.prepare('INSERT INTO project_models(organization_id,id,project_id,title,latest_version,created_by,created_at) VALUES(?,?,?,?,0,?,?)').bind(ctx.organizationId,modelId,projectId,title,ctx.uid,stamp));
 statements.push(env.DB.prepare('INSERT INTO project_model_versions(organization_id,id,model_id,version,filename,source_bytes,preview_bytes,metadata_bytes,source_sha256,preview_sha256,metadata_json,operation_key,request_hash,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(ctx.organizationId,versionId,modelId,version,filename,source.length,preview.length,metadataBytes,sourceHash,previewHash,metadataJson,operation,fingerprint,ctx.uid,stamp),...chunks(env,ctx,versionId,'source',source),...chunks(env,ctx,versionId,'preview',preview),env.DB.prepare('UPDATE project_models SET latest_version=? WHERE organization_id=? AND id=? AND latest_version=? AND archived_at IS NULL').bind(version,ctx.organizationId,modelId,expected),h.auditStatement(env,ctx,'project.model.imported','project_model',modelId,{projectId,version,sourceSha256:sourceHash,previewSha256:previewHash}),drop(env,g));
 try{await h.dbBatch(env,statements);}catch{prior=await env.DB.prepare('SELECT * FROM project_model_versions WHERE organization_id=? AND operation_key=?').bind(ctx.organizationId,operation).first();if(prior)return replay(prior);fail('Le chantier, les droits, la version ou le quota ont changé. Aucun import partiel enregistré.',409);}
 const live=await model(env,ctx,modelId);const saved=await env.DB.prepare('SELECT * FROM project_model_versions WHERE organization_id=? AND id=?').bind(ctx.organizationId,versionId).first();return h.json({model:modelJson(live.row),version:versionJson(saved),replayed:false},201);
}
async function archive(request,env,ctx,h,id){
 const {row}=await model(env,ctx,id,true),data=await h.body(request,2000);if(!data||Object.keys(data).some(k=>!['expectedVersion','operationKey'].includes(k))||!Number.isInteger(data.expectedVersion))fail('Paramètres d’archivage invalides.');key(data.operationKey);
 if(data.expectedVersion!==Number(row.latest_version))fail('Une nouvelle révision existe. Rechargez le modèle.',409);const g=uid('model-guard'),stamp=new Date().toISOString();
 try{await h.dbBatch(env,[guard(env,ctx,row.project_id,g,'EXISTS(SELECT 1 FROM project_models WHERE organization_id=? AND id=? AND latest_version=? AND archived_at IS NULL)',[ctx.organizationId,id,data.expectedVersion]),env.DB.prepare('UPDATE project_models SET archived_at=?,archived_by=? WHERE organization_id=? AND id=?').bind(stamp,ctx.uid,ctx.organizationId,id),h.auditStatement(env,ctx,'project.model.archived','project_model',id,{projectId:row.project_id,version:row.latest_version,operationKey:data.operationKey}),drop(env,g)]);}catch{fail('Le modèle ou vos droits ont changé. Actualisez.',409);}
 return h.json({archived:true});
}
export async function projectModelsRoute(request,url,env,ctx,h,id=null,action='',versionId=null){
 if(['GET','HEAD'].includes(request.method)){
  if(id&&versionId&&['source','preview','metadata'].includes(action))return artifact(request,env,ctx,id,versionId,action);
  if(request.method==='HEAD')return h.json({error:'Méthode non autorisée.'},405);
  if(id&&!action){const {row,canManage}=await model(env,ctx,id);const versions=await all(env.DB.prepare('SELECT * FROM project_model_versions WHERE organization_id=? AND model_id=? ORDER BY version DESC').bind(ctx.organizationId,id));await model(env,ctx,id);return h.json({model:modelJson(row),canManage,versions:versions.map(versionJson)});}
  if(!id&&!action){const projectId=url.searchParams.get('projectId'),{canManage}=await authorize(env,ctx,projectId);const rows=await all(env.DB.prepare('SELECT * FROM project_models WHERE organization_id=? AND project_id=? AND archived_at IS NULL ORDER BY created_at DESC,id').bind(ctx.organizationId,projectId));await authorize(env,ctx,projectId);return h.json({enabled:typeof env.MODELS?.convert==='function',canManage,limits:{maxSourceBytes:MODEL_LIMITS.maxSourceBytes,formats:MODEL_LIMITS.formats},models:rows.map(modelJson)});}
 }
 if(request.method==='POST'&&!versionId){if(!id&&!action||id&&action==='versions')return upload(request,env,ctx,h,id);if(id&&action==='archive')return archive(request,env,ctx,h,id);}
 return h.json({error:'Méthode non autorisée.'},405);
}
