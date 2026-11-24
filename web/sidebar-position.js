/* Keep the desktop menu in place across synchronous and deferred render layers. */
(()=>{'use strict';
let snapshot=null,frame=0;
const scope=()=>JSON.stringify([globalThis.socleCurrentOrganizationId||'',globalThis.socleCurrentAccess?.userId||'',globalThis.socleAccessPreview?.userId||'']);
function cancel(){snapshot=null;cancelAnimationFrame(frame)}
function restore(){if(!snapshot)return;const{nav,top,actor}=snapshot;if(!nav.isConnected||innerWidth<900||scope()!==actor){cancel();return}nav.scrollTop=top}
for(const type of ['wheel','pointerdown','touchstart','keydown'])document.addEventListener(type,event=>{if(event.target.closest?.('#nav'))cancel()},{capture:true,passive:true});
const nav=document.querySelector('#nav');
if(nav){nav.style.overflowAnchor='none';new MutationObserver(restore).observe(nav,{childList:true,subtree:true})}
const previousRender=render;
render=function(){
 if(nav&&innerWidth>=900&&!snapshot)snapshot={nav,top:nav.scrollTop,actor:scope()};
 const result=previousRender.apply(this,arguments);
 restore();queueMicrotask(restore);cancelAnimationFrame(frame);
 frame=requestAnimationFrame(()=>{restore();frame=requestAnimationFrame(()=>{restore();snapshot=null})});
 return result;
};
})();
