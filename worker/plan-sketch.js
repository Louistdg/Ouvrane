// SPDX-License-Identifier: MIT
// Original decorative sketch model. Coordinates use the existing plan page frame.
// Symbols and their anchored dimensions never enter the measurement/union engine.
const fail=message=>{throw Object.assign(Error(message),{status:400})};
const number=(v,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail('Position ou taille du symbole invalide.');return v};
const symbols={
 door:[[[0,0],[0,1],[1,1]],Array.from({length:13},(_,i)=>[Math.sin(i*Math.PI/24),1-Math.cos(i*Math.PI/24)])],
 window:[[[0,0],[1,0],[1,1],[0,1],[0,0]],[[0,.5],[1,.5]],[[.5,0],[.5,1]]],
 stairs:[[[0,0],[1,0],[1,1],[0,1],[0,0]],...Array.from({length:5},(_,i)=>[[0,(i+1)/6],[1,(i+1)/6]]),[[.5,.85],[.5,.15],[.35,.3]],[[.5,.15],[.65,.3]]]
};
export const PLAN_SKETCH_SYMBOLS=Object.freeze({door:'Porte',window:'Fenêtre',stairs:'Escalier'});
const reservedNames=new Set([...Object.getOwnPropertyNames(Object.prototype),'prototype'].map(s=>s.toLowerCase()));
export function validateSketchId(value){if(typeof value!=='string'||!/^[A-Za-z0-9._:-]{1,80}$/.test(value)||reservedNames.has(value.toLowerCase()))fail('Identifiant de symbole invalide ou réservé.');return value}
function customPaths(paths){
 if(!Array.isArray(paths)||!paths.length||paths.length>8)fail('Dessinez de 1 à 8 traits pour le symbole.');
 const result=paths.map(line=>{if(!Array.isArray(line)||line.length<2||line.length>64)fail('Un trait doit contenir de 2 à 64 points.');return line.map(p=>{if(!Array.isArray(p)||p.length!==2)fail('Point du symbole invalide.');return [number(p[0],0,1),number(p[1],0,1)]})});
 return result;
}
function customDefinition(value){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('Modèle de symbole invalide.');
 const id=validateSketchId(value.id),label=typeof value.label==='string'?value.label.trim():'';
 if(Object.hasOwn(symbols,id)||!label||label.length>80||!Number.isInteger(value.version)||value.version<1||value.version>100)fail('Nom ou version du modèle invalide.');
 const paths=customPaths(value.paths),points=paths.flat(),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
 if(Math.abs(Math.min(...xs))>1e-8||Math.abs(Math.max(...xs)-1)>1e-8||Math.abs(Math.min(...ys))>1e-8||Math.abs(Math.max(...ys)-1)>1e-8)fail('Le dessin doit être ajusté au cadre du symbole.');
 return {id,version:value.version,label,aspectRatio:number(value.aspectRatio,.1,10),paths};
}
export function normalizeSymbolPaths(paths,frameWidth=1,frameHeight=1){
 const clean=customPaths(paths),points=clean.flat(),minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0])),minY=Math.min(...points.map(p=>p[1])),maxY=Math.max(...points.map(p=>p[1]));
 if(maxX-minX<.005||maxY-minY<.005||!Number.isFinite(frameWidth)||!Number.isFinite(frameHeight)||frameWidth<=0||frameHeight<=0)fail('Dessinez un symbole avec une largeur et une hauteur.');
 const aspectRatio=(maxX-minX)*frameWidth/((maxY-minY)*frameHeight);number(aspectRatio,.1,10);
 return {paths:clean.map(line=>line.map(([x,y])=>[(x-minX)/(maxX-minX),(y-minY)/(maxY-minY)])),aspectRatio};
}
function symbolPaths(member,definitions){
 if(member.symbol==='custom'){const d=definitions.find(d=>d.id===member.definitionId&&d.version===member.definitionVersion);if(!d)fail('La version du symbole personnalisé est introuvable.');return d.paths}
 if(!Object.hasOwn(symbols,member.symbol))fail('Symbole de croquis inconnu.');return symbols[member.symbol];
}
export function sketchSymbolPaths(member,definitions=[]){return structuredClone(symbolPaths(member,definitions))}
const transform=(member,width,height,p)=>{
 const radians=member.rotation*Math.PI/180,dx=(p[0]-.5)*member.width*width,dy=(p[1]-.5)*member.height*height;
 return {x:member.x+(dx*Math.cos(radians)-dy*Math.sin(radians))/width,y:member.y+(dx*Math.sin(radians)+dy*Math.cos(radians))/height};
};
export function planSketchPaths(member,width,height,definitions=[]){
 const paths=symbolPaths(member,definitions);
 return {paths:paths.map(line=>line.map(p=>transform(member,width,height,p))),widthAnchor:[[0,0],[1,0]].map(p=>transform(member,width,height,p)),heightAnchor:[[1,0],[1,1]].map(p=>transform(member,width,height,p)),corners:[[0,0],[1,0],[1,1],[0,1]].map(p=>transform(member,width,height,p))};
}
export function sketchGroupBounds(group,width,height,definitions=[]){
 const points=group.members.flatMap(member=>planSketchPaths(member,width,height,definitions).corners);
 return {minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))};
}
export function validatePlanSketch(data,width,height,scale,reservedIds=new Set()){
 if(!data||data.schemaVersion!==1||data.coordinateSpace!=='plan-normalized-v1'||!Array.isArray(data.groups)||data.groups.length>20)fail('Croquis invalide : maximum 20 groupes dans le repère du plan.');
 const ids=new Set(reservedIds),id=value=>{validateSketchId(value);if(ids.has(value))fail('Identifiant de croquis invalide ou en double.');ids.add(value);return value};
 let definitions;
 if(data.definitions!==undefined){
  if(!Array.isArray(data.definitions)||data.definitions.length>32)fail('La palette de ce relevé est pleine (32 modèles ou versions).');
  const definitionIds=new Set(),versions=new Set();definitions=data.definitions.map(value=>{const d=customDefinition(value),key=JSON.stringify([d.id,d.version]);if(versions.has(key))fail('Version de symbole en double.');versions.add(key);if(!definitionIds.has(d.id)){id(d.id);definitionIds.add(d.id)}return d});
 }
 let count=0;const groups=[],results=[];
 for(const g of data.groups){
  if(!g||typeof g!=='object'||Array.isArray(g))fail('Groupe de croquis invalide.');
  const groupId=id(g.id),label=typeof g.label==='string'?g.label.trim():'';
  if(!label||label.length>80||!Array.isArray(g.members)||!g.members.length||g.members.length>20)fail('Nommez le groupe et choisissez de 1 à 20 symboles.');
  const members=[],dimensions=[];
  for(const m of g.members){
   if(++count>60)fail('Maximum 60 symboles par page.');
   if(!m||typeof m!=='object'||Array.isArray(m))fail('Symbole invalide.');
   if(m.symbol==='custom'){validateSketchId(m.definitionId);if(!definitions?.some(d=>d.id===m.definitionId&&d.version===m.definitionVersion))fail('Version de symbole personnalisé introuvable.')}else if(!Object.hasOwn(symbols,m.symbol)||m.definitionVersion!==1)fail('Symbole ou version de définition inconnu.');
   if(![0,90,180,270].includes(m.rotation)||typeof m.dimensionWidth!=='boolean'||typeof m.dimensionHeight!=='boolean'||!Number.isInteger(m.precision)||m.precision<0||m.precision>3)fail('Rotation ou présentation de la cotation invalide.');
   const member={id:id(m.id),symbol:m.symbol,...(m.symbol==='custom'?{definitionId:m.definitionId}:{}),definitionVersion:m.definitionVersion,x:number(m.x,0,1),y:number(m.y,0,1),width:number(m.width,.005,.8),height:number(m.height,.005,.8),rotation:m.rotation,dimensionWidth:m.dimensionWidth,dimensionHeight:m.dimensionHeight,precision:m.precision};
   const paths=planSketchPaths(member,width,height,definitions);
   for(const p of paths.corners)if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x< -1e-9||p.x>1+1e-9||p.y< -1e-9||p.y>1+1e-9)fail('Le groupe doit rester à l’intérieur de la page.');
   for(const axis of ['width','height'])if(member[axis==='width'?'dimensionWidth':'dimensionHeight']){
    if(!Number.isFinite(scale)||scale<=0)fail('Étalonnez la page avant d’ajouter des cotations.');
    const [a,b]=paths[axis+'Anchor'],value=Math.hypot((a.x-b.x)*width,(a.y-b.y)*height)*scale;
    if(!Number.isFinite(value)||value<.001||value>1000000)fail('Cotation nulle ou hors limites.');
    dimensions.push({id:member.id+':'+axis,memberId:member.id,definitionVersion:member.definitionVersion,axis,value:value.toFixed(6),label:value.toFixed(member.precision).replace('.',',')+' m'});
   }
   members.push(member);
  }
  groups.push({id:groupId,label,members});results.push({id:groupId,label,dimensions});
 }
 return {input:{schemaVersion:1,coordinateSpace:'plan-normalized-v1',...(definitions?{definitions}:{}),groups},result:{groups:results}};
}
export function copySketchGroup(group,width,height,newId,definitions=[]){
 const copy=structuredClone(group),used=new Set([group.id,...group.members.map(m=>m.id)]);
 const fresh=()=>{const value=validateSketchId(newId());if(used.has(value))fail('Identifiant de copie en double.');used.add(value);return value};
 const b=sketchGroupBounds(group,width,height,definitions),stepX=b.maxX-b.minX+.03,stepY=b.maxY-b.minY+.03;
 let dx=b.maxX+stepX<=1?stepX:b.minX>=stepX?-stepX:0,dy=dx?0:b.maxY+stepY<=1?stepY:b.minY>=stepY?-stepY:0;
 if(!dx&&!dy){dx=b.maxX+.03<=1?.03:b.minX>=.03?-.03:0;dy=b.maxY+.03<=1?.03:b.minY>=.03?-.03:0}
 copy.id=fresh();copy.label=(group.label+' · copie').slice(0,80);
 for(const m of copy.members){m.id=fresh();m.x+=dx;m.y+=dy}
 return copy;
}
export function rotateSketchGroup(group,width,height,definitions=[]){
 const result=structuredClone(group),b=sketchGroupBounds(group,width,height,definitions),cx=(b.minX+b.maxX)*width/2,cy=(b.minY+b.maxY)*height/2;
 for(const m of result.members){const dx=m.x*width-cx,dy=m.y*height-cy;m.x=(cx-dy)/width;m.y=(cy+dx)/height;m.rotation=(m.rotation+90)%360}
 return result;
}
export function resizeSketchGroup(group,width,height,scale,widthM,heightM,definitions=[]){
 if(!Number.isFinite(scale)||scale<=0)fail('Étalonnez le plan avant de redimensionner le groupe.');
 number(widthM,.001,1000000);number(heightM,.001,1000000);
 const result=structuredClone(group),b=sketchGroupBounds(group,width,height,definitions),cx=(b.minX+b.maxX)/2,cy=(b.minY+b.maxY)/2,sx=widthM/((b.maxX-b.minX)*width*scale),sy=heightM/((b.maxY-b.minY)*height*scale);
 for(const m of result.members){m.x=cx+(m.x-cx)*sx;m.y=cy+(m.y-cy)*sy;const quarter=m.rotation===90||m.rotation===270;m.width*=quarter?sy:sx;m.height*=quarter?sx:sy}
 return result;
}
export function createIndependentSymbol(sketch,groupId,memberId,options){
 const copy=structuredClone(sketch),member=copy.groups.find(g=>g.id===groupId)?.members.find(m=>m.id===memberId);if(!member)fail('Symbole à modifier introuvable.');
 const id=validateSketchId(options.id);if((copy.definitions||[]).some(d=>d.id===id)||copy.groups.some(g=>g.id===id||g.members.some(m=>m.id===id)))fail('Identifiant de variante déjà utilisé.');
 const definition=customDefinition({...options,id,version:1});copy.definitions||=[];copy.definitions.push(definition);member.symbol='custom';member.definitionId=id;member.definitionVersion=1;return copy;
}
export function reviseCustomSymbol(sketch,groupId,memberId,options){
 const copy=structuredClone(sketch),member=copy.groups.find(g=>g.id===groupId)?.members.find(m=>m.id===memberId);if(member?.symbol!=='custom'||!copy.definitions?.some(d=>d.id===member.definitionId&&d.version===member.definitionVersion))fail('Choisissez un symbole personnalisé existant.');
 const version=Math.max(...copy.definitions.filter(d=>d.id===member.definitionId).map(d=>d.version))+1;
 copy.definitions.push(customDefinition({...options,id:member.definitionId,version}));member.definitionVersion=version;return copy;
}
export function planSketchForTransmission(input){
 if(!input?.sketch?.definitions)return input;
 const copy=structuredClone(input),used=new Set(copy.sketch.groups.flatMap(g=>g.members.filter(m=>m.symbol==='custom').map(m=>JSON.stringify([m.definitionId,m.definitionVersion]))));
 copy.sketch.definitions=copy.sketch.definitions.filter(d=>used.has(JSON.stringify([d.id,d.version])));return copy;
}
