import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {collectThirdPartyNotices,THIRD_PARTY_NOTICE_BANNER,THIRD_PARTY_BUNDLES} from '../scripts/collect-third-party-notices.mjs';

const root=mkdtempSync(join(tmpdir(),'socle-notices-'));
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const write=(path,body)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),body);};
const decode=text=>text.replace(/&quot;/g,'"').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&amp;/g,'&');
const packagePath='node_modules/contradictory';
const apache='Apache License\r\nVersion 2.0\r\nEXACT <script>attack()</script> & copyright\r\n';
const mit='MIT License\nCopyright Fixture Authors\nPermission is hereby granted, fixture\n';
const extracted='/*! dependency attribution preserved verbatim */\n';
const copyright='/* Copyright 2009 ZXing authors\nLicensed under the Apache License, Version 2.0 */';
const lock={lockfileVersion:3,packages:{'':{name:'fixture'},[packagePath]:{version:'1.0.0'},[packagePath+'/node_modules/transitive']:{version:'2.0.0'},'node_modules/optional-other-platform':{version:'1.0.0',optional:true}}};
write('package-lock.json',JSON.stringify(lock));
write(packagePath+'/package.json',JSON.stringify({name:'contradictory',version:'1.0.0',license:'MIT',author:'<img src=x onerror=attack()>'}));
write(packagePath+'/LICENSE',apache);
write(packagePath+'/NOTICE','Upstream NOTICE\nEXACT attribution\n');
write(packagePath+'/dist/bundle.js.LICENSE.txt',extracted);
write(packagePath+'/deeply/nested/notices/MIT-LICENSE',mit);
write(packagePath+'/dist/bundle.js',copyright+'\n(()=>{})();');
write(packagePath+'/node_modules/transitive/package.json',JSON.stringify({name:'transitive',version:'2.0.0',license:'BSD-3-Clause'}));
write(packagePath+'/node_modules/transitive/licenses/LICENSE-BSD',mit);
write('scripts/vendor/LICENCE.md',mit);
write('scripts/vendor/big.cjs','/* Copyright Big fixture; https://example.test/LICENCE.md */\nmodule.exports=1;');
write('web/unrelated.js','SECRET_DO_NOT_COLLECT');
const options={root,requiredPackages:['contradictory'],distributions:[packagePath+'/dist/bundle.js'],vendored:['scripts/vendor/LICENCE.md','scripts/vendor/big.cjs']};
try{
  const result=collectThirdPartyNotices(options);
  assert.equal(result.packages.length,2,'only installed locked packages are listed');
  assert.equal(result.records.find(record=>record.path===packagePath+'/LICENSE').text,apache,'exact text beats contradictory package metadata');
  assert.equal(result.records.find(record=>record.path.endsWith('bundle.js.LICENSE.txt')).text,extracted,'webpack external attribution collected');
  assert.equal(result.records.find(record=>record.path.endsWith('/MIT-LICENSE')).text,mit,'deep attribution paths and alternate upstream filenames are included');
  assert.ok(result.records.some(record=>record.path.endsWith('/NOTICE')&&record.text.includes('EXACT attribution')));
  assert.ok(result.records.some(record=>record.path.includes('/node_modules/transitive/')&&record.text===mit),'nested locked dependency licence included');
  assert.ok(result.records.some(record=>record.text===copyright),'distribution copyright absent from generic licence retained');
  assert.ok(result.records.some(record=>record.path==='scripts/vendor/LICENCE.md'&&record.text===mit));
  const pre=[...result.html.matchAll(/<pre>([\s\S]*?)<\/pre>/g)].map(match=>decode(match[1]));
  assert.ok(pre.includes(apache),'HTML preserves the complete exact licence, including CRLF');
  assert.ok(!result.html.includes('<script>attack()')&&!result.html.includes('<img src=x'),'untrusted attribution text is escaped');
  assert.ok(!result.html.includes('SECRET_DO_NOT_COLLECT'),'collector reads positive attribution inputs only');
  assert.equal(collectThirdPartyNotices(options).html,result.html,'identical installed inputs produce deterministic output');
  write(packagePath+'/package.json',JSON.stringify({name:'contradictory',version:'9.0.0'}));
  assert.throws(()=>collectThirdPartyNotices(options),/differs from lockfile/,'stale installed versions cannot silently enter notices');
  write(packagePath+'/package.json',JSON.stringify({name:'contradictory',version:'1.0.0',license:'MIT'}));
  assert.throws(()=>collectThirdPartyNotices({...options,requiredPackages:['missing']}),/Required browser dependency is absent/);
  assert.throws(()=>collectThirdPartyNotices({...options,distributions:['web/unrelated.js']}),/does not belong/);
  rmSync(join(root,packagePath,'node_modules/transitive/licenses'),{recursive:true});
  write(packagePath+'/node_modules/transitive/README.md','Package documentation\n## License\n'+mit);
  assert.ok(collectThirdPartyNotices(options).records.some(record=>record.kind==='readme-licence'&&record.text.endsWith(mit)),'licences published only inside README are retained');

  // Execute the real build control flow with memory-only IO and an instrumented
  // compiler. This does not build the repository or change its dist directory.
  const build=readFileSync(join(repository,'scripts/build.mjs'),'utf8');
  const names=[...build.match(/const names=\[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map(match=>match[1]);
  const memory=new Map(names.map(name=>['web/'+name,Buffer.from('fixture body: '+name)]));
  memory.set('web/index.html',Buffer.from('<!doctype html><html><head></head><body></body></html>'));
  memory.set('web/tessdata/fra.traineddata.gz',Buffer.from('language fixture'));
  memory.set('worker/index.js',Buffer.from('// worker fixture'));
  memory.set('node_modules/tesseract.js/dist/tesseract.min.js.LICENSE.txt',Buffer.from(extracted));
  memory.set('node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt',Buffer.from('worker original notice\n'));
  const io={
    readFile:async(path,encoding)=>{if(!memory.has(path))memory.set(path,Buffer.from('fixture source: '+path));const value=memory.get(path);return encoding?value.toString(encoding):value;},
    copyFile:async(source,target)=>memory.set(target,await io.readFile(source)),
    mkdir:async()=>{},rm:async()=>{},writeFile:async(path,body)=>memory.set(path,Buffer.from(body)),
  };
  const compiler={build:async()=>{},transform:async code=>({code})};
  let collected=0;
  const collect=()=>{collected++;memory.set('web/third-party-notices.html',Buffer.from(result.html));};
  const source=build.replace(/^import .*;\r?\n/gm,'');
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  await new AsyncFunction('fs','esbuild','createHash','writeThirdPartyNotices','THIRD_PARTY_NOTICE_BANNER','THIRD_PARTY_BUNDLES','console',source)(io,compiler,createHash,collect,THIRD_PARTY_NOTICE_BANNER,THIRD_PARTY_BUNDLES,{log(){}});
  assert.equal(collected,1,'each build refreshes notices before packaging');
  const output=memory.get('dist/server/index.js').toString();
  const files=JSON.parse(output.slice('const FILES='.length,output.indexOf(';\n')));
  assert.equal(files['/third-party-notices.html'].type,'text/html;charset=utf-8');
  assert.equal(files['/third-party-notices.html'].body,result.html,'complete licence page reaches the actual serving map');
  for(const [route,expected] of [['/tesseract.min.js.LICENSE.txt',extracted],['/worker.min.js.LICENSE.txt','worker original notice\n']]){
    assert.equal(files[route].type,'text/plain;charset=utf-8','referenced notice has the right MIME type');
    assert.equal(files[route].body,expected,'referenced notice is copied byte for byte');
  }
  for(const name of THIRD_PARTY_BUNDLES)assert.ok(files['/'+name].body.startsWith(THIRD_PARTY_NOTICE_BANNER),'licence URL survives packaging for '+name);
  console.log('PASS third-party notices: exact upstream/transitive text, escaped HTML, lock integrity, real build serving map with memory-only IO.');
}finally{rmSync(root,{recursive:true,force:true});}
