import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {calculatePlanPage} from '../worker/plan-geometry.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
let checks=0;
async function test(name,fn){await fn();console.log('PASS '+name);checks++}
function context(file){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{isConnected:true,disabled:false,hidden:false,textContent:'',innerHTML:'',value:'',replaceChildren(){},addEventListener(){},querySelector(selector){return node(selector)}});return nodes.get(id)};
 const sandbox={console,structuredClone,setTimeout,clearTimeout,AbortController,crypto:globalThis.crypto,esc:value=>String(value??''),activeSocleOrganizationId:'org-a',MutationObserver:class{observe(){}},document:{querySelector:node},purchasesView(){},closeModal(){},openQuoteDraftFolder(){},backModal(){},addEventListener(){},SoclePlanGeometry:{calculatePlanPage},toast(){},btoa:s=>Buffer.from(s,'binary').toString('base64')};
 const c=vm.createContext(sandbox);vm.runInContext(readFileSync(new URL('../web/'+file,import.meta.url),'utf8'),c);
 return {c,node,run:s=>vm.runInContext(s,c)};
}
await test('Late import preview failure cannot erase a newer success',async()=>{
 const {c,run}=context('supplier-imports.js'),a=deferred(),b=deferred();let requests=0;
 c.serverJson=()=>++requests===1?a.promise:b.promise;
 run("supplierImportDesk={root:document.querySelector('#supplierImports'),organizationId:'org-a',revision:0};readSupplierImport=()=>({filename:'fixture.csv'});supplierImportTable=()=>'<table>current</table>'");
 const first=run('previewSupplierImport()'),second=run('previewSupplierImport()');b.resolve({previewSignature:'new',rows:[]});await second;a.reject(Error('old error'));await first;
 assert.equal(run('supplierImportDesk.preview.previewSignature'),'new');assert.equal(run("document.querySelector('#supplierImportCommit').disabled"),false);
});
await test('Import preview crossing organization is ignored',async()=>{
 const {c,run}=context('supplier-imports.js'),pending=deferred();c.serverJson=()=>pending.promise;
 run("supplierImportDesk={root:document.querySelector('#supplierImports'),organizationId:'org-a',revision:0};readSupplierImport=()=>({});supplierImportTable=()=>''");
 const request=run('previewSupplierImport()');c.activeSocleOrganizationId='org-b';pending.resolve({rows:[]});await request;assert.equal(run('supplierImportDesk.preview'),undefined);
});
await test('Cancelled slow file read never starts a worker or replaces the next file',async()=>{
 const {c,run}=context('supplier-imports.js'),pending=deferred();let workers=0;c.Worker=class{constructor(){workers++}};
 c.file={name:'old.csv',size:10,arrayBuffer:()=>pending.promise};run("supplierImportDesk={root:document.querySelector('#supplierImports'),organizationId:'org-a',revision:0,fileRevision:0}");
 const request=run('readSupplierImportFile(file)');run('cancelSupplierImportRead()');pending.resolve(new ArrayBuffer(10));await request;assert.equal(workers,0);assert.equal(run('supplierImportDesk.file'),null);
});
await test('A double import commit has one request',async()=>{
 const {c,run}=context('supplier-imports.js'),pending=deferred();let requests=0;c.serverJson=()=>{requests++;return pending.promise};
 run("supplierImportDesk={root:document.querySelector('#supplierImports'),organizationId:'org-a',revision:0,preview:{},operationKey:'same'}");
 const first=run('commitSupplierImport()');await run('commitSupplierImport()');assert.equal(requests,1);pending.resolve({version:1});await first;
});
await test('OCR result after cancellation cannot fill accounting fields',async()=>{
 const {c,run,node}=context('document-triage.js'),pending=deferred();c.file={type:'application/pdf',size:10};c.extractSupplierInvoicePdf=()=>pending.promise;let parsed=0;c.parseSupplierInvoicePdfText=()=>{parsed++;return {}};
 c.form=node('form');run('socleTriageFile=file');const request=run('readSocleTriagedDocument(form)');run('cancelSocleTriageRead()');pending.resolve({text:'Total TTC 1452',pageCount:1});await request;assert.equal(parsed,0);assert.equal(run('socleTriageReadOperation'),null);
});
await test('OCR result after changing the organization is discarded',async()=>{
 const {c,run,node}=context('document-triage.js'),pending=deferred();c.file={type:'application/pdf',size:10};c.extractSupplierInvoicePdf=()=>pending.promise;let parsed=0;c.parseSupplierInvoicePdfText=()=>{parsed++;return {}};c.form=node('form');run('socleTriageFile=file');const request=run('readSocleTriagedDocument(form)');c.activeSocleOrganizationId='org-b';pending.resolve({text:'Total TTC 1452',pageCount:1});await request;assert.equal(parsed,0);
});
await test('Missing and uncertain invoice amounts stay empty; zero VAT survives',()=>{
 const {run}=context('supplier-invoice-pdf.js');assert.equal(run("parseSupplierInvoicePdfText('Total TTC 1?52,00').total"),null);assert.equal(run("parseSupplierInvoicePdfText('Facture sans montant').total"),null);assert.equal(run("parseSupplierInvoicePdfText('Total TTC 100,00\\nMontant TVA 0,00').vat"),0);assert.equal(run("parseSupplierInvoicePdfText('Total TTC 1452,00\\nMontant TVA 252,00').total"),1452);assert.match(run("parseSupplierInvoicePdfText('Total TTC 1452,00').evidence.total"),/1452/);
});
function historyContext(){const h=context('plans.js');h.c.input={pageNumber:1,pageWidth:1000,pageHeight:800,calibration:{points:[{x:0,y:0},{x:.25,y:0}],lengthM:'5'},annotations:[{id:'surface',kind:'area',label:'surface',points:[{x:.1,y:.1},{x:.6,y:.1},{x:.6,y:.6},{x:.1,y:.6}]},{id:'length',kind:'length',label:'length',points:[{x:.1,y:.1},{x:.6,y:.1}]},{id:'note',kind:'note',label:'note',points:[{x:.1,y:.1}]}]};h.run("planDesk={input:structuredClone(input),root:document.querySelector('#planDesk'),readOnly:false,undo:[],redo:[],pending:[],editRevision:10}");return h}
await test('Undo and redo preserve all annotation kinds, IDs and calibration',()=>{
 const {run}=historyContext(),original=run('JSON.stringify(planDesk.input)');run("removePlanAnnotation('note')");assert.equal(run('planDesk.input.annotations.length'),2);run('undoPlanEdit()');assert.equal(run('JSON.stringify(planDesk.input)'),original);assert.equal(run('planDesk.editRevision'),12);run('redoPlanEdit()');assert.equal(run('planDesk.input.annotations.length'),2);
});
await test('One completed point drag is one undo and keeps the corrected geometry engine',()=>{
 const {run}=historyContext();run("planDesk.dragBefore=structuredClone(planDesk.input);candidate=structuredClone(planDesk.input);candidate.annotations[0].points[0].x=.09;applyPlanDrag(candidate)");assert.equal(run('planDesk.undo.length'),1);run('undoPlanEdit()');assert.equal(run('SoclePlanGeometry.calculatePlanPage(planDesk.input).result.netSurfaceM2'),'80.000');
});
await test('Crossing a polygon rolls the gesture back without adding history',()=>{
 const {run}=historyContext(),before=run('JSON.stringify(planDesk.input)');run("planDesk.dragBefore=structuredClone(planDesk.input);candidate=structuredClone(planDesk.input);candidate.annotations[0].points=[{x:.1,y:.1},{x:.6,y:.6},{x:.6,y:.1},{x:.1,y:.6}];applyPlanDrag(candidate)");assert.equal(run('JSON.stringify(planDesk.input)'),before);assert.equal(run('planDesk.undo.length'),0);
});
await test('Historical plan revisions stay read-only',()=>{
 const {run}=historyContext();run("removePlanAnnotation('note');planDesk.readOnly=true;undoPlanEdit()");assert.equal(run('planDesk.input.annotations.length'),2);assert.equal(run('planDesk.undo.length'),1);
});
console.log('PASS '+checks+' PROMAX async/history regression scenarios');
