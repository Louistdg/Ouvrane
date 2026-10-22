/* Personal home geometry. Moving a block never moves business records. */
(function(){
'use strict';
const defs=[
  ['weather','Météo','.ia-home-weather'],['portals','Accès officiels','.ia-home-portals'],
  ['attention','Centre de contrôle','.ia-attention'],['messages','Messages récents','.ia-owner-messages'],
  ['tasks','Priorités','.ia-owner-tasks'],['calendar','Calendrier','.ia-owner-week'],['jobs','Chantiers','.v3-jobs'],
  ['invoices','Factures à traiter','[data-home-office="invoices"]'],['expenses','Pièces récentes','[data-home-office="expenses"]'],['accounting-links','Comptabilité','[data-home-office="accounting-links"]']
];
const route='/api/me/preferences/dashboard/home-layout',STEP=24,GAP=12;
let state=null,board=null,blocks=new Map(),effective={},drag=null,frame=0,scrollFrame=0,timer=0,suppressUntil=0;
const clone=value=>JSON.parse(JSON.stringify(value)),mobile=()=>innerWidth<900;
function contextKey(){const a=globalThis.socleCurrentAccess||{};return JSON.stringify([globalThis.socleCurrentOrganizationId||'',a.userId||'',a.roleCode||'',a.scope||'',a.permissions||[],globalThis.socleAccessPreview||null])}
function permitted(){const a=globalThis.socleCurrentAccess;return Boolean(typeof storageReady!=='undefined'&&storageReady&&a&&!globalThis.socleAccessPreview&&(a.owner||a.roleCode==='ACCOUNTING'||(a.permissions||[]).includes('customers.view')))}
const current=s=>s===state&&s.key===contextKey();
function status(){
 const node=document.querySelector('[data-home-layout-status]');if(!node||!state)return;
 const text={loading:'Chargement de votre disposition…',ready:'Glissez les blocs par leur titre.',saving:'Enregistrement de la disposition…',saved:'Disposition enregistrée.',error:'Disposition non enregistrée.',conflict:'Disposition modifiée dans une autre fenêtre.'}[state.status]||'';
 if(node.dataset.state!==state.status){node.dataset.state=state.status;node.replaceChildren();const label=document.createElement('span');label.textContent=text;node.append(label);
  if(['error','conflict'].includes(state.status)){const button=document.createElement('button');button.type='button';button.className='link';button.textContent=state.status==='conflict'?'Recharger la disposition':'Réessayer';button.addEventListener('click',()=>state.status==='conflict'?reload():save());node.append(button)}
 }
 node.title=state.error||'';
}
function normalize(value){
 const positions={},ids=new Set(defs.map(d=>d[0]));
 for(const [id,p] of Object.entries(value?.positions||{}))if(ids.has(id)&&p&&[0,1].includes(p.column)&&[1,2].includes(p.span)&&p.column+p.span<=2&&Number.isInteger(p.row)&&p.row>=0&&p.row<=500)positions[id]={column:p.column,row:p.row,span:p.span};
 return {positions,mobileOrder:[...new Set((Array.isArray(value?.mobileOrder)?value.mobileOrder:[]).filter(id=>ids.has(id)))]};
}
function reset(){cancel();clearTimeout(timer);state={key:contextKey(),ready:false,status:'loading',saved:null,value:{positions:{},mobileOrder:[]},version:0,dirty:false,pending:false,operation:null,error:''};board=null;blocks=new Map();effective={};return state}
async function load(s){
 try{const result=await serverJson(route);if(!current(s))return;s.saved=result.preference?.value??null;s.value=normalize(s.saved);s.ready=true;s.status=s.saved?'saved':'ready';renderLayout();status()}
 catch(error){if(current(s)){s.status='error';s.error=error.message;status()}}
}
function reload(){if(!permitted())return;const s=reset();mount();load(s)}
async function save(){
 const s=state;if(!s||!current(s)||s.pending||s.status==='conflict')return;
 if(!s.ready){load(s);return}
 if(!s.dirty&&!s.operation)return;
 clearTimeout(timer);s.pending=true;s.status='saving';status();
 const operation=s.operation||(s.operation={version:s.version,value:clone(s.value),expectedValue:clone(s.saved)});
 try{
  const result=await serverJson(route,{method:'PUT',body:JSON.stringify({schemaVersion:1,value:operation.value,expectedValue:operation.expectedValue})});
  if(!current(s))return;
  s.saved=result.preference.value;s.operation=null;s.dirty=s.version!==operation.version;s.status=s.dirty?'saving':'saved';s.error='';
 }catch(error){if(current(s)){s.error=error.message||'La sauvegarde a échoué.';s.status=error.status===409?'conflict':'error';if(error.status&&error.status<500)s.operation=null}}
 finally{if(current(s)){s.pending=false;status();if(s.dirty&&s.status==='saving')queueMicrotask(save)}}
}
function changed(){state.version++;state.dirty=true;state.status='saving';state.error='';renderLayout();status();clearTimeout(timer);const s=state;timer=setTimeout(()=>{if(current(s))save()},250)}
function visibleIds(){return defs.map(d=>d[0]).filter(id=>blocks.has(id)&&!blocks.get(id).hidden)}
function spanFor(id){return state.value.positions[id]?.span||(['weather','portals','messages','tasks','invoices','expenses'].includes(id)?1:2)}
function resolve(positions,heights,priority){
 const result={},ids=Object.keys(positions).sort((a,b)=>a===priority?-1:b===priority?1:positions[a].row-positions[b].row||positions[a].column-positions[b].column);
 for(const id of ids){const p={...positions[id]},height=heights[id];let overlap;
  do{overlap=Object.entries(result).find(([other,q])=>p.column<q.column+q.span&&q.column<p.column+p.span&&p.row<q.row+heights[other]&&q.row<p.row+height);if(overlap)p.row=overlap[1].row+heights[overlap[0]]}while(overlap);
  result[id]=p;
 }
 return result;
}
function desktopGeometry(proposed,priority){
 const ids=visibleIds(),width=board.clientWidth,col=(width-GAP)/2,heights={};
 for(const id of ids){const card=blocks.get(id),span=proposed?.[id]?.span||spanFor(id);card.style.width=(span===2?width:col)+'px';heights[id]=Math.max(2,Math.ceil((card.offsetHeight+GAP)/STEP))}
 const defaults={},groups=[['weather','portals'],['attention'],['messages','tasks'],['calendar'],['jobs'],['invoices','expenses'],['accounting-links']];let row=0;
 for(const group of groups){let next=row;group.filter(id=>ids.includes(id)).forEach((id,index)=>{const span=proposed?.[id]?.span||spanFor(id);defaults[id]={column:span===2?0:index,row,span};next=Math.max(next,row+heights[id])});row=next}
 const positions={};for(const id of ids)positions[id]={...defaults[id],...(proposed?.[id]||state.value.positions[id]||{})};
 return {positions:resolve(positions,heights,priority),heights,col};
}
function mobileIds(){
 const ids=visibleIds(),order=state.value.mobileOrder;
 return [...order.filter(id=>ids.includes(id)),...ids.filter(id=>!order.includes(id)).sort((a,b)=>(state.value.positions[a]?.row??defs.findIndex(d=>d[0]===a)*100)-(state.value.positions[b]?.row??defs.findIndex(d=>d[0]===b)*100)||(state.value.positions[a]?.column||0)-(state.value.positions[b]?.column||0))];
}
function renderLayout(proposed,priority){
 if(!board?.isConnected||!state?.ready)return;
 board.dataset.ready='true';board.dataset.mobile=String(mobile());
 if(mobile()){
  board.style.height='';mobileIds().forEach((id,index)=>{const card=blocks.get(id);card.style.width='';card.style.left='';card.style.top='';card.style.order=String(index);card.dataset.homeSpan=String(spanFor(id))});return;
 }
 const geometry=desktopGeometry(proposed,priority);effective=geometry.positions;let bottom=0;
 for(const [id,p]of Object.entries(effective)){const card=blocks.get(id);card.style.order='';card.style.left=p.column*(geometry.col+GAP)+'px';card.style.top=p.row*STEP+'px';card.dataset.homeColumn=String(p.column);card.dataset.homeRow=String(p.row);card.dataset.homeSpan=String(p.span);bottom=Math.max(bottom,p.row*STEP+card.offsetHeight)}
 board.style.height=bottom+'px';
}
const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>{if(!drag)schedule()}):null;
function decorate(id,label,card){
 card.dataset.homeBlock=id;
 let header=card.querySelector(':scope > header,:scope > .panel-head,:scope > .ia-home-weather-head,:scope > .ia-home-portals-head');
 if(!header){header=document.createElement('div');header.className='home-block-title';const title=document.createElement('h2');title.textContent=label;header.append(title);card.prepend(header)}
 header.dataset.homeHeader=id;
 if(!header.querySelector('[data-home-drag]')){const handle=document.createElement('button');handle.type='button';handle.className='home-block-drag';handle.dataset.homeDrag=id;handle.setAttribute('aria-label','Déplacer le bloc '+label);handle.title='Glisser pour déplacer · flèches au clavier';handle.innerHTML='<span aria-hidden="true">⠿</span>';header.prepend(handle)}
 if(!card.querySelector('[data-home-resize]')){const resize=document.createElement('button');resize.type='button';resize.className='home-block-resize';resize.dataset.homeResize=id;resize.setAttribute('aria-label','Changer la largeur du bloc '+label);resize.title='Glisser pour redimensionner · cliquer pour changer la largeur';resize.innerHTML='<span aria-hidden="true">◩</span>';card.append(resize)}
 observer?.observe(card);
}
function mount(){
 if(state&&state.key!==contextKey()){cancel();clearTimeout(timer);state=null;board=null;blocks=new Map();effective={}}
 if(typeof view==='undefined'||view!=='home'||!permitted()){if(drag)cancel();return}
 if(drag){if(board?.isConnected&&blocks.get(drag.id)?.isConnected&&current(drag.state))return;cancel()}
 const main=document.querySelector('#main');if(!main)return;
 if(!state||state.key!==contextKey()){const s=reset();load(s)}
 let host=main.querySelector('[data-home-layout]');
 if(!host){host=document.createElement('div');host.dataset.homeLayout='';host.dataset.ready=String(state.ready);host.setAttribute('aria-label','Blocs de votre accueil');main.append(host)}
 board=host;blocks=new Map();
 for(const [id,label,selector]of defs){const card=main.querySelector(selector);if(!card)continue;blocks.set(id,card);if(card.parentElement!==host)host.append(card);if(!card.dataset.homeBlock||!card.querySelector('[data-home-drag]'))decorate(id,label,card)}
 for(const container of main.querySelectorAll('.home-top-grid,.ia-owner-dashboard,.ia-dashboard-grid'))if(!container.children.length)container.remove();
 let line=main.querySelector('[data-home-layout-status]');if(!line){line=document.createElement('p');line.dataset.homeLayoutStatus='';line.className='home-layout-status';line.setAttribute('role','status');line.setAttribute('aria-live','polite');host.before(line)}
 renderLayout();status();
}
function schedule(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;mount()})}
function dropElement(){return board?.querySelector('[data-home-drop]')}
function preview(){
 if(!drag||!board?.isConnected||!current(drag.state)){cancel();return}
 const d=drag;
 if(mobile()){
  const ids=d.order.filter(id=>id!==d.id),target=ids.findIndex(id=>{const r=blocks.get(id).getBoundingClientRect();return d.y<r.y+r.height/2});d.previewOrder=[...ids];d.previewOrder.splice(target<0?ids.length:target,0,d.id);
  d.previewOrder.forEach((id,index)=>{blocks.get(id).style.order=String(index)});
  let placeholder=dropElement();if(!placeholder){placeholder=document.createElement('div');placeholder.dataset.homeDrop='';placeholder.textContent='Déposer ici';board.append(placeholder)}
  placeholder.style.height=blocks.get(d.id).offsetHeight+'px';placeholder.style.order=String(d.previewOrder.indexOf(d.id));return;
 }
 const r=board.getBoundingClientRect(),p={...d.positions[d.id]},col=(r.width-GAP)/2;
 if(d.kind==='resize'){p.span=d.x-r.x-p.column*(col+GAP)>col+GAP/2?2:1;if(p.span===2)p.column=0}
 else{p.column=p.span===2?0:Math.max(0,Math.min(1,Math.round((d.x-r.x-d.offsetX)/(col+GAP))));p.row=Math.max(0,Math.min(500,Math.round((d.y-r.y-d.offsetY)/STEP)))}
 d.preview={...d.positions,[d.id]:p};renderLayout(d.preview,d.id);
 const actual=effective[d.id];let placeholder=dropElement();if(!placeholder){placeholder=document.createElement('div');placeholder.dataset.homeDrop='';placeholder.textContent='Déposer ici';board.append(placeholder)}
 placeholder.style.cssText='left:'+actual.column*(col+GAP)+'px;top:'+actual.row*STEP+'px;width:'+(actual.span===2?r.width:col)+'px;height:'+blocks.get(d.id).offsetHeight+'px';
 if(d.ghost){d.ghost.style.left=(d.x-d.offsetX)+'px';d.ghost.style.top=(d.y-d.offsetY)+'px'}
}
function autoScroll(){
 if(!drag?.moved){scrollFrame=0;return}
 const amount=drag.y<70?-Math.min(18,(70-drag.y)/3):drag.y>innerHeight-70?Math.min(18,(drag.y-innerHeight+70)/3):0,before=scrollY;
 if(amount)window.scrollBy(0,amount);if(scrollY!==before)preview();scrollFrame=requestAnimationFrame(autoScroll);
}
function clearDrag(){if(!drag)return;cancelAnimationFrame(scrollFrame);scrollFrame=0;drag.ghost?.remove();blocks.get(drag.id)?.classList.remove('home-block-moving');try{drag.handle.releasePointerCapture(drag.pointerId)}catch{}dropElement()?.remove();drag=null;document.body.classList.remove('home-layout-dragging');schedule()}
function cancel(){clearDrag();renderLayout()}
document.addEventListener('pointerdown',event=>{
 if(event.button!==0||!state?.ready||state.status==='conflict'||!permitted())return;
 const card=event.target.closest('[data-home-block]');if(!card||card.parentElement!==board)return;
 const resize=event.target.closest('[data-home-resize]'),handle=event.target.closest('[data-home-drag]'),header=event.target.closest('[data-home-header]');
 if(!resize&&!handle&&(!header||event.target.closest('a,button,input,select,textarea,label,[contenteditable="true"]')))return;
 if(event.pointerType==='touch'&&!handle&&!resize)return;if(mobile()&&resize)return;
 const r=card.getBoundingClientRect();drag={id:card.dataset.homeBlock,kind:resize?'resize':'move',state,handle:resize||handle||header,pointerId:event.pointerId,x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,offsetX:event.clientX-r.x,offsetY:event.clientY-r.y,positions:clone(effective),order:mobileIds(),moved:false};
 drag.handle.setPointerCapture(event.pointerId);
});
document.addEventListener('pointermove',event=>{
 if(!drag||event.pointerId!==drag.pointerId)return;drag.x=event.clientX;drag.y=event.clientY;
 if(!drag.moved&&Math.hypot(drag.x-drag.startX,drag.y-drag.startY)<6)return;
 if(!drag.moved){drag.moved=true;document.body.classList.add('home-layout-dragging');blocks.get(drag.id).classList.add('home-block-moving');if(!mobile()&&drag.kind==='move'){drag.ghost=document.createElement('div');drag.ghost.className='home-block-ghost';drag.ghost.textContent=defs.find(d=>d[0]===drag.id)[1];drag.ghost.style.width=blocks.get(drag.id).offsetWidth+'px';document.body.append(drag.ghost)}}
 event.preventDefault();preview();if(!scrollFrame)scrollFrame=requestAnimationFrame(autoScroll);
},{passive:false});
document.addEventListener('pointerup',event=>{
 if(!drag||event.pointerId!==drag.pointerId)return;const d=drag,valid=current(d.state)&&board?.isConnected&&d.moved;
 if(valid){if(mobile())state.value.mobileOrder=d.previewOrder||d.order;else state.value.positions={...state.value.positions,...clone(effective)};suppressUntil=Date.now()+150}
 clearDrag();if(valid)changed();else renderLayout();
});
document.addEventListener('pointercancel',cancel);
document.addEventListener('click',event=>{
 if(Date.now()<suppressUntil&&event.target.closest('[data-home-layout]')){event.preventDefault();event.stopImmediatePropagation();return}
 const resize=event.target.closest('[data-home-resize]');if(!resize||!state?.ready||mobile()||state.status==='conflict')return;
 const id=resize.dataset.homeResize,p=effective[id];if(!p)return;state.value.positions={...state.value.positions,...clone(effective),[id]:{...p,column:0,span:p.span===1?2:1}};changed();
},true);
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&drag){event.preventDefault();cancel();return}
 const handle=event.target.closest('[data-home-drag]');if(!handle||!state?.ready||state.status==='conflict'||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;
 event.preventDefault();const id=handle.dataset.homeDrag;
 if(mobile()){const ids=mobileIds(),index=ids.indexOf(id),next=Math.max(0,Math.min(ids.length-1,index+(['ArrowUp','ArrowLeft'].includes(event.key)?-1:1)));[ids[index],ids[next]]=[ids[next],ids[index]];state.value.mobileOrder=ids}
 else{const p={...effective[id]};if(event.key==='ArrowUp')p.row=Math.max(0,p.row-2);if(event.key==='ArrowDown')p.row=Math.min(500,p.row+2);if(event.key==='ArrowLeft')p.column=0;if(event.key==='ArrowRight')p.column=p.span===1?1:0;const geometry=desktopGeometry({...effective,[id]:p},id);state.value.positions={...state.value.positions,...geometry.positions}}
 changed();
});
globalThis.socleResetHomeLayout=function(){if(!state?.ready||!permitted()||state.status==='conflict')return;state.value={positions:{},mobileOrder:[]};changed()};
window.addEventListener('beforeunload',event=>{if(state&&(state.dirty||state.pending)){event.preventDefault();event.returnValue=''}});
window.addEventListener('resize',()=>{cancel();schedule()},{passive:true});
const root=document.querySelector('#main');if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
})();
