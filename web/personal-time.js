/* One business timezone for appointment inputs, independent of the PC's zone. */
(function(root){
 'use strict';
 const zone='Europe/Brussels';
 function parts(value){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).filter(p=>['year','month','day','hour','minute','second'].includes(p.type)).map(p=>[p.type,p.value]))}
 function local(value){const p=parts(value);return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute}
 function candidates(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('Choisissez une date et une heure.');
  const [year,month,day,hour,minute]=value.match(/\d+/g).map(Number);if(year<1900||year>2200||month<1||month>12||day<1||day>31||hour>23||minute>59)throw Error('La date ou l’heure est invalide.');
  const naive=Date.UTC(year,month-1,day,hour,minute);if(new Date(naive).toISOString().slice(0,16)!==value)throw Error('Cette date n’existe pas.');
  const offsets=new Set();for(const delta of [-48,-24,0,24,48]){const at=naive+delta*3600000,p=parts(at);offsets.add(Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second))-at)}
  return [...offsets].map(offset=>({iso:new Date(naive-offset).toISOString(),offsetMinutes:offset/60000})).filter(v=>local(v.iso)===value).sort((a,b)=>a.iso.localeCompare(b.iso));
 }
 function resolve(value,choice){const options=candidates(value);if(!options.length)throw Error('Cette heure n’existe pas à Bruxelles lors du passage à l’heure d’été. Choisissez une autre heure.');if(options.length>1&&!options.some(o=>o.iso===choice))throw Error('Cette heure existe deux fois à Bruxelles. Choisissez l’heure d’été ou l’heure d’hiver.');return options.length===1?options[0].iso:choice}
 root.ouvranePersonalTime={zone,local,candidates,resolve,day:value=>local(value).slice(0,10),format:value=>new Intl.DateTimeFormat('fr-BE',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value))};
})(globalThis);
