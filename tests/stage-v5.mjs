import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname, relative} from 'node:path';
import {createHash} from 'node:crypto';
import {stageV5} from '../scripts/stage-v5.mjs';

const temporary = mkdtempSync(join(tmpdir(), 'socle-stage-v5-'));
const source = join(temporary, 'source');
const put = (path, content) => {const destination=join(source,path); mkdirSync(dirname(destination),{recursive:true}); writeFileSync(destination,content);};
const paths = root => readdirSync(root,{withFileTypes:true}).flatMap(entry => entry.isDirectory() ? paths(join(root,entry.name)).map(path => entry.name+'/'+path) : [entry.name]).sort();
try {
  mkdirSync(source);
  put('Dockerfile', 'FROM node:22.23.3-bookworm-slim\nWORKDIR /app\nCOPY package.json package-lock.json ./\nRUN npm ci\nCOPY scripts ./scripts\nCOPY web ./web\nCOPY worker ./worker\nCOPY drizzle ./drizzle\nCOPY .openai ./.openai\nRUN node scripts/build.mjs\nRUN npm prune --omit=dev\nCOPY scripts/seed-batinova.sqlite /app/scripts/seed-batinova.sqlite\nCMD ["node", "scripts/v5-start.mjs"]\n');
  put('package.json', JSON.stringify({name:'stage-fixture',type:'module',scripts:{build:'node scripts/build.mjs',start:'node scripts/production.mjs'}}));
  put('package-lock.json', '{"lockfileVersion":3}');
  put('.dockerignore', 'node_modules\ndata\n.env*\n');
  put('.railwayignore', 'node_modules\ndata\n.env*\n');
  put('.openai/hosting.json', '{"d1":"DB"}');
  put('scripts/build.mjs', "import fs from 'node:fs/promises';\nimport esbuild from 'esbuild';\nawait esbuild.build({entryPoints:['scripts/frontend-entry.js'],outfile:'web/generated.js'});\nawait esbuild.build({entryPoints:['scripts/engine-entry.js'],outfile:'dist/server/engine.js'});\nawait fs.copyFile('node_modules/vendor/vendor.js','web/vendor.js');\nconst names=['index.html','style.css','app.js','generated.js','vendor.js','icon.png'];\nfor(const name of names)await fs.readFile('web/'+name);\nawait fs.readFile('worker/index.js','utf8');\nawait fs.copyFile('worker/child.js','dist/server/child.js');\nawait fs.copyFile('.openai/hosting.json','dist/.openai/hosting.json');\n");
  put('scripts/frontend-entry.js', "import {value} from './shared.mjs';import 'vendor';console.log(value);");
  put('scripts/shared.mjs', 'export const value=1;');
  put('scripts/engine-entry.js', "export {value} from './vendor/value.cjs';");
  put('scripts/vendor/value.cjs', "module.exports.value=require('./nested.cjs');");
  put('scripts/vendor/nested.cjs', 'module.exports=2;');
  put('scripts/vendor/LICENCE.md', 'MIT fixture');
  put('scripts/v5-start.mjs', "import './production.mjs';const seed=new URL('./seed-batinova.sqlite',import.meta.url);");
  put('scripts/production.mjs', "import './production-db.mjs';import '../worker/child.js';");
  put('scripts/production-db.mjs', "export const db='runtime';");
  put('scripts/seed-batinova.sqlite', Buffer.from('unique explicit fixture seed'));
  put('web/index.html', '<html><link rel="stylesheet" href="style.css"><script src="app.js"></script><img src="icon.png"></html>');
  put('web/style.css', 'body{background:url(assets/pattern.png)}');
  put('web/assets/pattern.png', Buffer.from([1,2,3,4]));
  put('web/app.js', "console.log('local application');");
  put('web/icon.png', Buffer.from([5,6,7,8]));
  put('worker/index.js', "import './child.js';import {value} from './engine.js';export default {value};");
  put('worker/child.js', "import {value} from './nested/shared.js';export {value};");
  put('worker/nested/shared.js', 'export const value=3;');
  put('drizzle/0000_initial.sql', 'CREATE TABLE fixture(id TEXT);');
  put('drizzle/0001_followup.sql', 'CREATE INDEX fixture_idx ON fixture(id);');
  for(const trap of ['.env','data/private.sqlite','tests/private.mjs','node_modules/vendor/vendor.js','dist/server/index.js','scripts/.env.private','scripts/archive.sqlite','scripts/nested/credentials.json','scripts/chrome-profile/Local State','scripts/cdp.log','scripts/unused-debug.mjs','web/.env','web/assets/unreferenced.png','web/nested/recording.mp4','web/nested/private.sqlite','web/generated.js','web/vendor.js','worker/.env','worker/diagnostic-unused.js','worker/nested/history.log','drizzle/meta/private.json','.openai/token.json']) put(trap, 'DO_NOT_STAGE_SECRET_FIXTURE');

  const target = join(temporary,'publication');
  const result = stageV5({source,target});
  const included = paths(target);
  const required = ['Dockerfile','package.json','package-lock.json','.dockerignore','.railwayignore','.openai/hosting.json','scripts/build.mjs','scripts/frontend-entry.js','scripts/shared.mjs','scripts/engine-entry.js','scripts/vendor/value.cjs','scripts/vendor/nested.cjs','scripts/vendor/LICENCE.md','scripts/v5-start.mjs','scripts/production.mjs','scripts/production-db.mjs','scripts/seed-batinova.sqlite','web/index.html','web/style.css','web/assets/pattern.png','web/app.js','web/icon.png','worker/index.js','worker/child.js','worker/nested/shared.js','drizzle/0000_initial.sql','drizzle/0001_followup.sql'];
  assert.deepEqual(included.filter(path=>path!=='.socle-stage-manifest.json'),required.sort(),'Only the build/runtime dependency closure and referenced assets are staged');
  assert.equal(included.filter(path=>/\.sqlite(?:$|[-.])/.test(path)).length,1,'Only the explicitly authorized seed enters the context');
  assert.equal(included.some(path=>/(^|\/)(\.env|data|tests|node_modules|dist|chrome-profile)(\/|$)/.test(path)),false);
  const manifest=JSON.parse(readFileSync(join(target,'.socle-stage-manifest.json'),'utf8'));
  assert.equal(manifest.files.length,required.length);
  assert.equal(result.fileCount,required.length);
  assert.equal(JSON.stringify(manifest).includes('DO_NOT_STAGE_SECRET_FIXTURE'),false,'Manifest does not contain file bodies or secrets');
  for(const file of manifest.files){const bytes=readFileSync(join(target,file.path));assert.equal(file.bytes,bytes.length);assert.equal(file.sha256,createHash('sha256').update(bytes).digest('hex'));}
  assert.throws(()=>stageV5({source,target}),/exist|overwrite|écras/i,'Existing destinations must never be replaced');
  assert.throws(()=>stageV5({source,target:join(source,'release')}),/source|inside|intérieur/i,'A nested target must be rejected');
  assert.equal(existsSync(join(source,'release')),false);

  // An included module must not pull an env/database path into the closure.
  put('worker/child.js', "import './nested/private.sqlite';export const value=1;");
  const rejected=join(temporary,'unsafe-import');
  assert.throws(()=>stageV5({source,target:rejected}),/forbidden|unsafe|interdit|extension|seed/i);
  assert.equal(existsSync(rejected),false,'Unsafe input is refused before creating a release folder');
  put('worker/child.js', "import {value} from './nested/shared.js';export {value};");
  put('web/style.css', 'body{background:url(../data/private.sqlite)}');
  assert.throws(()=>stageV5({source,target:join(temporary,'unsafe-asset')}),/forbidden|unsafe|interdit|outside|source|web|extension/i);
  put('web/style.css','body{background:url(assets/pattern.png)}');
  put('worker/child.js', "import './missing.js';export const value=1;");
  assert.throws(()=>stageV5({source,target:join(temporary,'missing-dependency')}),/missing|introuvable|ENOENT/i,'Missing dependencies must fail closed');
  put('worker/child.js', "import {value} from './nested/shared.js';export {value};");
  const outside=join(temporary,'outside-directory');mkdirSync(outside);writeFileSync(join(outside,'private.js'),'DO_NOT_STAGE_SECRET_FIXTURE');
  let symlinkCheck='not-run';
  try {
    symlinkSync(outside,join(source,'worker','linked-directory'),process.platform==='win32'?'junction':'dir');
    put('worker/child.js', "import './linked-directory/private.js';export const value=1;");
    assert.throws(()=>stageV5({source,target:join(temporary,'linked-dependency')}),/symbolic|symlink|link|outside|source|lien/i,'A symlink cannot escape the selected source');
    assert.throws(()=>stageV5({source,target:join(source,'worker','linked-directory','nested-target')}),/source|inside|intérieur/i,'A textual target inside source cannot evade the rule through a junction');
    symlinkCheck='refused';
  } catch(error) {if(!['EPERM','EACCES','ENOSYS'].includes(error.code))throw error;symlinkCheck='unavailable on this platform';}
  console.log('PASS positive V5 staging: exact Docker/build/runtime closure, local module/CJS dependencies, generated outputs omitted, referenced assets and license retained, one seed, nested env/DB/log/profile/unused traps excluded, manifest SHA/size verified, overwrite/inside-source/unsafe/missing inputs refused; no env, dist or installed dependencies required. Symlink boundary: '+symlinkCheck+'.');
} finally {rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
