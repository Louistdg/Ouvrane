/* Optional tools load only when their screen needs them. */
(function(){
'use strict';
const definitions={tabulator:{url:'/tabulator.js',ready:()=>globalThis.Tabulator}};
const pending=new Map();
globalThis.socleLoadTool=function(name){
 const definition=definitions[name];
 if(!definition)return Promise.reject(Error('Outil inconnu.'));
 const existing=definition.ready();if(existing)return Promise.resolve(existing);
 if(pending.has(name))return pending.get(name);
 const promise=new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  const cleanup=()=>{clearTimeout(timer);script.onload=null;script.onerror=null};
  const failed=()=>{cleanup();script.remove();reject(Error('Le tableau du métré n’a pas pu être chargé. Vérifiez la connexion puis réessayez.'))};
  const timer=setTimeout(failed,15000);
  script.async=true;
  script.src=globalThis.socleLazyAssetUrls?.[name]||definition.url;
  script.dataset.socleTool=name;
  script.onload=()=>{const value=definition.ready();if(!value){failed();return}cleanup();resolve(value)};
  script.onerror=failed;
  document.head.appendChild(script);
 });
 pending.set(name,promise);
 promise.catch(()=>{if(pending.get(name)===promise)pending.delete(name)});
 return promise;
};
})();
