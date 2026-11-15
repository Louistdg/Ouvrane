import {readFileSync,writeFileSync} from 'node:fs';
import {calculatePlanPage} from '../worker/plan-geometry.js';
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/plan-geometry/reference-cases.json',import.meta.url),'utf8'));
fixtures.push({id:'union_surfaces_chevauchantes',outers:[rect(0,0,10000,8000),rect(8000,0,4000,8000)],holes:[],expected_net_m2:96},{id:'triangle_oblique',outer:[[0,0],[6000,0],[0,4000]],holes:[],expected_net_m2:12});
export function inputFor(f){
 const outers=f.outers||[f.outer],polys=[...outers,...f.holes],all=polys.flat();
 const offset=500,width=Math.max(...all.map(p=>p[0]))+1000,height=Math.max(...all.map(p=>p[1]))+1000;
 return {pageNumber:1,pageWidth:width,pageHeight:height,calibration:{points:[{x:offset/width,y:offset/height},{x:(offset+1000)/width,y:offset/height}],lengthM:'1'},annotations:[...outers.map((points,i)=>({id:'surface-'+i,kind:'area',label:'Surface '+i,points})),...f.holes.map((points,i)=>({id:'opening-'+i,kind:'opening',label:'Réservation '+i,points}))].map(a=>({...a,points:a.points.map(([x,y])=>({x:(x+offset)/width,y:(y+offset)/height}))}))};
}
const rows=fixtures.map(f=>{const r=calculatePlanPage(inputFor(f)).result;return {id:f.id,expected:f.expected_net_m2,actual:Number(r.netSurfaceM2??Number(r.surfaceM2)-Number(r.openingsM2)),gross:r.surfaceM2,deduction:r.openingsM2,explicitNet:r.netSurfaceM2??null}});
const calibration=calculatePlanPage({pageNumber:1,pageWidth:500,pageHeight:400,calibration:{points:[{x:0,y:0},{x:.5,y:0}],lengthM:'5'},annotations:[{id:'calibration',kind:'area',label:'500 × 400 px',points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]}]}).result;
rows.push({id:'calibration_pixels_vers_m2',expected:80,actual:Number(calibration.netSurfaceM2??calibration.surfaceM2)});
for(const row of rows){row.passed=Math.abs(row.actual-row.expected)<1e-9;console.log((row.passed?'PASS ':'FAIL ')+row.id+': '+row.actual+' / attendu '+row.expected)}
if(process.env.GEOMETRY_REPORT)writeFileSync(process.env.GEOMETRY_REPORT,JSON.stringify({rows,passed:rows.filter(r=>r.passed).length,total:rows.length},null,2));
if(rows.some(r=>!r.passed))process.exitCode=1;
