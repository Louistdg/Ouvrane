import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,cpSync,mkdtempSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const app=process.env.OUVRANE_TEST_APP||dirname(dirname(fileURLToPath(import.meta.url))),out=process.env.OUVRANE_TEST_OUTPUT||join(tmpdir(),'ouvrane-document-revocation');mkdirSync(out,{recursive:true});const run=mkdtempSync(join(out,'document-'));
cpSync(join(app,'worker'),join(run,'runtime'),{recursive:true});cpSync(join(app,'dist/server/measurement-engine.js'),join(run,'runtime/measurement-engine.js'));writeFileSync(join(run,'runtime/package.json'),'{"type":"module"}');
const worker=(await import(pathToFileURL(join(run,'runtime/index.js')))).default,{openProductionDatabase}=await import(pathToFileURL(join(app,'scripts/production-db.mjs'))),opened=openProductionDatabase({databasePath:join(run,'synthetic.sqlite'),migrationsDirectory:join(app,'drizzle')}),db=opened.database,stamp='2026-10-27T09:00:00.000Z',checks=[];
let hook=null;
function prepare(sql){const statement=opened.DB.prepare(sql);function wrap(s){const after=async(method,args)=>{const result=await s[method](...args);if(hook?.match(sql,method)){const h=hook;hook=null;h.run()}return result};return{bind:(...args)=>wrap(s.bind(...args)),first:(...args)=>after('first',args),all:(...args)=>after('all',args),run:(...args)=>after('run',args)}}return wrap(statement)}
const env={DB:{prepare,batch:s=>opened.DB.batch(s)}};
const content=Buffer.from('%PDF-1.4\nPRIVATE-SYNTHETIC-REVOCATION-ONLY\n%%EOF\n');
async function get(suffix='preview',uid='reader',organization='org'){
 const response=await worker.fetch(new Request('https://ouvrane.test/api/documents/doc/'+suffix,{headers:{origin:'https://ouvrane.test','oai-authenticated-user-id':uid,'x-socle-organization-id':organization}}),env);const bytes=Buffer.from(await response.arrayBuffer());return{status:response.status,bytes,headers:response.headers};
}
function check(name,ok){checks.push({name,pass:Boolean(ok)});console.log((ok?'PASS ':'FAIL ')+name)}
const grants=['documents.secure.view','projects.view.all','customers.view','invoices.view','accounting.view'];
function reset(){hook=null;db.prepare("UPDATE organization_members SET status='active',role_id=CASE WHEN user_id='owner' THEN 'owner-role' ELSE 'reader-role' END WHERE organization_id='org'").run();for(const p of grants)db.prepare('INSERT OR IGNORE INTO role_permissions VALUES(?,?)').run('reader-role',p);db.prepare("DELETE FROM role_permissions WHERE role_id='reader-role' AND permission_code='projects.view.assigned'").run();db.prepare("UPDATE secure_documents SET archived_at=NULL,status='available',sensitivity='standard',business_owner_type='organization',business_owner_id='org',byte_size=? WHERE id='doc'").run(content.length);db.prepare("UPDATE invoices SET archived_at=NULL,project_id=NULL WHERE id='invoice'").run();}
try{
 for(const uid of ['owner','reader'])db.prepare('INSERT INTO profiles(id,first_name,last_name,email,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(uid,'Synthetic',uid,uid+'@example.invalid',stamp,stamp);
 db.prepare('INSERT INTO organizations(id,name,created_at,updated_at) VALUES(?,?,?,?)').run('org','Synthetic only',stamp,stamp);
 for(const [id,code] of [['owner-role','OWNER'],['reader-role','SECRETARY'],['blocked-role','WORKER']])db.prepare('INSERT INTO roles(id,organization_id,code,name,created_at) VALUES(?,?,?,?,?)').run(id,'org',code,code,stamp);
 for(const uid of ['owner','reader'])db.prepare("INSERT INTO organization_members(id,organization_id,user_id,role_id,status,joined_at,created_at,updated_at) VALUES(?,?,?,?,'active',?,?,?)").run(uid+'-member','org',uid,uid+'-role',stamp,stamp,stamp);
 for(const p of [...grants,'projects.view.assigned'])db.prepare('INSERT OR IGNORE INTO permissions VALUES(?,?)').run(p,p);
 db.prepare('INSERT INTO organization_workspace_state(organization_id,payload,revision,source_user_id,created_at,updated_at) VALUES(?,?,1,?,?,?)').run('org',JSON.stringify({version:3,jobs:[],people:[],teams:[],assignments:[],quotes:[]}),'owner',stamp,stamp);
 db.prepare("INSERT INTO projects(id,organization_id,name,status,created_at,updated_at) VALUES('unassigned-project','org','Synthetic unassigned','active',?,?)").run(stamp,stamp);
 db.prepare('INSERT INTO document_folders(id,organization_id,name,context_type,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('folder','org','Synthetic','company','owner',stamp,stamp);
 db.prepare('INSERT INTO secure_documents(id,organization_id,folder_id,storage_key,original_name,content_type,byte_size,sensitivity,status,uploaded_by,created_at,updated_at,business_owner_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('doc','org','folder','private/org/doc','invoice.pdf','application/pdf',content.length,'standard','available','owner',stamp,stamp,'org');
 db.prepare('INSERT INTO secure_document_blobs(document_id,organization_id,content,created_at) VALUES(?,?,?,?)').run('doc','org',content,stamp);
 db.prepare("INSERT INTO invoices(id,organization_id,invoice_number,invoice_type,status,issue_date,due_date,currency,subtotal_cents,vat_amount_cents,total_cents,created_by,created_at,updated_at) VALUES('invoice','org','SYNTHETIC','standard','unpaid','2026-10-27','2026-11-27','EUR',100,0,100,'owner',?,?)").run(stamp,stamp);
 db.prepare('INSERT INTO document_relations VALUES(?,?,?,?,?,?,?)').run('invoice-doc','org','doc','invoice','invoice','owner',stamp);
 reset();for(const suffix of ['preview','download']){const normal=await get(suffix);check(suffix+' authorized exact private bytes',normal.status===200&&normal.bytes.equals(content));check(suffix+' private no-store and PDF',normal.headers.get('cache-control')==='private, no-store'&&normal.headers.get('content-type')==='application/pdf');}
 const cases=[
  ['document permission revoked',()=>db.prepare("DELETE FROM role_permissions WHERE role_id='reader-role' AND permission_code='documents.secure.view'").run()],
  ['membership suspended',()=>db.prepare("UPDATE organization_members SET status='disabled' WHERE user_id='reader'").run()],
  ['role replaced',()=>db.prepare("UPDATE organization_members SET role_id='blocked-role' WHERE user_id='reader'").run()],
  ['document archived',()=>db.prepare("UPDATE secure_documents SET archived_at=? WHERE id='doc'").run(stamp)],
  ['document made unavailable',()=>db.prepare("UPDATE secure_documents SET status='quarantined' WHERE id='doc'").run()],
  ['sensitivity raised',()=>db.prepare("UPDATE secure_documents SET sensitivity='confidential' WHERE id='doc'").run()],
  ['linked invoice archived',()=>db.prepare("UPDATE invoices SET archived_at=? WHERE id='invoice'").run(stamp)],
  ['accounting permission revoked',()=>db.prepare("DELETE FROM role_permissions WHERE role_id='reader-role' AND permission_code='accounting.view'").run()],
  ['project scope revoked',()=>{db.prepare("DELETE FROM role_permissions WHERE role_id='reader-role' AND permission_code='projects.view.all'").run();db.prepare("INSERT OR IGNORE INTO role_permissions VALUES('reader-role','projects.view.assigned')").run();db.prepare("UPDATE invoices SET project_id='unassigned-project' WHERE id='invoice'").run()}],
 ];
 for(const [label,revoke] of cases)for(const suffix of ['preview','download']){
  reset();const logsBefore=db.prepare('SELECT COUNT(*) n FROM document_access_logs').get().n;hook={match:(sql,method)=>method==='first'&&sql.startsWith('SELECT content FROM secure_document_blobs'),run:revoke};const denied=await get(suffix);
  check(label+' '+suffix+' injection reached exact BLOB seam',hook===null);check(label+' '+suffix+' denied after BLOB read',denied.status===404);check(label+' '+suffix+' no private bytes',!denied.bytes.includes(Buffer.from('PRIVATE-SYNTHETIC')));check(label+' '+suffix+' no successful access log',db.prepare('SELECT COUNT(*) n FROM document_access_logs').get().n===logsBefore);
 }
 reset();hook={match:(sql,method)=>method==='run'&&sql.startsWith('INSERT INTO document_access_logs'),run:()=>db.prepare("DELETE FROM role_permissions WHERE role_id='reader-role' AND permission_code='documents.secure.view'").run()};const logCount=db.prepare('SELECT COUNT(*) n FROM document_access_logs').get().n;const late=await get();check('revocation during access log still prevents bytes',late.status===404&&!late.bytes.includes(Buffer.from('PRIVATE-SYNTHETIC')));check('failed late delivery removes only its own success log',db.prepare('SELECT COUNT(*) n FROM document_access_logs').get().n===logCount);
 reset();hook={match:(sql,method)=>method==='first'&&sql.startsWith('SELECT content FROM secure_document_blobs'),run:()=>db.prepare("UPDATE organization_members SET status='disabled' WHERE user_id='owner'").run()};const owner=await get('preview','owner');check('even OWNER loses access when membership revoked in flight',owner.status===404&&!owner.bytes.includes(Buffer.from('PRIVATE-SYNTHETIC')));
 reset();const foreign=await get('preview','reader','unowned-org');check('unowned organization denied',foreign.status===403);check('SQLite integrity',db.prepare('PRAGMA integrity_check').get().integrity_check==='ok');check('foreign keys',db.prepare('PRAGMA foreign_key_check').all().length===0);
}finally{opened.close();const report={at:new Date().toISOString(),run,sourceSha256:createHash('sha256').update(readFileSync(join(run,'runtime/index.js'))).digest('hex'),passed:checks.filter(c=>c.pass).length,total:checks.length,checks};writeFileSync(join(run,'RESULTATS.json'),JSON.stringify(report,null,2));console.log('DOCUMENT_REVOCATION '+report.passed+'/'+report.total);if(checks.some(c=>!c.pass))process.exitCode=1}
