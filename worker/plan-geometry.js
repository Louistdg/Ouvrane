const fail=message=>{throw Object.assign(Error(message),{status:400})};
const finite=(v,min,max,label)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail(label+' invalide.');return v};
const point=p=>({x:finite(p?.x,0,1,'Coordonnée x'),y:finite(p?.y,0,1,'Coordonnée y')});
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function intersects(a,b,c,d){const e=1e-10;const on=(p,q,r)=>Math.abs(cross(p,q,r))<e&&r.x>=Math.min(p.x,q.x)-e&&r.x<=Math.max(p.x,q.x)+e&&r.y>=Math.min(p.y,q.y)-e&&r.y<=Math.max(p.y,q.y)+e;const x=cross(a,b,c),y=cross(a,b,d),z=cross(c,d,a),t=cross(c,d,b);return x*y<0&&z*t<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b)}
export function calculatePlanPage(data){
 const width=finite(data.pageWidth,20,20000,'Largeur de page'),height=finite(data.pageHeight,20,20000,'Hauteur de page');
 if(!Number.isInteger(data.pageNumber)||data.pageNumber<1||data.pageNumber>10000)fail('Page invalide.');
 const distance=(a,b)=>Math.hypot((a.x-b.x)*width,(a.y-b.y)*height);
 let calibration=null,scale=null;
 if(data.calibration){const c=data.calibration;if(!Array.isArray(c.points)||c.points.length!==2)fail('Deux points d’étalonnage sont requis.');const points=c.points.map(point),length=String(c.lengthM||'').replace(',','.');if(!/^\d+(?:\.\d{1,5})?$/.test(length)||Number(length)<=0||Number(length)>1000000)fail('Cote connue invalide.');const units=distance(...points);if(units<0.01)fail('Les points d’étalonnage sont trop proches.');scale=Number(length)/units;calibration={points,lengthM:length}}
 if(!Array.isArray(data.annotations)||data.annotations.length>100)fail('Maximum 100 annotations par page.');
 const ids=new Set(),annotations=[],results=[];
 for(const a of data.annotations){
  if(!a||!/^[A-Za-z0-9._:-]{1,100}$/.test(a.id||'')||ids.has(a.id))fail('Identifiant d’annotation invalide ou en double.');ids.add(a.id);
  if(!['length','area','opening','note'].includes(a.kind))fail('Type d’annotation invalide.');
  const label=String(a.label||'').trim();if(!label||label.length>200)fail('Nommez chaque annotation (200 caractères maximum).');
  if(!Array.isArray(a.points)||a.points.length<1||a.points.length>64)fail('Points invalides.');const points=a.points.map(point);
  let quantity=null,unit=null;
  if(a.kind==='note'){if(points.length!==1)fail('Un repère texte attend un point.')}else{
   if(!scale)fail('Étalonnez cette page avant d’enregistrer des mesures.');
   if(a.kind==='length'){if(points.length!==2||distance(...points)<0.01)fail('Longueur invalide.');quantity=distance(...points)*scale;unit='m'}else{
    if(points.length<3)fail('Une surface attend au moins trois points.');
    for(let i=0;i<points.length;i++){if(distance(points[i],points[(i+1)%points.length])<0.01)fail('Deux sommets de surface sont trop proches.');for(let j=i+1;j<points.length;j++){if(j===i+1||i===0&&j===points.length-1)continue;if(intersects(points[i],points[(i+1)%points.length],points[j],points[(j+1)%points.length]))fail('Le contour se croise ou se touche.');}}
    let area=0;for(let i=0;i<points.length;i++){const p=points[i],q=points[(i+1)%points.length];area+=p.x*q.y-q.x*p.y}quantity=Math.abs(area)*width*height/2*scale*scale;unit='m2';
   }
   if(!Number.isFinite(quantity)||quantity<0.001||quantity>1000000)fail('Mesure nulle ou hors limites.');
  }
  annotations.push({id:a.id,kind:a.kind,label,points});results.push({id:a.id,kind:a.kind,label,quantity:quantity===null?null:quantity.toFixed(3),unit});
 }
 return {input:{pageNumber:data.pageNumber,pageWidth:width,pageHeight:height,calibration,annotations},result:{annotations:results,scaleMetresPerPageUnit:scale===null?null:scale.toString(),surfaceM2:results.filter(a=>a.kind==='area').reduce((s,a)=>s+Number(a.quantity),0).toFixed(3),openingsM2:results.filter(a=>a.kind==='opening').reduce((s,a)=>s+Number(a.quantity),0).toFixed(3)}};
}
