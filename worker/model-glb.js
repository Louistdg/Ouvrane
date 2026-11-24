// Original narrow GLB contract for the embedded, uncompressed IFC preview.
// Deliberately rejects external resources/codecs rather than relaxing the viewer.
export function inspectModelGlb(bytes){
 const bad=()=>{throw Object.assign(Error('Aperçu GLB incohérent ou non autonome.'),{status:422});};
 if(!(bytes instanceof Uint8Array)||bytes.length<28||bytes.length>8388608)bad();const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u=o=>v.getUint32(o,true);
 if(u(0)!==0x46546c67||u(4)!==2||u(8)!==bytes.length||u(16)!==0x4e4f534a)bad();const jsonLength=u(12),binAt=20+jsonLength;
 if(jsonLength%4||jsonLength>524288||binAt+8>bytes.length||u(binAt+4)!==0x004e4942||binAt+8+u(binAt)!==bytes.length)bad();
 let d;try{d=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(20,binAt)).trim());}catch{bad();}
 if(d.asset?.version!=='2.0'||d.extensionsUsed?.length||d.extensionsRequired?.length||d.images?.length||d.textures?.length||d.animations?.length||d.skins?.length||!Array.isArray(d.buffers)||d.buffers.length!==1||d.buffers[0].uri||d.buffers[0].byteLength!==u(binAt)||!Array.isArray(d.nodes)||!d.nodes.length||d.nodes.length>2000||!Array.isArray(d.meshes)||d.meshes.length!==d.nodes.length||d.scene!==0||!Array.isArray(d.scenes)||d.scenes.length!==1||JSON.stringify(d.scenes[0].nodes)!==JSON.stringify(d.nodes.map((_,i)=>i)))bad();
 const base=binAt+8,size=u(binAt),integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;let vertices=0,triangles=0;
 function accessor(id,type,component){const a=d.accessors?.[id],b=d.bufferViews?.[a?.bufferView];if(!a||!b||a.type!==type||a.componentType!==component||a.sparse||b.buffer!==0||b.byteStride||!integer(a.count,1,600000)||!integer(b.byteOffset??0,0,size)||!integer(b.byteLength,1,size)||!integer(a.byteOffset??0,0,b.byteLength))bad();const components=type==='VEC3'?3:1,offset=(b.byteOffset||0)+(a.byteOffset||0),length=a.count*components*4;if(offset%4||offset+length>base+size-base||offset+length>(b.byteOffset||0)+b.byteLength)bad();return {count:a.count,get:(i,j=0)=>{const at=base+offset+(i*components+j)*4;return component===5126?v.getFloat32(at,true):v.getUint32(at,true);}};}
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let n=0;n<d.nodes.length;n++){
  const node=d.nodes[n],mesh=d.meshes[node.mesh];if(!mesh||node.children?.length||node.translation||node.rotation||node.scale||!Array.isArray(node.matrix)||node.matrix.length!==16||node.matrix.some(x=>!Number.isFinite(x))||node.matrix[3]!==0||node.matrix[7]!==0||node.matrix[11]!==0||node.matrix[15]!==1||mesh.primitives?.length!==1)bad();
  const p=mesh.primitives[0];if(p.mode!==4||p.extensions||Object.keys(p.attributes||{}).some(k=>!['POSITION','NORMAL'].includes(k)))bad();const positions=accessor(p.attributes.POSITION,'VEC3',5126),normals=accessor(p.attributes.NORMAL,'VEC3',5126),indices=accessor(p.indices,'SCALAR',5125);
  if(normals.count!==positions.count||indices.count%3)bad();vertices+=positions.count;triangles+=indices.count/3;if(vertices>120000||triangles>200000)bad();
  for(let i=0;i<positions.count;i++){const x=positions.get(i,0),y=positions.get(i,1),z=positions.get(i,2);if(![x,y,z,...[0,1,2].map(j=>normals.get(i,j))].every(Number.isFinite))bad();for(let a=0;a<3;a++){const world=node.matrix[a]*x+node.matrix[4+a]*y+node.matrix[8+a]*z+node.matrix[12+a];if(!Number.isFinite(world)||Math.abs(world)>1e9)bad();min[a]=Math.min(min[a],world);max[a]=Math.max(max[a],world);}}
  for(let i=0;i<indices.count;i++)if(indices.get(i)>=positions.count)bad();
 }
 const dimensions=max.map((x,i)=>x-min[i]);if(!dimensions.some(x=>x>0))bad();return {objectCount:d.nodes.length,vertices,triangles,min,max,dimensions};
}
