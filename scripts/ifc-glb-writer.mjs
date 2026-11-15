// Original Ouvrane GLB exporter, derived from the independently qualified pilot.
// No resource references, textures, compression, downloaded code or quantities.
export function makeModelGlb(meshes,sourceHash){
 const chunks=[],bufferViews=[],accessors=[],materials=[],gltfMeshes=[],nodes=[];let byteLength=0;
 const add=(array,target)=>{const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength),index=bufferViews.length;bufferViews.push({buffer:0,byteOffset:byteLength,byteLength:bytes.length,target});chunks.push(bytes);byteLength+=bytes.length;return index;};
 const accessor=(array,count,type,componentType,target,range)=>{const index=accessors.length;accessors.push({bufferView:add(array,target),componentType,count,type,...range});return index;};
 for(const mesh of meshes){
  const count=mesh.vertices.length/6,positions=new Float32Array(count*3),normals=new Float32Array(count*3),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<count;i++)for(let a=0;a<3;a++){positions[i*3+a]=mesh.vertices[i*6+a];normals[i*3+a]=mesh.vertices[i*6+3+a];min[a]=Math.min(min[a],positions[i*3+a]);max[a]=Math.max(max[a],positions[i*3+a]);}
  const position=accessor(positions,count,'VEC3',5126,34962,{min,max}),normal=accessor(normals,count,'VEC3',5126,34962,{}),indices=accessor(new Uint32Array(mesh.indices),mesh.indices.length,'SCALAR',5125,34963,{}),material=materials.length;
  materials.push({pbrMetallicRoughness:{baseColorFactor:mesh.color,metallicFactor:0,roughnessFactor:1},doubleSided:false});const id=gltfMeshes.length;
  gltfMeshes.push({primitives:[{attributes:{POSITION:position,NORMAL:normal},indices,material,mode:4}]});nodes.push({name:mesh.name,mesh:id,matrix:mesh.matrix,extras:{sourceSha256:sourceHash,expressID:String(mesh.expressID),globalId:mesh.globalId}});
 }
 const document={asset:{version:'2.0',generator:'Ouvrane private IFC preview',extras:{sourceSha256:sourceHash,webIfcVersion:'0.0.78',worldUnit:'metre',worldBasis:'Y-up'}},scene:0,scenes:[{nodes:nodes.map((_,i)=>i)}],nodes,meshes:gltfMeshes,materials,buffers:[{byteLength}],bufferViews,accessors};
 const raw=Buffer.from(JSON.stringify(document)),json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);const binary=Buffer.concat(chunks),header=Buffer.alloc(12),jh=Buffer.alloc(8),bh=Buffer.alloc(8);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+binary.length,8);jh.writeUInt32LE(json.length);jh.writeUInt32LE(0x4e4f534a,4);bh.writeUInt32LE(binary.length);bh.writeUInt32LE(0x004e4942,4);return Buffer.concat([header,jh,json,bh,binary]);
}
