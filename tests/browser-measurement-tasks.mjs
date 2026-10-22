import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {connectBrowser,waitForApp,waitFor} from './helpers/browser-cdp.mjs';
const base=process.env.SOCLE_TEST_URL,browser=await connectBrowser(base),tab=await browser.createSession(base);
try{
 await tab.navigate(base);
 const login=async email=>{await tab.evaluate(`fetch('/__local-test/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)}})})`,'login-materials');await tab.reload();await waitForApp(tab)};
 const api=async(path,method='GET',data)=>tab.evaluate(`fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{'content-type':'application/json'},${data===undefined?'':`body:JSON.stringify(${JSON.stringify(data)}),`}}).then(async r=>({status:r.status,data:await r.json()}))`,'measurement-task-api');
 await login('direction@batinova.example');const projectId=await tab.evaluate('String(jobs[0].id)','measurement-task-project');
 const customer=await api('/api/customers','POST',{type:'individual',firstName:'Test',lastName:'Liaison matériaux',street:'Rue test',city:'Namur',country:'BE'});assert.equal(customer.status,201,JSON.stringify(customer));
 const visit=await api('/api/quote-visits','POST',{customerId:customer.data.customer.id,place:'Couverture · préparation',contact:'Test',notes:'Simulation isolée',operationKey:'material-visit-'+Date.now()});assert.equal(visit.status,201,JSON.stringify(visit));const visitId=visit.data.visit.id;
 const input={planes:[{id:'a',eaveLengthM:'10',developedSlopeM:'4.2',openingsM2:'2'},{id:'b',eaveLengthM:'10',developedSlopeM:'4.2',openingsM2:'2'}],config:{usefulCoverWidthMm:'180',usefulExposureMm:'120',battenSpacingM:'0.3',counterBattenSpacingM:'0.6',slateWastePct:'10',underlayAllowancePct:'10',timberWastePct:'10'},guttersM:'20',flashingsM:'3',unitPrices:{UNDERLAY:'9876.54'},packages:{UNDERLAY:'10'},vatRate:null};
 const createMeasurement=async(version,source='Relevé toiture')=>{const r=await api('/api/measurements','POST',{visitId,input,sourceLabel:source,expectedVersion:version-1,operationKey:'task-metre-'+version+'-'+Date.now()});assert.equal(r.status,201,JSON.stringify(r));return r.data.measurement};
 const m1=await createMeasurement(1),endpoint='/api/measurements/'+m1.id+'/tasks';
 assert.equal((await api(endpoint)).data.canCreate,false);
 assert.equal((await api(endpoint,'POST',{})).status,409,'No default project may be guessed for a preproject visit');
 const quote=await api('/api/quotes','POST',{projectId,customerId:customer.data.customer.id,title:'Devis accepté de référence',client:'Test',clientAddress:'Namur',date:'2026-10-20',validUntil:'2026-11-20',status:'accepted',lines:[{label:'Contrat existant',qty:1,unit:'forfait',price:1234.56,vat:21}]});assert.equal(quote.status,201,JSON.stringify(quote));const quoteId=quote.data.quote.id;
 assert.equal((await api('/api/quote-visits/'+visitId+'/quote','POST',{quoteId})).status,200);
 const stockBefore=(await api('/api/field-data')).data.stockItems;assert.ok(Array.isArray(stockBefore)&&stockBefore.length,'Actual stock rows required for the no-mutation assertion');
 const preview=(await api(endpoint)).data;assert.equal(preview.canCreate,true);assert.equal(preview.needs.find(n=>n.code==='UNDERLAY').requiredQuantity,'92.400');assert.ok(!JSON.stringify(preview).includes('unitPrice'));
 const body={title:'Pose sous-toiture depuis métré',description:'Vérifier le support avant pose.',codes:['UNDERLAY'],quantityBasis:'required',previewSignature:preview.previewSignature,operationKey:'measurement-task-source-'+Date.now()};
 assert.equal((await api(endpoint,'POST',{...body,codes:['UNDERLAY','UNDERLAY']})).status,400);
 assert.equal((await api(endpoint,'POST',{...body,codes:['unknown']})).status,400);
 assert.equal((await api(endpoint,'POST',{...body,previewSignature:'tampered'})).status,409);
 await createMeasurement(2);assert.equal((await api(endpoint,'POST',body)).status,409);
 const currentOld=(await api(endpoint)).data,request={...body,previewSignature:currentOld.previewSignature};assert.equal((await api(endpoint,'POST',request)).status,409,'An old version needs explicit acknowledgment');request.confirmOlderVersion=true;
 const created=await api(endpoint,'POST',request);assert.equal(created.status,201,JSON.stringify(created));const task=created.data.task,taskId=task.id,prep='/api/tasks/'+taskId+'/preparation';assert.deepEqual(task.materials,[{name:'Sous-toiture',quantity:92.4,unit:'m2'}]);
 assert.equal((await api(endpoint,'POST',request)).data.task.id,taskId);assert.equal((await api(endpoint,'POST',{...request,title:'changed'})).status,409);
 assert.equal((await api('/api/measurements/foreign-measurement/tasks')).status,404);
 await createMeasurement(3,'Révision après préparation');
 assert.equal((await api(endpoint,'POST',request)).data.replayed,true,'Lost-response retry must still work after a newer measurement');
 const preparation=(await api(prep)).data;assert.equal(preparation.measurementSource.version,1);assert.equal(preparation.measurementSource.newerVersionAvailable,true);assert.equal(preparation.measurementSource.latestVersion,3);assert.equal(preparation.measurementSource.materialsChanged,false);assert.equal(preparation.task.materials[0].quantity,92.4);
 const packaged=await api(endpoint,'POST',{...request,title:'Préparation conditionnée',quantityBasis:'packaged',previewSignature:(await api(endpoint)).data.previewSignature,operationKey:'packaged-task-'+Date.now()});assert.equal(packaged.status,201);assert.equal(packaged.data.task.materials[0].quantity,100);
 assert.deepEqual((await api('/api/quotes/'+quoteId)).data.quote.lines,quote.data.quote.lines,'Accepted quote must remain untouched');
 assert.deepEqual((await api('/api/field-data')).data.stockItems,stockBefore,'No stock movement or reservation during task creation');
 const members=(await api('/api/access-control')).data.members,worker=members.find(m=>m.email==='anthony.simon@batinova.example'),workerId=worker.userId||worker.id;
 await login('anthony.simon@batinova.example');assert.equal((await api(endpoint)).status,403);assert.equal((await api(endpoint,'POST',request)).status,403);assert.equal((await api(prep)).status,404);
 await login('direction@batinova.example');const teams=(await api('/api/hr/teams')).data.teams,team=teams.find(t=>t.active&&t.memberIds.includes(String(worker.personId)))||teams.find(t=>t.active&&t.memberIds.length),date=new Date(Date.now()+14*86400000).toISOString().slice(0,10);
 const assignment=await api('/api/assignments','POST',{date,projectId,teamId:team.id,people:team.memberIds,startTime:'19:00',endTime:'20:00',assignmentType:'team',status:'planned',reason:'Préparation issue du métré',operationKey:'measurement-prep-'+Date.now()});assert.equal(assignment.status,201,JSON.stringify(assignment));
 const options=(await api(prep+'?from='+date+'&to='+date)).data,selection=options.assignments.find(a=>a.id===assignment.data.id);assert.ok(selection);
 assert.equal((await api(prep,'POST',{assignmentId:selection.id,assignmentSignature:selection.signature,expectedVersion:0,operationKey:'measurement-bind-'+Date.now()})).status,201);
 const packetBody={taskId,recipientIds:[workerId],responseMode:'confirm',expectedIssueVersion:0},packetPreview=await api('/api/work-packets/preview','POST',packetBody);assert.equal(packetPreview.status,200,JSON.stringify(packetPreview));assert.equal(packetPreview.data.snapshot.measurementSource.version,1);assert.equal(packetPreview.data.snapshot.materials[0].quantity,92.4);assert.equal(packetPreview.data.snapshot.preparation.assignment.id,selection.id);
 const published=await api('/api/work-packets/publish','POST',{...packetBody,previewSignature:packetPreview.data.previewSignature,operationKey:'measurement-packet-'+Date.now()});assert.equal(published.status,201,JSON.stringify(published));const issueId=published.data.id;
 assert.equal((await api('/api/tasks/'+taskId,'PATCH',{materials:[{name:'Sous-toiture',quantity:95,unit:'m2'}]})).status,200);
 assert.equal((await api(prep)).data.measurementSource.materialsChanged,true);
 assert.equal((await api('/api/work-packets/'+issueId)).data.snapshot.materials[0].quantity,92.4,'Issued instructions remain frozen after task edits');
 await login('anthony.simon@batinova.example');const own=(await api(prep)).data;assert.equal(own.measurementSource.version,1);assert.equal(own.task.materials[0].quantity,95);assert.equal(own.canPrepare,false);assert.ok(!/unitPrice|1234\.56|9876\.54|lines_json|result_json/.test(JSON.stringify(own)),'No quote financial data in worker preparation');
 const workerPacket=(await api('/api/work-packets/'+issueId)).data;assert.equal(workerPacket.snapshot.measurementSource.version,1);assert.equal(workerPacket.snapshot.materials[0].quantity,92.4);
 await tab.evaluate(`openWorkPacket(${JSON.stringify(issueId)})`,'worker-measurement-packet');assert.match(await tab.evaluate("document.querySelector('#modalbody').textContent",'source-visible-to-worker'),/Métré version 1/);
 await tab.call('Emulation.setDeviceMetricsOverride',{width:412,height:950,deviceScaleFactor:1,mobile:true});const workerShot=await tab.call('Page.captureScreenshot',{format:'png'});writeFileSync(new URL('./measurement-task-worker-412.png',import.meta.url),Buffer.from(workerShot.data,'base64'));
 await login('direction@batinova.example');const latest=(await api('/api/measurements?visitId='+visitId)).data.measurements[0];
 for(const width of [1440,412]){
  await tab.call('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width===412});
  await tab.call('Emulation.setTouchEmulationEnabled',{enabled:width===412,maxTouchPoints:5});
  if(width===412){await tab.call('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 SamsungBrowser/26.0'});await tab.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5})}
  await tab.evaluate(`openMeasurementDesk(${JSON.stringify(visitId)})`,'measurement-entry');assert.equal(await tab.evaluate("!!document.querySelector('[onclick=\"openMeasurementTask(measurementDesk.latest.id)\"]')",'task-entry-visible'),true);
  await tab.evaluate(`openMeasurementTask(${JSON.stringify(latest.id)})`,'task-from-measurement');assert.equal(await tab.evaluate('document.documentElement.scrollWidth>innerWidth','task-desk-overflow'),false);
  assert.equal(await tab.evaluate("(()=>{const row=document.querySelector('.measurement-task-material'),box=row.querySelector('input').getBoundingClientRect(),text=row.querySelector('span').getBoundingClientRect();return box.width>=22&&box.width<=26&&text.left>box.right&&row.getBoundingClientRect().height>=44})()",'aligned-material-checkbox'),true);
  const shot=await tab.call('Page.captureScreenshot',{format:'png'});writeFileSync(new URL('./measurement-task-'+width+'.png',import.meta.url),Buffer.from(shot.data,'base64'));
  await tab.evaluate(`document.querySelector('#measurementTaskDesk [name=title]').value='Parcours interface ${width}'`,'task-title');
  if(width===412){
   await tab.evaluate(`(()=>{window.materialNativeFetch=window.fetch;window.dropMaterialResponse=true;window.fetch=async(...args)=>{const r=await window.materialNativeFetch(...args);if(window.dropMaterialResponse&&String(args[0])===${JSON.stringify('/api/measurements/'+latest.id+'/tasks')}&&args[1]?.method==='POST'&&r.ok){window.dropMaterialResponse=false;throw new TypeError('Réponse perdue après création')}return r}})()`,'lose-material-response');
   const touch=async()=>{const rect=await tab.evaluate("(()=>{const b=document.querySelector('#measurementTaskDesk [type=submit]');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",'touch-create-rect');await tab.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[rect]});await tab.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})};
   await touch();await waitFor(()=>tab.evaluate("document.querySelector('#measurementTaskStatus')?.textContent.includes('Réponse perdue')",'material-response-error'),{label:'Lost response visible'});await touch();await waitFor(()=>tab.evaluate("!!document.querySelector('#measurementTaskDesk')?.dataset.taskId",'material-replay-created'),{label:'Same task recovered'});await tab.evaluate('window.fetch=window.materialNativeFetch','restore-material-fetch');
  }else{
   const rect=await tab.evaluate("(()=>{const b=document.querySelector('#measurementTaskDesk [type=submit]');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",'mouse-create-rect');
   await tab.call('Input.dispatchMouseEvent',{type:'mousePressed',...rect,button:'left',clickCount:1});await tab.call('Input.dispatchMouseEvent',{type:'mouseReleased',...rect,button:'left',clickCount:1});
   await waitFor(()=>tab.evaluate("!!document.querySelector('#measurementTaskDesk')?.dataset.taskId",'mouse-created-task'),{label:'PC form submitted by mouse'});
  }
  const uiTaskId=await tab.evaluate("document.querySelector('#measurementTaskDesk').dataset.taskId",'ui-task-id');assert.ok(uiTaskId);const listed=(await api('/api/tasks')).data.tasks.filter(t=>t.title==='Parcours interface '+width);assert.equal(listed.length,1);assert.equal(listed[0].id,uiTaskId);
  await tab.evaluate("document.querySelector('#measurementTaskStatus + button').onclick()",'go-to-task-preparation');assert.equal(await tab.evaluate("!!document.querySelector('#taskPreparationDesk')",'preparation-after-create'),true);assert.equal((await api('/api/tasks/'+uiTaskId+'/preparation')).data.measurementSource.version,3);
  await tab.evaluate('backModal()','return-to-created-source');assert.equal(await tab.evaluate("document.querySelector('#measurementTaskDesk').dataset.taskId",'back-keeps-created-task'),uiTaskId);await tab.evaluate("document.querySelector('#measurementTaskStatus + button').onclick()",'restored-next-step');assert.equal(await tab.evaluate("!!document.querySelector('#taskPreparationDesk')",'restored-next-step-live'),true);
 }
 await tab.evaluate(`openMeasurementTask(${JSON.stringify(latest.id)})`,'open-before-delayed-preview');
 await tab.evaluate(`(()=>{window.materialNativeFetch=window.fetch;const gate=new Promise(resolve=>{window.releaseMaterialPreview=resolve});window.fetch=async(...args)=>{const r=await window.materialNativeFetch(...args);if(String(args[0])===${JSON.stringify('/api/measurements/'+latest.id+'/tasks')}&&!args[1]?.method)await gate;return r};window.pendingMaterialPreview=openMeasurementTask(${JSON.stringify(latest.id)})})()`,'delay-material-preview');
 await tab.evaluate('closeModal();window.releaseMaterialPreview();window.pendingMaterialPreview','close-before-material-preview');await tab.evaluate('window.fetch=window.materialNativeFetch','restore-preview-fetch');assert.equal(await tab.evaluate("document.querySelector('#modal').open",'preview-must-not-reopen'),false);
 await tab.reload();await waitForApp(tab);assert.equal((await api(prep)).data.measurementSource.version,1);
 console.log('PASS measurement → task materials → real planning → issued worker packet; 92.4 calculated vs 100 packaged, explicit old version, current source/head conflicts, exact replay after source revision and lost response, unchanged accepted quote/stock, financial confidentiality and worker/nonparticipant denial, immutable origin after task edit, actual PC/Samsung-emulated touch/navigation and reload.');
}finally{await tab.close();await browser.close()}
