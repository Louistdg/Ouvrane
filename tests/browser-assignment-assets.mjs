import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {connectBrowser, waitForApp, waitFor} from './helpers/browser-cdp.mjs';

const base = process.env.SOCLE_TEST_URL;
const browser = await connectBrowser(base);
const tab = await browser.createSession(base);
const ownerEmail = 'direction@batinova.example';
const workerEmail = 'anthony.simon@batinova.example';
const token = Date.now().toString();
const operationKey = name => `means-${name}-${token}-${crypto.randomUUID()}`;
const dateAt = days => {
  const date = new Date(Date.now() + days * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(date);
  const part = type => parts.find(value => value.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

try {
  await tab.navigate(base);
  const login = async email => {
    await tab.evaluate(`fetch('/__local-test/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)}})})`, 'means-login');
    await tab.reload();
    await waitForApp(tab);
  };
  const api = async (path, method = 'GET', body, organizationId) => tab.evaluate(`fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{'content-type':'application/json'${organizationId ? `,'x-socle-organization-id':${JSON.stringify(organizationId)}` : ''}},${body === undefined ? '' : `body:JSON.stringify(${JSON.stringify(body)}),`}}).then(async r=>({status:r.status,data:await r.json()}))`, 'means-api');
  const must = (response, status, label) => {
    assert.equal(response.status, status, `${label}: ${JSON.stringify(response)}`);
    return response.data;
  };
  const noPrices = value => {
    const visit = item => {
      if (!item || typeof item !== 'object') return;
      for (const [key, nested] of Object.entries(item)) {
        assert.equal(/^(monthly|unit_?cost(_cents)?|unitCostCents|purchasePrice|grossHourlyCents|totalCost|costCents)$/i.test(key), false, `Financial field leaked: ${key}`);
        visit(nested);
      }
    };
    visit(value);
  };
  const click = async (selector, touch = false) => {
    const hit = await tab.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)throw Error('Missing means control: '+${JSON.stringify(selector)});b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,uncovered:!!document.elementFromPoint(x,y)?.closest(${JSON.stringify(selector)})}})()`, 'means-control-target');
    assert.equal(hit.uncovered, true, `Control covered: ${selector}`);
    if (touch) {
      await tab.call('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: hit.x, y: hit.y}]});
      await tab.call('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    } else {
      await tab.call('Input.dispatchMouseEvent', {type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', clickCount: 1});
      await tab.call('Input.dispatchMouseEvent', {type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', clickCount: 1});
    }
  };
  const viewport = async width => {
    await tab.call('Emulation.setDeviceMetricsOverride', {width, height: 950, deviceScaleFactor: 1, mobile: width === 412});
    await tab.call('Emulation.setTouchEmulationEnabled', {enabled: width === 412, maxTouchPoints: 5});
    await tab.call('Network.setUserAgentOverride', {userAgent: width === 412
      ? 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 SamsungBrowser/26.0'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'});
  };

  await login(ownerEmail);
  const projects = await tab.evaluate('jobs.map(j=>({id:String(j.id),name:j.name}))', 'means-projects');
  assert.ok(projects.length >= 2, 'Two existing isolated-clone projects required');
  const projectId = projects[0].id;
  const otherProjectId = projects[1].id;
  const members = must(await api('/api/access-control'), 200, 'Members').members;
  const worker = members.find(member => member.email === workerEmail);
  assert.ok(worker?.personId, 'Worker linked to a real HR person');
  const workerId = String(worker.userId || worker.id);
  const personB = must(await api('/api/hr/people', 'POST', {displayName: `QA moyens B ${token}`, roleTitle: 'Poseur', category: 'Ouvrier', active: true}), 201, 'Second distinct worker').person;
  const createTeam = async (suffix, personId) => {
    const team = must(await api('/api/hr/teams', 'POST', {name: `QA moyens ${suffix} ${token}`, active: true}), 201, 'Create distinct team').team;
    must(await api('/api/hr/teams/' + team.id + '/members', 'PUT', {memberIds: [String(personId)]}), 200, 'Team membership');
    return {id: String(team.id), personId: String(personId)};
  };
  const teamA = await createTeam('A', worker.personId);
  const teamB = await createTeam('B', personB.id);
  const createAsset = async (name, reference, group = 'tools') => must(await api('/api/assets', 'POST', {name, reference, group, category: group === 'vehicles' ? 'Camionnette' : 'Outillage', mode: 'Propriété', condition: 'En service', monthly: 987.65, ...(group === 'vehicles' ? {vehicle: {registration: 'QA-987-65', model: 'Fourgon essai'}} : {})}), 201, 'Create real catalogue asset').id;
  const sameName = `Sertisseuse homonyme ${token}`;
  const toolA = String(await createAsset(sameName, `QA-MOYENS-A-${token}`));
  const toolB = String(await createAsset(sameName, `QA-MOYENS-B-${token}`));
  const sharedTool = String(await createAsset(`Niveau partagé ${token}`, `QA-MOYENS-SHARED-${token}`));
  const uiTool = String(await createAsset(`Visseuse écran ${token}`, `QA-MOYENS-UI-${token}`));
  const van = String(await createAsset(`Camionnette équipe ${token}`, `QA-MOYENS-VAN-${token}`, 'vehicles'));
  assert.notEqual(toolA, toolB, 'Matching names never identify the same asset');
  const assignmentBody = (team, project, date, startTime = '21:00', endTime = '22:00', extra = {}) => ({date, projectId: project, teamId: team.id, people: [team.personId], startTime, endTime, assignmentType: 'team', status: 'planned', reason: 'Simulation moyens V5 dans copie isolée', operationKey: operationKey('assignment'), ...extra});
  const createAssignment = async body => String(must(await api('/api/assignments', 'POST', body), 201, 'Create real assignment').id);
  const today = dateAt(0);
  const bodyA = assignmentBody(teamA, projectId, today, '21:00', '22:00', {vehicleId: van, packId: 'LEGACY-PACK-UNRESOLVED-QA'});
  const bodyB = assignmentBody(teamB, otherProjectId, today);
  const assignmentA = await createAssignment(bodyA);
  const assignmentB = await createAssignment(bodyB);
  const endpoint = assignmentId => '/api/assignments/' + assignmentId + '/assets';
  const read = async assignmentId => must(await api(endpoint(assignmentId)), 200, 'Read assignment means');
  const reserveBody = async (assignmentId, assetIds, changes = {}) => {
    const state = await read(assignmentId);
    return {action: 'reserve', assetIds, expectedVersion: state.expectedVersion, assignmentSignature: state.assignmentSignature, operationKey: operationKey('reserve'), ...changes};
  };
  const reserve = async (assignmentId, assetIds, changes) => api(endpoint(assignmentId), 'POST', await reserveBody(assignmentId, assetIds, changes));
  const initial = await read(assignmentA);
  assert.equal(initial.expectedVersion, 0);
  assert.equal(initial.canManage, true);
  assert.ok(initial.resources.some(resource => resource.id === van && resource.known));
  assert.ok(initial.resources.some(resource => resource.id === bodyA.packId && !resource.known), 'Legacy unresolved pack remains explicit');
  assert.equal((await api(endpoint('not-this-company'))).status, 404);
  assert.equal((await reserve(assignmentA, [toolA], {assignmentSignature: 'stale'})).status, 409);
  const reservedA = await reserveBody(assignmentA, [toolA]);
  must(await api(endpoint(assignmentA), 'POST', reservedA), 201, 'Reserve tool A');
  assert.equal(must(await api(endpoint(assignmentA), 'POST', reservedA), 200, 'Repeat reservation').replayed, true);
  assert.equal((await api(endpoint(assignmentA), 'POST', {...reservedA, assetIds: [toolB]})).status, 409, 'A key cannot be reused for different means');
  assert.equal((await reserve(assignmentB, [toolA])).status, 409, 'Different teams and projects cannot reserve the same overlapping tool');
  must(await reserve(assignmentB, [toolB]), 201, 'Independent same-name tool stays bookable');
  const adjacentBody = assignmentBody(teamB, otherProjectId, today, '22:00', '23:00');
  const adjacentAssignment = await createAssignment(adjacentBody);
  must(await reserve(adjacentAssignment, [toolA]), 201, 'Adjacent booking does not overlap');
  const staleBeforeMove = await read(assignmentA);
  assert.equal((await api('/api/assignments/' + assignmentA, 'PUT', {...bodyA, startTime: '21:30', endTime: '22:30'})).status, 409, 'Ordinary planning edits must honor extra-asset bookings');
  assert.equal((await read(assignmentA)).assignment.startTime, '21:00', 'Rejected planning edit is fully rolled back');
  assert.equal((await read(assignmentA)).assignmentSignature, staleBeforeMove.assignmentSignature);
  assert.equal((await api('/api/assignments/' + assignmentB, 'PUT', {...bodyB, vehicleId: van})).status, 409, 'Legacy vehicle selector obeys the same asset collision guard');

  const tomorrow = dateAt(1);
  const futureA = await createAssignment(assignmentBody(teamA, projectId, tomorrow, '21:00', '22:00', {vehicleId: van}));
  const futureVehicleConflict = await api('/api/assignments', 'POST', assignmentBody(teamB, otherProjectId, tomorrow, '21:00', '22:00', {vehicleId: van}));
  assert.equal(futureVehicleConflict.status, 409, 'Creating an assignment also rejects a shared vehicle, with entirely distinct people and teams');
  const futureB = await createAssignment(assignmentBody(teamB, otherProjectId, tomorrow));
  const race = await Promise.all([reserveBody(futureA, [sharedTool]), reserveBody(futureB, [sharedTool])]);
  const raceResults = await Promise.all(race.map((body, index) => api(endpoint(index ? futureB : futureA), 'POST', body)));
  assert.deepEqual(raceResults.map(response => response.status).sort(), [201, 409], JSON.stringify(raceResults));
  assert.equal((await read(futureA)).extras.includes(sharedTool) + (await read(futureB)).extras.includes(sharedTool), 1, 'Only one concurrent booking commits');
  must(await reserve(futureA, [...(await read(futureA)).extras, toolB]), 201, 'Give the worker a definite future booking independently of the race winner');

  const availabilityEndpoint = '/api/assets/' + toolA + '/availability';
  const availability = must(await api(availabilityEndpoint), 200, 'Read availability calendar');
  assert.equal(availability.timeZone, 'Europe/Brussels');
  assert.equal((await api(availabilityEndpoint, 'POST', {action: 'block', startsAt: today + 'T22:00', endsAt: today + 'T21:00', reason: 'Intervalle inversé', operationKey: operationKey('bad-block')})).status, 400);
  const blockBody = {action: 'block', startsAt: today + 'T00:00', endsAt: null, reason: 'Contrôle atelier avant départ', operationKey: operationKey('block')};
  const block = must(await api(availabilityEndpoint, 'POST', blockBody), 201, 'Record actual unavailability despite an existing booking');
  assert.equal(must(await api(availabilityEndpoint, 'POST', blockBody), 200, 'Replay same block').replayed, true);
  const blocked = await read(assignmentA);
  const blockedTool = blocked.resources.find(resource => resource.id === toolA);
  assert.equal(blockedTool.availability, 'blocked');
  assert.equal(blockedTool.canTake, false);
  const blockId = block.id || block.blockId || blockedTool.blocks.find(entry => entry.reason === blockBody.reason)?.id;
  assert.ok(blockId, 'Committed calendar block has a stable ID');
  assert.equal((await api(endpoint(assignmentA), 'POST', {action: 'take', assetId: toolA, assignmentSignature: blocked.assignmentSignature, operationKey: operationKey('blocked-take')})).status, 409);
  const resolveBody = {action: 'resolve', blockId, note: 'Contrôle terminé, matériel disponible', operationKey: operationKey('resolve')};
  must(await api(availabilityEndpoint, 'POST', resolveBody), 201, 'Resolve recorded unavailability');
  assert.equal(must(await api(availabilityEndpoint, 'POST', resolveBody), 200, 'Replay resolution').replayed, true);
  assert.equal((await read(assignmentA)).resources.find(resource => resource.id === toolA).availability, 'available');

  const task = must(await api('/api/projects/' + projectId + '/tasks', 'POST', {title: 'Mission avec outillage et véhicule', assignedTo: workerId, operationKey: operationKey('task')}), 201, 'Create task for real preparation').task;
  const prepEndpoint = '/api/tasks/' + task.id + '/preparation';
  const choices = must(await api(prepEndpoint + '?from=' + today + '&to=' + today), 200, 'Preparation assignment choices').assignments;
  const choice = choices.find(item => item.id === assignmentA);
  assert.ok(choice);
  must(await api(prepEndpoint, 'POST', {assignmentId: assignmentA, assignmentSignature: choice.signature, expectedVersion: 0, operationKey: operationKey('preparation')}), 201, 'Link task to the actual crew and means');
  const packetBody = {taskId: task.id, recipientIds: [workerId], responseMode: 'none', expectedIssueVersion: 0};
  const packetPreview = must(await api('/api/work-packets/preview', 'POST', packetBody), 200, 'Prepare a field edition with means');
  assert.ok(packetPreview.snapshot.preparation.assignment.resources.some(resource => resource.id === toolA && resource.known));
  assert.ok(packetPreview.snapshot.preparation.assignment.resources.some(resource => resource.id === van && resource.known));
  const packet = must(await api('/api/work-packets/publish', 'POST', {...packetBody, previewSignature: packetPreview.previewSignature, operationKey: operationKey('publish')}), 201, 'Publish the field edition');
  const frozenPacket = must(await api('/api/work-packets/' + packet.id), 200, 'Read published edition').snapshot;
  const nextPacket = {...packetBody, expectedIssueVersion: 1};
  const beforeBlockPreview = must(await api('/api/work-packets/preview', 'POST', nextPacket), 200, 'Preview before a real breakdown');
  const editionBlock = must(await api(availabilityEndpoint, 'POST', {action: 'block', startsAt: today + 'T00:00', endsAt: null, reason: 'Panne après aperçu avant diffusion', operationKey: operationKey('edition-block')}), 201, 'Record breakdown after preview');
  assert.equal((await api('/api/work-packets/publish', 'POST', {...nextPacket, previewSignature: beforeBlockPreview.previewSignature, operationKey: operationKey('stale-means-publish')})).status, 409, 'A breakdown invalidates an existing publication preview');
  assert.equal((await api('/api/work-packets/preview', 'POST', nextPacket)).status, 409, 'New field edition cannot promise unavailable known means');
  assert.deepEqual(must(await api('/api/work-packets/' + packet.id), 200, 'Existing edition after breakdown').snapshot, frozenPacket, 'A later breakdown never rewrites an issued edition');
  const editionBlockId = editionBlock.id || editionBlock.blockId || (await read(assignmentA)).resources.find(resource => resource.id === toolA).blocks.find(entry => entry.reason === 'Panne après aperçu avant diffusion')?.id;
  must(await api(availabilityEndpoint, 'POST', {action: 'resolve', blockId: editionBlockId, note: 'Réparé et contrôlé avant départ', operationKey: operationKey('edition-resolve')}), 201, 'Resolve breakdown before preparing another edition');
  must(await api('/api/work-packets/preview', 'POST', nextPacket), 200, 'Fresh preview after resolution');

  // Use the rendered controls and real CDP input. Offline and lost-response cases
  // are deliberate transport failures, never a second fake database or mock API.
  for (const width of [1440, 412]) {
    await viewport(width);
    await tab.evaluate(`openTaskPreparation(${JSON.stringify(task.id)},{from:${JSON.stringify(today)},to:${JSON.stringify(today)}})`, 'means-preparation-entry');
    await tab.evaluate(`openAssignmentAssets(${JSON.stringify(assignmentA)})`, 'means-desk');
    assert.equal(await tab.evaluate("!!document.querySelector('#assignmentAssetsDesk')", 'means-desk-visible'), true);
    assert.equal(await tab.evaluate('document.documentElement.scrollWidth>innerWidth', 'means-page-overflow'), false);
    assert.equal(await tab.evaluate("(()=>{const r=document.querySelector('#assignmentAssetsDesk');return r.scrollWidth>r.clientWidth+1})()", 'means-desk-overflow'), false);
    await tab.evaluate(`(()=>{window.meansRoot=document.querySelector('#assignmentAssetsDesk');const s=document.querySelector('#assignmentAssetsSearch');s.value=${JSON.stringify('QA-MOYENS-UI-' + token)};s.dispatchEvent(new Event('input',{bubbles:true}))})()`, 'search-real-asset');
    await waitFor(() => tab.evaluate(`!!document.querySelector('#assignmentAssetsOptions [data-asset-id="${uiTool}"]')`, 'means-option-filtered'), 'Searched catalogue asset is shown');
    assert.equal(await tab.evaluate(`!!document.querySelector('#assignmentAssetsOptions [data-asset-id="${toolA}"]')?.getClientRects().length`, 'means-search-excludes-other-reference'), false);
    const checkbox = `#assignmentAssetsOptions input[type=checkbox][data-asset-id="${uiTool}"]`;
    if (!await tab.evaluate(`document.querySelector(${JSON.stringify(checkbox)}).checked`, 'means-extra-current')) await click(checkbox, width === 412);
    if (width === 1440) {
      await tab.evaluate(`(()=>{window.meansNativeFetch=window.fetch;window.meansLoseResponse=true;window.fetch=async(...args)=>{const response=await window.meansNativeFetch(...args);if(window.meansLoseResponse&&String(args[0])===${JSON.stringify(endpoint(assignmentA))}&&args[1]?.method==='POST'&&JSON.parse(args[1].body).action==='reserve'&&response.ok){await response.clone().text();window.meansLoseResponse=false;throw new TypeError('Réponse perdue après réservation des moyens')}return response}})()`, 'means-drop-one-success');
      await tab.call('Network.enable');
      await tab.call('Network.emulateNetworkConditions', {offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
      try {
        await click('#assignmentAssetsReserve');
        await waitFor(() => tab.evaluate("!!document.querySelector('#assignmentAssetsStatus')?.textContent&&!document.querySelector('#assignmentAssetsReserve').disabled", 'means-offline-message'), 'Offline reservation is rejected visibly');
      } finally {
        await tab.call('Network.emulateNetworkConditions', {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
      }
      assert.equal((await read(assignmentA)).extras.includes(uiTool), false, 'Offline reservation is not silently queued');
      await click('#assignmentAssetsReserve');
      await waitFor(() => tab.evaluate("document.querySelector('#assignmentAssetsStatus')?.textContent.includes('Réponse perdue')&&!document.querySelector('#assignmentAssetsReserve').disabled", 'means-lost-response-visible'), 'Committed reservation with lost response is visible');
    }
    await click('#assignmentAssetsReserve', width === 412);
    await waitFor(async () => (await read(assignmentA)).extras.includes(uiTool), 'UI reservation has committed');
    await waitFor(() => tab.evaluate("!document.querySelector('#assignmentAssetsReserve').disabled", 'means-form-ready'), 'UI ready after reservation');
    assert.equal(await tab.evaluate("document.querySelector('#assignmentAssetsDesk')===window.meansRoot", 'means-preserve-root'), true, 'Mutation must not create a false modal history entry');
    if (width === 1440) await tab.evaluate('window.fetch=window.meansNativeFetch', 'means-restore-native-fetch');
    const state = await read(assignmentA);
    assert.equal(state.extras.filter(id => id === uiTool).length, 1, 'Lost-response retry never duplicates the selection');
    await tab.evaluate(`(()=>{const s=document.querySelector('#assignmentAssetsSearch');s.value=${JSON.stringify('QA-MOYENS-A-' + token)};s.dispatchEvent(new Event('input',{bubbles:true}))})()`, 'means-search-after-write');
    await waitFor(() => tab.evaluate(`!!document.querySelector('#assignmentAssetsOptions [data-asset-id="${toolA}"]')`, 'means-after-write-option'), 'Search remains connected after saving');
    const shot = await tab.call('Page.captureScreenshot', {format: 'png'});
    writeFileSync(new URL('./assignment-assets-office-' + width + '.png', import.meta.url), Buffer.from(shot.data, 'base64'));
    await click(`[data-action="availability"][data-asset-id="${toolA}"]`, width === 412);
    await waitFor(() => tab.evaluate("!!document.querySelector('#assignmentAssetAvailability')", 'means-calendar-visible'), 'Availability panel is accessible');
    assert.equal(await tab.evaluate('document.documentElement.scrollWidth>innerWidth', 'means-calendar-overflow'), false);
    await tab.evaluate('backModal()', 'means-back-from-calendar');
    assert.equal(await tab.evaluate("!!document.querySelector('#assignmentAssetsDesk')", 'means-back-to-assets'), true);
    await tab.evaluate('backModal()', 'means-back-to-preparation');
    assert.equal(await tab.evaluate("!!document.querySelector('#taskPreparationDesk')", 'means-preparation-restored'), true, 'Back returns directly to the caller after a write');
    // Reset only the new extra so the mobile pass also creates a real change.
    must(await reserve(assignmentA, [toolA]), 201, 'Reset UI-only extra between viewports');
  }
  must(await reserve(assignmentA, [toolA, uiTool]), 201, 'Prepare a second traceable take for the historical-return scenario');

  await login(workerEmail);
  const own = await read(assignmentA);
  assert.equal(own.canManage, false);
  assert.ok(!own.options?.length, 'Worker never receives the office catalogue picker');
  noPrices(own);
  assert.equal((await api(endpoint(assignmentB))).status, 404, 'Unrelated crew remains hidden');
  assert.equal((await api(endpoint(assignmentA), 'POST', {action: 'reserve', assetIds: [], expectedVersion: own.expectedVersion, assignmentSignature: own.assignmentSignature, operationKey: operationKey('worker-reserve')})).status, 403);
  assert.equal((await api(availabilityEndpoint, 'POST', blockBody)).status, 403);
  assert.equal((await api(endpoint(futureA), 'POST', {action: 'take', assetId: toolB, assignmentSignature: (await read(futureA)).assignmentSignature, operationKey: operationKey('future-take')})).status, 409, 'Worker cannot physically take a future booking');
  for (const width of [1440, 412]) {
    await viewport(width);
    await tab.evaluate(`openAssignmentAssets(${JSON.stringify(assignmentA)})`, 'means-worker-desk');
    assert.equal(await tab.evaluate("!!document.querySelector('#assignmentAssetsReserve')", 'means-worker-no-save'), false);
    assert.equal(await tab.evaluate('document.documentElement.scrollWidth>innerWidth', 'means-worker-overflow'), false);
    const shot = await tab.call('Page.captureScreenshot', {format: 'png'});
    writeFileSync(new URL('./assignment-assets-worker-' + width + '.png', import.meta.url), Buffer.from(shot.data, 'base64'));
  }
  const takeContext = await read(assignmentA);
  const takeBody = {action: 'take', assetId: toolA, assignmentSignature: takeContext.assignmentSignature, operationKey: operationKey('simultaneous-take')};
  const takes = await Promise.all([api(endpoint(assignmentA), 'POST', takeBody), api(endpoint(assignmentA), 'POST', takeBody)]);
  assert.deepEqual(takes.map(response => response.status).sort(), [200, 201], JSON.stringify(takes));
  const taken = await read(assignmentA);
  const takenTool = taken.resources.find(resource => resource.id === toolA);
  assert.equal(takenTool.availability, 'out');
  assert.equal(takenTool.canTake, false);
  assert.equal(takenTool.canReturn, true);
  assert.ok(takenTool.custody?.takeId);
  assert.deepEqual(taken.history, [], 'Operational workers do not receive the cross-project office history');
  noPrices(taken);
  const takeId = takenTool.custody.takeId;
  const secondTakeContext = await read(assignmentA);
  must(await api(endpoint(assignmentA), 'POST', {action: 'take', assetId: uiTool, assignmentSignature: secondTakeContext.assignmentSignature, operationKey: operationKey('take-before-replan')}), 201, 'Take another tool before the crew changes');
  const secondTakeId = (await read(assignmentA)).resources.find(resource => resource.id === uiTool).custody.takeId;

  await login(ownerEmail);
  // The same team and tool occupy consecutive calendar days. A grouped shift
  // must release intermediate slots atomically, while preserving real custody.
  // This checks atomic movement and conflict rejection, not the pre-existing
  // lack of a global planning CAS under concurrent edits.
  const groupPerson = must(await api('/api/hr/people', 'POST', {displayName: `QA décalage groupé ${token}`, roleTitle: 'Poseur', category: 'Ouvrier', active: true}), 201, 'Create an isolated grouped-replan person').person;
  const groupTeam = await createTeam('décalage groupé', groupPerson.id);
  const groupDay0 = dateAt(20), groupDay1 = dateAt(21), groupDay2 = dateAt(22), groupDay3 = dateAt(23);
  const groupFirst = await createAssignment(assignmentBody(groupTeam, projectId, groupDay0));
  const groupSecond = await createAssignment(assignmentBody(groupTeam, projectId, groupDay1));
  must(await reserve(groupFirst, [toolA]), 201, 'Reserve the shared tool for the first grouped day');
  must(await reserve(groupSecond, [toolA]), 201, 'Reserve the same tool for the next calendar day');
  const physicalBeforeGroup = (await read(assignmentA)).resources.find(resource => resource.id === toolA).custody;
  assert.equal(physicalBeforeGroup.takeId, takeId);
  const groupRequest = {scope: 'team', teamId: groupTeam.id, from: groupDay0, to: groupDay1, shiftDays: 1, reason: 'Décaler ensemble deux journées consécutives sans fausse collision intermédiaire', operationKey: operationKey('group-replan')};
  const groupMoved = must(await api('/api/planning/replan', 'POST', groupRequest), 200, 'Shift consecutive bookings together by one day');
  assert.equal(groupMoved.count, 2);
  assert.deepEqual(groupMoved.ids.map(String).sort(), [groupFirst, groupSecond].sort());
  assert.equal((await read(groupFirst)).assignment.date, groupDay1);
  assert.equal((await read(groupSecond)).assignment.date, groupDay2);
  assert.equal(must(await api('/api/planning/replan', 'POST', groupRequest), 200, 'Retry the same grouped shift').replayed, true);
  assert.equal((await read(groupFirst)).assignment.date, groupDay1, 'Replay does not shift the first day twice');
  assert.equal((await read(groupSecond)).assignment.date, groupDay2, 'Replay does not shift the second day twice');
  assert.deepEqual((await read(assignmentA)).resources.find(resource => resource.id === toolA).custody, physicalBeforeGroup, 'Successful grouped replan never creates a physical return');
  const outsideAssignment = await createAssignment(assignmentBody(teamB, otherProjectId, groupDay3));
  must(await reserve(outsideAssignment, [toolA]), 201, 'Reserve the final destination with an outside crew');
  const beforeRejectedGroup = await Promise.all([read(groupFirst), read(groupSecond), read(outsideAssignment)]);
  assert.equal((await api('/api/planning/replan', 'POST', {...groupRequest, from: groupDay1, to: groupDay2, reason: 'Destination finale déjà occupée par une autre équipe', operationKey: operationKey('group-replan-conflict')})).status, 409, 'Reject an outside conflict in the final grouped destination');
  for (let index = 0; index < beforeRejectedGroup.length; index++) {
    const id = [groupFirst, groupSecond, outsideAssignment][index];
    const after = await read(id);
    assert.deepEqual(after.assignment, beforeRejectedGroup[index].assignment, 'Rejected grouped replan does not move or cancel part of the group');
    assert.equal(after.assignmentSignature, beforeRejectedGroup[index].assignmentSignature, 'Rejected grouped replan preserves every booking guard');
    assert.deepEqual(after.extras, beforeRejectedGroup[index].extras);
  }
  const afterRejectedGroup = await read(assignmentA);
  assert.deepEqual(afterRejectedGroup.resources.find(resource => resource.id === toolA).custody, physicalBeforeGroup, 'Failed grouped replan never creates a physical return');
  assert.equal(afterRejectedGroup.history.filter(entry => entry.kind === 'return' && entry.assetId === toolA).length, 0);
  console.log('PASS grouped planning API: consecutive days sharing one crew/tool shift atomically, retry replays once, outside final conflict rejects all changes, physical custody remains open. Global concurrent-edit CAS is pre-existing and not qualified here.');
  must(await api('/api/assignments/' + assignmentA, 'DELETE'), 200, 'Cancel actual assignment');
  const cancelled = await read(assignmentA);
  assert.equal(cancelled.resources.find(resource => resource.id === toolA).custody.takeId, takeId, 'Planning cancellation never fakes a physical return');
  must(await api('/api/assignments/' + assignmentB, 'PUT', {...bodyB, vehicleId: van}), 200, 'Cancelled booking releases vehicle planning slot');
  await login(workerEmail);
  const afterCancel = await read(assignmentA);
  assert.equal(afterCancel.resources.find(resource => resource.id === toolA).canReturn, true, 'Original worker can return a tool after cancellation');
  assert.equal(must(await api(endpoint(assignmentA), 'POST', takeBody), 200, 'Acknowledgement after cancellation').replayed, true);
  await tab.evaluate(`openAssignmentAssets(${JSON.stringify(assignmentA)})`, 'means-return-after-cancel');
  await tab.evaluate(`(()=>{const note=document.querySelector('[data-return-note][data-asset-id="${toolA}"]');note.value='Rendu au dépôt après annulation';note.dispatchEvent(new Event('input',{bubbles:true}))})()`, 'means-physical-return-note');
  await tab.evaluate(`(()=>{window.meansReturnNativeFetch=window.fetch;window.meansDropReturn=true;window.fetch=async(...args)=>{const response=await window.meansReturnNativeFetch(...args);if(window.meansDropReturn&&String(args[0])===${JSON.stringify(endpoint(assignmentA))}&&args[1]?.method==='POST'&&JSON.parse(args[1].body).action==='return'&&response.ok){window.meansReturnRequest=JSON.parse(args[1].body);await response.clone().text();window.meansDropReturn=false;throw new TypeError('Réponse perdue après retour physique')}return response}})()`, 'means-drop-return-response');
  const returnSelector = `[data-action="return"][data-asset-id="${toolA}"]`;
  await click(returnSelector, true);
  await waitFor(() => tab.evaluate("document.querySelector('#assignmentAssetsStatus')?.textContent.includes('Réponse perdue')", 'means-lost-return-visible'), 'Lost return response is visible');
  await click(returnSelector, true);
  await waitFor(async () => !(await read(assignmentA)).resources.find(resource => resource.id === toolA)?.custody, 'Return retry resolves the same physical event');
  await tab.evaluate('window.fetch=window.meansReturnNativeFetch', 'means-restore-return-fetch');
  const returned = await read(assignmentA);
  assert.deepEqual(returned.history, [], 'Return acknowledgement does not disclose the office history');
  noPrices(returned);

  await login(ownerEmail);
  const officeReturn = await read(assignmentA);
  assert.equal(officeReturn.history.filter(entry => entry.kind === 'take' && entry.assetId === toolA).length, 1);
  assert.equal(officeReturn.history.filter(entry => entry.kind === 'return' && entry.assetId === toolA).length, 1);
  assert.equal(officeReturn.history.find(entry => entry.kind === 'return' && entry.assetId === toolA).note, 'Rendu au dépôt après annulation');
  must(await api('/api/assignments/' + assignmentA, 'PUT', assignmentBody(teamB, otherProjectId, dateAt(2), '21:00', '22:00', {vehicleId: null, packId: null})), 200, 'Replan an assignment while its old tool remains physically out');
  await login(workerEmail);
  const returnOnly = await read(assignmentA);
  assert.equal(returnOnly.returnOnly, true);
  assert.equal(returnOnly.assignment.projectId, projectId, 'Return-only context uses the original project');
  assert.equal(returnOnly.assignmentSignature, null);
  assert.deepEqual(returnOnly.extras, []);
  assert.ok(!returnOnly.options?.length, 'Return-only reader never receives the new crew catalogue');
  assert.equal(JSON.stringify(returnOnly).includes(otherProjectId), false, 'Replanned project is not leaked to the old participant');
  assert.equal(JSON.stringify(returnOnly).includes(String(personB.id)), false, 'Replanned crew is not leaked to the old participant');
  assert.deepEqual(returnOnly.resources.map(resource => resource.id), [uiTool], 'Only the historical open take remains available to return');
  assert.equal(returnOnly.resources[0].canReturn, true);
  noPrices(returnOnly);
  const historicalReturn = {action: 'return', assetId: uiTool, takeId: secondTakeId, note: 'Retour par le preneur initial après changement d’équipe', operationKey: operationKey('historical-return')};
  must(await api(endpoint(assignmentA), 'POST', historicalReturn), 201, 'Original participant returns the historically taken tool');
  assert.equal(must(await api(endpoint(assignmentA), 'POST', historicalReturn), 200, 'Replay historical return after access expires').replayed, true);
  assert.equal((await api(endpoint(assignmentA))).status, 404, 'Historical-return access ends after the last actual return');

  await login(ownerEmail);
  const tomorrowTask = must(await api('/api/projects/' + projectId + '/tasks', 'POST', {title: 'Mission de demain avec contrôle matériel', assignedTo: workerId, operationKey: operationKey('future-task')}), 201, 'Create tomorrow mission').task;
  const tomorrowPrep = '/api/tasks/' + tomorrowTask.id + '/preparation';
  const tomorrowChoice = must(await api(tomorrowPrep + '?from=' + tomorrow + '&to=' + tomorrow), 200, 'Tomorrow preparation choices').assignments.find(item => item.id === futureA);
  assert.ok(tomorrowChoice);
  must(await api(tomorrowPrep, 'POST', {assignmentId: futureA, assignmentSignature: tomorrowChoice.signature, expectedVersion: 0, operationKey: operationKey('future-preparation')}), 201, 'Link tomorrow mission');
  const tomorrowPacketBody = {taskId: tomorrowTask.id, recipientIds: [workerId], responseMode: 'none', expectedIssueVersion: 0};
  const tomorrowPreview = must(await api('/api/work-packets/preview', 'POST', tomorrowPacketBody), 200, 'Preview tomorrow means before issue');
  const tomorrowPacket = must(await api('/api/work-packets/publish', 'POST', {...tomorrowPacketBody, previewSignature: tomorrowPreview.previewSignature, operationKey: operationKey('future-packet')}), 201, 'Publish tomorrow edition');
  const frozenTomorrow = must(await api('/api/work-packets/' + tomorrowPacket.id), 200, 'Read tomorrow issued edition').snapshot;
  await login(workerEmail);
  const issueDescription = 'Câble endommagé, utilisation interdite avant contrôle atelier ' + token;
  must(await api('/api/assets/' + toolB + '/issues', 'POST', {severity: 'Immobilisé', description: issueDescription}), 201, 'Worker reports an actual immobilizing fault');
  await login(ownerEmail);
  const issueAvailability = must(await api('/api/assets/' + toolB + '/availability'), 200, 'Read the calendar generated by the critical issue');
  const issueBlock = issueAvailability.blocks.find(entry => !entry.resolved && entry.reason === issueDescription);
  assert.ok(issueBlock, 'Critical issue atomically creates an explicit unresolved availability block');
  assert.equal((await read(futureA)).resources.find(resource => resource.id === toolB).availability, 'blocked', 'Open immobilization blocks the existing booking tomorrow');
  assert.equal((await api('/api/work-packets/preview', 'POST', {...tomorrowPacketBody, expectedIssueVersion: 1})).status, 409, 'Tomorrow field edition cannot silently ignore a critical issue');
  assert.deepEqual(must(await api('/api/work-packets/' + tomorrowPacket.id), 200, 'Read old edition after critical issue').snapshot, frozenTomorrow);
  must(await api('/api/assets/' + toolB + '/availability', 'POST', {action: 'resolve', blockId: issueBlock.id, note: 'Câble remplacé puis contrôle avant reprise', operationKey: operationKey('resolve-critical-issue')}), 201, 'Office records return to service');
  must(await api('/api/work-packets/preview', 'POST', {...tomorrowPacketBody, expectedIssueVersion: 1}), 200, 'Fresh edition available after explicit resolution');

  const org = must(await api('/api/organizations', 'POST', {name: 'QA moyens autre entreprise ' + token}), 201, 'Create isolated second company').organization;
  assert.equal((await api(endpoint(assignmentA), 'GET', undefined, org.id)).status, 404);
  assert.equal((await api(availabilityEndpoint, 'GET', undefined, org.id)).status, 404);
  assert.equal((await api(endpoint(assignmentA), 'POST', {...reservedA, operationKey: operationKey('foreign-company')}, org.id)).status, 404);
  await tab.reload();
  await waitForApp(tab);
  const persisted = await read(assignmentA);
  assert.equal(persisted.history.filter(entry => entry.kind === 'take' && entry.assetId === toolA).length, 1);
  assert.equal(persisted.history.filter(entry => entry.kind === 'return' && entry.assetId === toolA).length, 1);
  must(await api('/api/access-control/' + workerId, 'PUT', {profileName: 'QA terrain sans matériel', scope: 'Ses chantiers uniquement', modules: {jobs: {view: true}, actions: {view: true}, planning: {view: true}}, sensitive: {}, fieldActions: {}, projectIds: [projectId]}), 200, 'Keep task/project access while revoking asset access');
  await login(workerEmail);
  const limitedPortal = must(await api('/api/projects/' + projectId + '/field-portal?date=' + tomorrow), 200, 'Field portal without asset permission');
  assert.equal(limitedPortal.capabilities.viewAssets, false);
  assert.ok(limitedPortal.team.assignments.some(item => String(item.id) === futureA), 'Fixture still exposes the permitted own assignment');
  for (const assignment of limitedPortal.team.assignments) {
    assert.equal(Object.hasOwn(assignment, 'resources'), false, 'Portal must not add resource names, block reasons or custody without asset permission');
    assert.equal(Object.hasOwn(assignment, 'assetIds'), false, 'Portal must not add the complementary asset catalogue without asset permission');
  }
  assert.deepEqual(limitedPortal.assets, []);
  assert.equal(JSON.stringify(limitedPortal).includes(issueDescription), false, 'Internal breakdown description stays hidden after asset access is revoked');
  assert.equal(JSON.stringify(limitedPortal).includes(sameName), false, 'Complementary tool names stay hidden after asset access is revoked');
  const hiddenPreparation = must(await api('/api/tasks/' + tomorrowTask.id + '/preparation'), 200, 'Own task preparation remains available after asset permission is revoked');
  assert.deepEqual(hiddenPreparation.current.assignment.resources, []);
  assert.equal(hiddenPreparation.current.assignment.resourcesHidden, true);
  assert.equal(JSON.stringify(hiddenPreparation).includes(sameName), false, 'Preparation does not bypass revoked asset permission');
  assert.equal((await api('/api/work-packets/' + tomorrowPacket.id)).status, 403, 'Issued means respect current recipient asset permission');
  const hiddenPackets = must(await api('/api/work-packets?taskId=' + tomorrowTask.id), 200, 'Field-edition list after asset permission is revoked');
  assert.equal(hiddenPackets.items.some(item => item.id === tomorrowPacket.id), false, 'An inaccessible means edition is absent from the recipient list');
  await login(ownerEmail);
  assert.equal((await api('/api/work-packets/preview', 'POST', {...tomorrowPacketBody, expectedIssueVersion: 1})).status, 403, 'Office cannot issue means to a recipient without material permission');
  console.log('PASS real means/planning: distinct crews and same-name asset identities; overlap and adjacency; concurrent allocation; legacy vehicle and ordinary planning edits share guards; unavailability/resolution; stale publication preview and immutable issued means; office vs own worker/outsider/tenant isolation without prices; offline and lost-response recovery; cancellation never invents a return; physical take/return retries and private historical return after crew/project replan; PC1440 and Samsung412 emulated mouse/touch, search after writes, Back and overflow; reload persistence.');
} finally {
  try { await tab.evaluate('if(window.meansNativeFetch)window.fetch=window.meansNativeFetch;if(window.meansReturnNativeFetch)window.fetch=window.meansReturnNativeFetch', 'means-clean-fetch'); } catch {}
  try { await tab.call('Network.emulateNetworkConditions', {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1}); } catch {}
  await tab.close();
  await browser.close();
}
