import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {connectBrowser,waitForApp,waitFor} from './helpers/browser-cdp.mjs';
const base=process.env.SOCLE_TEST_URL,browser=await connectBrowser(base),tab=await browser.createSession(base);
try{
 await tab.navigate(base);
 const login=async email=>{await tab.evaluate(`fetch('/__local-test/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)}})})`,'login-preparation');await tab.reload();await waitForApp(tab)};
 const api=async(path,method='GET',data)=>tab.evaluate(`fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{'content-type':'application/json'},${data===undefined?'':`body:JSON.stringify(${JSON.stringify(data)}),`}}).then(async r=>({status:r.status,data:await r.json()}))`,'preparation-api');
 await login('direction@batinova.example');
 const members=(await api('/api/access-control')).data.members,aMember=members.find(m=>m.email==='anthony.simon@batinova.example'),userA=aMember.userId||aMember.id;
 const teams=(await api('/api/hr/teams')).data.teams,team=teams.find(t=>t.active&&t.memberIds.includes(String(aMember.personId)))||teams.find(t=>t.active&&t.memberIds.length);assert.ok(team,'Active team with members required');
 const projectId=await tab.evaluate('String(jobs[0].id)','preparation-project');
 const field=await api('/api/field-data'),van=field.data.assets.find(x=>x.group==='vehicles');assert.ok(van,'Seeded vehicle required');
 const task=await api('/api/projects/'+projectId+'/tasks','POST',{title:'Préparation couverture · équipe et moyens',description:'Simulation V5 : liaison au planning existant.',assignedTo:userA,materials:[{name:'Sous-toiture',quantity:80,unit:'m2'}],operationKey:'preparation-task-'+Date.now()});assert.equal(task.status,201,JSON.stringify(task));const taskId=task.data.task.id,endpoint='/api/tasks/'+taskId+'/preparation';
 const initial=await api(endpoint);assert.equal(initial.status,200,JSON.stringify(initial));assert.equal(initial.data.expectedVersion,0);assert.equal(initial.data.current,null);
 const date=new Date(Date.now()+14*86400000).toISOString().slice(0,10);
 const assignmentData={date,projectId,teamId:team.id,people:team.memberIds,startTime:'18:00',endTime:'19:00',assignmentType:'team',status:'planned',vehicleId:String(van.id),packId:'BATXL-PACK-42000',reason:'Simulation préparation V5',operationKey:'prep-assignment-'+Date.now()};
 const created=await api('/api/assignments','POST',assignmentData);assert.equal(created.status,201,JSON.stringify(created));const assignmentId=created.data.id;
 const options=await api(endpoint+'?from='+date+'&to='+date),selected=options.data.assignments.find(a=>a.id===assignmentId);assert.ok(selected,JSON.stringify(options));assert.ok(selected.people.every(p=>p.active));assert.ok(selected.resources.some(r=>r.id===String(van.id)&&r.name===van.name));assert.ok(!JSON.stringify(selected).includes('unitCost'));
 const link={assignmentId,assignmentSignature:selected.signature,expectedVersion:0,operationKey:'link-preparation-'+Date.now()};
 assert.equal((await api(endpoint,'POST',{...link,assignmentId:'foreign-assignment'})).status,404);
 assert.equal((await api(endpoint,'POST',{...link,assignmentSignature:'stale'})).status,409);
 const previewBeforeLink={taskId,recipientIds:[userA],responseMode:'confirm',coverNote:'Préparer la zone façade.',expectedIssueVersion:0};
 const emptyPreview=await api('/api/work-packets/preview','POST',previewBeforeLink);assert.equal(emptyPreview.status,200,JSON.stringify(emptyPreview));
 assert.equal((await api(endpoint,'POST',link)).status,201);assert.equal((await api(endpoint,'POST',link)).data.replayed,true);
 assert.equal((await api(endpoint,'POST',{...link,assignmentId:null})).status,409);
 assert.equal((await api(endpoint,'POST',{...link,operationKey:'stale-prep-'+Date.now()})).status,409);
 assert.equal((await api('/api/work-packets/publish','POST',{...previewBeforeLink,previewSignature:emptyPreview.data.previewSignature,operationKey:'stale-empty-'+Date.now()})).status,409);
 const frozenPreview=await api('/api/work-packets/preview','POST',previewBeforeLink);assert.equal(frozenPreview.status,200);assert.equal(frozenPreview.data.snapshot.preparation.assignment.id,assignmentId);
 const published=await api('/api/work-packets/publish','POST',{...previewBeforeLink,previewSignature:frozenPreview.data.previewSignature,operationKey:'prepared-packet-'+Date.now()});assert.equal(published.status,201,JSON.stringify(published));const issueId=published.data.id;
 const issueBefore=await api('/api/work-packets/'+issueId);assert.equal(issueBefore.data.preparationChanged,false);
 for(const width of [1440,412]){
  await tab.call('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width===412});
  if(width===412){await tab.call('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 SamsungBrowser/26.0'});await tab.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5})}
  await tab.evaluate(`openTaskPreparation(${JSON.stringify(taskId)},{from:${JSON.stringify(date)},to:${JSON.stringify(date)}})`,'preparation-desk');assert.equal(await tab.evaluate("!!document.querySelector('#taskPreparationDesk')",'desk-visible'),true);assert.equal(await tab.evaluate('document.documentElement.scrollWidth>innerWidth','preparation-overflow'),false);
  const shot=await tab.call('Page.captureScreenshot',{format:'png'});writeFileSync(new URL('./preparation-'+width+'.png',import.meta.url),Buffer.from(shot.data,'base64'));
 }
 await tab.evaluate(`openWorkPacketHistory(${JSON.stringify(taskId)})`,'history-from-preparation');await tab.evaluate('backModal()','back-to-preparation');assert.equal(await tab.evaluate('taskPreparationDesk?.root.isConnected','preparation-live-after-back'),true,'Back must reconnect the preparation controls to the restored DOM');
 // Exercise the actual UI save, not just its endpoint.
 const tapSave=async()=>{const hit=await tab.evaluate("(()=>{const b=document.querySelector('#preparationSave'),r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,uncovered:document.elementFromPoint(x,y)===b}})()",'save-touch-target');assert.equal(hit.uncovered,true);await tab.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:hit.x,y:hit.y}]});await tab.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})};
 await tab.call('Network.enable');await tab.call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 try{await tapSave();await waitFor(()=>tab.evaluate("!!document.querySelector('#preparationStatus').textContent&&!document.querySelector('#preparationSave').disabled",'offline-link-error'),'offline-link-refused')}finally{await tab.call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1})}
 assert.equal((await api(endpoint)).data.expectedVersion,1,'Offline request must not queue a silent planning change');
 await tab.evaluate(`(()=>{window.preparationNativeFetch=window.fetch;window.preparationDropOnce=true;window.fetch=async(...args)=>{const r=await window.preparationNativeFetch(...args);if(window.preparationDropOnce&&String(args[0])===${JSON.stringify(endpoint)}&&args[1]?.method==='POST'){window.preparationDropOnce=false;await r.clone().text();throw new TypeError('Réponse perdue simulée')}return r}})()`,'lose-one-link-response');
 try{await tapSave();await waitFor(()=>tab.evaluate("!window.preparationDropOnce&&!!document.querySelector('#preparationStatus').textContent&&!document.querySelector('#preparationSave').disabled",'lost-link-error'),'lost-link-response');assert.equal((await api(endpoint)).data.expectedVersion,2);assert.equal(await tab.evaluate('taskPreparationDesk.data.expectedVersion','old-ui-after-lost-response'),1)}finally{await tab.evaluate('window.fetch=window.preparationNativeFetch','restore-link-fetch')}
 await tapSave();await waitFor(()=>tab.evaluate('taskPreparationDesk.data.expectedVersion===2','replayed-link-ui'),'save-via-touch');assert.equal((await api(endpoint)).data.history.length,2,'Retry must replay the same link');
 const noResources={...assignmentData,startTime:'19:00',endTime:'20:00',vehicleId:undefined,packId:undefined};
 const rescheduled=await api('/api/assignments/'+assignmentId,'PUT',noResources);assert.equal(rescheduled.status,200,JSON.stringify(rescheduled));
 const planning=(await api('/api/planning?from='+date+'&to='+date)).data.assignments.find(a=>String(a.id)===assignmentId);assert.equal(String(planning.vehicle),String(van.id));assert.equal(planning.pack,'BATXL-PACK-42000');
 const live=await api(endpoint);assert.equal(live.data.current.assignment.startTime,'19:00');
 const issueAfter=await api('/api/work-packets/'+issueId);assert.equal(issueAfter.data.preparationChanged,true);assert.deepEqual(issueAfter.data.snapshot,issueBefore.data.snapshot);
 await tab.evaluate(`openWorkPacket(${JSON.stringify(issueId)})`,'packet-planning-context');assert.equal(await tab.evaluate("document.querySelector('.task-preparation-packet').textContent.includes('a changé')",'planning-change-warning'),true);
 await login('anthony.simon@batinova.example');
 const own=await api(endpoint);assert.equal(own.status,200,JSON.stringify(own));assert.equal(own.data.canPrepare,false);assert.equal(own.data.assignments,undefined);assert.equal(own.data.history,undefined);
 assert.equal((await api(endpoint,'POST',{...link,expectedVersion:2,operationKey:'worker-link-'+Date.now()})).status,403);
 await tab.evaluate(`openTaskPreparation(${JSON.stringify(taskId)},{from:${JSON.stringify(date)},to:${JSON.stringify(date)}})`,'worker-preparation');assert.equal(await tab.evaluate("!!document.querySelector('#preparationAssignment')",'no-worker-composer'),false);
 const workerShot=await tab.call('Page.captureScreenshot',{format:'png'});writeFileSync(new URL('./preparation-worker-412.png',import.meta.url),Buffer.from(workerShot.data,'base64'));
 await tab.evaluate(`openWorkPacket(${JSON.stringify(issueId)})`,'worker-receipt-with-reschedule');await tab.evaluate('confirmWorkPacket()','confirm-planned-packet');assert.ok((await api('/api/work-packets/'+issueId)).data.events.some(e=>e.kind==='confirmed'));
 const unrelated=await api('/api/tasks/not-this-company/preparation');assert.equal(unrelated.status,404);
 await login('direction@batinova.example');
 const otherProjectId=await tab.evaluate('String(jobs.find(j=>String(j.id)!=='+JSON.stringify(projectId)+').id)','other-project-for-link');
 assert.equal((await api('/api/assignments/'+assignmentId,'PUT',{...noResources,projectId:otherProjectId})).status,200);
 const movedLink=await api(endpoint);assert.equal(movedLink.data.current.unavailable,true);assert.equal(movedLink.data.current.assignment,null,'The current task must not disclose another project crew');
 assert.equal((await api('/api/work-packets/preview','POST',{...previewBeforeLink,expectedIssueVersion:1})).status,409);
 await tab.evaluate(`openTaskPreparation(${JSON.stringify(taskId)},{from:${JSON.stringify(date)},to:${JSON.stringify(date)}})`,'moved-assignment-desk');assert.equal(await tab.evaluate("!!document.querySelector('[onclick=\"saveTaskPreparation(true)\"]')",'can-detach-moved-assignment'),true);
 await login('anthony.simon@batinova.example');const hidden=await api(endpoint);assert.equal(hidden.status,200);assert.equal(hidden.data.current.assignment,null);assert.equal(hidden.data.current.unavailable,true);
 await login('direction@batinova.example');assert.equal((await api('/api/assignments/'+assignmentId,'PUT',noResources)).status,200);
 const privateTask=await api('/api/projects/'+projectId+'/tasks','POST',{title:'Tâche bureau non distribuée',operationKey:'private-prep-task-'+Date.now()});assert.equal(privateTask.status,201);const privateTaskId=privateTask.data.task.id;
 await login('anthony.simon@batinova.example');assert.equal((await api('/api/tasks/'+privateTaskId+'/preparation')).status,404);
 await login('direction@batinova.example');
 await tab.evaluate(`openTaskPreparation(${JSON.stringify(taskId)},{from:${JSON.stringify(date)},to:${JSON.stringify(date)}})`,'open-planning-entry');await tab.evaluate('openPreparationPlanning(false)','edit-real-planning');assert.equal(await tab.evaluate('view','planning-open'), 'planning');assert.equal(await tab.evaluate("document.querySelector('#modalbody form').elements.job.value",'same-project'),projectId);
 assert.equal((await api('/api/assignments/'+assignmentId,'DELETE')).status,200);assert.equal((await api(endpoint)).data.current.unavailable,true);
 const afterCancel=await api('/api/work-packets/preview','POST',{...previewBeforeLink,expectedIssueVersion:1});assert.equal(afterCancel.status,409,JSON.stringify(afterCancel));
 assert.equal((await api(endpoint,'POST',{assignmentId:null,assignmentSignature:null,expectedVersion:2,operationKey:'detach-prep-'+Date.now()})).status,201);
 const afterDetach=await api(endpoint);assert.equal(afterDetach.data.current.assignment,null);assert.equal(afterDetach.data.history.length,3);
 const badDate=await api(endpoint+'?from=2026-99-99');assert.equal(badDate.status,400,JSON.stringify(badDate));
 await tab.reload();await waitForApp(tab);assert.equal((await api(endpoint)).data.expectedVersion,3);
 await tab.evaluate(`openTaskPreparation(${JSON.stringify(taskId)},{from:${JSON.stringify(date)},to:${JSON.stringify(date)}})`,'prepare-late-load');
 await tab.evaluate(`(()=>{window.preparationNativeFetch=window.fetch;const gate=new Promise(resolve=>{window.preparationRelease=resolve});window.fetch=async(...args)=>{const r=await window.preparationNativeFetch(...args);if(String(args[0]).startsWith(${JSON.stringify(endpoint)})&&!args[1]?.method)await gate;return r};window.preparationPending=openTaskPreparation(${JSON.stringify(taskId)},{from:${JSON.stringify(date)},to:${JSON.stringify(date)}})})()`,'hold-preparation-response');
 await tab.evaluate('closeModal();window.preparationRelease();window.preparationPending','close-before-response');await tab.evaluate('window.fetch=window.preparationNativeFetch','restore-late-load-fetch');assert.equal(await tab.evaluate("document.querySelector('#modal').open",'no-reopen-after-close'),false);
 console.log('PASS live task/planning link, version and assignment conflicts, idempotency, vehicle/kit preservation, frozen packet with changed-planning warning, worker read-only/recipient checks, actual PC/Samsung-emulated UI save and planning navigation, cancellation/detach, cross-project move without crew disclosure, offline rejection/lost-response replay through touch, reload persistence.');
}finally{await tab.close();await browser.close()}
