import {parentPort,workerData} from 'node:worker_threads';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {makeModelGlb} from './ifc-glb-writer.mjs';
import {inspectModelGlb} from '../worker/model-glb.js';
const require=createRequire(import.meta.url),W=require('../vendor/web-ifc/web-ifc-api-node.js');
const hash=b=>createHash('sha256').update(b).digest('hex');
const api=new W.IfcAPI();let modelId=null;
try{
 globalThis.fetch=()=>{throw Error('External requests disabled in IFC conversion');};
 const source=new Uint8Array(workerData.source);if(!source.length||source.length>1800000)throw Error('source');
 await api.Init();api.SetLogLevel(W.LogLevel.LOG_LEVEL_OFF);modelId=api.OpenModel(source,{COORDINATE_TO_ORIGIN:false,MEMORY_LIMIT:268435456,ALLOW_INCOMPATIBLE_SCHEMA_ALIASES:false});
 if(modelId<0||api.GetModelSchema(modelId)!=='IFC4')throw Error('schema');
 const meshes=[];let vertices=0,triangles=0;const sourceHash=hash(source);
 api.StreamAllMeshes(modelId,mesh=>{try{for(let i=0;i<mesh.geometries.size();i++){
  if(meshes.length>=2000)throw Object.assign(Error('limit'),{status:413});const p=mesh.geometries.get(i),g=api.GetGeometry(modelId,p.geometryExpressID);
  try{const vc=g.GetVertexDataSize(),ic=g.GetIndexDataSize();vertices+=vc/6;triangles+=ic/3;if(vc%6||ic%3||vertices>120000||triangles>200000)throw Object.assign(Error('limit'),{status:413});const obj=api.GetLine(modelId,mesh.expressID);meshes.push({expressID:mesh.expressID,globalId:String(obj.GlobalId?.value||''),name:String(obj.Name?.value||'Objet IFC').slice(0,180),matrix:[...p.flatTransformation],vertices:Float32Array.from(api.GetVertexArray(g.GetVertexData(),vc)),indices:Uint32Array.from(api.GetIndexArray(g.GetIndexData(),ic)),color:[p.color.x,p.color.y,p.color.z,p.color.w].map(x=>Number.isFinite(x)?Math.max(0,Math.min(1,x)):1)});}finally{g.delete();}
 }}finally{if(typeof mesh.delete==='function')mesh.delete();else mesh.geometries.delete?.();}},true);
 if(!meshes.length)throw Error('empty');const preview=makeModelGlb(meshes,sourceHash);if(preview.length>8388608)throw Object.assign(Error('limit'),{status:413});const inspected=inspectModelGlb(preview);
 const metadata={schema:'IFC4',sourceSha256:sourceHash,previewSha256:hash(preview),converter:{name:'web-ifc',version:'0.0.78',exporter:'Ouvrane original GLB'},worldUnit:'metre',worldBasis:'Y-up',coordinateToOrigin:false,sourceToDisplay:'Placement matrix already includes linear unit conversion and Y-up basis; no second scale or implicit translation.',objectCount:meshes.length,dimensions:inspected.dimensions,bounds:{min:inspected.min,max:inspected.max},vertices:inspected.vertices,triangles:inspected.triangles,objects:meshes.map(m=>({expressId:String(m.expressID),globalId:m.globalId,name:m.name,matrix:m.matrix})),limitations:['Geometry preview only; no automatic contractual quantities.','Only IFC4 and embedded uncompressed geometry are admitted in this first import.','No cadastral coordinate-system or IfcMapConversion qualification.']};
 const bytes=Uint8Array.from(preview);parentPort.postMessage({ok:true,preview:bytes,metadata},[bytes.buffer]);
}catch(error){parentPort.postMessage({ok:false,status:error.status===413?413:422});}
finally{if(modelId!==null&&modelId>=0)api.CloseModel(modelId);api.Dispose();}
