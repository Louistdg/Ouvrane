import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {connectBrowser, waitForApp, waitFor} from './helpers/browser-cdp.mjs';

const base = process.env.SOCLE_TEST_URL;
const browser = await connectBrowser(base);
const tab = await browser.createSession(base);
const token = Date.now().toString();
// Observe only this test page and confirm the native beforeunload prompt
// when the user deliberately submits logout. Other dialog types fail the test.
async function expectedLogoutConfirmation() {
  const discovery = await (await fetch((process.env.SOCLE_CDP_URL || 'http://127.0.0.1:9222') + '/json/version')).json();
  const socket = new WebSocket(discovery.webSocketDebuggerUrl), pending = new Map();
  const state = {accepted:0,error:null}; let sequence = 0, observerSession;
  await new Promise((resolve,reject) => {socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('Logout observer could not connect')),{once:true});});
  const send = (method,params,sessionId) => new Promise((resolve,reject) => {
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Logout observer timeout: '+method));},5000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
  socket.addEventListener('message',event => {
    const message=JSON.parse(event.data),request=pending.get(message.id);
    if(request){clearTimeout(request.timer);pending.delete(message.id);if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result);return;}
    if(message.sessionId===observerSession&&message.method==='Page.javascriptDialogOpening') {
      const expected=message.params.type==='beforeunload';
      if(!expected)state.error='Unexpected dialog during logout: '+message.params.type;
      tab.call('Page.handleJavaScriptDialog',{accept:expected}).then(()=>{if(expected)state.accepted++;},error=>{state.error=error.message;});
    }
  });
  try {
    const {targetInfo}=await tab.call('Target.getTargetInfo');
    ({sessionId:observerSession}=await send('Target.attachToTarget',{targetId:targetInfo.targetId,flatten:true}));
    await send('Page.enable',{},observerSession);
    return {state,close:async()=>{try{await send('Target.detachFromTarget',{sessionId:observerSession});}finally{socket.close();}}};
  } catch(error) {socket.close();throw error;}
}
try {
  await tab.navigate(base);
  const login = async email => {
    await tab.evaluate(`fetch('/__local-test/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)}})})`, 'publication-login');
    await tab.reload(); await waitForApp(tab);
  };
  const api = (path, method = 'GET', data) => tab.evaluate(`fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{'content-type':'application/json'},${data === undefined ? '' : `body:JSON.stringify(${JSON.stringify(data)}),`}}).then(async r=>({status:r.status,data:await r.json()}))`, 'publication-api');
  const must = (response, status, label) => {assert.equal(response.status, status, `${label}: ${JSON.stringify(response)}`); return response.data;};
  const click = async (selector, touch) => {
    const hit = await tab.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing publication control: '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,visible:!!e.getClientRects().length,uncovered:!!document.elementFromPoint(x,y)?.closest(${JSON.stringify(selector)})}})()`, 'publication-hit');
    assert.equal(hit.visible && hit.uncovered, true, `Visible usable control required: ${selector}`);
    if (touch) {await tab.call('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:hit.x,y:hit.y}]}); await tab.call('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});}
    else {await tab.call('Input.dispatchMouseEvent', {type:'mousePressed',x:hit.x,y:hit.y,button:'left',clickCount:1}); await tab.call('Input.dispatchMouseEvent', {type:'mouseReleased',x:hit.x,y:hit.y,button:'left',clickCount:1});}
  };
  const visible = selector => tab.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return !!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'})()`, 'publication-visible');
  const navigate = async (route, touch) => {
    if (!touch) await click(`#nav [data-nav-route="${route}"]`, false);
    else if (await visible(`#socleMobileNav [data-mobile-route="${route}"]`)) await click(`#socleMobileNav [data-mobile-route="${route}"]`, true);
    else if (route === 'connecteurs') {
      await navigate('home', true);
      await waitFor(() => visible('[data-v5-home-overview] [data-v5-action="tools"]'), 'Tools catalogue has a usable mobile entry');
      await click('[data-v5-home-overview] [data-v5-action="tools"]', true);
    } else {
      await click('#socleMobileNav [data-mobile-menu-toggle]', true);
      await waitFor(() => visible(`#socleMobileMoreDialog [data-mobile-route="${route}"]`), 'Mobile menu exposes the permitted route');
      await click(`#socleMobileMoreDialog [data-mobile-route="${route}"]`, true);
    }
    await waitFor(() => tab.evaluate(`view===${JSON.stringify(route)}`, 'publication-active-route'), 'Requested route opened');
  };
  const noPretend = async label => {
    const result = await tab.evaluate(`(()=>{const main=document.querySelector('#main'),text=main?.innerText||'',assistant=[...document.querySelectorAll('button,[role=button],[aria-label]')].filter(e=>e.getClientRects().length).some(e=>/\\bassistant\\b/i.test((e.getAttribute('aria-label')||'')+' '+e.textContent));return{text,assistant}})()`, 'publication-no-pretend');
    assert.equal(result.assistant, false, `${label}: conversational assistant control remains exposed`);
    for (const pattern of [/34\s+outils\s+synchronis/i, /Trackunit[^\n]{0,50}\b3\s+engins/i, /41\s*\/\s*41/, /9930:BE0123456789/, /Peppol\s+connecté/i, /Check-in\/out\s+ONSS\s+actif/i, /Certificat\s+GlobalSign/i, /Extension Martin\s*[—–-]\s*versant arrière/i]) assert.equal(pattern.test(result.text), false, `${label}: old fictional external activity is presented`);
    assert.equal(await tab.evaluate('document.documentElement.scrollWidth>innerWidth+1', 'publication-overflow'), false, `${label}: horizontal page overflow`);
  };
  const chooseCatalogue = async (capability, action, contextSelector, rootSelector, touch) => {
    await navigate('connecteurs', touch);
    const card = `[data-v5-capability="${capability}"]`;
    await waitFor(() => visible(card + ` [data-v5-action="${action}"]`), 'Permitted local capability has a real action');
    assert.equal(await tab.evaluate(`document.querySelector(${JSON.stringify(card)}).dataset.capabilityState`, 'publication-capability-state'), 'available');
    await click(card + ` [data-v5-action="${action}"]`, touch);
    await waitFor(() => visible('#v5DossierChooser'), 'A real dossier must be chosen explicitly');
    await click(contextSelector, touch);
    await waitFor(() => visible(rootSelector), 'Chosen dossier opens its actual business module');
  };

  await login('direction@batinova.example');
  const state = must(await api('/api/state'), 200, 'Authoritative owner workspace').state;
  assert.ok(state.jobs?.length);
  const projectId = String(state.jobs[0].id);
  const projectName = String(state.jobs[0].name);
  const visit = must(await api('/api/quote-visits', 'POST', {place:'Visite publication réelle ' + token, contact:'Contrôle V5', notes:'Fixture isolée pour vérifier les vrais dossiers', operationKey:'publication-visit-' + token}), 201, 'Create a real visit').visit;
  const assetName = 'Camionnette publication ' + token;
  const asset = must(await api('/api/assets', 'POST', {name:assetName, reference:'PUB-V5-' + token, group:'vehicles', category:'Camionnette', mode:'Propriété', condition:'En service'}), 201, 'Create a real asset');
  const members = must(await api('/api/access-control'), 200, 'Access directory').members;
  const worker = members.find(member => member.email === 'anthony.simon@batinova.example');
  assert.ok(worker?.personId);
  const workerId = String(worker.userId || worker.id);
  const team = must(await api('/api/hr/teams'), 200, 'Real teams').teams.find(team => team.active && team.memberIds.includes(String(worker.personId)));
  assert.ok(team);
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0,10);
  const assignment = must(await api('/api/assignments', 'POST', {date,projectId,teamId:team.id,people:[String(worker.personId)],startTime:'22:00',endTime:'23:00',assignmentType:'team',status:'planned',vehicleId:String(asset.id),reason:'Contrôle publication isolé',operationKey:'publication-assignment-' + token}), 201, 'Create a real scheduled crew');
  const task = must(await api('/api/projects/' + projectId + '/tasks', 'POST', {title:'Mission publication métier ' + token, assignedTo:workerId, materials:[{name:'Matériau publication',quantity:1,unit:'pc'}],operationKey:'publication-task-' + token}), 201, 'Create a real task').task;
  const prepEndpoint = '/api/tasks/' + task.id + '/preparation';
  const choice = must(await api(prepEndpoint + '?from=' + date + '&to=' + date), 200, 'Preparation choices').assignments.find(item => String(item.id) === String(assignment.id));
  assert.ok(choice);
  must(await api(prepEndpoint, 'POST', {assignmentId:String(assignment.id),assignmentSignature:choice.signature,expectedVersion:0,operationKey:'publication-preparation-' + token}), 201, 'Bind the real task to its crew');
  await tab.reload(); await waitForApp(tab);
  const realField = must(await api('/api/field-data'), 200, 'Actual asset catalogue');
  const realVisits = must(await api('/api/quote-visits'), 200, 'Actual visits').visits;
  assert.ok(realField.assets.some(item => String(item.id) === String(asset.id)));
  assert.ok(realVisits.some(item => item.id === visit.id));
  const expectedMetrics = {projects:state.jobs.length,assets:realField.assets.length,visits:realVisits.length};

  for (const width of [1440,412]) {
    const touch = width === 412;
    await tab.call('Emulation.setDeviceMetricsOverride', {width,height:950,deviceScaleFactor:1,mobile:touch});
    await tab.call('Emulation.setTouchEmulationEnabled', {enabled:touch,maxTouchPoints:5});
    await tab.call('Network.setUserAgentOverride', {userAgent:touch ? 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 SamsungBrowser/26.0' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'});
    await navigate('home', touch);
    await waitFor(() => visible('[data-v5-home-overview]'), 'V5 home overview');
    for (const [metric,expected] of Object.entries(expectedMetrics)) await waitFor(() => tab.evaluate(`(()=>{const e=document.querySelector('[data-v5-metric="${metric}"]');return e?.dataset.state==='ready'&&Number(e.querySelector('b')?.textContent.replace(/\\s/g,''))===${expected}})()`, 'publication-real-metric'), `Home ${metric} comes from real API data`);
    await noPretend('Home ' + width);
    if (touch) {
      await click('#socleMobileNav [data-mobile-menu-toggle]', true);
      await waitFor(() => visible('#socleMobileMoreDialog[open] .socle-mobile-menu-foot'), 'Samsung More menu footer is visible');
      assert.equal(await visible('#socleMobileMoreDialog[open] form[action="/auth/logout"] button'), true, 'Samsung logout must remain visible inside its menu footer');
      const menuShot = await tab.call('Page.captureScreenshot', {format:'png'});
      writeFileSync(new URL('./publication-mobile-more-412.png', import.meta.url), Buffer.from(menuShot.data,'base64'));
      await click('#socleMobileMoreDialog[open] [data-mobile-menu-close]', true);
      await waitFor(() => tab.evaluate('!document.querySelector("#socleMobileMoreDialog")?.open', 'publication-mobile-menu-closed'), 'Samsung More menu closes by touch');
    }
    await tab.evaluate("scrollTo(0,0);document.querySelector('#nav').scrollTop=0", 'publication-capture-top');
    await waitFor(() => tab.evaluate("scrollY===0&&document.querySelector('#nav').scrollTop===0", 'publication-capture-at-top'), 'Home capture starts at page and navigation top');
    let shot = await tab.call('Page.captureScreenshot', {format:'png'});
    writeFileSync(new URL('./publication-home-' + width + '.png', import.meta.url), Buffer.from(shot.data,'base64'));
    await tab.evaluate('quickCreateMenu()', 'publication-quick-create');
    assert.equal(await tab.evaluate("/\\bassistant\\b/i.test(document.querySelector('#modalbody').innerText)", 'publication-no-quick-assistant'), false);
    await tab.evaluate('closeModal()', 'publication-close-quick-create');

    await navigate('accounting', touch);
    await click('.v4-tab-peppol', touch);
    await waitFor(() => visible('#v5ElectronicInvoicePreparation'), 'Real invoice-preparation state');
    const finance = await tab.evaluate("document.querySelector('#v5ElectronicInvoicePreparation').innerText", 'publication-invoice-state');
    assert.match(finance, /pas connect|non configur|aucun.*opérateur|aucun.*envoi|sans.*opérateur/i);
    assert.equal(await tab.evaluate("[...document.querySelectorAll('#v5ElectronicInvoicePreparation button')].some(b=>!b.disabled&&/envoyer|tester la connexion/i.test(b.textContent))", 'publication-no-fake-invoice-send'), false);
    await noPretend('Accounting ' + width);
    await navigate('timeEntries', touch);
    await waitFor(() => visible('#v5TimeTrackingLinks'), 'Real time-entry tools');
    await noPretend('Time entries ' + width);
    await navigate('fleet', touch);
    await waitFor(() => visible('#v5AssetTools'), 'Real asset tools');
    await noPretend('Assets ' + width);
    await navigate('quotes', touch);
    await waitFor(() => visible('#v5MeasurementTools'), 'Real measurement tools');
    await noPretend('Quotes ' + width);

    await navigate('connecteurs', touch);
    await waitFor(() => visible('#v5ToolsCatalogue'), 'Local tools and external readiness catalogue');
    for (const capability of ['invoicing','onss','equipment-data','ifc']) {
      const card = `[data-v5-capability="${capability}"]`;
      assert.equal(await tab.evaluate(`document.querySelector(${JSON.stringify(card)})?.dataset.capabilityState`, 'publication-external-state'), 'not-configured', `Unconnected external capability ${capability} stays explicit`);
      assert.equal(await tab.evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(card)});return [...c.querySelectorAll('.badge')].some(b=>/^(connecté|active?|synchronisé|conforme)$/i.test(b.textContent.trim()))})()`, 'publication-no-active-external-badge'), false);
    }
    await noPretend('Tools catalogue ' + width);
    await tab.evaluate("scrollTo(0,0);document.querySelector('#nav').scrollTop=0", 'publication-capture-top');
    await waitFor(() => tab.evaluate("scrollY===0&&document.querySelector('#nav').scrollTop===0", 'publication-capture-at-top'), 'Tools capture starts at page and navigation top');
    shot = await tab.call('Page.captureScreenshot', {format:'png'});
    writeFileSync(new URL('./publication-tools-' + width + '.png', import.meta.url), Buffer.from(shot.data,'base64'));

    await chooseCatalogue('plans','plans',`[data-v5-action="project-plans"][data-project-id="${projectId}"]`,'#planList',touch);
    assert.equal(await tab.evaluate('String(planListScope.projectId)', 'publication-chosen-plan-project'), projectId);
    must(await api('/api/plans?projectId=' + projectId), 200, 'The chosen plans belong to the selected project');
    await tab.evaluate('closeModal()', 'publication-close-plans');
    await chooseCatalogue('measurements','measurements',`[data-v5-action="visit-measurements"][data-visit-id="${visit.id}"]`,'#measurementDesk',touch);
    assert.equal(await tab.evaluate('measurementDesk.visit.id', 'publication-chosen-visit'), visit.id);
    must(await api('/api/measurements?visitId=' + visit.id), 200, 'Measurement module reads the actual created visit');
    await tab.evaluate('closeModal()', 'publication-close-measurements');

    await navigate('jobs', touch);
    await tab.evaluate(`openJobWorkspace(${JSON.stringify(state.jobs[0].id)})`, 'publication-existing-job');
    await click('.v4-job-tab[data-v5-action="job-tab"][data-tab="v4hub"]', touch);
    await waitFor(() => visible('#v5JobTools'), 'Real project dossier tools');
    assert.equal(await tab.evaluate('String(currentJobId)', 'publication-existing-job-id'), projectId);
    assert.ok((await tab.evaluate("document.querySelector('#main').innerText", 'publication-project-name')).includes(projectName));
    await noPretend('Project dossier ' + width);
    await tab.evaluate(`openTaskPreparation(${JSON.stringify(task.id)},{from:${JSON.stringify(date)},to:${JSON.stringify(date)}})`, 'publication-real-preparation');
    await click(`#taskPreparationDesk button[onclick*="openAssignmentAssets"]`, touch);
    await waitFor(() => visible('#assignmentAssetsDesk'), 'Actual crew means remain available');
    assert.equal(await tab.evaluate("document.querySelector('#assignmentAssetsDesk').dataset.assignmentId", 'publication-real-assignment'), String(assignment.id));
    assert.ok((await tab.evaluate("document.querySelector('#assignmentAssetsDesk').innerText", 'publication-real-asset')).includes(assetName));
    await tab.evaluate('backModal()', 'publication-back-to-preparation');
    await waitFor(() => visible('#taskPreparationDesk'), 'Preparation restored');
    await click('#taskPreparationDesk button[onclick*="openTaskStock"]', touch);
    await waitFor(() => visible('#taskStockDesk'), 'Actual material reservations remain available');
    assert.equal(await tab.evaluate("document.querySelector('#taskStockDesk').dataset.taskId", 'publication-real-stock-task'), task.id);
    must(await api('/api/tasks/' + task.id + '/stock'), 200, 'Actual task stock permission and data');
    await tab.evaluate('closeModal()', 'publication-close-stock');
    await navigate('actions', touch);
    await waitFor(() => tab.evaluate(`!!document.querySelector('[data-task-id="${task.id}"]')`, 'publication-task-in-list'), 'Actual task remains visible');
    await noPretend('Tasks ' + width);
    await navigate('stock', touch);
    must(await api('/api/stock-catalog?limit=10'), 200, 'Stock module still has a live server catalogue');
    await noPretend('Stock ' + width);
  }

  must(await api('/api/access-control/' + workerId, 'PUT', {profileName:'QA publication limitée',scope:'Ses chantiers uniquement',modules:{jobs:{view:true},actions:{view:true},planning:{view:true}},sensitive:{},fieldActions:{},projectIds:[projectId]}), 200, 'Revoke finance and asset rights through the real access API');
  await login('anthony.simon@batinova.example');
  assert.equal((await api('/api/plans?projectId=' + projectId)).status, 403);
  assert.equal((await api('/api/measurements?visitId=' + visit.id)).status, 403);
  assert.equal((await api('/api/assignments/' + assignment.id + '/assets')).status, 404);
  const restrictedPrep = must(await api(prepEndpoint), 200, 'Permitted task preparation remains readable');
  assert.deepEqual(restrictedPrep.current.assignment.resources, []);
  assert.equal(restrictedPrep.current.assignment.resourcesHidden, true);
  await tab.evaluate("navigate('connecteurs')", 'publication-restricted-tools-direct-route');
  await waitFor(() => visible('#v5ToolsCatalogue'), 'Restricted catalogue handles direct navigation');
  for (const capability of ['plans','measurements','supplier-prices','assets']) {
    const card = `[data-v5-capability="${capability}"]`;
    assert.equal(await tab.evaluate(`document.querySelector(${JSON.stringify(card)})?.dataset.capabilityState`, 'publication-restricted-capability'), 'restricted');
    assert.equal(await tab.evaluate(`document.querySelectorAll(${JSON.stringify(card + ' [data-v5-action]')}).length`, 'publication-no-restricted-action'), 0);
  }
  await noPretend('Restricted catalogue');
  await click('#socleMobileNav [data-mobile-menu-toggle]', true);
  await waitFor(() => visible('#socleMobileMoreDialog[open] .socle-mobile-menu-foot'), 'Samsung logout footer remains visible for the restricted real account');
  const logoutConfirmation = await expectedLogoutConfirmation();
  try {
    await click('#socleMobileMoreDialog[open] form[action="/auth/logout"] button', true);
    await waitFor(() => tab.evaluate('location.pathname==="/login"', 'publication-mobile-logout-navigation'), 'Actual Samsung logout form reaches the login route');
    assert.equal(logoutConfirmation.state.error, null, 'Only the expected native logout confirmation may be accepted');
    assert.equal((await api('/api/state')).status, 401, 'Real Samsung logout revokes server access');
    const loggedOutCookies = await tab.call('Network.getCookies', {urls:[base]});
    assert.equal(loggedOutCookies.cookies.some(cookie => cookie.name === 'socle_test_session'), false, 'Real Samsung logout expires the browser session cookie');
    console.log('Native logout confirmations accepted: ' + logoutConfirmation.state.accepted);
  } finally {await logoutConfirmation.close();}
  console.log('PASS V5 publication UI: real API-backed home metrics after new visit/asset; no fictional external activity or assistant; invoice readiness explicit without fake send; local plans/measurements chosen by actual dossier; tasks, stock, crew means preserved; real revoked permissions enforced by APIs and catalogue; PC1440/Samsung412 emulated navigation, mouse/touch and overflow; mobile More footer and real touch logout, server revocation and cookie expiry.');
} catch (error) {
  try {
    const diagnostic = await tab.evaluate(`(()=>{const safe=fn=>{try{return fn()}catch(e){return String(e.message)}};return {error:${JSON.stringify('Publication gate failure')},view:safe(()=>view),storageReady:safe(()=>storageReady),loading:globalThis.socleWorkspaceLoading,accessRole:globalThis.socleCurrentAccess?.roleCode,accessOwner:globalThis.socleCurrentAccess?.owner,accessKeys:Object.keys(globalThis.socleCurrentAccess||{}),sessionAccessKey:safe(()=>sessionAccessKey),previewVerified:globalThis.socleAccessPreviewVerified,moduleViews:Object.fromEntries(['jobs','quotes','documents','fleet','accounting','actions'].map(name=>[name,safe(()=>canModuleAction(name,'view'))])),renderSource:safe(()=>String(globalThis.render)),v4Script:[...document.scripts].find(s=>s.src.includes('/v4.js'))?.src,overviewPresent:!!document.querySelector('[data-v5-home-overview]'),overviewRects:document.querySelector('[data-v5-home-overview]')?.getClientRects().length,mainText:document.querySelector('#main')?.innerText,bodyHtml:document.body.outerHTML}})()`, 'publication-failure-state');
    writeFileSync(new URL('./artifacts/browser-gate/publication-failure.json', import.meta.url), JSON.stringify({failure:String(error.stack||error),...diagnostic},null,2));
    const shot = await tab.call('Page.captureScreenshot', {format:'png'});
    writeFileSync(new URL('./artifacts/browser-gate/publication-failure.png', import.meta.url), Buffer.from(shot.data,'base64'));
    console.error('PUBLICATION_FAILURE_STATE='+JSON.stringify({...diagnostic,bodyHtml:undefined,mainText:diagnostic.mainText?.slice(0,1800)}));
  } catch (captureError) {console.error('Publication diagnostic capture failed: '+captureError.message);}
  throw error;
} finally {await tab.close(); await browser.close();}
