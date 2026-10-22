import {requireCommercialVisitScope} from './commercial-scope.js';
import {currentSupplierPrices,supplierUnit} from './supplier-price-imports.js';
import {Big} from './measurement-engine.js';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const unit=value=>({m2:'m2','m²':'m2',m:'m',pc:'pc','pièce':'pc','pièces':'pc'}[String(value||'').trim().toLowerCase()]||String(value||'').trim().toLowerCase());
function number(value,name,{positive=false}={}){if(!/^\d+(?:\.\d{1,5})?$/.test(String(value)))fail(name+' invalide.');const n=new Big(value);if(n.gt(1000000)||positive&&n.lte(0))fail(name+' hors limites.');return n}
async function signature(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function measurementProcurementRoute(request,url,env,ctx,measurementId,action,h){
 await h.requirePermission(env,ctx,'quotes.view');await h.requireQuotePriceRead(env,ctx);await h.requirePermission(env,ctx,'stock.view');await h.requirePermission(env,ctx,'purchase_orders.manage');
 const m=await env.DB.prepare('SELECT * FROM measurement_snapshots WHERE organization_id=? AND id=?').bind(ctx.organizationId,measurementId).first();if(!m)fail('Métré introuvable.',404);
 const visit=await env.DB.prepare('SELECT * FROM quote_site_visits WHERE organization_id=? AND id=?').bind(ctx.organizationId,m.visit_id).first();if(!visit)fail('Visite introuvable.',404);
 const quote=await requireCommercialVisitScope(env,ctx,visit,h);
 const state=await h.organizationWorkspaceState(env,ctx.organizationId,{readOnly:ctx.preview});if(!state)fail('Espace entreprise indisponible.',404);
 await h.ensureLegacyFieldDataImported(env,ctx,state);
 const contacts=(state.contacts||[]).filter(c=>(c.roles||[]).some(r=>['Fournisseur','Sous-traitant'].includes(r)));
 const stock=(await env.DB.prepare('SELECT id,name,reference,supplier_reference,unit,quantity,reserved,unit_cost_cents,updated_at FROM field_stock_items WHERE organization_id=? AND archived_at IS NULL ORDER BY name,id').bind(ctx.organizationId).all()).results;
 const needs=JSON.parse(m.result_json).materialNeeds;
 const effectiveDate=h.socleBusinessDate(state),requestedSupplier=url.searchParams.get('supplierId');
 if(requestedSupplier&&!contacts.some(c=>String(c.id)===requestedSupplier))fail('Fournisseur introuvable.',404);
 const suggestedPrices=requestedSupplier?await currentSupplierPrices(env,ctx.organizationId,requestedSupplier,effectiveDate):new Map();
 if(request.method==='GET'&&action)return h.json({error:'Méthode non autorisée.'},405);
 if(request.method==='GET')return h.json({effectiveDate,prices:[...suggestedPrices.values()],measurementId,version:m.version,projectId:quote?.project_id||null,needs,stock:stock.map(x=>({id:x.id,name:x.name,reference:x.reference,unit:x.unit,quantity:x.quantity,reserved:x.reserved,available:Big(x.quantity).minus(x.reserved).lt(0)?'0':Big(x.quantity).minus(x.reserved).toString()})),suppliers:contacts.map(c=>({id:String(c.id),name:c.name||c.company||String(c.id)}))});
 if(request.method!=='POST'||!['preview','order'].includes(action))return h.json({error:'Méthode non autorisée.'},405);
 const data=await h.body(request,40000),supplier=contacts.find(x=>String(x.id)===String(data.supplierId||''));if(!supplier)fail('Choisissez un fournisseur de cette entreprise.',404);
 if(!Array.isArray(data.lines)||!data.lines.length||data.lines.length>needs.length)fail('Sélectionnez les besoins à commander.');
 if(![0,6,12,21].includes(data.vatRate))fail('Choisissez explicitement la TVA achat.');
 const currentPrices=await currentSupplierPrices(env,ctx.organizationId,String(supplier.id),effectiveDate);
 const usedCodes=new Set(),usedItems=new Set(),lines=[],comparison=[];
 for(const row of data.lines){
  const need=needs.find(n=>n.code===row.code);if(!need||usedCodes.has(row.code))fail('Besoin inconnu ou présent deux fois.');usedCodes.add(row.code);
  const item=stock.find(x=>String(x.id)===String(row.stockItemId||''));if(!item)fail('Associez chaque besoin à un article de cette entreprise.',404);
  if(usedItems.has(item.id))fail('Un article ne peut pas couvrir deux besoins dans cette commande.');usedItems.add(item.id);
  if(unit(item.unit)!==unit(need.unit))fail('Unités incompatibles : '+need.label+' et '+item.name+'.');
  const tariff=row.priceImportId?currentPrices.get(item.id):null;
  if(row.priceImportId&&(!tariff||tariff.importId!==row.priceImportId||supplierUnit(tariff.unit)!==unit(item.unit)))fail('Le tarif sélectionné est périmé ou incompatible. Reprenez le tarif.',409);
  const packageSize=tariff?.packageSize||need.packageSize;
  const pack=number(packageSize,'Conditionnement',{positive:true}),quantity=number(row.quantity,'Quantité commandée',{positive:true});
  if(quantity.div(pack).mod(1).gt(0))fail('La quantité commandée doit respecter le conditionnement de '+need.label+'.');
  const price=number(row.unitPrice,'Prix d’achat');if(tariff&&price.toFixed(2)!==tariff.price)fail('Un prix modifié doit être déclaré comme saisie manuelle.');
  const available=Big(item.quantity).minus(item.reserved),free=available.gt(0)?available:new Big(0);
  const shortage=Big(need.requiredQuantity).minus(free),suggested=shortage.gt(0)?shortage.div(pack).round(0,Big.roundUp).times(pack):new Big(0);
  lines.push({reference:String(item.supplier_reference||item.reference||''),label:item.name,quantity:Number(quantity.toString()),unit:item.unit,unitPrice:Number(price.toFixed(2)),vatRate:data.vatRate});
  comparison.push({code:need.code,label:need.label,stockItemId:item.id,stockReference:item.reference,unit:item.unit,requiredQuantity:need.requiredQuantity,packageSize,priceSource:tariff?{importId:tariff.importId,version:tariff.version,validFrom:tariff.validFrom,reference:tariff.reference}:null,stockQuantity:String(item.quantity),reserved:String(item.reserved),available:free.toString(),suggestedShortfall:suggested.toString(),orderedQuantity:quantity.toString(),unitPrice:price.toFixed(2),stockUpdatedAt:item.updated_at});
 }
 const prepared={measurementId:m.id,version:m.version,sourceLabel:m.source_label,visitId:visit.id,projectId:quote?.project_id||null,supplierId:String(supplier.id),vatRate:data.vatRate,comparison,lines};
 const previewSignature=await signature(prepared);
 if(action==='preview')return h.json({...prepared,previewSignature,stockReserved:false,notice:'Le stock affiché est indicatif, non réservé. La quantité commandée est votre choix explicite ; aucun mouvement de stock ni envoi fournisseur.'});
 if(data.previewSignature!==previewSignature)fail('Les données ou le stock ont changé. Recalculez l’aperçu avant de créer la commande.',409);
 const date=h.socleBusinessDate(state),requester=await h.currentProfileLabel(env,ctx);
 const orderData={number:'BC-METRE-'+m.id.slice(6)+'-'+String(supplier.id),supplierId:String(supplier.id),date,projectId:quote?.project_id||null,requester,status:'brouillon',lines,operationKey:'measurement:'+m.id+':'+String(supplier.id)};
 const req=new Request(request.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(orderData)});
 return h.purchaseOrderRoutes(req,env,ctx,{measurementId:m.id,version:m.version,sourceLabel:m.source_label,visitId:visit.id,previewSignature,comparison,stockReserved:false});
}
