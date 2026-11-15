// Read-only contact history. Only persisted IDs establish ownership; labels never do.
export async function contactFilesRoute(request,env,ctx,contactId,documentId,action,h){
 const {json,rows}=h;
 if(request.method!=='GET')return json({error:'Méthode non autorisée.'},405);
 await h.requirePermission(env,ctx,'customers.view');
 const state=await h.organizationWorkspaceState(env,ctx.organizationId,{readOnly:true});
 const contact=(state?.contacts||[]).find(c=>String(c.id)===contactId);
 let customerId='',sourceId=contact?contactId:'';
 if(contact){const link=await env.DB.prepare('SELECT customer_id FROM commercial_contact_customers WHERE organization_id=? AND contact_id=?').bind(ctx.organizationId,contactId).first();customerId=link?.customer_id||''}
 else if(contactId.startsWith('canonical:')){customerId=contactId.slice(10);const customer=await env.DB.prepare('SELECT id FROM customers WHERE organization_id=? AND id=?').bind(ctx.organizationId,customerId).first();if(!customer)return json({error:'Fiche introuvable.'},404);const link=await env.DB.prepare('SELECT contact_id FROM commercial_contact_customers WHERE organization_id=? AND customer_id=?').bind(ctx.organizationId,customerId).first();sourceId=link?.contact_id||''}
 else return json({error:'Fiche introuvable.'},404);
 const matchesProject=p=>p.customerId?Boolean(customerId&&String(p.customerId)===customerId):Boolean(sourceId&&(String(p.clientId??'')===sourceId||(p.contactIds||[]).map(String).includes(sourceId)));
 const projectIds=new Set((state?.jobs||[]).filter(matchesProject).map(p=>String(p.id)));
 if(customerId)for(const p of await rows(env.DB.prepare('SELECT id FROM projects WHERE organization_id=? AND customer_id=? AND archived_at IS NULL').bind(ctx.organizationId,customerId)))projectIds.add(String(p.id));
 const visibleProjects=new Set();for(const id of projectIds)if(await h.hasProjectScope(env,ctx,id))visibleProjects.add(id);
 const finance=await h.allowed(env,ctx,'invoices.view')&&await h.allowed(env,ctx,'accounting.view');
 const invoices=[],invoiceIds=new Set(),legacySeen=new Set();
 const legacy=state?.accountingData?.customerInvoices||[];
 const matchesLegacy=i=>i.customerId?Boolean(customerId&&String(i.customerId)===customerId):i.clientId!=null||i.contactId!=null?Boolean(sourceId&&[i.clientId,i.contactId].some(id=>id!=null&&String(id)===sourceId)):projectIds.has(String(i.projectId??i.job??''));
 if(finance){
  const candidates=await rows(env.DB.prepare('SELECT * FROM invoices WHERE organization_id=? ORDER BY issue_date DESC,id').bind(ctx.organizationId));
  for(const i of candidates){
   if(i.legacy_source_id)legacySeen.add(String(i.legacy_source_id));
   if(i.archived_at)continue;
   const originals=i.legacy_source_id?legacy.filter(l=>String(l.id)===String(i.legacy_source_id)):[];
   const original=originals.length===1?originals[0]:null;
   const matches=i.customer_id?Boolean(customerId&&String(i.customer_id)===customerId):original&&(original.customerId||original.clientId!=null||original.contactId!=null)?matchesLegacy(original):projectIds.has(String(i.legacy_project_id||i.project_id||''))||Boolean(original&&matchesLegacy(original));
   if(!matches)continue;
   try{await h.requireInvoiceDocumentScope(env,ctx,i)}catch(e){if([403,404].includes(e.status))continue;throw e}
   invoiceIds.add(String(i.id));invoices.push({id:i.id,reference:i.invoice_number,date:i.issue_date,status:i.status,totalCents:i.total_cents,documents:[]});
  }
  // Unimported historical records remain read-only and explicitly have no file.
  for(const i of legacy){if(legacySeen.has(String(i.id))||!matchesLegacy(i))continue;try{await h.requireInvoiceDocumentScope(env,ctx,{legacy_project_id:i.projectId??i.job??null})}catch(e){if([403,404].includes(e.status))continue;throw e}invoices.push({id:'history:'+String(i.id),reference:i.ref||'Facture historique',date:i.date||'',status:i.status||'',totalCents:Math.round(Number(i.amount||0)*100),documents:[]})}
 }
 const docs=[];
 if(await h.allowed(env,ctx,'documents.secure.view')){
  const candidates=await rows(env.DB.prepare(`SELECT d.* FROM secure_documents d WHERE d.organization_id=? AND d.archived_at IS NULL
   AND (? IS NULL OR d.id=?) AND EXISTS (SELECT 1 FROM document_relations r WHERE r.organization_id=d.organization_id AND r.document_id=d.id AND (
    (r.relation_type='customer' AND r.relation_id=? AND ?<>'') OR
    (r.relation_type='project' AND r.relation_id IN (SELECT value FROM json_each(?))) OR
    (r.relation_type='invoice' AND r.relation_id IN (SELECT value FROM json_each(?))))) ORDER BY d.created_at DESC,d.id`)
   .bind(ctx.organizationId,documentId,documentId,customerId,customerId,JSON.stringify([...visibleProjects]),JSON.stringify([...invoiceIds])));
  for(const d of candidates){
   const links=await h.documentRelations(env,ctx,d.id);
   const linked=links.some(r=>r.relation_type==='customer'&&customerId&&String(r.relation_id)===customerId||r.relation_type==='project'&&visibleProjects.has(String(r.relation_id))||r.relation_type==='invoice'&&invoiceIds.has(String(r.relation_id)));
   if(!linked||!await h.canAccessSecureDocument(env,ctx,d,links))continue;
   const blob=d.status==='available'&&await env.DB.prepare('SELECT 1 ok FROM secure_document_blobs WHERE organization_id=? AND document_id=? AND content IS NOT NULL').bind(ctx.organizationId,d.id).first();
   const item={id:d.id,title:d.title||d.original_name,originalName:d.original_name,contentType:d.content_type,available:Boolean(blob)};
   docs.push(item);for(const i of invoices)if(links.some(r=>r.relation_type==='invoice'&&String(r.relation_id)===String(i.id)))i.documents.push(item);
  }
 }
 if(documentId){const doc=docs.find(d=>String(d.id)===documentId);if(!doc||!doc.available)return json({error:'Pièce indisponible ou accès non autorisé.'},404);if(action)return h.documentContentRoute(request,env,ctx,documentId,action==='download');return json({document:doc})}
 return json({invoices,documents:docs,financeVisible:finance});
}
