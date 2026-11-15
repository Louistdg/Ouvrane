import {Worker} from 'node:worker_threads';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
let active=null;
const failure=(message,status)=>Object.assign(Error(message),{status});
export function createIfcModelConverter({timeoutMs=30000,workerFactory=(url,options)=>new Worker(url,options)}={}){
 if(!existsSync(fileURLToPath(new URL('../vendor/web-ifc/web-ifc-node.wasm',import.meta.url))))return null;
 const owner=Symbol('ifc-runtime');
 return {
  async convert(source){
   if(active)throw failure('Une conversion est déjà en cours.',409);
   if(!(source instanceof Uint8Array)||!source.length||source.length>1800000)throw failure('Source hors limites.',413);
   const copy=Uint8Array.from(source),worker=workerFactory(new URL('./ifc-model-worker.mjs',import.meta.url),{workerData:{source:copy},transferList:[copy.buffer],resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:32,stackSizeMb:4}}),lease={owner,worker,cancel:null};active=lease;let timer;
   try{return await new Promise((resolve,reject)=>{
    let settled=false;const settle=(error,value)=>{if(settled)return;settled=true;error?reject(error):resolve(value);};lease.cancel=()=>settle(failure('Conversion interrompue.',503));
    timer=setTimeout(()=>settle(failure('Délai de conversion dépassé.',504)),timeoutMs);
    worker.once('message',m=>m?.ok?settle(null,{preview:new Uint8Array(m.preview),metadata:m.metadata}):settle(failure('Modèle non convertible.',m?.status===413?413:422)));
    worker.once('error',()=>settle(failure('Le convertisseur a refusé ce fichier.',422)));
    worker.once('exit',()=>settle(failure('Le convertisseur s’est arrêté.',422)));
   });}finally{clearTimeout(timer);try{await worker.terminate();}finally{if(active===lease)active=null;}}
  },
  async close(){if(active?.owner===owner){const lease=active;lease.cancel?.();await lease.worker.terminate();if(active===lease)active=null;}}
 };
}
