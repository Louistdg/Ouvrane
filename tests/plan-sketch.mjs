import assert from 'node:assert/strict';
import {calculatePlanPage} from '../worker/plan-geometry.js';
import {validatePlanSketch,planSketchPaths,copySketchGroup,rotateSketchGroup,resizeSketchGroup,sketchGroupBounds} from '../worker/plan-sketch.js';
import {planMeasureSource} from '../worker/plan-regions.js';
const page={pageNumber:1,pageWidth:600,pageHeight:400,calibration:{points:[{x:.1,y:.1},{x:.6,y:.1}],lengthM:'10'},annotations:[{id:'surface',kind:'area',label:'Surface',points:[{x:.1,y:.1},{x:.6,y:.1},{x:.6,y:.6},{x:.1,y:.6}]},{id:'hole',kind:'opening',label:'Ouverture',points:[{x:.2,y:.2},{x:.3,y:.2},{x:.3,y:.3},{x:.2,y:.3}]}]};
const member=(id='s1')=>({id,symbol:'window',definitionVersion:1,x:.4,y:.4,width:.1,height:.1,rotation:0,dimensionWidth:true,dimensionHeight:true,precision:2});
const sketch={schemaVersion:1,coordinateSpace:'plan-normalized-v1',groups:[{id:'g1',label:'Fenêtres façade',members:[member(),{...member('s2'),x:.6}]}]};
const before=calculatePlanPage(page),raw=JSON.stringify(page),after=calculatePlanPage({...page,sketch});
assert.deepEqual(after.result.annotations,before.result.annotations);assert.equal(after.result.netSurfaceM2,before.result.netSurfaceM2);assert.equal(after.result.openingsM2,before.result.openingsM2);assert.equal(JSON.stringify(page),raw);assert.equal('sketch' in before.input,false);assert.equal('sketch' in before.result,false);
assert.equal(after.result.sketch.groups[0].dimensions[0].value,'2.000000');assert.equal(after.result.sketch.groups[0].dimensions[0].label,'2,00 m');
assert.equal(after.result.netSurfaceM2,'64.000');assert.equal(planMeasureSource(after.result,'g1'),null);assert.equal(planMeasureSource(after.result,'s1:width'),null);
for(const annotations of [page.annotations,[...page.annotations,{...page.annotations[1],id:'overlap'}],[page.annotations[0],{...page.annotations[1],points:[{x:.8,y:.8},{x:.9,y:.8},{x:.9,y:.9},{x:.8,y:.9}]}]]){
 const plain=calculatePlanPage({...page,annotations}),decorated=calculatePlanPage({...page,annotations,sketch});const result=structuredClone(decorated.result);delete result.sketch;assert.deepEqual(result,plain.result);
}
const unchanged=JSON.stringify(sketch);let serial=0;const copied=copySketchGroup(sketch.groups[0],600,400,()=>`new-${++serial}`);
assert.equal(JSON.stringify(sketch),unchanged);assert.notEqual(copied.id,'g1');assert.equal(new Set([copied.id,...copied.members.map(s=>s.id)]).size,3);assert.notEqual(copied.members[0].id,'s1');
validatePlanSketch({...sketch,groups:[...sketch.groups,copied]},600,400,1/30,new Set());
const rotated=rotateSketchGroup(sketch.groups[0],600,400);const r=calculatePlanPage({...page,sketch:{...sketch,groups:[rotated]}});
assert.equal(r.result.sketch.groups[0].dimensions[0].value,after.result.sketch.groups[0].dimensions[0].value);assert.equal(rotated.members[0].rotation,90);assert.equal(JSON.stringify(sketch),unchanged);
const resized=resizeSketchGroup(rotated,600,400,1/30,2,3),bounds=sketchGroupBounds(resized,600,400);assert.ok(Math.abs((bounds.maxX-bounds.minX)*600/30-2)<1e-9);assert.ok(Math.abs((bounds.maxY-bounds.minY)*400/30-3)<1e-9);assert.equal(JSON.stringify(sketch),unchanged);validatePlanSketch({...sketch,groups:[resized]},600,400,1/30);
assert.throws(()=>resizeSketchGroup(rotated,600,400,null,2,3),/Étalonnez/);assert.throws(()=>resizeSketchGroup(rotated,600,400,1/30,NaN,3));
assert.ok(planSketchPaths(member(),600,400).paths.length>=2);
for(const symbol of ['door','window','stairs'])assert.ok(planSketchPaths({...member(),symbol},600,400).paths.length>=2);
const bad=change=>{const s=structuredClone(sketch);change(s);assert.throws(()=>calculatePlanPage({...page,sketch:s}),e=>e.status===400)};
bad(s=>s.groups[0].members[0].x=NaN);bad(s=>s.groups[0].members[0].width=Infinity);bad(s=>s.groups[0].members[0].definitionVersion=2);bad(s=>s.groups[0].members[0].symbol='script');bad(s=>s.groups[0].members[0].rotation=45);bad(s=>s.groups[0].members[0].precision=9);bad(s=>s.groups[0].members[0].dimensionWidth='yes');bad(s=>s.groups[0].members[0].x=.99);bad(s=>s.groups[0].members[1].id='s1');bad(s=>s.groups[0].id='surface');bad(s=>s.coordinateSpace='pdf-raw-v1');bad(s=>s.schemaVersion=2);bad(s=>s.groups[0].members=[]);bad(s=>s.groups=Array.from({length:21},(_,i)=>({...s.groups[0],id:'g'+i})));
assert.throws(()=>calculatePlanPage({...page,annotations:[],calibration:null,sketch}),/Étalonnez/);
const unscaled=structuredClone(sketch);for(const m of unscaled.groups[0].members)m.dimensionWidth=m.dimensionHeight=false;
assert.equal(calculatePlanPage({...page,annotations:[],calibration:null,sketch:unscaled}).result.sketch.groups[0].dimensions.length,0);
console.log('PASS sketch geometry: old results unchanged, separate decorative groups, anchored dimensions, immutable copy/rotation, bounds/IDs/types/versions/calibration validation.');
