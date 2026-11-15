/* Personal order of project tabs. Customization never changes business records. */
(function(){
'use strict';
var order=null,loaded=false,loading=null,scope='',epoch=0,generation=0,editing=false,pending=Promise.resolve(),scheduled=false;
function context(){var a=globalThis.socleCurrentAccess||{};return JSON.stringify([globalThis.socleCurrentOrganizationId||a.organizationId||'',a.userId||'',a.roleCode||'',a.permissions||[],globalThis.socleAccessPreview||null]);}
function syncScope(){var key=context();if(key!==scope){scope=key;epoch++;generation++;order=null;loaded=false;loading=null;editing=false;}return key;}
function nav(){return document.querySelector('.job-workspace-tabs');}
function keyOf(button){if(button.dataset.jobTabKey)return button.dataset.jobTabKey;var match=/jobWorkspaceTab\s*=\s*'([A-Za-z_]+)'/.exec(button.getAttribute('onclick')||'');if(match)button.dataset.jobTabKey=match[1];return button.dataset.jobTabKey||null;}
function tabButtons(){var bar=nav();return bar?Array.prototype.slice.call(bar.querySelectorAll('button')).filter(function(button){return Boolean(keyOf(button));}):[];}
function readOrder(){
 var key=syncScope(),ticket=epoch;if(loaded)return Promise.resolve(order);if(loading)return loading;
 if(typeof serverJson!=='function')return Promise.resolve(null);
 loading=serverJson('/api/me/preferences/dashboard/job-tabs').then(function(data){
  if(ticket!==epoch||key!==context())return null;
  var value=data&&data.preference&&data.preference.value;order=value&&Array.isArray(value.order)?value.order.filter(function(id){return typeof id==='string';}):null;loaded=true;return order;
 }).catch(function(){return null;}).finally(function(){if(ticket===epoch)loading=null;});
 return loading;
}
function arrowsFor(button){var node=button.nextElementSibling;return node&&node.classList.contains('job-tab-move')?node:null;}
function place(list){
 if(!list.length)return;var parent=list[0].parentNode,pairs=list.map(function(button){return{button:button,arrows:arrowsFor(button)};});
 pairs.forEach(function(pair){parent.append(pair.button);if(pair.arrows)parent.append(pair.arrows);});
 refresh();
}
function applyOrder(){
 syncScope();if(!order||!order.length)return;
 var list=tabButtons(),map={};list.forEach(function(button){map[keyOf(button)]=button;});
 var seen=new Set(),next=[];order.forEach(function(id){if(map[id]&&!seen.has(id)){next.push(map[id]);seen.add(id);}});
 list.forEach(function(button){if(!seen.has(keyOf(button)))next.push(button);});
 if(list.map(keyOf).join(',')!==next.map(keyOf).join(','))place(next);
}
function refresh(){
 var list=tabButtons(),bar=nav();if(bar)bar.dataset.customizing=String(editing);
 list.forEach(function(button,index){
  var wrap=arrowsFor(button);if(!wrap)return;wrap.hidden=!editing;
  var left=wrap.querySelector('[data-move="left"]'),right=wrap.querySelector('[data-move="right"]');
  if(left){left.disabled=index===0;left.setAttribute('aria-disabled',String(index===0));}
  if(right){right.disabled=index===list.length-1;right.setAttribute('aria-disabled',String(index===list.length-1));}
 });
 var toggle=document.querySelector('[data-job-tabs-customize]');if(toggle){var label=editing?'Terminer la personnalisation':'Personnaliser les onglets';if(toggle.textContent!==label)toggle.textContent=label;toggle.setAttribute('aria-pressed',String(editing));}
}
function announce(message){
 var node=document.querySelector('[data-job-tabs-status]');
 if(!node){node=document.createElement('p');node.dataset.jobTabsStatus='';node.setAttribute('role','status');node.setAttribute('aria-live','polite');node.className='sr-only';document.body.append(node);}
 node.textContent=message;
}
function persist(){
 var key=syncScope(),ticket=epoch,version=++generation,next=tabButtons().map(keyOf);order=next.slice();loaded=true;
 if(typeof serverJson!=='function')return Promise.resolve();
 pending=pending.catch(function(){}).then(function(){
  if(ticket!==epoch||key!==context())return;
  return serverJson('/api/me/preferences/dashboard/job-tabs',{method:'PUT',body:JSON.stringify({schemaVersion:1,value:{order:next}})});
 }).then(function(){
  if(ticket===epoch&&key===context()&&version===generation)announce('Ordre des onglets enregistré.');
 }).catch(function(){
  if(ticket!==epoch||key!==context()||version!==generation)return;
  announce('L’ordre n’a pas pu être enregistré. La disposition enregistrée est rechargée.');
  order=null;loaded=false;return readOrder().then(function(){if(version===generation)applyOrder();});
 });
 return pending;
}
function move(button,direction){
 syncScope();if(!button||!nav())return;
 var list=tabButtons(),index=list.indexOf(button),target=index+(direction==='left'?-1:1);
 if(index<0||target<0||target>=list.length)return;
 list.splice(index,1);list.splice(target,0,button);place(list);button.focus();persist();
}
function setEditing(value){syncScope();editing=Boolean(value);refresh();}
function enhance(){
 scheduled=false;syncScope();var bar=nav();if(!bar){editing=false;document.querySelector('[data-job-tabs-customizer]')?.remove();return;}
 var controls=document.querySelector('[data-job-tabs-customizer]');
 if(!controls){controls=document.createElement('div');controls.className='job-tabs-customizer';controls.dataset.jobTabsCustomizer='';var toggle=document.createElement('button');toggle.type='button';toggle.className='link';toggle.dataset.jobTabsCustomize='';controls.append(toggle);bar.before(controls);}
 tabButtons().forEach(function(button){
  if(arrowsFor(button))return;var wrap=document.createElement('span');wrap.className='job-tab-move';wrap.hidden=!editing;
  wrap.innerHTML='<button type="button" data-move="left" aria-label="Déplacer cet onglet vers la gauche">◀</button><button type="button" data-move="right" aria-label="Déplacer cet onglet vers la droite">▶</button>';button.after(wrap);
 });
 refresh();readOrder().then(applyOrder);
}
function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(enhance);}}
document.addEventListener('click',function(event){
 var toggle=event.target.closest?.('[data-job-tabs-customize]');if(toggle){event.preventDefault();setEditing(!editing);return;}
 var trigger=event.target.closest?.('[data-move]');if(!trigger||!trigger.closest('.job-workspace-tabs')||!editing||trigger.disabled)return;
 event.preventDefault();event.stopPropagation();var button=trigger.parentElement.previousElementSibling;if(button&&keyOf(button))move(button,trigger.dataset.move);
},true);
document.addEventListener('keydown',function(event){
 if(event.key==='Escape'&&editing&&event.target.closest?.('.job-workspace-tabs,.job-tabs-customizer')){event.preventDefault();setEditing(false);document.querySelector('[data-job-tabs-customize]')?.focus();return;}
 if(!event.ctrlKey||!['ArrowLeft','ArrowRight'].includes(event.key))return;
 var button=event.target.closest?.('.job-workspace-tabs button');if(!button||!keyOf(button))return;
 event.preventDefault();setEditing(true);move(button,event.key==='ArrowLeft'?'left':'right');
},true);
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('DOMContentLoaded',schedule);schedule();
globalThis.socleJobTabs={order:function(){syncScope();return order?order.slice():null;},move:move,reset:function(){epoch++;generation++;order=null;loaded=false;loading=null;editing=false;schedule();}};
})();
