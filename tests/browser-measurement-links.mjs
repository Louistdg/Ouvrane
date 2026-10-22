import assert from 'node:assert/strict';
import {connectBrowser,waitForApp} from './helpers/browser-cdp.mjs';
const base=process.env.SOCLE_TEST_URL,browser=await connectBrowser(base),tab=await browser.createSession(base);
try{
 await tab.navigate(base);
 await tab.evaluate("fetch('/__local-test/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'direction@batinova.example'})})",'login');await tab.reload();await waitForApp(tab);
 const api=async(path,method='GET',data)=>tab.evaluate(`fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{'content-type':'application/json'},${data===undefined?'':`body:JSON.stringify(${JSON.stringify(data)}),`}}).then(async r=>({status:r.status,data:await r.json()}))`,'api-'+path);
 const customerResult=await api('/api/customers','POST',{type:'individual',firstName:'Test',lastName:'Mesure',street:'Rue du test',city:'Namur',country:'BE'});assert.equal(customerResult.status,201,JSON.stringify(customerResult));const customer=customerResult.data.customer;
 assert.equal((await api('/api/measurements/not-in-this-organization')).status,404);
 const v=await api('/api/quote-visits','POST',{customerId:customer.id,place:'V5 test toiture',contact:'Test',notes:'Jeu isolé',operationKey:'v5-visit-'+Date.now()});assert.equal(v.status,201,JSON.stringify(v));const visitId=v.data.visit.id;
 const input={planes:[{id:'a',eaveLengthM:'10',developedSlopeM:'4.2',openingsM2:'2'},{id:'b',eaveLengthM:'10',developedSlopeM:'4.2',openingsM2:'2'}],config:{usefulCoverWidthMm:'180',usefulExposureMm:'120',battenSpacingM:'0.3',counterBattenSpacingM:'0.6',slateWastePct:'10',underlayAllowancePct:'10',timberWastePct:'10'},guttersM:'20',flashingsM:'3',unitPrices:{SLATE_PIECES:'1',UNDERLAY:'2',BATTENS:'3',COUNTER_BATTENS:'4',GUTTERS:'5',FLASHINGS:'6'},packages:{UNDERLAY:'10'},vatRate:21};
 const data={visitId,input,sourceLabel:'Relevé de référence',expectedVersion:0,operationKey:'v5-metre-'+Date.now()};
 const m=await api('/api/measurements','POST',data);assert.equal(m.status,201,JSON.stringify(m));const measurement=m.data.measurement;assert.equal(measurement.result.areaGrossM2,'84.000');assert.equal(measurement.result.areaNetM2,'80.000');const need=measurement.result.materialNeeds.find(x=>x.code==='UNDERLAY');assert.equal(need.requiredQuantity,'92.400');assert.equal(need.packages,'10');assert.equal(need.orderedQuantity,'100');
 assert.equal((await api('/api/measurements','POST',data)).data.replayed,true);
 assert.equal((await api('/api/measurements','POST',{...data,sourceLabel:'Changed'})).status,409);
 assert.equal((await api('/api/measurements','POST',{...data,operationKey:'other-key-123',expectedVersion:0})).status,409);
 assert.equal((await api('/api/measurements','POST',{...data,operationKey:'other-key-456',expectedVersion:1,input:{...input,packages:{UNDERLAY:'0'}}})).status,400);
 const q=await api('/api/quotes','POST',{customerId:customer.id,title:'Test métré',client:'Test',clientAddress:'Namur',date:'2026-10-20',validUntil:'2026-11-20',status:'draft',lines:[{label:'Préparation',qty:1,unit:'forfait',price:10,vat:21}]});assert.equal(q.status,201,JSON.stringify(q));const quote=q.data.quote;
 assert.equal((await api('/api/quote-visits/'+visitId+'/quote','POST',{quoteId:quote.id})).status,200);
 const apply={quoteId:quote.id,expectedLinesJson:JSON.stringify(quote.lines)};
 assert.equal((await api('/api/measurements/'+measurement.id,'POST',{...apply,expectedLinesJson:'[]'})).status,409);
 assert.equal((await api('/api/measurements/'+measurement.id,'POST',apply)).status,200);
 assert.equal((await api('/api/measurements/'+measurement.id,'POST',apply)).data.replayed,true);
 const updated=(await api('/api/quotes/'+quote.id)).data.quote;assert.equal(updated.lines.length,7);assert.match(updated.lines[1].description,new RegExp(measurement.id));
 assert.equal((await api('/api/measurements','POST',{...data,sourceDocumentId:'foreign-document',expectedVersion:1,operationKey:'foreign-doc-123'})).status,404);
 const version2=await api('/api/measurements','POST',{...data,expectedVersion:1,operationKey:'version-two-'+Date.now()});assert.equal(version2.status,201);assert.equal(version2.data.measurement.version,2);
 assert.equal((await api('/api/quotes/'+quote.id,'PUT',{...updated,status:'accepted',id:undefined,createdAt:undefined,updatedAt:undefined})).status,200);
 assert.equal((await api('/api/measurements/'+version2.data.measurement.id,'POST',{quoteId:quote.id,expectedLinesJson:JSON.stringify(updated.lines)})).status,409);
 await tab.evaluate(`loadQuoteVisits({quiet:true})`,'refresh-visits');
 await tab.evaluate(`openQuoteDraftFolder(${JSON.stringify(visitId)})`,'open-visit-folder');
 assert.equal(await tab.evaluate("[...document.querySelectorAll('#modalbody button')].some(x=>x.textContent==='Métrés et besoins')",'entry-point'),true);
 for(const width of [1440,390]){
  await tab.call('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<500});
  await tab.evaluate(`openMeasurementDesk(${JSON.stringify(visitId)})`,'open-measurement-desk');
  assert.equal(await tab.evaluate("!!document.querySelector('#measurementDesk .tabulator')",'table'),true);
  assert.equal(await tab.evaluate("document.documentElement.scrollWidth>innerWidth",'overflow'),false);
  await tab.call('Page.captureScreenshot',{format:'png'}).then(async shot=>{const {writeFileSync}=await import('node:fs');writeFileSync(new URL('./measurement-'+width+'.png',import.meta.url),Buffer.from(shot.data,'base64'))});
 }
 await tab.evaluate("saveMeasurementDesk()",'save-from-ui');
 assert.equal((await api('/api/measurements?visitId='+visitId)).data.measurements.length,3);
 await tab.reload();await waitForApp(tab);assert.equal((await api('/api/measurements?visitId='+visitId)).data.measurements.length,3);
 await tab.evaluate("fetch('/__local-test/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'anthony.simon@batinova.example'})})",'worker-login');
 assert.equal((await api('/api/measurements?visitId='+visitId)).status,403);
 console.log('PASS measurement links: server calculation, packs, immutable versions, duplicate/conflict handling, draft-only quote transfer, persistence, worker denial, Tabulator PC/mobile.');
}finally{await tab.close();await browser.close()}
