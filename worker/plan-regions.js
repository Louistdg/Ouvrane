import polygonClipping from './vendor/polygon-clipping-0.15.7.cjs';

// Clipping uses normalized document coordinates. Calibration is applied once,
// to the resulting area, rather than to rounded annotation quantities.
function ringArea(ring){
 if(ring.length<3)return 0;
 const [ox,oy]=ring[0];let sum=0,correction=0;
 for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length];
  const term=(a[0]-ox)*(b[1]-oy)-(b[0]-ox)*(a[1]-oy)-correction;
  const next=sum+term;correction=(next-sum)-term;sum=next;
 }
 return Math.abs(sum)/2;
}
export function multiPolygonArea(polygons){
 // A polygon is an exterior followed by holes. Never add all absolute rings.
 return polygons.reduce((sum,rings)=>sum+Math.max(0,ringArea(rings[0])-rings.slice(1).reduce((s,r)=>s+ringArea(r),0)),0);
}
function union(shapes){return shapes.length?polygonClipping.union(...shapes.map(a=>[a.points.map(p=>[p.x,p.y])])):[]}
export function calculatePlanRegions(annotations,areaFactor){
 const surfaces=annotations.filter(a=>a.kind==='area'),openings=annotations.filter(a=>a.kind==='opening');
 const exterior=union(surfaces),reservations=union(openings),hasSurfaceContour=surfaces.length>0;
 const clipped=hasSurfaceContour&&reservations.length?polygonClipping.intersection(exterior,reservations):reservations;
 const net=hasSurfaceContour&&reservations.length?polygonClipping.difference(exterior,reservations):exterior;
 const surface=multiPolygonArea(exterior)*areaFactor,deduction=multiPolygonArea(clipped)*areaFactor;
 const netSurface=hasSurfaceContour?multiPolygonArea(net)*areaFactor:null;
 const deductibleById=new Map(openings.map(a=>[a.id,hasSurfaceContour?multiPolygonArea(polygonClipping.intersection(exterior,union([a])))*areaFactor:null]));
 for(const value of [surface,deduction,netSurface,...deductibleById.values()])if(value!==null&&(!Number.isFinite(value)||value<0||value>1000000))throw Object.assign(Error('Surface réunie nulle ou hors limites.'),{status:400});
 return {hasSurfaceContour,surface,deduction,netSurface,deductibleById};
}

export const PAGE_OPENINGS_SOURCE='@page-openings-union';
export function planMeasureSource(result,annotationId){
 if(annotationId===PAGE_OPENINGS_SOURCE){
  if(result.geometryVersion!==2||!result.annotations.some(a=>a.kind==='opening'))return null;
  return {id:annotationId,kind:'opening',label:'Ensemble des réservations de la page, sans double déduction',quantity:result.openingsM2,unit:'m2'};
 }
 const measure=result.annotations.find(a=>a.id===annotationId);
 if(!measure)return null;
 return measure.kind==='opening'&&result.geometryVersion===2&&measure.deductibleQuantity!==null&&measure.deductibleQuantity!==undefined?{...measure,quantity:measure.deductibleQuantity}:measure;
}
