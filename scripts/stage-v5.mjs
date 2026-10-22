import {readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync, readdirSync, existsSync, rmSync} from 'node:fs';
import {resolve, dirname, relative, isAbsolute, join, sep, posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootFiles = new Set(['Dockerfile','package.json','package-lock.json','.dockerignore','.railwayignore']);
const seed = 'scripts/seed-batinova.sqlite';
const moduleExtensions = /\.(?:mjs|cjs|js)$/i;
const webExtensions = /\.(?:mjs|js|css|html|webmanifest|svg|png|ico|jpe?g|webp|gif|woff2?|ttf|otf|gz)$/i;
const forbiddenParts = new Set(['.git','node_modules','data','tests','reports','private','dist','chrome-profile','cdp']);
const licenseNames = ['LICENSE','LICENCE','LICENSE.md','LICENCE.md','LICENSE.txt','LICENCE.txt'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (parent, child) => {const path=relative(parent,child);return path===''||(!isAbsolute(path)&&path!=='..'&&!path.startsWith('..'+sep));};
const fail = message => {throw Error('SOCLE V5 staging: '+message);};

// Read static JS dependency declarations without evaluating source or requiring
// npm packages. Comments, regex bodies and template contents cannot add files.
function tokens(source) {
  const result=[];
  const regexStart=previous=>!previous||['(','[','{','=',',',':',';','!','?','return','throw','case','=>'].includes(previous.value);
  for(let i=0;i<source.length;){
    const c=source[i],next=source[i+1];
    if(/\s/.test(c)){i++;continue;}
    if(c==='/'&&next==='/'){i=source.indexOf('\n',i+2);if(i<0)break;continue;}
    if(c==='/'&&next==='*'){const end=source.indexOf('*/',i+2);if(end<0)fail('unterminated source comment');i=end+2;continue;}
    if(c==='`'){i++;let closed=false;while(i<source.length){if(source[i]==='\\'){i+=2;continue;}if(source[i++]==='`'){closed=true;break;}}if(!closed)fail('unterminated template literal');result.push({type:'template',value:''});continue;}
    if(c==='"'||c==="'"){
      const quote=c;let value='',closed=false;i++;
      while(i<source.length){const part=source[i++];if(part===quote){closed=true;break;}if(part!=='\\'){value+=part;continue;}const escaped=source[i++];if(escaped==='\n')continue;const simple={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'};if(escaped in simple)value+=simple[escaped];else if(escaped==='x'||escaped==='u'){const count=escaped==='x'?2:4,digits=source.slice(i,i+count);if(!new RegExp('^[a-fA-F0-9]{'+count+'}$').test(digits))fail('unsupported string escape');value+=String.fromCharCode(parseInt(digits,16));i+=count;}else value+=escaped;}
      if(!closed)fail('unterminated source string');result.push({type:'string',value});continue;
    }
    if(c==='/'&&regexStart(result.at(-1))){i++;let characterClass=false,closed=false;while(i<source.length){const part=source[i++];if(part==='\\'){i++;continue;}if(part==='[')characterClass=true;if(part===']')characterClass=false;if(part==='/'&&!characterClass){closed=true;break;}}if(!closed)fail('unterminated regular expression');while(/[a-z]/i.test(source[i]||'')&&i<source.length)i++;result.push({type:'regex',value:''});continue;}
    const identifier=source.slice(i).match(/^[A-Za-z_$][\w$]*/);if(identifier){result.push({type:'identifier',value:identifier[0]});i+=identifier[0].length;continue;}
    if(c==='='&&next==='>'){result.push({type:'punctuation',value:'=>'});i+=2;continue;}
    result.push({type:'punctuation',value:c});i++;
  }
  return result;
}
function arrayAt(list, index) {
  if(list[index]?.value!=='[')fail('expected a static file-list array');
  const values=[];for(let i=index+1;i<list.length;i++){if(list[i].value===']')return values;if(list[i].value===',')continue;if(list[i].type!=='string')fail('file lists must contain only static strings');values.push(list[i].value);}
  fail('unterminated static file list');
}
function imports(list) {
  const found=[];
  for(let i=0;i<list.length;i++){
    if(list[i].value==='from'&&list[i+1]?.type==='string')found.push(list[i+1].value);
    if(list[i].value==='import'&&list[i+1]?.type==='string')found.push(list[i+1].value);
    if(['import','require'].includes(list[i].value)&&list[i+1]?.value==='('&&list[i+2]?.type==='string'&&list[i+3]?.value===')')found.push(list[i+2].value);
  }
  return found;
}
function normalized(path) {
  if(typeof path!=='string'||!path||path.includes('\\')||path.startsWith('/')||/[\u0000-\u001f]/.test(path))fail('unsafe relative source path');
  const result=posix.normalize(path);if(result==='..'||result.startsWith('../'))fail('source dependency points outside the selected source');return result.replace(/^\.\//,'');
}
function permitted(path) {
  const parts=path.split('/');
  if(parts.some(part=>forbiddenParts.has(part)||part.startsWith('.env'))||/\.(?:log|sqlite(?:3)?|db)(?:$|[.-])/i.test(path)&&path!==seed)fail('forbidden source dependency: '+path);
  if(rootFiles.has(path)||path==='.openai/hosting.json'||path===seed)return;
  if(/^drizzle\/\d[^/]*\.sql$/.test(path))return;
  if((path.startsWith('scripts/')||path.startsWith('worker/'))&&moduleExtensions.test(path))return;
  if(path.startsWith('scripts/')&&licenseNames.includes(parts.at(-1)))return;
  if(path.startsWith('web/')&&webExtensions.test(path))return;
  fail('unsafe extension or non-publication source: '+path);
}
function projectedRealpath(path) {
  const tail=[];let current=resolve(path);
  while(!existsSync(current)){const parent=dirname(current);if(parent===current)fail('target has no existing parent');tail.unshift(current.slice(parent.length).replace(/^[/\\]/,''));current=parent;}
  return join(realpathSync(current),...tail);
}

export function stageV5({source=repository,target}={}) {
  if(typeof target!=='string'||!target.trim())fail('an explicit target directory is required');
  const sourceRoot=realpathSync(resolve(source)),targetRoot=projectedRealpath(target);
  if(inside(sourceRoot,resolve(target))||inside(sourceRoot,targetRoot))fail('target must stay outside the source directory');
  if(existsSync(targetRoot))fail('target already exists; overwrite is forbidden');
  const files=new Map(),moduleQueue=[],visitedModules=new Set(),generated=new Set(),compiledOutputs=new Set();
  function read(path) {
    path=normalized(path);permitted(path);if(files.has(path))return files.get(path);
    const absolute=resolve(sourceRoot,...path.split('/'));
    const metadata=lstatSync(absolute);if(metadata.isSymbolicLink())fail('symbolic links are not accepted: '+path);
    const actual=realpathSync(absolute);if(!inside(sourceRoot,actual))fail('source link points outside the selected source: '+path);
    let parent=dirname(absolute);while(parent!==sourceRoot){if(lstatSync(parent).isSymbolicLink())fail('source directory symlink is not accepted: '+path);parent=dirname(parent);}
    if(!metadata.isFile())fail('expected a regular source file: '+path);
    const value={bytes:readFileSync(absolute),mode:metadata.mode};files.set(path,value);return value;
  }
  const text=path=>read(path).bytes.toString('utf8');
  function module(path) {path=normalized(path);if(generated.has(path))return;if(!moduleExtensions.test(path))fail('unsafe module extension: '+path);read(path);moduleQueue.push(path);}
  for(const path of ['Dockerfile','package.json','package-lock.json','.dockerignore','.railwayignore','.openai/hosting.json',seed])read(path);
  const docker=text('Dockerfile').replace(/\\\r?\n/g,' ');
  for(const line of docker.split(/\r?\n/)){
    const match=line.trim().match(/^COPY\s+(.+)$/i);if(!match)continue;
    if(match[1].startsWith('--'))fail('COPY flags need an explicit staging review');
    const args=match[1].startsWith('[')?JSON.parse(match[1]):match[1].split(/\s+/);
    for(const path of args.slice(0,-1))if(!rootFiles.has(path)&&!['scripts','web','worker','drizzle','.openai',seed].includes(path))fail('Docker COPY source requires an explicit inclusion rule: '+path);
  }
  const command=docker.match(/^\s*CMD\s+(\[[^\r\n]+\])\s*$/mi);if(!command)fail('Docker CMD must declare its Node startup script explicitly');
  const cmd=JSON.parse(command[1]);if(cmd.length!==2||cmd[0]!=='node'||cmd[1]!=='scripts/v5-start.mjs')fail('Docker CMD must select scripts/v5-start.mjs');
  const buildEntries=[...docker.matchAll(/^\s*RUN\s+node\s+(scripts\/[A-Za-z0-9._/-]+)\s*$/gmi)].map(match=>match[1]);
  if(!buildEntries.includes('scripts/build.mjs'))fail('Docker build entry scripts/build.mjs is missing');
  module(cmd[1]);for(const entry of buildEntries)module(entry);
  const build=tokens(text('scripts/build.mjs'));
  let webNames=null;const buildSources=[];
  for(let i=0;i<build.length;i++){
    if(build[i].value==='names'&&build[i+1]?.value==='='&&build[i+2]?.value==='[')webNames=arrayAt(build,i+2);
    if(build[i].value==='entryPoints'&&build[i+1]?.value===':')for(const path of arrayAt(build,i+2))module(path);
    if(build[i].value==='outfile'&&build[i+1]?.value===':'&&build[i+2]?.type==='string'){const output=normalized(build[i+2].value);generated.add(output);compiledOutputs.add(output);}
    if(build[i].value==='copyFile'&&build[i+1]?.value==='('&&build[i+2]?.type==='string'&&build[i+3]?.value===','&&build[i+4]?.type==='string'){buildSources.push(build[i+2].value);generated.add(normalized(build[i+4].value));}
    if(build[i].value==='readFile'&&build[i+1]?.value==='('&&build[i+2]?.type==='string'&&[',',')'].includes(build[i+3]?.value))buildSources.push(build[i+2].value);
  }
  if(!webNames?.length)fail('build must declare a nonempty static names array for web resources');
  for(const output of compiledOutputs)if(output.startsWith('dist/server/'))generated.add('worker/'+output.slice('dist/server/'.length));
  for(const path of buildSources){if(path.startsWith('node_modules/')||generated.has(normalized(path)))continue;if(moduleExtensions.test(path))module(path);else read(path);}
  for(const name of webNames){const path=normalized('web/'+name);if(!path.startsWith('web/'))fail('web names cannot escape the web directory');if(!generated.has(path))read(path);}
  for(const entry of readdirSync(join(sourceRoot,'drizzle'),{withFileTypes:true}))if(entry.isFile()&&/^\d[^/]*\.sql$/.test(entry.name))read('drizzle/'+entry.name);
  if(![...files.keys()].some(path=>path.startsWith('drizzle/')))fail('numbered SQL migrations are missing');
  while(moduleQueue.length){
    const path=moduleQueue.shift();if(visitedModules.has(path))continue;visitedModules.add(path);
    for(const specifier of imports(tokens(text(path)))){
      if(specifier.startsWith('./')||specifier.startsWith('../'))module(posix.join(posix.dirname(path),specifier));
      else if(specifier.startsWith('/')||specifier.startsWith('file:'))fail('absolute module imports are forbidden: '+path);
    }
    for(const name of licenseNames){const license=posix.join(posix.dirname(path),name);if(license.startsWith('scripts/')&&existsSync(join(sourceRoot,...license.split('/'))))read(license);}
  }
  const scannedWeb=new Set();
  while(true){
    const pending=[...files.keys()].filter(path=>path.startsWith('web/')&&/\.(?:css|html|webmanifest)$/.test(path)&&!scannedWeb.has(path));if(!pending.length)break;
    for(const path of pending){
      scannedWeb.add(path);const content=text(path),references=[];
      if(path.endsWith('.webmanifest')){const manifest=JSON.parse(content);for(const icon of manifest.icons||[])if(icon.src)references.push(icon.src);}
      for(const match of content.matchAll(/url\(\s*(["']?)([^)"']+)\1\s*\)/g))references.push(match[2]);
      if(path.endsWith('.html'))for(const match of content.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g))references.push(match[1]);
      for(const reference of references){
        if(/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference))continue;
        const clean=reference.split(/[?#]/)[0];if(!clean)continue;
        const asset=normalized(clean.startsWith('/')?'web/'+clean.slice(1):posix.join(posix.dirname(path),clean));
        if(!asset.startsWith('web/'))fail('web resource points outside web: '+path);
        if(/\.(?:sqlite(?:3)?|db|log)(?:$|[.-])/i.test(asset)||asset.split('/').some(part=>part.startsWith('.env')||forbiddenParts.has(part)))fail('forbidden web resource: '+asset);
        if(!webExtensions.test(clean))continue;
        if(!generated.has(asset))read(asset);
      }
    }
  }
  const ordered=[...files.entries()].sort(([a],[b])=>a.localeCompare(b,'en'));
  const manifest={version:1,product:'SOCLE V5',createdAt:new Date().toISOString(),node:process.version,source:sourceRoot,entrypoints:{build:'scripts/build.mjs',start:cmd[1],seed},files:ordered.map(([path,value])=>({path,bytes:value.bytes.length,sha256:hash(value.bytes)}))};
  manifest.fileCount=manifest.files.length;manifest.totalBytes=manifest.files.reduce((sum,file)=>sum+file.bytes,0);
  mkdirSync(dirname(targetRoot),{recursive:true});let created=false;
  try{
    mkdirSync(targetRoot);created=true;
    for(const [path,value] of ordered){const destination=join(targetRoot,...path.split('/'));mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,value.bytes,{flag:'wx',mode:value.mode&0o777});}
    for(const [path,value] of ordered){const sourcePath=join(sourceRoot,...path.split('/'));if(lstatSync(sourcePath).isSymbolicLink()||!inside(sourceRoot,realpathSync(sourcePath)))fail('source link changed while staging: '+path);if(hash(readFileSync(sourcePath))!==hash(value.bytes))fail('source changed while staging; retry from a stable source: '+path);if(hash(readFileSync(join(targetRoot,...path.split('/'))))!==hash(value.bytes))fail('staged checksum mismatch: '+path);}
    writeFileSync(join(targetRoot,'.socle-stage-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  }catch(error){if(created)rmSync(targetRoot,{recursive:true,force:true});throw error;}
  return {target:targetRoot,manifest:join(targetRoot,'.socle-stage-manifest.json'),fileCount:manifest.fileCount,totalBytes:manifest.totalBytes};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const options={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i];if(key==='--help'){console.log('Usage: node scripts/stage-v5.mjs --target <new-directory-outside-source> [--source <source-directory>]');process.exit(0);}if(!['--target','--source'].includes(key)||!process.argv[i+1]||process.argv[i+1].startsWith('--'))fail('use --target <new-directory> [--source <directory>]');options[key.slice(2)]=process.argv[++i];}
    console.log(JSON.stringify(stageV5(options),null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
