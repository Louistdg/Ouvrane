import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {connectBrowser,waitFor,waitForApp} from './helpers/browser-cdp.mjs';
const base=process.env.SOCLE_TEST_URL;assert.ok(base&&new URL(base).hostname==='127.0.0.1');const browser=await connectBrowser(base),tab=await browser.createSession(base);
const run=(s,l)=>tab.evaluate(s,'sidebar:'+l);
try{
 await tab.navigate(base+'/health');await run("fetch('/__local-test/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'direction@batinova.example'})}).then(r=>{if(!r.ok)throw Error('Login failed')})",'login');await tab.navigate(base);await waitForApp(tab);
 await waitFor(()=>run('iaAAttentionHomeReady()','home-feeds-ready'),'Initial home feeds settle before taking menu coordinates');
 await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))','home-painted');
 await tab.call('Emulation.setDeviceMetricsOverride',{width:1440,height:700,deviceScaleFactor:1,mobile:false});
 await waitFor(()=>run('document.querySelector("#nav").scrollHeight>document.querySelector("#nav").clientHeight+100','scrollable'),'Sidebar exceeds its viewport');
 for(const route of ['company','permissions']){
  await run('document.querySelector("#nav").scrollTop=document.querySelector("#nav").scrollHeight;new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))','scroll-painted');
  const before=await waitFor(()=>run(`(()=>{const nav=document.querySelector('#nav'),button=nav.querySelector('[data-nav-route="${route}"]');const r=button.getBoundingClientRect(),point={x:r.x+r.width/2,y:r.y+r.height/2},hit=document.elementFromPoint(point.x,point.y);if(!hit||!(hit===button||button.contains(hit))){button.scrollIntoView({block:'nearest'});return null;}return{top:nav.scrollTop,...point}})()`,'usable-'+route),'Actual visible menu target '+route);assert.ok(before.top>100);
  await tab.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:before.x,y:before.y});await tab.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:before.x,y:before.y});
  await waitFor(()=>run(`view==='${route}'`,'route-'+route),'Selected section opens');await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))','paint');
  const after=await run('document.querySelector("#nav").scrollTop','position-'+route);assert.ok(Math.abs(after-before.top)<=1,`Sidebar must stay at ${before.top}px after ${route}, got ${after}px`);
  await run('render();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))','refresh');assert.equal(await run('document.querySelector("#nav").scrollTop','after-refresh'),after,'Refresh keeps sidebar position');
 }
 const shot=await tab.call('Page.captureScreenshot',{format:'png'});writeFileSync(new URL('./sidebar-scroll-preserved.png',import.meta.url),Buffer.from(shot.data,'base64'));console.log('PASS sidebar position preserved on two real clicks and subsequent refreshes');
}catch(e){const shot=await tab.call('Page.captureScreenshot',{format:'png'});writeFileSync(new URL('./sidebar-scroll-failure.png',import.meta.url),Buffer.from(shot.data,'base64'));throw e}finally{await browser.close()}
