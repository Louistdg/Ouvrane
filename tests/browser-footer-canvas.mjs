import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {connectBrowser,waitFor} from './helpers/browser-cdp.mjs';

// Static real shell/CSS fixture: no authentication, database or production writes.
const root=resolve('web'),dir=resolve('tests/artifacts/footer-'+Date.now());mkdirSync(dir,{recursive:true});
const before=process.argv.includes('--before');
let html=readFileSync(resolve(root,'index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('socle-v3 socle-loading','socle-v3');
html=html.replace(/<main id="main">[\s\S]*?<\/main>/,'<main id="main"><h1>Personnel &amp; équipes</h1><div class="card">Composez les équipes</div></main>');
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(name==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
 const path=resolve(root,'.'+name);if(!path.startsWith(root+'\\')||!existsSync(path)){res.writeHead(404);res.end();return}
 let data=readFileSync(path);
 if(before&&name==='/ouvrane-repere.css')data=Buffer.from(data.toString().replace(/\/\* One canvas[\s\S]*?(?=body\.socle-v3\[data-v3-theme\^="repere-"\] :is)/,'body.socle-v3[data-v3-theme^="repere-"] #main{position:relative;isolation:isolate;background:var(--sx-canvas)!important}\nbody.socle-v3[data-v3-theme^="repere-"] #main::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background-image:var(--repere-texture);background-size:cover;background-position:50% 45%;opacity:.12}\n'));
 res.setHeader('Content-Type',({'.css':'text/css','.png':'image/png','.js':'text/javascript'})[extname(path)]||'application/octet-stream');res.end(data);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0','--user-data-dir='+resolve(dir,'chrome'),'--no-first-run','--no-default-browser-check','about:blank'],{windowsHide:true,stdio:'ignore'});
let browser;const results=[];
try{
 const portFile=resolve(dir,'chrome/DevToolsActivePort');await waitFor(()=>existsSync(portFile),'Isolated Chrome ready');
 process.env.SOCLE_CDP_URL='http://127.0.0.1:'+readFileSync(portFile,'utf8').split('\n')[0];browser=await connectBrowser(base);const tab=await browser.createSession(base);await tab.navigate(base);
 for(const width of [1920,412])for(const theme of ['repere-cuivre','repere-eclipse','repere-lunaire','petrole'])for(const long of [false,true]){
  await tab.call('Emulation.setDeviceMetricsOverride',{width,height:945,deviceScaleFactor:1,mobile:width<500});
  await tab.evaluate(`document.body.dataset.v3Theme=${JSON.stringify(theme)};document.querySelector('#main').style.height=${JSON.stringify(long?'1600px':'')};scrollTo(0,0)`);
  await new Promise(r=>setTimeout(r,250));
  const state=await tab.evaluate(`(()=>{const s=e=>getComputedStyle(e),b=document.body,m=document.querySelector('#main'),f=document.querySelector('body>footer'),n=document.querySelector('#nav'),p=getComputedStyle(b,'::before');return{texture:p.backgroundImage,position:p.position,main:s(m).backgroundColor,footer:s(f).backgroundColor,footerImage:s(f).backgroundImage,width:document.documentElement.scrollWidth,viewport:innerWidth,canvas:s(b).backgroundColor,nav:s(n).position,scrollHeight:document.documentElement.scrollHeight}})()`);
  results.push({width,theme,long,...state});assert.ok(state.width<=width+1,'No horizontal overflow');
  if(theme.startsWith('repere-')){assert.notEqual(state.texture,'none','Texture spans body rather than stopping at main');assert.equal(state.position,'fixed');assert.equal(state.main,'rgba(0, 0, 0, 0)');assert.equal(state.footer,'rgba(0, 0, 0, 0)');assert.equal(state.footerImage,'none')}
  else{assert.equal(state.texture,'none');assert.notEqual(state.main,'rgba(0, 0, 0, 0)')}
  if(width===1920)assert.equal(state.nav,'fixed');
  if(!long){const shot=await tab.call('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(dir,theme+'-'+width+'.png'),Buffer.from(shot.data,'base64'))}
  if(long){await tab.evaluate('scrollTo(0,document.documentElement.scrollHeight)');assert.ok(await tab.evaluate('scrollY>0'),'Long page remains scrollable')}
 }
 writeFileSync(resolve(dir,'results.json'),JSON.stringify(results,null,2));console.log('PASS 16 shell cases: 4 themes, PC/mobile, short/long pages. '+dir);
}finally{if(browser)await browser.close();chrome.kill();server.closeAllConnections();await new Promise(r=>server.close(r))}
