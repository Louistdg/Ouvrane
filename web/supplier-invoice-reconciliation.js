function reconciliationSupplierId(item){
 return String(item?.supplier_id??item?.supplierId??'');
}

function reconciliationMonth(value){
 return /^\d{4}-\d{2}/.test(String(value||''))?String(value).slice(0,7):'';
}

function supplierInvoiceReconciliationAnalyze(expense,orders,deliveries){
 const supplierId=reconciliationSupplierId(expense);
 const linkedOrderId=String(expense.purchase_order_id||'');
 const linkedDeliveryId=String(expense.delivery_note_id||'');
 const linkedDelivery=linkedDeliveryId?deliveries.find(note=>String(note.id)===linkedDeliveryId):null;
 if(linkedDeliveryId&&!linkedDelivery){
  return {status:'unmatched',reason:'Le bon de livraison lié à la facture est absent des données visibles; vérification impossible.',candidates:[]};
 }
 const deliveryOrderId=linkedDelivery?String(linkedDelivery.orderId??linkedDelivery.order_id):'';
 if(linkedOrderId&&deliveryOrderId&&linkedOrderId!==deliveryOrderId){
  return {status:'unmatched',reason:'La commande et le bon de livraison liés à la facture se contredisent.',candidates:[]};
 }
 const targetOrderId=linkedOrderId||deliveryOrderId;
 let candidates=[];
 let reason='';

 if(targetOrderId){
  const order=orders.find(item=>String(item.id)===targetOrderId);
  if(!order)return {status:'unmatched',reason:'La commande indiquée sur la facture est absente des données visibles.',candidates:[]};
  if(supplierId&&reconciliationSupplierId(order)!==supplierId){
   return {status:'unmatched',reason:'Le fournisseur de la commande ne correspond pas à celui de la facture.',candidates:[]};
  }
  candidates=[order];
  reason=supplierId?'Commande liée explicitement sur la facture; fournisseur identique.':'Commande liée explicitement; fournisseur à contrôler.';
 }else if(supplierId){
  candidates=orders.filter(order=>reconciliationSupplierId(order)===supplierId);
  reason='Même fournisseur; aucune référence de commande n’est enregistrée sur la facture.';
 }else{
  return {status:'unmatched',reason:'Le fournisseur n’est pas renseigné; aucune commande ne peut être proposée sans deviner.',candidates:[]};
 }

 if(!candidates.length){
  return {status:'unmatched',reason:'Aucune commande de ce fournisseur dans les données visibles. Facture non rapprochée.',candidates:[]};
 }

 const invoiceMonth=reconciliationMonth(expense.expense_date);
 const enriched=candidates.map(order=>{
  const orderMonth=reconciliationMonth(order.expectedDate||order.expected_date);
  const orderId=String(order.id);
  let noteReason='Livraisons rattachées à cette commande.';
  let notes=deliveries.filter(note=>String(note.orderId??note.order_id)===orderId);

  if(linkedDeliveryId){
   if(String(linkedDelivery.orderId??linkedDelivery.order_id)!==orderId){notes=[];noteReason='Le bon indiqué ne correspond pas à cette commande.';}
   else{notes=[linkedDelivery];noteReason='Bon de livraison explicitement lié sur la facture.';}
  }

  const lines=(order.lines||[]).map(line=>{
   const orderLineId=String(line.id);
   const receivedLines=notes.filter(note=>['Reçue','Avec réserve'].includes(String(note.status||''))).flatMap(note=>(note.lines||[]).filter(item=>String(item.orderLineId??item.order_line_id)===orderLineId).map(item=>({note,item})));
   const accepted=receivedLines.filter(({item})=>item.condition!=='Refusé'),acceptedMilli=accepted.reduce((sum,{item})=>sum+Math.max(0,Math.round(Number(item.received||0)*1000)),0);
   const refusedMilli=receivedLines.filter(({item})=>item.condition==='Refusé').reduce((sum,{item})=>sum+Math.max(0,Math.round(Number(item.received||0)*1000)),0);
   const orderedMilli=Math.max(0,Math.round(Number(line.quantity||0)*1000));
   const price=Number(line.unitPrice??line.unit_price);
   return {
    orderLineId,reference:String(line.reference||''),label:String(line.label||''),unit:String(line.unit||''),
    orderedMilli,acceptedMilli,refusedMilli,
    receipts:accepted.map(({note,item})=>({deliveryNoteId:String(note.id),deliveryNumber:String(note.number||note.id),deliveryLineId:String(item.id),acceptedMilli:Math.max(0,Math.round(Number(item.received||0)*1000))})),
    missingMilli:Math.max(0,orderedMilli-acceptedMilli),excessMilli:Math.max(0,acceptedMilli-orderedMilli),
    orderedUnitPriceCents:Number.isFinite(price)?Math.round(price*100):null,
    invoicedMilli:null,invoicedUnitPriceCents:null
   };
  });
  const periodMatches=Boolean(invoiceMonth&&orderMonth&&invoiceMonth===orderMonth);
  const reasons=[reason];
  if(periodMatches)reasons.push('même mois de commande et de facture');
  if(expense.delivery_note_id)reasons.push(noteReason);
  return {orderId,orderNumber:String(order.number||order.id),projectId:String(order.job??order.projectId??''),periodMatches,reasons,notes,lines};
 });

 return {status:enriched.length===1?'candidate':'ambiguous',reason,candidates:enriched};
}

function reconciliationEscape(value){
 return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function reconciliationQuantity(milli,unit){
 const number=new Intl.NumberFormat('fr-BE',{minimumFractionDigits:0,maximumFractionDigits:3}).format(Number(milli||0)/1000);
 return `${number}${unit?` ${reconciliationEscape(unit)}`:''}`;
}

function reconciliationMoney(cents){
 if(cents===null||cents===undefined)return 'Non disponible';
 return new Intl.NumberFormat('fr-BE',{style:'currency',currency:'EUR'}).format(Number(cents)/100);
}

function updateSupplierInvoiceReconciliation(form){
 for(const row of form.querySelectorAll('[data-reconciliation-line]')){
  const quantity=row.querySelector('[name="invoicedQuantity"]');
  const unitPrice=row.querySelector('[name="invoicedUnitPrice"]');
  const invoiceReference=row.querySelector('[name="invoiceReference"]');
  const referenceResult=row.querySelector('[data-reference-variance]');
  const quantityResult=row.querySelector('[data-quantity-variance]');
  const priceResult=row.querySelector('[data-price-variance]');
  const quantityValue=quantity.value.trim()===''?null:Number(quantity.value);
  const priceValue=unitPrice.value.trim()===''?null:Number(unitPrice.value);
  const referenceValue=invoiceReference.value.trim();

  if(!referenceValue){
   referenceResult.textContent='À relever sur la facture';
  }else if(!row.dataset.orderReference){
   referenceResult.textContent='Référence commandée absente';
  }else{
   const invoiceReferenceNormalized=referenceValue.normalize('NFKC').toLocaleLowerCase('fr');
   const orderReferenceNormalized=row.dataset.orderReference.normalize('NFKC').toLocaleLowerCase('fr');
   referenceResult.textContent=invoiceReferenceNormalized===orderReferenceNormalized?'Références alignées':'Référence différente de la commande';
  }

  if(quantityValue===null||!Number.isFinite(quantityValue)||quantityValue<0){
   quantityResult.textContent='À relever sur la facture';
  }else{
   const invoiceMilli=Math.round(quantityValue*1000);
   const receivedMilli=Number(row.dataset.acceptedMilli);
   const delta=invoiceMilli-receivedMilli;
   quantityResult.textContent=delta>0
    ?`Facturé au-delà du reçu : ${reconciliationQuantity(delta,row.dataset.unit)}`
    :delta<0?`Reçu non facturé : ${reconciliationQuantity(-delta,row.dataset.unit)}`:'Facture et reçu alignés';
  }

  if(priceValue===null||!Number.isFinite(priceValue)||priceValue<0){
   priceResult.textContent='À relever sur la facture';
  }else if(row.dataset.orderedUnitPriceCents===''){
   priceResult.textContent='Prix commandé indisponible';
  }else{
   const delta=Math.round(priceValue*100)-Number(row.dataset.orderedUnitPriceCents);
   priceResult.textContent=delta>0
    ?`Facturé ${reconciliationMoney(delta)} de plus`
    :delta<0?`Facturé ${reconciliationMoney(-delta)} de moins`:'Prix alignés';
  }
 }
}

function supplierInvoiceReconciliationRender(expense,result){
 const label=reconciliationEscape(expense.supplier_name||'Fournisseur non renseigné');
 const reference=reconciliationEscape(expense.supplier_reference||expense.description||'Facture sans référence');
 const intro=`<p><strong>${label}</strong> · ${reference} · HTVA ${reconciliationMoney(expense.subtotal_cents)}</p>`;
 if(result.status==='unmatched'){
  return `${intro}<div class="notice"><strong>JE NE SAIS PAS — facture non rapprochée.</strong><p>${reconciliationEscape(result.reason)}</p></div><p class="help-line">Aucune commande ne sera choisie automatiquement.</p>`;
 }

 const warning=result.status==='ambiguous'
  ?'<div class="notice"><strong>Plusieurs commandes possibles — je ne sais pas laquelle correspond.</strong><p>Vérifiez les pièces avant toute décision.</p></div>'
  :'<div class="notice"><strong>Proposition à vérifier par une personne.</strong><p>La correspondance par fournisseur ou par lien enregistré ne vaut pas validation.</p></div>';
 const candidates=result.candidates.map(candidate=>{
  const deliveryNames=candidate.notes.map(note=>`${reconciliationEscape(note.number||note.id)} · ${reconciliationEscape(note.status||'état inconnu')}`).join(', ');
  const rows=candidate.lines.map(line=>{
   const variance=line.excessMilli?`Trop reçu : ${reconciliationQuantity(line.excessMilli,line.unit)}`:line.missingMilli?`Reste à recevoir : ${reconciliationQuantity(line.missingMilli,line.unit)}`:'Réception conforme à la quantité commandée';
   const refused=line.refusedMilli?` · refusé ${reconciliationQuantity(line.refusedMilli,line.unit)}`:'';
   const priceData=line.orderedUnitPriceCents===null?'':String(line.orderedUnitPriceCents);
   return `<tr data-reconciliation-line
     data-accepted-milli="${line.acceptedMilli}"
     data-ordered-unit-price-cents="${priceData}"
     data-order-reference="${reconciliationEscape(line.reference)}"
     data-unit="${reconciliationEscape(line.unit)}">
     <td><strong>${reconciliationEscape(line.label||line.reference||'Ligne sans libellé')}</strong>
       <small>${reconciliationEscape(line.reference||'Référence absente')}</small></td>
     <td>${reconciliationQuantity(line.orderedMilli,line.unit)}
       <small>${reconciliationEscape(variance)}</small></td>
     <td>${reconciliationQuantity(line.acceptedMilli,line.unit)}${refused?`<small>${refused}</small>`:''}</td>
     <td><label><span class="sr-only">Référence facturée pour ${reconciliationEscape(line.label)}</span>
       <input name="invoiceReference" type="text" oninput="updateSupplierInvoiceReconciliation(this.form)"></label></td>
     <td data-reference-variance>À relever sur la facture</td>
     <td><label><span class="sr-only">Quantité facturée pour ${reconciliationEscape(line.label)}</span>
       <input name="invoicedQuantity" type="number" min="0" step="0.001" inputmode="decimal" oninput="updateSupplierInvoiceReconciliation(this.form)"></label></td>
     <td data-quantity-variance>À relever sur la facture</td>
     <td>${reconciliationMoney(line.orderedUnitPriceCents)}</td>
     <td><label><span class="sr-only">Prix unitaire facturé pour ${reconciliationEscape(line.label)} en euros</span>
       <input name="invoicedUnitPrice" type="number" min="0" step="0.01" inputmode="decimal" oninput="updateSupplierInvoiceReconciliation(this.form)"></label></td>
     <td data-price-variance>À relever sur la facture</td>
   </tr>`;
  }).join('');
  const period=candidate.periodMatches?' · même mois':' · période non confirmée';
  return `<section class="panel">
    <div class="panel-head"><div>
      <h3>Commande ${reconciliationEscape(candidate.orderNumber)}</h3>
      <span>${candidate.reasons.map(reconciliationEscape).join(' · ')}${period}</span>
    </div></div>
    <p><strong>Bons de livraison :</strong> ${deliveryNames||'Aucun bon visible pour cette commande'}</p>
    <div class="data-table"><table>
      <thead><tr>
        <th>Article / référence</th><th>Commandée</th><th>Reçue acceptée</th>
        <th>Réf. facturée</th><th>Écart référence</th><th>Quantité facturée</th>
        <th>Écart facture / reçu</th><th>Prix commandé</th><th>Prix facturé</th><th>Écart de prix</th>
      </tr></thead>
      <tbody>${rows||'<tr><td colspan="10" class="empty">Aucune ligne de commande disponible.</td></tr>'}</tbody>
    </table></div>
  </section>`;
 }).join('');
 return `${intro}${warning}<p class="help-line">Relevez les références, quantités et prix unitaires sur la facture pour comparer les lignes. Rien n’est enregistré tant qu’un rapprochement n’est pas confirmé explicitement ; les écarts de réception affichés ne remplacent pas ces données.</p><form onsubmit="event.preventDefault();return false">${candidates}</form><p class="notice">Mode revue assistée : aucune correspondance n’est créée automatiquement. Une validation explicite est nécessaire pour enregistrer un rapprochement traçable.</p>`;
}

function supplierInvoiceMatchRemainingCents(allocation,matches){
 const used=(matches||[]).filter(item=>item.status==='active'&&String(item.allocationId)===String(allocation.id)).reduce((sum,item)=>sum+Number(item.matchedCents||0),0);
 return Math.max(0,Number(allocation.amountCents||0)-used);
}
function supplierInvoiceReceiptRemainingMilli(receipt,matches){
 const used=(matches||[]).filter(item=>item.status==='active'&&String(item.deliveryLineId)===String(receipt.deliveryLineId)).reduce((sum,item)=>sum+Number(item.matchedQuantityMilli||0),0);
 return Math.max(0,Number(receipt.acceptedMilli||0)-used);
}
function supplierInvoiceMatchHistoryHtml(matches){
 if(!matches?.length)return '<p class="help-line">Aucun rapprochement enregistré pour cette facture.</p>';
 return '<section class="panel"><div class="panel-head"><h3>Rapprochements enregistrés</h3></div>'+matches.map(item=>'<div class="detail-row"><span><strong>'+reconciliationMoney(item.matchedCents)+'</strong><small>'+reconciliationQuantity(item.matchedQuantityMilli,'')+' · commande '+reconciliationEscape(item.orderId)+' · ligne de réception '+reconciliationEscape(item.deliveryLineId)+'</small></span><span><span class="badge '+(item.status==='active'?'green':'')+'">'+(item.status==='active'?'Actif':'Annulé')+'</span>'+(item.status==='active'?'<button class="link" data-void-supplier-match="'+reconciliationEscape(item.id)+'">Annuler le rapprochement</button>':'')+'</span></div>').join('')+'</section>';
}
function enhanceSupplierInvoiceReconciliation(expense,result,allocations,matches){
 const root=document.querySelector('#modalbody');if(!root||!Array.isArray(allocations)||!Array.isArray(matches))return;
 root.insertAdjacentHTML('afterbegin',supplierInvoiceMatchHistoryHtml(matches));
 for(const button of root.querySelectorAll('[data-void-supplier-match]'))button.onclick=()=>voidSupplierInvoiceMatch(expense.id,button.dataset.voidSupplierMatch);
 if(result.status!=='candidate'){root.insertAdjacentHTML('beforeend','<p class="notice">Enregistrement désactivé tant que plusieurs commandes restent possibles. Choisissez ou liez explicitement la commande avant de confirmer.</p>');return}
 const candidate=result.candidates[0],projectAllocations=allocations.filter(item=>item.status==='active'&&item.destinationType==='project'&&String(item.destinationId)===String(candidate.projectId)&&supplierInvoiceMatchRemainingCents(item,matches)>0);
 const rows=[...root.querySelectorAll('[data-reconciliation-line]')];
 candidate.lines.forEach((line,index)=>{
  const row=rows[index];if(!row)return;const receipts=(line.receipts||[]).map(receipt=>({...receipt,remainingMilli:supplierInvoiceReceiptRemainingMilli(receipt,matches)})).filter(receipt=>receipt.remainingMilli>0);
  const cell=document.createElement('td');cell.dataset.matchControls='1';
  if(!projectAllocations.length)cell.innerHTML='<small>Ventilez d’abord cette facture sur le chantier.</small>';
  else if(!receipts.length)cell.innerHTML='<small>Aucune quantité reçue encore disponible à rapprocher.</small>';
  else{
   const allocationSelect=document.createElement('select');allocationSelect.name='matchAllocation';for(const allocation of projectAllocations){const option=new Option((allocation.destinationLabel||candidate.projectId)+' · reste '+reconciliationMoney(supplierInvoiceMatchRemainingCents(allocation,matches)),allocation.id);allocationSelect.add(option)}
   const receiptSelect=document.createElement('select');receiptSelect.name='matchReceipt';for(const receipt of receipts){const option=new Option((receipt.deliveryNumber||receipt.deliveryNoteId)+' · reste '+reconciliationQuantity(receipt.remainingMilli,line.unit),receipt.deliveryLineId);option.dataset.deliveryNoteId=receipt.deliveryNoteId;option.dataset.remainingMilli=String(receipt.remainingMilli);receiptSelect.add(option)}
   const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='Confirmer ce rapprochement';button.onclick=()=>saveSupplierInvoiceMatch(expense,candidate,line,row,allocationSelect,receiptSelect,button);
   const status=document.createElement('small');status.dataset.matchStatus='1';cell.append(allocationSelect,receiptSelect,button,status);
  }
  row.append(cell);
 });
 for(const table of root.querySelectorAll('.data-table table')){const head=table.querySelector('thead tr');if(head&&!head.querySelector('[data-match-head]')){const th=document.createElement('th');th.dataset.matchHead='1';th.textContent='Validation';head.append(th)}}
 root.insertAdjacentHTML('beforeend','<p class="notice"><strong>Validation humaine obligatoire.</strong> Aucun rapprochement n’est créé par la simple proposition. Le serveur revérifie ventilation, chantier, commande, réception, quantité et montant au moment de confirmer.</p>');
}
async function saveSupplierInvoiceMatch(expense,candidate,line,row,allocationSelect,receiptSelect,button){
 const status=row.querySelector('[data-match-status]'),quantity=Number(row.querySelector('[name="invoicedQuantity"]')?.value),unitPrice=Number(row.querySelector('[name="invoicedUnitPrice"]')?.value),receiptOption=receiptSelect.selectedOptions[0],matchedQuantityMilli=Math.round(quantity*1000),matchedCents=Math.round(quantity*unitPrice*100);
 if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unitPrice)||unitPrice<=0||!receiptOption){status.textContent='Renseignez une quantité et un prix facturés positifs, puis choisissez la réception.';return}
 if(matchedQuantityMilli>Number(receiptOption.dataset.remainingMilli||0)){status.textContent='La quantité dépasse le reste de cette réception.';return}
 button.disabled=true;status.textContent='';
 row.dataset.matchOperationKey||='supplier-match-'+crypto.randomUUID();
 try{
  await serverJson('/api/supplier-invoices/'+encodeURIComponent(expense.id)+'/matches',{method:'POST',body:JSON.stringify({allocationId:allocationSelect.value,projectId:candidate.projectId,orderId:candidate.orderId,orderLineId:line.orderLineId,deliveryNoteId:receiptOption.dataset.deliveryNoteId,deliveryLineId:receiptOption.value,matchedCents,matchedQuantityMilli,operationKey:row.dataset.matchOperationKey})});
  toast('Rapprochement fournisseur enregistré avec traçabilité.');await openSupplierInvoiceReconciliation(expense.id);
 }catch(error){status.textContent=error.message;button.disabled=false}
}
async function voidSupplierInvoiceMatch(expenseId,matchId){
 if(!confirm('Annuler ce rapprochement ? L’historique sera conservé.'))return;
 try{await serverJson('/api/supplier-invoices/'+encodeURIComponent(expenseId)+'/matches/'+encodeURIComponent(matchId)+'/void',{method:'POST'});toast('Rapprochement annulé avec traçabilité.');await openSupplierInvoiceReconciliation(expenseId)}catch(error){toast(error.message||'Annulation refusée.')}
}
async function openSupplierInvoiceReconciliation(expenseId){
 const expenses=typeof serverExpenses==='undefined'?[]:serverExpenses;
 const expense=expenses.find(item=>String(item.id)===String(expenseId));
 if(!expense){toast('Facture fournisseur introuvable dans les données chargées.');return;}
 const orders=typeof purchaseOrders==='undefined'?[]:purchaseOrders;
 const deliveries=typeof deliveryNotes==='undefined'?[]:deliveryNotes;
 const result=supplierInvoiceReconciliationAnalyze(expense,orders,deliveries);
 let allocations=null,matches=null;
 try{const data=await serverJson('/api/expenses/'+encodeURIComponent(expenseId)+'/allocations');allocations=data.allocations||[]}catch{}
 try{const data=await serverJson('/api/supplier-invoices/'+encodeURIComponent(expenseId)+'/matches');matches=data.matches||[]}catch{}
 modal('Rapprochement de facture fournisseur',supplierInvoiceReconciliationRender(expense,result));
 enhanceSupplierInvoiceReconciliation(expense,result,allocations,matches);
}

globalThis.openSupplierInvoiceReconciliation=openSupplierInvoiceReconciliation;
globalThis.updateSupplierInvoiceReconciliation=updateSupplierInvoiceReconciliation;
globalThis.saveSupplierInvoiceMatch=saveSupplierInvoiceMatch;
globalThis.voidSupplierInvoiceMatch=voidSupplierInvoiceMatch;
globalThis.supplierInvoiceReconciliation={analyze:supplierInvoiceReconciliationAnalyze,render:supplierInvoiceReconciliationRender};
