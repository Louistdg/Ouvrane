let supplierImportDesk=null;
const beforeSupplierImportsPurchases=purchasesView;
purchasesView=function(){return beforeSupplierImportsPurchases()+`<section class="panel supplier-import-entry"><h2>Tarifs fournisseurs</h2><p>Importez un tarif daté, vérifiez ses références et retrouvez les prix lors de la préparation des achats.</p><button class="btn" onclick="openSupplierImports()">Importer ou consulter les tarifs</button></section>`};
async function openSupplierImports(){
 try{
  const data=await serverJson('/api/supplier-price-imports');supplierImportDesk={...data,sheets:[],file:null,base64:null,preview:null,revision:0,fileRevision:0,operationKey:'supplier-'+crypto.randomUUID()};
  modal('Tarifs fournisseurs',`<section id="supplierImports"><p>CSV UTF-8 ou XLSX · 2 Mo maximum · 2 000 lignes. Les prix sont historisés ; aucun stock ni devis existant n’est modifié.</p><div class="form-two"><label>Fournisseur<select id="supplierImportSupplier"><option value="">Choisir…</option>${data.suppliers.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join('')}</select></label><label>Valable à partir du<input id="supplierImportDate" type="date"></label></div><label>Fichier de prix<input id="supplierImportFile" type="file" accept=".csv,.xlsx"></label><label class="supplier-import-confirm"><input id="supplierImportBasis" type="checkbox"> Je confirme : prix en EUR, HTVA, par unité (et non par paquet).</label><div id="supplierImportMapping"></div><div id="supplierImportPreview" role="status" aria-live="polite"></div><div class="modal-actions"><button id="supplierImportCheck" class="btn" disabled onclick="previewSupplierImport()">Vérifier les correspondances</button><button id="supplierImportCommit" class="btn primary" disabled onclick="commitSupplierImport()">Enregistrer ce tarif</button></div><h3>Historique des imports</h3><div class="supplier-import-history">${data.imports.map(i=>'<div class="detail-row"><span>'+esc(data.suppliers.find(s=>s.id===i.supplierId)?.name||i.supplierId)+' · v'+esc(i.version)+'<small>Valable le '+esc(i.validFrom)+' · '+esc(i.filename)+'</small></span><button class="btn" onclick="openSupplierImportHistory(\''+esc(i.id)+'\')">Détail</button></div>').join('')||'<p>Aucun tarif importé.</p>'}</div></section>`);
  const root=document.querySelector('#supplierImports');root.querySelector('#supplierImportFile').addEventListener('change',e=>readSupplierImportFile(e.target.files[0]));
  root.addEventListener('input',()=>invalidateSupplierImport());
 }catch(e){toast(e.message)}
}
function invalidateSupplierImport(){if(!supplierImportDesk)return;supplierImportDesk.revision++;supplierImportDesk.preview=null;document.querySelector('#supplierImportCommit').disabled=true;document.querySelector('#supplierImportPreview').textContent=''}
async function readSupplierImportFile(file){
 const desk=supplierImportDesk;if(!desk||!file)return;
 invalidateSupplierImport();const fileRevision=++desk.fileRevision;desk.sheets=[];desk.file=null;document.querySelector('#supplierImportCheck').disabled=true;document.querySelector('#supplierImportMapping').textContent='Lecture du fichier…';
 try{
  if(!/\.(csv|xlsx)$/i.test(file.name)||file.size>2000000||!file.size)throw Error('Choisissez un CSV UTF-8 ou XLSX de 2 Mo maximum.');
  const buffer=await file.arrayBuffer();const sheets=await new Promise((resolve,reject)=>{
   const worker=new Worker('/supplier-import-worker.js');const timer=setTimeout(()=>{worker.terminate();reject(Error('Lecture trop longue. Réduisez le classeur.'))},20000);
   const done=fn=>value=>{clearTimeout(timer);worker.terminate();fn(value)};
   worker.onmessage=({data})=>data.error?done(reject)(Error(data.error)):done(resolve)(data.sheets);worker.onerror=done(reject);worker.postMessage({filename:file.name,buffer:buffer.slice(0)},[]);
  });
  if(supplierImportDesk!==desk||desk.fileRevision!==fileRevision)return;
  if(!sheets.some(s=>s.rows.length>1))throw Error('Aucune donnée après la ligne d’en-têtes.');
  let binary='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  desk.base64=btoa(binary);desk.file=file;desk.sheets=sheets.filter(s=>s.rows.length>1);renderSupplierImportMapping();document.querySelector('#supplierImportCheck').disabled=false;
 }catch(e){if(supplierImportDesk===desk&&desk.fileRevision===fileRevision)document.querySelector('#supplierImportMapping').textContent=e.message||'Fichier illisible.'}
}
function renderSupplierImportMapping(index=0){
 const desk=supplierImportDesk;desk.sheetIndex=index;const headers=desk.sheets[index].rows[0];
 const fields=[['reference','Référence','reference|référence|ref|code'],['name','Désignation','désignation|designation|nom|name|libelle|libellé'],['unit','Unité','unité|unite|unit'],['price','Prix HTVA / unité','prix|price|pu|prix htva'],['packageSize','Conditionnement (facultatif)','conditionnement|pack|paquet']];
 document.querySelector('#supplierImportMapping').innerHTML='<p>Fichier chargé : <strong>'+esc(desk.file.name)+'</strong></p><label>Feuille<select id="supplierImportSheet">'+desk.sheets.map((s,i)=>'<option value="'+i+'" '+(i===index?'selected':'')+'>'+esc(s.name)+'</option>').join('')+'</select></label><p>Première ligne : en-têtes. Vérifiez les colonnes ; conditionnement vide = 1 unité.</p><div class="supplier-import-columns">'+fields.map(([key,label,aliases])=>{const guess=headers.findIndex(x=>aliases.split('|').includes(String(x).trim().toLowerCase()));return '<label>'+label+'<select data-import-field="'+key+'"><option value="">'+(key==='packageSize'?'1 unité':'Choisir…')+'</option>'+headers.map((h,i)=>'<option value="'+i+'" '+(guess===i?'selected':'')+'>'+esc(h||'Colonne '+(i+1))+'</option>').join('')+'</select></label>'}).join('')+'</div>';
 document.querySelector('#supplierImportSheet').onchange=e=>{invalidateSupplierImport();renderSupplierImportMapping(Number(e.target.value))};
}
function readSupplierImport(){
 const desk=supplierImportDesk,root=document.querySelector('#supplierImports');if(!desk.file)throw Error('Choisissez un fichier.');
 if(!root.querySelector('#supplierImportBasis').checked)throw Error('Confirmez les prix en EUR HTVA par unité.');
 const mapping={sheet:desk.sheets[desk.sheetIndex].name,columns:{}};const selected=new Set();
 for(const select of root.querySelectorAll('[data-import-field]')){const key=select.dataset.importField;if(select.value===''){if(key!=='packageSize')throw Error('Choisissez toutes les colonnes obligatoires.');mapping.columns[key]=null;continue}const i=Number(select.value);if(selected.has(i))throw Error('Chaque colonne doit correspondre à un seul champ.');selected.add(i);mapping.columns[key]=i}
 const rows=desk.sheets[desk.sheetIndex].rows.slice(1).filter(row=>row.some(x=>String(x??'').trim())).map(row=>Object.fromEntries(Object.entries(mapping.columns).map(([key,i])=>[key,i===null?'1':String(row[i]??'')])));
 return {supplierId:root.querySelector('#supplierImportSupplier').value,validFrom:root.querySelector('#supplierImportDate').value,filename:desk.file.name,originalBase64:desk.base64,currency:'EUR',priceBasis:'unit-ex-vat',mapping,rows};
}
async function previewSupplierImport(){
 try{
  const desk=supplierImportDesk,data=readSupplierImport(),revision=desk.revision;const preview=await serverJson('/api/supplier-price-imports/preview',{method:'POST',body:JSON.stringify(data)});if(supplierImportDesk!==desk||desk.revision!==revision)return;
  desk.preview={...data,previewSignature:preview.previewSignature};
  document.querySelector('#supplierImportPreview').innerHTML='<h3>'+preview.matched+' référence(s) liée(s) · '+preview.unmatched+' sans correspondance</h3><p>Les références sans correspondance restent dans l’historique. Aucun article n’est créé automatiquement.</p>'+supplierImportTable(preview.rows)+'<p>'+esc(preview.notice)+'</p>';document.querySelector('#supplierImportCommit').disabled=false;
 }catch(e){document.querySelector('#supplierImportPreview').textContent=e.message;document.querySelector('#supplierImportCommit').disabled=true}
}
function supplierImportTable(rows){return '<p class="supplier-import-scroll-hint">Faites glisser le tableau pour voir les prix et conditionnements.</p><div class="supplier-import-table" tabindex="0"><table><thead><tr><th>Référence</th><th>Désignation</th><th>Unité</th><th>EUR HTVA / unité</th><th>Paquet</th><th>Stock</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.reference)+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.unit)+'</td><td>'+esc(r.price)+'</td><td>'+esc(r.packageSize)+'</td><td>'+esc(r.stockItemId?'Lié':'Non lié')+'</td></tr>').join('')+'</tbody></table></div>'}
async function commitSupplierImport(){
 const desk=supplierImportDesk;if(!desk?.preview)return;document.querySelector('#supplierImportCommit').disabled=true;
 try{const result=await serverJson('/api/supplier-price-imports/commit',{method:'POST',body:JSON.stringify({...desk.preview,operationKey:desk.operationKey})});document.querySelector('#supplierImportPreview').innerHTML='<p><strong>Tarif enregistré · version '+esc(result.version)+'.</strong> Les prix sont disponibles dans la préparation des achats.</p><button class="btn" onclick="openSupplierImports()">Retour à l’historique</button>';desk.preview=null;desk.operationKey='supplier-'+crypto.randomUUID();toast('Tarif fournisseur enregistré.')}catch(e){document.querySelector('#supplierImportPreview').textContent=e.message;document.querySelector('#supplierImportCommit').disabled=false}
}
async function openSupplierImportHistory(id){
 try{const {import:i}=await serverJson('/api/supplier-price-imports/'+encodeURIComponent(id));modal('Tarif fournisseur · version '+i.version,'<section id="supplierImportHistory"><p>Valable à partir du '+esc(i.validFrom)+' · '+esc(i.filename)+'</p>'+supplierImportTable(i.rows)+'<p class="supplier-import-checksum">SHA-256 : '+esc(i.checksum)+'</p><a class="btn" href="/api/supplier-price-imports/'+encodeURIComponent(i.id)+'/original" download>Télécharger le fichier original</a><button class="btn" onclick="openSupplierImports()">Retour aux tarifs</button></section>')}catch(e){toast(e.message)}
}
