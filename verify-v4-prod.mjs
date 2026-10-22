// Vérification navigateur de SOCLE V4 en production (Railway) + captures.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9347;
const ROOT = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(ROOT, 'v4-shots-prod');
const APP = 'https://socle-v4-preview.up.railway.app';
const EMAIL = 'louis.masson@outlook.com';
const PASSWORD = 'Dirck1953@';
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
async function waitFor(fn, timeout = 30000, step = 400) { const t = Date.now(); while (Date.now() - t < timeout) { try { if (await fn()) return true; } catch {} await sleep(step); } return false; }

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(ROOT, 'chrome-v4-prod')}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { try { ready = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch {} if (!ready) await sleep(500); }
  if (!ready) throw new Error('CDP indisponible');
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = await cdpClient(target.webSocketDebuggerUrl);
  await c.send('Page.enable'); await c.send('Runtime.enable');
  const evalJS = async expression => { const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.text || '')); return r.result?.value; };
  const shot = async name => { const r = await c.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, name), Buffer.from(r.data, 'base64')); };

  await c.send('Page.navigate', { url: APP + '/login' });
  await waitFor(async () => (await evalJS('document.readyState')) === 'complete');
  const loginOk = await evalJS(`(()=>{const e=document.querySelector('input[name=email]');const p=document.querySelector('input[name=password]');const f=document.querySelector('form');if(!e||!p||!f)return 'missing';e.value=${JSON.stringify(EMAIL)};p.value=${JSON.stringify(PASSWORD)};f.submit();return 'submitted'})()`);
  console.log('LOGIN form:', loginOk);
  const loaded = await waitFor(async () => { try { return await evalJS(`!!document.querySelector('#nav button') && !(document.querySelector('#main')?.innerText||'').includes('Chargement')`); } catch { return false; } }, 45000);
  console.log('APP LOADED:', loaded);
  await sleep(2000);
  const heads = await evalJS(`(()=>{const m=document.querySelector('#main');return [...m.querySelectorAll('h1,h2')].slice(0,8).map(x=>x.textContent.trim()).filter(Boolean)})()`);
  console.log('HOME:', JSON.stringify(heads));
  console.log('strip:', await evalJS(`!!document.querySelector('.v4-strip')`), '| eyebrow restant:', await evalJS(`document.querySelectorAll('.v4-strip + *, .panel-head .eyebrow').length`));
  await shot('v4p-01-accueil.png');

  await evalJS(`navigate('connecteurs');true`); await sleep(900);
  console.log('CONNECTEURS:', JSON.stringify((await evalJS(`(()=>[...document.querySelectorAll('#main h2')].slice(0,6).map(x=>x.textContent.trim()))()`))));
  await shot('v4p-02-connecteurs.png');

  await evalJS(`navigate('accounting');true`); await sleep(1200);
  await evalJS(`(()=>{const b=[...document.querySelectorAll('.v3-section-tabs button')].find(x=>x.textContent.includes('Peppol'));if(b)b.click();return !!b})()`);
  await sleep(900);
  console.log('PEPPOL:', await evalJS(`!!document.querySelector('.v4-peppol-tabs')`));
  await shot('v4p-03-peppol.png');

  await evalJS(`navigate('timeEntries');true`); await sleep(1200);
  console.log('POINTAGES:', await evalJS(`!!document.querySelector('.v4-pointages')`));
  await shot('v4p-04-pointages.png');

  await evalJS(`navigate('jobs');true`); await sleep(1200);
  await evalJS(`(()=>{if(typeof openJobWorkspace==='function'&&typeof jobs!=='undefined'&&jobs.length){openJobWorkspace(jobs[0].id);return true}return false})()`);
  await sleep(1200);
  await evalJS(`(()=>{const b=[...document.querySelectorAll('.job-workspace-tabs button')].find(x=>x.textContent.includes('Suivi'));if(b)b.click();return !!b})()`);
  await sleep(900);
  console.log('HUB:', await evalJS(`!!document.querySelector('.v4-photos')`));
  await shot('v4p-05-chantier-hub.png');

  await evalJS(`(()=>{const inp=document.querySelector('.v4-assistant footer input');inp.value='quels chantiers ont dérivé ?';const b=document.querySelector('.v4-assistant footer button');b.click();return true})()`);
  await sleep(600);
  console.log('ASSISTANT:', await evalJS(`document.querySelectorAll('.v4-assistant .msg').length`));
  await shot('v4p-06-assistant.png');
  console.log('DONE');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  try { chrome.kill(); } catch {}
  await sleep(400);
}
