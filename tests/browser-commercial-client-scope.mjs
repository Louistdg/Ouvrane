import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {realpathSync} from 'node:fs';
import {basename,dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {connectBrowser} from './helpers/browser-cdp.mjs';

// All writes belong to a disposable Browser Gate run. No candidate/seed path,
// public origin, credentials file, replacement workspace or manufactured user.
const base=process.env.SOCLE_TEST_URL,dbPath=process.env.SOCLE_TEST_DATABASE_PATH;
assert.ok(base&&dbPath,'Browser Gate URL and copied database are mandatory.');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname),'Public origins are forbidden.');
assert.equal(new URL(base).protocol,'http:','Use the isolated local gate server.');
const databasePath=realpathSync(resolve(dbPath));
assert.equal(basename(databasePath),'socle.sqlite');
assert.match(dirname(databasePath),/browser-gate[\\/]run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,'Only the real run-UUID Browser Gate copy may be opened.');
const database=new DatabaseSync(databasePath),failures=[],addedPermissions=[];
const token=randomUUID(),ownerEmail='direction@batinova.example',workerEmail='anthony.simon@batinova.example';
let browser,tab,organizationId='',worker,setupComplete=false;
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=';
function check(label,ok,detail={}){console.log((ok?'PASS ':'FAIL ')+label+' '+JSON.stringify(detail));if(!ok)failures.push(label);}
const run=(expression,label)=>tab.evaluate(expression,'commercial-scope:'+label);
const request=(path,method='GET',data)=>run(`(async()=>{const r=await fetch(${JSON.stringify(path)},{cache:'no-store',method:${JSON.stringify(method)},headers:{'content-type':'application/json',${organizationId?`'x-socle-organization-id':${JSON.stringify(organizationId)},`:''}},${data===undefined?'':`body:JSON.stringify(${JSON.stringify(data)}),`}});const contentType=r.headers.get('content-type')||'';return {status:r.status,contentType,...(/json/i.test(contentType)?{body:await r.json()}:{bytes:(await r.arrayBuffer()).byteLength})}})()`,'api-'+method+'-'+path);
function must(response,status,label){assert.equal(response.status,status,label+' HTTP '+response.status);return response.body;}
const login=async email=>must(await request('/__local-test/login','POST',{email}),204,'Existing local-test login');
const api=async(path,method='GET',data)=>must(await request(path,method,data),200,path);
async function scenario(label,action){try{await action();}catch(error){check(label+' completes',false,{error:String(error?.message||error).slice(0,300)});}}
function permissions(){return new Set(database.prepare('SELECT permission_code FROM role_permissions WHERE role_id=?').all(worker.roleId).map(row=>row.permission_code));}
function visitState(visitId){
  return {
    visit:database.prepare('SELECT * FROM quote_site_visits WHERE organization_id=? AND id=?').get(organizationId,visitId),
    documents:database.prepare('SELECT * FROM quote_site_visit_documents WHERE organization_id=? AND visit_id=? ORDER BY document_id').all(organizationId,visitId),
    visitRelations:database.prepare('SELECT * FROM quote_site_visit_document_relations WHERE organization_id=? AND visit_id=? ORDER BY document_id').all(organizationId,visitId),
    customerRelations:database.prepare('SELECT r.* FROM document_relations r JOIN quote_site_visit_documents v ON v.organization_id=r.organization_id AND v.document_id=r.document_id WHERE v.organization_id=? AND v.visit_id=? ORDER BY r.id').all(organizationId,visitId),
    audits:database.prepare("SELECT id,action,entity_type,entity_id,old_values,new_values FROM audit_logs WHERE organization_id=? AND (entity_id=? OR entity_id IN(SELECT document_id FROM quote_site_visit_documents WHERE organization_id=? AND visit_id=?)) ORDER BY id").all(organizationId,visitId,organizationId,visitId)
  };
}
function quoteState(quoteId){return {quote:database.prepare('SELECT * FROM quotes_server WHERE organization_id=? AND id=?').get(organizationId,quoteId),audits:database.prepare('SELECT id,action,old_values,new_values FROM audit_logs WHERE organization_id=? AND entity_id=? ORDER BY id').all(organizationId,quoteId)};}
function mutationTotals(){return database.prepare('SELECT (SELECT COUNT(*) FROM quote_site_visits WHERE organization_id=?) visits,(SELECT COUNT(*) FROM quotes_server WHERE organization_id=?) quotes,(SELECT COUNT(*) FROM secure_documents WHERE organization_id=?) documents,(SELECT COUNT(*) FROM audit_logs WHERE organization_id=?) audits').get(organizationId,organizationId,organizationId,organizationId);}
async function unchangedVisit(label,visitId,action,expectedStatus=403){
  const before=visitState(visitId),totals=mutationTotals(),response=await action();
  check(label+' is denied',response.status===expectedStatus,{expectedStatus,status:response.status});
  check(label+' preserves visit, links and audit',isDeepStrictEqual(visitState(visitId),before));
  check(label+' creates no commercial record, document or audit',isDeepStrictEqual(mutationTotals(),totals));
}
async function upload(visitId,label){
  return run(`(async()=>{const form=new FormData();form.set('operationKey',${JSON.stringify('scope-'+token+'-'+label)});form.append('photos',new File([Uint8Array.from(atob(${JSON.stringify(png)}),char=>char.charCodeAt(0))],${JSON.stringify('commercial-scope-'+token+'-'+label+'.png')},{type:'image/png'}));const r=await fetch(${JSON.stringify('/api/quote-visits/'+encodeURIComponent(visitId)+'/attachments')},{method:'POST',headers:{'x-socle-organization-id':${JSON.stringify(organizationId)}},body:form});return{status:r.status,body:await r.json()}})()`,'upload-'+label);
}
const quoteFields=quote=>Object.fromEntries(['projectId','customerId','reference','status','title','client','clientAddress','date','validUntil','deposit','paymentTerms','notes','exclusions','lines'].map(key=>[key,quote[key]]));
const hasId=(items,id)=>Array.isArray(items)&&items.some(item=>String(item.id)===String(id));
const containsMoney=value=>{
  const forbidden=new Set(['price','unitPrice','unitPriceCents','amount','amountCents','subtotal','subtotalCents','total','totalCents','vatAmount','deposit','paymentTerms','cost','costPrice','purchasePrice','margin','source','sourcePriceObserved','sourceVatIncluded']);
  return Boolean(value&&typeof value==='object'&&Object.entries(value).some(([key,item])=>forbidden.has(key)||containsMoney(item)));
};

try{
  browser=await connectBrowser(base);tab=await browser.createSession(base);
  // Capture identity and existing scopes without loading the app's autosave UI.
  await tab.navigate(new URL('/health',base).href);await login(ownerEmail);
  const original=await api('/api/state');organizationId=String(original.organizationId||'');
  assert.ok(organizationId&&original.role==='OWNER','The existing owner must control this copied organization.');
  worker=database.prepare("SELECT om.user_id userId,om.role_id roleId FROM local_test_identities i JOIN organization_members om ON om.user_id=i.profile_id AND om.organization_id=i.organization_id JOIN roles r ON r.id=om.role_id AND r.organization_id=om.organization_id WHERE LOWER(i.email)=? AND om.organization_id=? AND om.status='active' AND r.code='WORKER'").get(workerEmail,organizationId);
  assert.ok(worker,'The real Anthony WORKER membership is required.');
  const originalPermissions=[...permissions()].sort();
  assert.ok(originalPermissions.includes('quotes.view')&&originalPermissions.includes('documents.secure.view')&&!originalPermissions.includes('customers.view'),'Fixture requires real terrain quote/document access, without the customer directory.');
  await login(workerEmail);const own=await api('/api/state');
  assert.equal(String(own.access?.userId),String(worker.userId));assert.equal(own.access?.roleCode,'WORKER');
  const visibleIds=new Set((own.state?.jobs||[]).map(job=>String(job.id))),allJobs=original.state?.jobs||[];
  const visible=allJobs.find(job=>visibleIds.has(String(job.id))),outside=allJobs.find(job=>!visibleIds.has(String(job.id)));
  assert.ok(visible&&outside&&visibleIds.size>0,'A visible and an out-of-scope existing project are mandatory; never invent or grant one.');
  check('WORKER sees real assigned projects',visibleIds.size>0,{visibleProjects:visibleIds.size});
  check('WORKER cannot read the canonical customer directory',(await request('/api/customers')).status===403);
  await login(ownerEmail);
  const customers={};
  for(const label of ['A','B'])customers[label]=must(await request('/api/customers','POST',{type:'company',companyName:'QA commercial '+label+' '+token,street:'Rue de la copie isolée',city:'Namur',country:'BE'}),201,'Create copied customer '+label).customer;
  assert.ok(customers.A?.id&&customers.B?.id&&customers.A.id!==customers.B.id);
  const date=new Date().toISOString().slice(0,10),validUntil=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  async function createQuote(label,customerId,projectId=null){
    const body={customerId,projectId,reference:'QA-SCOPE-'+label+'-'+token,title:'Devis scope '+label+' '+token,client:'Client '+label,date,validUntil,status:'draft',lines:[{label:'Prestation de vérification',description:'Copie Browser Gate seulement',qty:2,unit:'pc',price:123.45,vat:21}]};
    return must(await request('/api/quotes','POST',body),201,'Create real quote '+label).quote;
  }
  const fixedProjectId='qa-commercial-project-'+token,stamp=new Date().toISOString();
  // The API has no SQL project-create endpoint. This one new fixture is inserted
  // only into the already verified disposable run-UUID database, never a job.
  database.prepare('INSERT INTO projects(id,organization_id,customer_id,name,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(fixedProjectId,organizationId,customers.A.id,'QA fixed client '+token,'active',stamp,stamp);
  const quotes={prospect:await createQuote('prospect-A',customers.A.id),visible:await createQuote('visible-A',customers.A.id,String(visible.id)),outside:await createQuote('outside-A',customers.A.id,String(outside.id)),fixed:await createQuote('fixed-A',customers.A.id,fixedProjectId),otherClient:await createQuote('prospect-B',customers.B.id)};
  const visits={};
  for(const label of ['prospect','visible','outside','mismatch'])visits[label]=must(await request('/api/quote-visits','POST',{customerId:customers.A.id,place:'Visite '+label+' '+token,contact:'QA client A',notes:'Périmètre commercial isolé',operationKey:'scope-visit-'+label+'-'+token}),201,'Create real visit '+label).visit;
  for(const label of ['visible','outside'])must(await request('/api/quote-visits/'+visits[label].id+'/quote','POST',{quoteId:quotes[label].id}),200,'Link fixture '+label);
  const documents={};
  for(const label of ['prospect','visible','outside']){
    const uploaded=must(await upload(visits[label].id,'owner-'+label),200,'Owner uploads valid PNG '+label);
    assert.equal(uploaded.added?.length,1,'One real fixture photo is mandatory.');documents[label]=uploaded.added[0].id;
  }
  check('Owner sees all copied quotes',(await api('/api/quotes')).quotes.filter(quote=>Object.values(quotes).some(item=>item.id===quote.id)).length===5);
  for(const label of ['prospect','visible','outside']){
    must(await request('/api/quote-visits/'+visits[label].id),200,'Owner reads visit '+label);
    const photo=await request('/api/documents/'+documents[label]+'/preview');assert.ok(photo.status===200&&photo.bytes>0,'The owner must read each real photo before worker assertions.');
  }
  setupComplete=true;

  await scenario('Owner mismatched visit/customer link',async()=>{
    await unchangedVisit('Visit client A to quote client B',visits.mismatch.id,()=>request('/api/quote-visits/'+visits.mismatch.id+'/quote','POST',{quoteId:quotes.otherClient.id}),409);
  });
  await scenario('Owner fixed project/customer mismatch',async()=>{
    const before=database.prepare('SELECT * FROM projects WHERE organization_id=? AND id=?').get(organizationId,fixedProjectId),counts=mutationTotals();
    const response=await request('/api/quotes','POST',{...quoteFields(quotes.fixed),reference:'QA-SCOPE-WRONG-'+token,customerId:customers.B.id,status:'accepted'});
    check('Project fixed to A rejects accepted quote for B',response.status===409,{status:response.status});
    check('Rejected mismatch preserves SQL project client and totals',isDeepStrictEqual(database.prepare('SELECT * FROM projects WHERE organization_id=? AND id=?').get(organizationId,fixedProjectId),before));
    check('Rejected project mismatch creates no quote or audit',isDeepStrictEqual(mutationTotals(),counts));
  });

  await login(workerEmail);const current=await api('/api/state');
  assert.equal(String(current.access?.userId),String(worker.userId));assert.equal(current.access?.roleCode,'WORKER');
  await scenario('Worker quote reads',async()=>{
    const list=must(await request('/api/quotes'),200,'Assigned quote list');
    check('Quote list excludes both prospect customers',!hasId(list.quotes,quotes.prospect.id)&&!hasId(list.quotes,quotes.otherClient.id));
    check('Quote list excludes outside and SQL-only projects',!hasId(list.quotes,quotes.outside.id)&&!hasId(list.quotes,quotes.fixed.id));
    check('Quote list retains the assigned execution quote',hasId(list.quotes,quotes.visible.id));
    check('Worker quote list contains no money',!containsMoney(list.quotes));
    for(const label of ['prospect','otherClient','outside','fixed'])check('Direct quote '+label+' is denied',(await request('/api/quotes/'+quotes[label].id)).status===403);
    const allowed=must(await request('/api/quotes/'+quotes.visible.id),200,'Assigned execution quote');
    check('Assigned worker sheet data retains real identity and work',allowed.quote?.id===quotes.visible.id&&allowed.quote.lines?.length===1&&allowed.quote.lines[0].label===quotes.visible.lines[0].label&&allowed.quote.lines[0].qty===2);
    check('Assigned execution quote remains without prices',!containsMoney(allowed.quote));
    check('The real assigned project still responds200',(await request('/api/projects/'+visible.id)).status===200);
  });
  await scenario('Worker visit reads',async()=>{
    const list=must(await request('/api/quote-visits'),200,'Assigned visit list');
    check('Visit list excludes unlinked prospects and outside project',!hasId(list.visits,visits.prospect.id)&&!hasId(list.visits,visits.outside.id));
    check('Visit list retains the assigned visit',hasId(list.visits,visits.visible.id));
    for(const label of ['prospect','outside'])check('Direct visit '+label+' is denied',(await request('/api/quote-visits/'+visits[label].id)).status===403);
    const allowed=must(await request('/api/quote-visits/'+visits.visible.id),200,'Assigned visit');
    check('Assigned visit keeps its execution quote',allowed.visit?.quoteId===quotes.visible.id);
  });
  await scenario('Worker photo reads',async()=>{
    const ownerPhotos=Object.values(documents),response=must(await request('/api/documents?q='+encodeURIComponent('commercial-scope-'+token)),200,'Filtered worker document list');
    check('Document list exposes only the authorized fixture photo',hasId(response.documents,documents.visible)&&!hasId(response.documents,documents.prospect)&&!hasId(response.documents,documents.outside));
    for(const label of ['prospect','outside'])for(const suffix of ['', '/preview','/download']){
      const response=await request('/api/documents/'+documents[label]+suffix);
      check('Worker cannot read '+label+' photo '+(suffix||'metadata'),[403,404].includes(response.status),{status:response.status});
    }
    for(const suffix of ['', '/preview']){
      const response=await request('/api/documents/'+documents.visible+suffix);
      check('Assigned photo remains accessible '+(suffix||'metadata'),response.status===200&&(suffix?response.bytes>0:response.body?.document?.id===documents.visible));
    }
    assert.equal(ownerPhotos.length,3,'All three real document fixtures must exist.');
  });

  // Grant only these two real backend permissions to the existing copied role.
  // Their absence from the original role is preserved and restored exactly.
  for(const permission of ['quotes.create','quotes.edit']){
    assert.ok(database.prepare('SELECT 1 ok FROM permissions WHERE code=?').get(permission),'The canonical permission must already exist.');
    if(!permissions().has(permission)){assert.equal(database.prepare('INSERT INTO role_permissions(role_id,permission_code) VALUES(?,?)').run(worker.roleId,permission).changes,1);addedPermissions.push(permission);}
  }
  assert.ok(permissions().has('quotes.create')&&permissions().has('quotes.edit')&&!permissions().has('customers.view'));
  await login(workerEmail);assert.equal(String((await api('/api/state')).access?.userId),String(worker.userId));
  check('Temporary quote writers still cannot read customers',(await request('/api/customers')).status===403);
  for(const label of ['outside','prospect']){
    await scenario('Worker '+label+' PATCH',()=>unchangedVisit('Worker PATCH '+label,visits[label].id,()=>request('/api/quote-visits/'+visits[label].id,'PATCH',{notes:'Unauthorized mutation '+token})));
    await scenario('Worker '+label+' upload',()=>unchangedVisit('Worker upload '+label,visits[label].id,()=>upload(visits[label].id,'worker-'+label)));
    await scenario('Worker '+label+' link',()=>unchangedVisit('Worker link '+label+' to visible project quote',visits[label].id,()=>request('/api/quote-visits/'+visits[label].id+'/quote','POST',{quoteId:quotes.visible.id})));
  }
  await scenario('Worker prospect creation',async()=>{
    const before=mutationTotals(),response=await request('/api/quote-visits','POST',{customerId:customers.A.id,place:'Denied prospect '+token,operationKey:'scope-denied-create-'+token});
    check('Quote create grant alone cannot create an unassigned prospect visit',response.status===403,{status:response.status});
    check('Denied prospect visit creates no record or audit',isDeepStrictEqual(mutationTotals(),before));
  });
  await scenario('Worker cannot adopt an existing prospect quote',async()=>{
    const before=quoteState(quotes.prospect.id),response=await request('/api/quotes/'+quotes.prospect.id,'PUT',{...quoteFields(quotes.prospect),projectId:String(visible.id)});
    check('PUT checks original prospect scope before moving to assigned project',response.status===403,{status:response.status});
    check('Denied quote adoption preserves original quote and audit',isDeepStrictEqual(quoteState(quotes.prospect.id),before));
  });

  await login(ownerEmail);
  await scenario('Owner cannot change the client behind an already linked visit',async()=>{
    const before=quoteState(quotes.visible.id),visitBefore=visitState(visits.visible.id);
    const response=await request('/api/quotes/'+quotes.visible.id,'PUT',{...quoteFields(quotes.visible),customerId:customers.B.id});
    check('Linked quote A to customer B is rejected',response.status===409,{status:response.status});
    check('Rejected client change preserves quote and audit',isDeepStrictEqual(quoteState(quotes.visible.id),before));
    check('Rejected client change preserves visit and document relations',isDeepStrictEqual(visitState(visits.visible.id),visitBefore));
  });
  await scenario('Owner positive scope remains available',async()=>{
    check('Owner session remains the owner',(await api('/api/state')).role==='OWNER');
    for(const quote of Object.values(quotes))check('Owner still reads each created quote',(await request('/api/quotes/'+quote.id)).status===200);
    for(const visit of Object.values(visits))check('Owner still reads each created visit',(await request('/api/quote-visits/'+visit.id)).status===200);
  });
  // The permission cleanup below does not delete our isolated commercial rows.
  // A red run must keep the real accepted/rejected mutations for root diagnosis.
  assert.deepEqual([...permissions()].filter(permission=>!addedPermissions.includes(permission)).sort(),originalPermissions,'Only the explicitly tracked role grants may change.');
}catch(error){check('Mandatory real fixture/setup or transport',false,{error:String(error?.message||error).slice(0,400)});}
finally{
  for(const permission of addedPermissions)try{
    const result=database.prepare('DELETE FROM role_permissions WHERE role_id=? AND permission_code=?').run(worker.roleId,permission);
    check('Restore temporary role grant '+permission,result.changes===1);
  }catch{check('Restore temporary role grant '+permission,false);}
  try{if(worker)check('No added commercial permission remains',addedPermissions.every(permission=>!permissions().has(permission)));}catch{check('Read restored permissions',false);}
  try{if(tab)await login(ownerEmail);}catch{check('Restore owner browser identity',false);}
  try{if(tab)await tab.close();}catch{check('Close owned browser context',false);}
  try{if(browser)await browser.close();}catch{check('Close own CDP connection',false);}
  database.close();
}
console.log('COMMERCIAL_CLIENT_SCOPE '+JSON.stringify({setupComplete,failedChecks:failures.length,failures}));
assert.equal(setupComplete,true,'All real commercial/scope fixtures must exist; no skipped or manufactured user/project scope.');
assert.equal(failures.length,0,'Commercial client-scope regressions: '+failures.join('; '));
