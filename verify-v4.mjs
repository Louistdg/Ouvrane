// Vérification navigateur du prototype SOCLE V4 local + captures.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9346;
const ROOT = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(ROOT, 'v4-shots');
const APP = 'http://127.0.0.1:4281';
const sleep = ms => new Promise(r => setTimeout(r, ms));
mkdirSync(SHOTS, { recursive: true });

function cdpClient(wsUrl) {
  let seq = 0; const pending = new Map(); const listeners = new Map(); let socket;
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, { res, rej });
    socket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 30000);
  });
  const on = (ev, fn) => listeners.set(ev, fn);
  return new Promise((res, rej) => {
    socket = new WebSocket(wsUrl);
    socket.onopen = () => res({ send, on });
    socket.onerror = () => rej(new Error('ws error'));
    socket.onmessage = e => {
      const d = JSON.parse(e.data);
      if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
      else if (d.method && listeners.has(d.method)) listeners.get(d.method)(d.params || {});
    };
  });
}
async function waitFor(fn, timeout = 20000, step = 400) { const t = Date.now(); while (Date.now() - t < timeout) { try { if (await fn()) return true; } catch {} await sleep(step); } return false; }

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(ROOT, 'chrome-v4-profile')}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { try { ready = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch {} if (!ready) await sleep(500); }
  if (!ready) throw new Error('CDP indisponible');
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = await cdpClient(target.webSocketDebuggerUrl);
  await c.send('Page.enable'); await c.send('Runtime.enable');
  const evalJS = async expression => { const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.text || '')); return r.result?.value; };
  const shot = async name => { const r = await c.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, name), Buffer.from(r.data, 'base64')); };

  await c.send('Page.navigate', { url: APP + '/' });
  await waitFor(async () => (await evalJS('document.readyState')) === 'complete');
  await sleep(1200);
  const initial = await evalJS(`(()=>{const m=document.querySelector('#main');return (m?m.innerText.slice(0,300):'')+' ||| title='+document.title})()`);
  console.log('INITIAL:', JSON.stringify(initial));

  // Connexion locale de test : direction@batinova.example (OWNER Marc Delcourt)
  const loginDone = await waitFor(async () => {
    try { return await evalJS(`(async()=>{const r=await fetch('/__local-test/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'direction@batinova.example'})});return r.status})()`) === 200; } catch { return false; }
  });
  console.log('LOGIN:', loginDone);
  await c.send('Page.navigate', { url: APP + '/' });
  const loaded = await waitFor(async () => { try { return await evalJS(`!!document.querySelector('#nav button') && !(document.querySelector('#main')?.innerText||'').includes('Chargement')`); } catch { return false; } }, 45000);
  console.log('APP LOADED:', loaded);
  await sleep(1500);

  const grab = async () => await evalJS(`(()=>{const m=document.querySelector('#main');if(!m)return null;const heads=[...m.querySelectorAll('h1,h2')].slice(0,8).map(x=>x.textContent.trim()).filter(Boolean);return {heads,text:(m.innerText||'').replace(/\\s+/g,' ').trim().slice(0,500)}})()`);

  // 1. Accueil
  let info = await grab();
  console.log('HOME:', JSON.stringify(info?.heads), '| strip:', await evalJS(`!!document.querySelector('.v4-strip')`), '| connected:', await evalJS(`!!document.querySelector('.v4-home-connected')`), '| assistant:', await evalJS(`!!document.querySelector('.v4-assistant')`));
  await shot('v4-01-accueil.png');

  // 2. Connecteurs
  await evalJS(`navigate('connecteurs');true`);
  await sleep(900);
  console.log('CONNECTEURS:', JSON.stringify((await grab())?.heads));
  await shot('v4-02-connecteurs.png');

  // 3. Comptabilité + onglet Peppol
  await evalJS(`navigate('accounting');true`); await sleep(1200);
  const tabOk = await evalJS(`(document.querySelector('.v3-section-tabs')?[...document.querySelectorAll('.v3-section-tabs button')].map(b=>b.textContent.trim()):[])`);
  console.log('FINANCE TABS:', JSON.stringify(tabOk));
  await shot('v4-03-comptabilite.png');
  await evalJS(`(()=>{const b=[...document.querySelectorAll('.v3-section-tabs button')].find(x=>x.textContent.includes('Peppol'));if(b)b.click();return !!b})()`);
  await sleep(900);
  console.log('PEPPOL PANEL:', await evalJS(`!!document.querySelector('.v4-peppol-tabs')`), '|', JSON.stringify((await grab())?.heads));
  await shot('v4-04-peppol.png');

  // 4. Pointages
  await evalJS(`navigate('timeEntries');true`); await sleep(1200);
  console.log('POINTAGES:', await evalJS(`!!document.querySelector('.v4-pointages')`));
  await shot('v4-05-pointages.png');

  // 5. Biens & matériel
  await evalJS(`navigate('fleet');true`); await sleep(1200);
  console.log('FLEET:', await evalJS(`!!document.querySelector('.v4-fleet')`));
  await shot('v4-06-materiel.png');

  // 6. Devis
  await evalJS(`navigate('quotes');true`); await sleep(1200);
  console.log('QUOTES:', await evalJS(`!!document.querySelector('.v4-quotes')`));
  await shot('v4-07-devis.png');

  // 7. Chantier hub
  await evalJS(`navigate('jobs');true`); await sleep(1200);
  const opened = await evalJS(`(()=>{if(typeof openJobWorkspace==='function'&&typeof jobs!=='undefined'&&jobs.length){openJobWorkspace(jobs[0].id);return true}const b=document.querySelector('#main [onclick*="openJobWorkspace"]');if(b){b.click();return true}return false})()`);
  console.log('JOB OPEN:', opened);
  await sleep(1200);
  await evalJS(`(()=>{const b=[...document.querySelectorAll('.job-workspace-tabs button')].find(x=>x.textContent.includes('Suivi'));if(b)b.click();return !!b})()`);
  await sleep(900);
  console.log('HUB:', await evalJS(`!!document.querySelector('.v4-photos')`), '|', JSON.stringify((await grab())?.heads));
  await shot('v4-08-chantier-hub.png');

  // 8. Assistant IA test
  await evalJS(`(()=>{const inp=document.querySelector('.v4-assistant footer input');inp.value='quels chantiers ont dérivé ?';const b=document.querySelector('.v4-assistant footer button');b.click();return true})()`);
  await sleep(600);
  const msgs = await evalJS(`[...document.querySelectorAll('.v4-assistant .msg')].map(m=>m.textContent.slice(0,80))`);
  console.log('ASSISTANT:', JSON.stringify(msgs));
  await shot('v4-09-assistant.png');
  console.log('DONE');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch {}
  await sleep(400);
}
