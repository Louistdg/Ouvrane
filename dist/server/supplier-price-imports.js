import {Big} from './measurement-engine.js';
const fail=(msg,status=400)=>{throw Object.assign(Error(msg),{status})};
const normalizeRef=v=>String(v||'').trim().toUpperCase();
export const supplierUnit=v=>({'m²':'m2','pièce':'pc','pièces':'pc'}[String(v||'').trim().toLowerCase()]||String(v||'').trim().toLowerCase());
function decimal(v,label,{positive=false}={}){const s=String(v??'').trim().replace(/[\s\u00a0\u202f]/g,'').replace(',','.');if(!/^\d+(?:\.\d{1,5})?$/.test(s))fail(label+' : nombre invalide.');const n=new Big(s);if(n.gt(1000000)||positive&&n.lte(0))fail(label+' hors limites.');return n}
async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('')}
export async function currentSupplierPrices(env,org,supplierId,date){
 const rows=(await env.DB.prepare('SELECT id,version,valid_from,rows_json FROM supplier_price_imports WHERE organization_id=? AND supplier_id=? AND valid_from<=? ORDER BY valid_from DESC,version DESC').bind(org,String(supplierId),date).all()).results;
 const map=new Map();for(const batch of rows)for(const row of JSON.parse(batch.rows_json))if(row.stockItemId&&!map.has(row.stockItemId))map.set(row.stockItemId,{...row,importId:batch.id,version:batch.version,validFrom:batch.valid_from});return map;
}
export async function supplierPriceImports(request,url,env,ctx,importId,action,h){
 await h.requirePermission(env,ctx,'purchase_orders.manage');await h.requirePermission(env,ctx,'stock.view');await h.requireQuotePriceRead(env,ctx);
 if(importId){
  if(request.method!=='GET')return h.json({error:'Méthode non autorisée.'},405);
  const row=await env.DB.prepare('SELECT * FROM supplier_price_imports WHERE organization_id=? AND id=?').bind(ctx.organizationId,importId).first();if(!row)fail('Import introuvable.',404);
  if(action==='original')return new Response(row.original_bytes,{headers:{'content-type':'application/octet-stream','content-disposition':'attachment; filename="'+row.filename.replace(/[^A-Za-z0-9._-]/g,'_')+'"','cache-control':'no-store','x-content-type-options':'nosniff'}});
  return h.json({import:{id:row.id,supplierId:row.supplier_id,version:row.version,validFrom:row.valid_from,filename:row.filename,checksum:row.checksum_sha256,createdAt:row.created_at,rows:JSON.parse(row.rows_json),mapping:JSON.parse(row.mapping_json)}});
 }
 if(request.method==='GET'){
  const imports=(await env.DB.prepare('SELECT id,supplier_id supplierId,version,valid_from validFrom,filename,created_at createdAt FROM supplier_price_imports WHERE organization_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(ctx.organizationId).all()).results;
  const state=await h.organizationWorkspaceState(env,ctx.organizationId,{readOnly:ctx.preview});
  const suppliers=(state?.contacts||[]).filter(c=>(c.roles||[]).some(r=>['Fournisseur','Sous-traitant'].includes(r))).map(c=>({id:String(c.id),name:c.company||c.name||String(c.id)}));
  return h.json({imports,suppliers});
 }
 if(request.method!=='POST'||!['preview','commit'].includes(action))return h.json({error:'Méthode non autorisée.'},405);
 const data=await h.body(request,4500000);if(!data||typeof data!=='object'||Array.isArray(data))fail('Import invalide.');
 const state=await h.organizationWorkspaceState(env,ctx.organizationId,{readOnly:ctx.preview});if(!state)fail('Entreprise introuvable.',404);
 const supplier=(state.contacts||[]).find(c=>String(c.id)===String(data.supplierId)&&(c.roles||[]).some(r=>['Fournisseur','Sous-traitant'].includes(r)));if(!supplier)fail('Fournisseur introuvable.',404);
 const date=String(data.validFrom||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('Date de validité invalide.');
 const filename=String(data.filename||'').trim();if(filename.length>180||!/\.(csv|xlsx)$/i.test(filename))fail('Fichier CSV ou XLSX attendu.');
 if(data.currency!=='EUR'||data.priceBasis!=='unit-ex-vat')fail('Confirmez des prix en EUR HTVA par unité.');
 const raw=String(data.originalBase64||'');if(raw.length>2800000||!raw||raw.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(raw))fail('Fichier trop volumineux ou illisible.');
 let bytes;try{bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0))}catch{fail('Fichier illisible.')} if(bytes.length>2000000)fail('Fichier limité à 2 Mo.');
 if(/\.xlsx$/i.test(filename)&&(bytes[0]!==80||bytes[1]!==75))fail('Ce fichier ne correspond pas à un classeur XLSX.');
 if(!Array.isArray(data.rows)||!data.rows.length||data.rows.length>2000)fail('Import limité à 2 000 lignes.');
 if(!data.mapping||typeof data.mapping!=='object'||Array.isArray(data.mapping)||JSON.stringify(data.mapping).length>2000)fail('Correspondance des colonnes obligatoire.');
 await h.ensureLegacyFieldDataImported(env,ctx,state);
 const stock=(await env.DB.prepare('SELECT id,reference,supplier_reference,unit FROM field_stock_items WHERE organization_id=? AND archived_at IS NULL').bind(ctx.organizationId).all()).results;
 const seen=new Set(),clean=[];
 for(let i=0;i<data.rows.length;i++){
  const row=data.rows[i];if(!row||typeof row!=='object'||Array.isArray(row))fail('Ligne '+(i+1)+' invalide.');
  const reference=String(row.reference||'').trim(),name=String(row.name||'').trim(),unit=String(row.unit||'').trim();
  if(!reference||reference.length>120||!name||name.length>240||!unit||unit.length>30)fail('Référence, désignation et unité obligatoires, ligne '+(i+1)+'.');
  const key=normalizeRef(reference);if(seen.has(key))fail('Référence fournisseur en double : '+reference);seen.add(key);
  const price=decimal(row.price,'Prix ligne '+(i+1)).toFixed(2),packageSize=decimal(row.packageSize??'1','Conditionnement ligne '+(i+1),{positive:true}).toString();
  const matches=stock.filter(s=>normalizeRef(s.supplier_reference||s.reference)===key);
  if(matches.length>1)fail('Référence ambiguë dans le stock : '+reference+'. Corrigez le catalogue.');
  if(matches.length&&supplierUnit(matches[0].unit)!==supplierUnit(unit))fail('Unité incompatible avec le stock : '+reference);
  clean.push({reference,name,unit,price,packageSize,currency:'EUR',priceBasis:'unit-ex-vat',stockItemId:matches[0]?.id||null});
 }
 const checksum=await digest(bytes),mappingJson=JSON.stringify(data.mapping),rowsJson=JSON.stringify(clean);
 const previewSignature=await digest(new TextEncoder().encode(JSON.stringify({supplierId:String(supplier.id),validFrom:date,filename,checksum,mapping:data.mapping,rows:clean})));
 if(action==='preview')return h.json({previewSignature,rows:clean,matched:clean.filter(x=>x.stockItemId).length,unmatched:clean.filter(x=>!x.stockItemId).length,checksum,notice:'Aucun article ni stock modifié. Les tarifs seront historisés ; les devis existants conservent leurs prix.'});
 if(data.previewSignature!==previewSignature)fail('Aperçu modifié ou correspondance périmée. Recommencez la vérification.',409);
 if(!/^[A-Za-z0-9._:-]{8,120}$/.test(String(data.operationKey||'')))fail('Clé d’import invalide.');
 const old=await env.DB.prepare('SELECT * FROM supplier_price_imports WHERE organization_id=? AND operation_key=?').bind(ctx.organizationId,data.operationKey).first();
 if(old){if(old.supplier_id!==String(supplier.id)||old.valid_from!==date||old.filename!==filename||old.checksum_sha256!==checksum||old.mapping_json!==mappingJson||old.rows_json!==rowsJson)fail('Cette clé correspond à un autre import.',409);return h.json({id:old.id,version:old.version,replayed:true})}
 const head=await env.DB.prepare('SELECT MAX(version) version FROM supplier_price_imports WHERE organization_id=? AND supplier_id=?').bind(ctx.organizationId,String(supplier.id)).first();
 const id='price-import-'+crypto.randomUUID(),version=Number(head?.version||0)+1,stamp=new Date().toISOString();
 try{await h.dbBatch(env,[env.DB.prepare('INSERT INTO supplier_price_imports VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(ctx.organizationId,id,String(supplier.id),version,date,filename,checksum,bytes,mappingJson,rowsJson,data.operationKey,ctx.uid,stamp),h.auditStatement(env,ctx,'supplier_prices.imported','supplier_price_import',id,{supplier_id:String(supplier.id),version,valid_from:date,filename,checksum,rows:clean.length})])}catch(e){if(String(e).includes('UNIQUE constraint'))fail('Un autre import a été enregistré. Rechargez puis réessayez.',409);throw e}
 return h.json({id,version,matched:clean.filter(x=>x.stockItemId).length,unmatched:clean.filter(x=>!x.stockItemId).length},201);
}
