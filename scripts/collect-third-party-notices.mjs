import {readFileSync, readdirSync, existsSync, writeFileSync, lstatSync} from 'node:fs';
import {resolve, dirname, relative, sep, isAbsolute, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const escapeHtml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sha256 = text => createHash('sha256').update(text).digest('hex');
const licenceName = /(?:^|[._-])(?:licen[cs]e|notice|copying|copyright|authors)(?:$|[._-])/i;
export const THIRD_PARTY_NOTICE_BANNER = '/*! Third-party licences and copyright notices: /third-party-notices.html */\n';
export const THIRD_PARTY_BUNDLES = new Set(['pdfjs.js', 'pdfjs-worker.mjs', 'konva.js', 'exceljs.js', 'papaparse.js', 'tabulator.js', 'tabulator.css', 'tesseract.js', 'tesseract-worker.js', 'tesseract-core-lstm.wasm.js', 'stock-zxing.js', 'roofing-metre.js']);
export const BROWSER_DISTRIBUTIONS = [
  'node_modules/pdfjs-dist/build/pdf.mjs',
  'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  'node_modules/konva/konva.min.js',
  'node_modules/exceljs/dist/exceljs.min.js',
  'node_modules/papaparse/papaparse.min.js',
  'node_modules/tabulator-tables/dist/js/tabulator.min.js',
  'node_modules/tabulator-tables/dist/css/tabulator.min.css',
  'node_modules/tesseract.js/dist/tesseract.min.js',
  'node_modules/tesseract.js/dist/worker.min.js',
  'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'node_modules/@zxing/library/esm/core/BarcodeFormat.js',
  'node_modules/@zxing/library/esm/core/DecodeHintType.js',
  'node_modules/@zxing/browser/esm/readers/BrowserMultiFormatReader.js',
];
const vendoredFiles = ['scripts/roofing-metre/vendor/LICENCE.md', 'scripts/roofing-metre/vendor/big.cjs'];
const browserPackages = ['pdfjs-dist', 'konva', 'exceljs', 'papaparse', 'tabulator-tables', 'tesseract.js', 'tesseract.js-core', '@tesseract.js-data/fra', '@zxing/browser', '@zxing/library'];

// Licence text is read verbatim, never reconstructed from package.json. The
// installed lockfile is a conservative superset: it includes build tools and
// platform-specific optional packages present on this build machine.
export function collectThirdPartyNotices({root=repository, distributions=BROWSER_DISTRIBUTIONS, vendored=vendoredFiles, requiredPackages=browserPackages}={}) {
  root=resolve(root);
  const lock=JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  if(!lock.packages||lock.lockfileVersion<2)throw Error('Notices require a package lock with an explicit packages map');
  const records=[], packages=[], installedPaths=new Set();
  function absolute(path) {
    const full=resolve(root, path), rel=relative(root, full);
    if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep)||path.includes('\\'))throw Error('Unsafe attribution path: '+path);
    return full;
  }
  function text(path) {
    const full=absolute(path);
    if(lstatSync(full).isSymbolicLink())throw Error('Attribution files must not be symbolic links: '+path);
    return readFileSync(full, 'utf8');
  }
  function add(path, content, kind='licence') {records.push({path,kind,text:content,sha256:sha256(content)});}
  function scan(directory) {
    const entries=readdirSync(absolute(directory), {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name, 'en'));
    for(const entry of entries){
      const path=directory+'/'+entry.name;
      if(entry.isFile()&&licenceName.test(entry.name))add(path,text(path));
      // Nested dependencies are inventoried by their own lockfile entry; do
      // not collect packages that npm left outside the selected lockfile.
      else if(entry.isDirectory()&&!['node_modules','.git'].includes(entry.name))scan(path);
    }
  }
  for(const [path, locked] of Object.entries(lock.packages).sort(([a],[b])=>a.localeCompare(b, 'en'))){
    if(!path)continue;
    if(!/^(?:node_modules\/)(?:[^/]+\/)*[^/]+$/.test(path)||path.split('/').some(part=>part==='..'||part==='.'||part.startsWith('.env')))throw Error('Invalid locked package path: '+path);
    const manifest=path+'/package.json';
    if(!existsSync(absolute(manifest))){if(locked.optional)continue;throw Error('Locked dependency is not installed: '+path);}
    const metadata=JSON.parse(text(manifest));
    if(!metadata.name||metadata.version!==locked.version)throw Error('Installed dependency differs from lockfile: '+path);
    installedPaths.add(path);
    const start=records.length;
    scan(path);
    if(records.length===start){
      for(const entry of readdirSync(absolute(path),{withFileTypes:true}))if(entry.isFile()&&/^readme(?:$|\.)/i.test(entry.name)){
        const source=text(path+'/'+entry.name);
        if(/licen[cs]e|copyright|permission is hereby granted|redistribution and use/i.test(source))add(path+'/'+entry.name,source,'readme-licence');
      }
    }
    // Keep authorship metadata distinct from licence text. Some data-only
    // packages publish no standalone licence; do not invent their copyright.
    const authorship={name:metadata.name,version:metadata.version,...('license' in metadata?{declaredLicense:metadata.license}:{}),...('author' in metadata?{author:metadata.author}:{}),...('contributors' in metadata?{contributors:metadata.contributors}:{})};
    packages.push({path,...authorship,licenceFiles:records.length-start});
  }
  for(const name of requiredPackages)if(!installedPaths.has('node_modules/'+name))throw Error('Required browser dependency is absent: '+name);
  for(const path of distributions){
    const owner=[...installedPaths].filter(prefix=>path.startsWith(prefix+'/')).sort((a,b)=>b.length-a.length)[0];
    if(!owner)throw Error('Distribution does not belong to an installed locked package: '+path);
    const source=text(path), comments=source.match(/\/\*[\s\S]*?\*\//g)||[];
    for(const [index,comment] of comments.entries())if(/copyright|licen[cs]e|@licstart|SPDX-/i.test(comment))add(path+'#comment-'+index,comment,'distribution-attribution');
  }
  for(const path of vendored){
    const source=text(path);
    if(licenceName.test(path.split('/').at(-1)))add(path,source,'vendored-licence');
    else for(const [index,comment] of (source.match(/\/\*[\s\S]*?\*\//g)||[]).entries())if(/copyright|licen[cs]e/i.test(comment))add(path+'#comment-'+index,comment,'vendored-attribution');
  }
  const sections=records.map(record=>'<section><h2>'+escapeHtml(record.path)+'</h2><p class="hash">SHA-256 '+record.sha256+'</p><pre>'+escapeHtml(record.text)+'</pre></section>').join('\n');
  const inventory=packages.map(pkg=>'<tr><td>'+escapeHtml(pkg.name+' '+pkg.version)+'</td><td>'+escapeHtml(pkg.path)+'</td><td><pre>'+escapeHtml(JSON.stringify({...('declaredLicense' in pkg?{declaredLicense:pkg.declaredLicense}:{}),...('author' in pkg?{author:pkg.author}:{}),...('contributors' in pkg?{contributors:pkg.contributors}:{})},null,2))+'</pre></td><td>'+pkg.licenceFiles+'</td></tr>').join('\n');
  const html='<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SOCLE · Licences et attributions</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#1c2530;background:#f4f5f6;max-width:1100px;margin:auto;padding:24px}h1,h2{line-height:1.25}h2{font-size:17px;overflow-wrap:anywhere}section{background:white;border:1px solid #c8cdd3;border-radius:8px;padding:20px;margin:18px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,monospace}table{border-collapse:collapse;width:100%;font-size:13px}td,th{text-align:left;vertical-align:top;border:1px solid #c8cdd3;padding:8px;overflow-wrap:anywhere}.hash{font-size:11px;overflow-wrap:anywhere}a{color:#12566a}</style></head><body><h1>Licences et attributions des composants tiers</h1><p>Textes reproduits intégralement depuis les fichiers des dépendances installées et verrouillées, et attributions présentes dans les distributions navigateur. Cet inventaire est volontairement plus large que le code exécuté : il inclut les dépendances transitives, les outils de compilation et les composants optionnels installés sur la plateforme de construction. Leur présence ici ne signifie pas que chacun est utilisé dans le navigateur.</p><p>Les déclarations de package.json sont indiquées séparément, sans remplacer ni réinterpréter les textes de licence. Les composants sans fichier de licence autonome restent identifiés dans l’inventaire.</p><p>Notices externes conservées : <a href="/tesseract.min.js.LICENSE.txt">Tesseract navigateur</a> · <a href="/worker.min.js.LICENSE.txt">Tesseract worker</a>.</p><p>'+packages.length+' paquets installés ; '+records.length+' textes et attributions. SHA-256 du verrou de dépendances : '+sha256(readFileSync(join(root,'package-lock.json')))+'.</p>'+sections+'<h2>Inventaire des paquets installés</h2><table><thead><tr><th>Composant</th><th>Chemin du paquet</th><th>Métadonnées déclarées</th><th>Textes trouvés</th></tr></thead><tbody>'+inventory+'</tbody></table></body></html>\n';
  return {html,records,packages};
}

export function writeThirdPartyNotices(options={}) {
  const root=resolve(options.root||repository),result=collectThirdPartyNotices({...options,root});
  writeFileSync(join(root,'web/third-party-notices.html'),result.html);
  return {packages:result.packages.length,texts:result.records.length,bytes:Buffer.byteLength(result.html)};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(process.argv.length!==2)throw Error('Usage: node scripts/collect-third-party-notices.mjs');console.log(JSON.stringify(writeThirdPartyNotices()));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
