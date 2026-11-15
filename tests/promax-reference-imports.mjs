import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash, webcrypto} from 'node:crypto';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {supplierPriceImports} from '../dist/server/supplier-price-imports.js';

globalThis.crypto ??= webcrypto;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'promax-reference');
const resultRoot = process.env.PROMAX_REFERENCE_RESULTS || path.resolve(root, '../Corrections/2026-10-24-INTEGRATION-PROMAX/retour-agent-tests');
const syncRoot = 'C:/Documents/ChatGPT/ouvrane/echanges-agents/SYNCHRO';
const expectedRuntime = 'c7556a0bd34c22dbe1bcf9e496e0f618aafb2521cf276c03aab4038b6edacd94';
const sourceModules = [
  'worker/supplier-price-imports.js',
  'dist/server/measurement-engine.js',
  'web/supplier-import-worker.js',
  'web/papaparse.js',
  'web/exceljs.js',
  'drizzle/0011_field_operations.sql',
  'drizzle/0040_stock_catalog_v2.sql',
  'drizzle/0054_supplier_price_imports.sql',
  'dist/server/index.js',
  'dist/server/supplier-price-imports.js'
];
let integrityFiles = [...sourceModules, 'tests/promax-reference-imports.mjs'];
const results = [];
let knownDefects = 0;
let unexpectedFailures = 0;
let initialHashes = null;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function fileHashes() {
  const entries = {};
  for (const rel of integrityFiles) {
    try { entries[rel] = sha256(await readFile(path.join(root, rel))); }
    catch { entries[rel] = null; }
  }
  return entries;
}

async function check(name, fn, {knownDefect = false} = {}) {
  try {
    const detail = await fn();
    results.push({name, status: 'PASS', ...(detail === undefined ? {} : {detail})});
    console.log(`PASS ${name}`);
  } catch (error) {
    const record = {name, status: 'FAIL', knownDefect, error: String(error?.message || error).slice(0, 1200)};
    results.push(record);
    if (knownDefect) knownDefects++;
    else unexpectedFailures++;
    console.error(`${knownDefect ? 'KNOWN DEFECT' : 'FAIL'} ${name}: ${error?.message || error}`);
  }
}

async function verifyStartGate() {
  const statePath = path.join(syncRoot, 'ETAT-INTEGRATEUR.json');
  let state;
  try { state = JSON.parse(await readFile(statePath, 'utf8')); }
  catch { return {unavailable: true, reason: 'état SYNCHRO absent sur cette machine : dossier d’échange de la mission du 2026-10-24'}; }
  const actual = sha256(await readFile(path.join(root, 'dist/server/index.js')));
  assert.equal(state.runtimeReady, true, 'runtimeReady doit être true avant le lot A');
  assert.equal(state.runtimeHash, expectedRuntime, 'l’empreinte annoncée doit être celle attendue au démarrage');
  assert.equal(actual, expectedRuntime, 'dist/server/index.js doit correspondre à l’empreinte annoncée');
  return {runtimeHash: actual, phase: state.phase};
}

const fixtureManifest = JSON.parse(await readFile(path.join(fixtureRoot, 'MANIFESTE.json'), 'utf8'));
integrityFiles = [...sourceModules, 'tests/promax-reference-imports.mjs', 'tests/fixtures/promax-reference/MANIFESTE.json', 'tests/fixtures/promax-reference/README.md', 'tests/fixtures/promax-reference/import-contract.csv', ...fixtureManifest.files.map(entry => `tests/fixtures/promax-reference/${entry.file}`)];
await check('fixtures D03 copiées sans altération', async () => {
  for (const entry of fixtureManifest.files) {
    const bytes = await readFile(path.join(fixtureRoot, entry.file));
    assert.equal(bytes.length, entry.bytes, `${entry.file}: taille différente`);
    assert.equal(sha256(bytes), entry.sha256, `${entry.file}: SHA-256 différent`);
  }
  const custom = await readFile(path.join(fixtureRoot, 'import-contract.csv'));
  assert.ok(custom.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), 'le fixture contrat doit avoir un BOM UTF-8');
  return {copiedFrom: 'D03/MANIFESTE.json', count: fixtureManifest.files.length, customFixture: 'import-contract.csv'};
});

let startGate;
await check('garde build stable avant essai', async () => {
  startGate = await verifyStartGate();
  if (startGate.unavailable) return startGate.reason;
  return startGate;
});
await check('empreintes des modules avant essai', async () => {
  initialHashes = await fileHashes();
  assert.equal(initialHashes['worker/supplier-price-imports.js'], initialHashes['dist/server/supplier-price-imports.js'], 'route source et route compilée doivent être alignées');
  return initialHashes;
});

// Execute the exact browser worker and the exact web bundles loaded by Ouvrane.
const workerSource = await readFile(path.join(root, 'web/supplier-import-worker.js'), 'utf8');
const webBundles = new Map([
  ['/papaparse.js', await readFile(path.join(root, 'web/papaparse.js'), 'utf8')],
  ['/exceljs.js', await readFile(path.join(root, 'web/exceljs.js'), 'utf8')]
]);
const workerContext = vm.createContext({
  console,
  TextDecoder,
  TextEncoder,
  Uint8Array,
  DataView,
  ArrayBuffer,
  setTimeout,
  clearTimeout,
  setImmediate,
  atob: value => Buffer.from(value, 'base64').toString('binary'),
  postMessage(value) { workerContext.lastMessage = value; }
});
workerContext.self = workerContext;
workerContext.importScripts = (...urls) => {
  for (const url of urls) {
    const bundle = webBundles.get(url);
    if (!bundle) throw Error(`importScripts inattendu: ${url}`);
    try { vm.runInContext(bundle, workerContext, {filename: url}); }
    catch (error) { throw Error(`${url}: ${error?.message || error}`); }
  }
};
vm.runInContext(workerSource, workerContext, {filename: 'web/supplier-import-worker.js'});
async function parseInProductWorker(filename, bytes) {
  workerContext.lastMessage = undefined;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await workerContext.self.onmessage({data: {filename, buffer}});
  return workerContext.lastMessage;
}

let contractFileBytes;
let contractParsed;
await check('worker CSV réel : BOM, guillemets, accents et texte de formule', async () => {
  const bytes = await readFile(path.join(fixtureRoot, 'fournisseur-valide.csv'));
  const parsed = await parseInProductWorker('fournisseur-valide.csv', bytes);
  assert.ok(parsed.sheets, JSON.stringify(parsed));
  assert.equal(parsed.sheets[0].rows[0][0], 'Référence');
  assert.equal(parsed.sheets[0].rows[1][0], '00123');
  assert.equal(parsed.sheets[0].rows[1][1], 'Vis, inox « façade »');
  const formulaLikeText = parsed.sheets[0].rows.find(row => String(row[0]) === '00345');
  assert.equal(formulaLikeText[1], '=HYPERLINK("https://invalid.example";"texte uniquement")');
  const grossRow = parsed.sheets[0].rows.find(row => String(row[0]) === '00234');
  assert.equal(grossRow[2], '121,00');
  assert.equal(grossRow[3], 'TTC', 'le worker conserve la base telle quelle, sans conversion fiscale');
  return {rows: parsed.sheets[0].rows.length - 1, formulaTextPreserved: true, TTCConverted: false};
});

await check('worker XLSX réel : texte 00123 et rejet de formule', async () => {
  const validBytes = await readFile(path.join(fixtureRoot, 'fournisseur-valide.xlsx'));
  const valid = await parseInProductWorker('fournisseur-valide.xlsx', validBytes);
  assert.ok(valid.sheets, JSON.stringify(valid));
  assert.equal(valid.sheets[0].rows[1][0], '00123');
  const errorBytes = await readFile(path.join(fixtureRoot, 'fournisseur-erreurs.xlsx'));
  const invalid = await parseInProductWorker('fournisseur-erreurs.xlsx', errorBytes);
  assert.match(invalid.error || '', /formules/i);
  return {reference00123: valid.sheets[0].rows[1][0], formulaStatus: invalid.error};
});

await check('worker rejette le volume au-delà de 2 000 lignes', async () => {
  const bytes = await readFile(path.join(fixtureRoot, 'fournisseur-10000.csv'));
  const parsed = await parseInProductWorker('fournisseur-10000.csv', bytes);
  assert.match(parsed.error || '', /maximum|grand/i);
  return {bytes: bytes.length, observed: parsed.error};
});

await check('worker refuse UTF-8 invalide', async () => {
  const parsed = await parseInProductWorker('invalid.csv', Buffer.from([0xff, 0xfe, 0xfd]));
  assert.ok(parsed.error && !parsed.sheets, 'des octets non UTF-8 ne doivent pas être interprétés comme un CSV valide');
  return parsed.error;
});

// D03 documents a numeric XLSX reference as unsafe because leading zeroes are lost.
await check('D03 : référence XLSX numérique refusée avant perte de zéros', async () => {
  const generated = await vm.runInContext(`(async()=>{
    const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Tarif');
    sheet.addRow(['Référence','Désignation','Unité','Prix HTVA','Conditionnement']);
    sheet.addRow([123,'Vis de test','pc',12.5,10]);sheet.getCell('A2').numFmt='00000';
    const bytes=await workbook.xlsx.writeBuffer();
    return {bytes:Array.from(new Uint8Array(bytes)),valueType:typeof sheet.getCell('A2').value,display:sheet.getCell('A2').text};
  })()`, workerContext);
  assert.equal(generated.valueType, 'number');
  const parsed = await parseInProductWorker('numeric-reference.xlsx', Buffer.from(generated.bytes));
  assert.ok(parsed.error, `le worker accepte la référence numérique ${JSON.stringify(parsed.sheets?.[0]?.rows?.[1]?.[0])}, alors que D03 attend son refus pour prévenir la perte du zéro initial.`);
  return {expected: 'refus de la cellule numérique', observed: parsed.error};
}, {knownDefect: true});

contractFileBytes = await readFile(path.join(fixtureRoot, 'import-contract.csv'));
contractParsed = await parseInProductWorker('import-contract.csv', contractFileBytes);
assert.ok(contractParsed.sheets, JSON.stringify(contractParsed));
assert.equal(contractParsed.sheets[0].rows[0][0], 'Référence');
assert.equal(contractParsed.sheets[0].rows[1][0], '00123');

const db = new DatabaseSync(':memory:');
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE organizations(id TEXT PRIMARY KEY);
CREATE TABLE profiles(id TEXT PRIMARY KEY);
INSERT INTO organizations VALUES('org-a'),('org-b');
INSERT INTO profiles VALUES('owner-a'),('owner-b');
CREATE TABLE field_stock_items(
  id TEXT NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id),
  reference TEXT, supplier_reference TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0, reserved REAL NOT NULL DEFAULT 0, unit TEXT NOT NULL,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0, minimum REAL NOT NULL DEFAULT 0,
  supplier TEXT, location TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL REFERENCES profiles(id),
  created_at TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES profiles(id), updated_at TEXT NOT NULL,
  archived_at TEXT, PRIMARY KEY(organization_id,id)
);
CREATE TABLE audit_events(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,detail_json TEXT NOT NULL);
INSERT INTO audit_events VALUES('audit-collision','org-a','seed','seed','seed','{}');`);
db.exec(await readFile(path.join(root, 'drizzle/0054_supplier_price_imports.sql'), 'utf8'));
const stockInsert = db.prepare(`INSERT INTO field_stock_items
  (id,organization_id,reference,supplier_reference,name,unit,created_by,created_at,updated_by,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?)`);
stockInsert.run('stock-123','org-a','STOCK-00123','00123','Vis inox','pc','owner-a','fixture','owner-a','fixture');
stockInsert.run('stock-ambig-1','org-a','AMBIG-1','AMBIG','Ambigu 1','pc','owner-a','fixture','owner-a','fixture');
stockInsert.run('stock-ambig-2','org-a','AMBIG-2','ambig','Ambigu 2','pc','owner-a','fixture','owner-a','fixture');
stockInsert.run('stock-unit','org-a','BADUNIT','BADUNIT','Unité différente','m2','owner-a','fixture','owner-a','fixture');

let failAudit = false;
const env = {DB: {prepare(sql) {
  return {bind(...values) {return {
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({results: db.prepare(sql).all(...values)}),
    run: () => db.prepare(sql).run(...values)
  };}};
}}};
const syntheticPermissions = new Map([
  ['org-a', new Set(['purchase_orders.manage','stock.view','quote.price.read'])],
  ['org-b', new Set(['purchase_orders.manage','stock.view','quote.price.read'])]
]);
const helpers = {
  body: request => request.json(),
  json: (data, status = 200) => Response.json(data, {status}),
  requirePermission: async (_env, ctx, permission) => {
    if (!syntheticPermissions.get(ctx.organizationId)?.has(permission)) throw Object.assign(Error('permission denied'), {status: 403});
  },
  requireQuotePriceRead: async (_env, ctx) => {
    if (!syntheticPermissions.get(ctx.organizationId)?.has('quote.price.read')) throw Object.assign(Error('price read denied'), {status: 403});
  },
  organizationWorkspaceState: async (_env, organizationId) => ({contacts: organizationId === 'org-a' ? [
    {id: 'supplier-a', company: 'Fournisseur fictif A', roles: ['Fournisseur']}
  ] : [{id: 'supplier-b', company: 'Fournisseur fictif B', roles: ['Fournisseur']}]}),
  ensureLegacyFieldDataImported: async () => {},
  auditStatement: (_env, ctx, action, entityType, entityId, detail) => failAudit
    ? env.DB.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?)').bind('audit-collision',ctx.organizationId,action,entityType,entityId,JSON.stringify(detail))
    : env.DB.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?)').bind(`audit-${entityId}`,ctx.organizationId,action,entityType,entityId,JSON.stringify(detail)),
  dbBatch: async (_env, statements) => {
    db.exec('BEGIN IMMEDIATE');
    try { for (const statement of statements) statement.run(); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
};
const authorized = {organizationId: 'org-a', uid: 'owner-a', preview: false};
function urlFor(id, action) {
  const suffix = id ? `/${encodeURIComponent(id)}${action === 'original' ? '/original' : ''}` : action ? `/${action}` : '';
  return new URL(`https://ouvrane-test.invalid/api/supplier-price-imports${suffix}`);
}
async function invoke({ctx = authorized, method = 'POST', action = 'preview', importId = null, data = null}) {
  const url = urlFor(importId, action);
  const request = new Request(url, {
    method,
    ...(data === null ? {} : {headers: {'content-type': 'application/json'}, body: JSON.stringify(data)})
  });
  try {
    const response = await supplierPriceImports(request, url, env, ctx, importId, action, helpers);
    if (action === 'original') return {status: response.status, bytes: new Uint8Array(await response.arrayBuffer())};
    let body = null;
    try { body = await response.json(); } catch {}
    return {status: response.status, body};
  } catch (error) {
    return {status: error.status || 500, body: {error: error.message}, thrown: true};
  }
}
function importPayload({rows, bytes = contractFileBytes, validFrom = '2026-10-24', supplierId = 'supplier-a', filename = 'import-contract.csv', mapping = {sheet: 'CSV', columns: {reference: 0, name: 1, unit: 2, price: 3, packageSize: 4}}, currency = 'EUR', priceBasis = 'unit-ex-vat'} = {}) {
  return {supplierId, validFrom, filename, originalBase64: Buffer.from(bytes).toString('base64'), currency, priceBasis, mapping, rows};
}
const contractRows = contractParsed.sheets[0].rows.slice(1).filter(row => row.some(value => String(value ?? '').trim())).map(row => ({
  reference: String(row[0]), name: String(row[1]), unit: String(row[2]), price: String(row[3]), packageSize: String(row[4])
}));

let initialPreview;
await check('route Ouvrane : aperçu HTVA/unité, référence texte, conditionnement distinct, aucune écriture', async () => {
  const payload = importPayload({rows: contractRows});
  initialPreview = await invoke({action: 'preview', data: payload});
  assert.equal(initialPreview.status, 200, JSON.stringify(initialPreview.body));
  assert.equal(initialPreview.body.rows[0].reference, '00123');
  assert.equal(initialPreview.body.rows[0].price, '12.50');
  assert.equal(initialPreview.body.rows[0].packageSize, '10');
  assert.equal(initialPreview.body.rows[0].priceBasis, 'unit-ex-vat');
  assert.equal(initialPreview.body.rows[0].stockItemId, 'stock-123');
  assert.equal(initialPreview.body.matched, 1);
  assert.equal(initialPreview.body.unmatched, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM supplier_price_imports').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events WHERE action=\'supplier_prices.imported\'').get().n, 0);
  return {matched: initialPreview.body.matched, unmatched: initialPreview.body.unmatched, previewOnly: true};
});

await check('route refuse les bases et devises hors contrat sans conversion implicite', async () => {
  const payload = importPayload({rows: contractRows});
  assert.equal((await invoke({action: 'preview', data: {...payload, currency: 'USD'}})).status, 400);
  assert.equal((await invoke({action: 'preview', data: {...payload, priceBasis: 'unit-including-vat'}})).status, 400);
  assert.equal((await invoke({action: 'preview', data: {...payload, validFrom: '01/02/2026'}})).status, 400);
  return 'USD, TTC et date ambiguë refusés';
});

await check('route valide prix, doublons normalisés, unités et références ambiguës', async () => {
  const payload = importPayload({rows: contractRows});
  assert.equal((await invoke({action: 'preview', data: {...payload, rows: [{...contractRows[0], price: '-2'}]}})).status, 400);
  assert.equal((await invoke({action: 'preview', data: {...payload, rows: [{...contractRows[0], price: '1,123456'}]}})).status, 400);
  assert.equal((await invoke({action: 'preview', data: {...payload, rows: [{...contractRows[0], reference: 'ambig'}]}})).status, 400);
  assert.equal((await invoke({action: 'preview', data: {...payload, rows: [{...contractRows[0], reference: 'BADUNIT', unit: 'pc'}]}})).status, 400);
  assert.equal((await invoke({action: 'preview', data: {...payload, rows: [
    {...contractRows[0], reference: 'Ref-A'}, {...contractRows[0], reference: 'ref-a'}
  ]}})).status, 400);
  return 'négatif, précision >5 décimales, référence ambiguë, unité incompatible et doublon de casse refusés';
});

let firstImportId;
const firstKey = 'promax-reference-import-0001';
const firstCommit = async (overrides = {}) => invoke({action: 'commit', data: {
  ...importPayload({rows: contractRows}), previewSignature: initialPreview.body.previewSignature, operationKey: firstKey, ...overrides
}});
await check('route refuse aperçu altéré ou source changée après aperçu', async () => {
  assert.equal((await firstCommit({previewSignature: '0'.repeat(64)})).status, 409);
  assert.equal((await firstCommit({originalBase64: Buffer.from('source modifiée').toString('base64')})).status, 409);
  assert.equal((await firstCommit({rows: [{...contractRows[0], price: '13.00'}, contractRows[1]]})).status, 409);
  return 'signature, octets origine et lignes liées à l’aperçu contrôlés';
});

await check('route commit atomique, idempotence, historique immuable et original exact', async () => {
  const committed = await firstCommit();
  assert.equal(committed.status, 201, JSON.stringify(committed.body));
  firstImportId = committed.body.id;
  assert.equal(committed.body.version, 1);
  const replay = await firstCommit();
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM supplier_price_imports').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events WHERE action=\'supplier_prices.imported\'').get().n, 1);
  const stored = await invoke({method: 'GET', action: '', importId: firstImportId});
  assert.equal(stored.status, 200);
  assert.equal(stored.body.import.rows[0].reference, '00123');
  assert.equal(stored.body.import.rows[0].price, '12.50');
  assert.equal(stored.body.import.rows[0].packageSize, '10');
  assert.equal(stored.body.import.rows[1].stockItemId, null, 'article sans correspondance conservé, sans création automatique');
  const original = await invoke({method: 'GET', action: 'original', importId: firstImportId});
  assert.equal(original.status, 200);
  assert.deepEqual(Buffer.from(original.bytes), contractFileBytes);
  assert.throws(() => db.prepare("UPDATE supplier_price_imports SET rows_json='{}' WHERE id=?").run(firstImportId), /supplier_price_import_immutable/);
  const conflictRows = [{...contractRows[0], price: '13.00'}, contractRows[1]];
  const conflictPreview = await invoke({action: 'preview', data: importPayload({rows: conflictRows})});
  assert.equal(conflictPreview.status, 200);
  const conflict = await invoke({action: 'commit', data: {...importPayload({rows: conflictRows}), previewSignature: conflictPreview.body.previewSignature, operationKey: firstKey}});
  assert.equal(conflict.status, 409, 'une clé d’opération ne peut pas désigner un autre import');
  return {id: firstImportId, version: 1, replayed: true, originalSha256: sha256(original.bytes)};
});

await check('route journalise version 2 sans muter version 1', async () => {
  const payload = importPayload({rows: [{...contractRows[0], price: '13,00'}, contractRows[1],], validFrom: '2026-11-01'});
  const preview = await invoke({action: 'preview', data: payload});
  assert.equal(preview.status, 200);
  const committed = await invoke({action: 'commit', data: {...payload, previewSignature: preview.body.previewSignature, operationKey: 'promax-reference-import-0002'}});
  assert.equal(committed.status, 201, JSON.stringify(committed.body));
  assert.equal(committed.body.version, 2);
  const v1 = JSON.parse(db.prepare('SELECT rows_json FROM supplier_price_imports WHERE organization_id=? AND id=?').get('org-a', firstImportId).rows_json);
  const v2 = JSON.parse(db.prepare('SELECT rows_json FROM supplier_price_imports WHERE organization_id=? AND id=?').get('org-a', committed.body.id).rows_json);
  assert.equal(v1[0].price, '12.50');
  assert.equal(v2[0].price, '13.00');
  return {versions: [v1[0].price, v2[0].price]};
});

await check('route limite à 2 000 lignes et 2 Mo', async () => {
  const rows2000 = Array.from({length: 2000}, (_, i) => ({reference: `R${String(i).padStart(5, '0')}`, name: 'Article synthétique', unit: 'pc', price: '1,00', packageSize: '1'}));
  const base = importPayload({rows: rows2000, bytes: Buffer.from('limite\n')});
  assert.equal((await invoke({action: 'preview', data: base})).status, 200);
  assert.equal((await invoke({action: 'preview', data: {...base, rows: [...rows2000, {reference: 'R2000', name: 'Article synthétique', unit: 'pc', price: '1', packageSize: '1'}]}})).status, 400);
  const oversize = Buffer.alloc(2_000_001, 0x61);
  assert.equal((await invoke({action: 'preview', data: importPayload({rows: contractRows, bytes: oversize})})).status, 400);
  return {rows2000: 'accepté', rows2001: 'refusé', bytes2000001: 'refusés'};
});

await check('isolation organisation et permissions contrôlées dans le handler', async () => {
  assert.equal((await invoke({method: 'GET', action: '', importId: firstImportId, ctx: {organizationId: 'org-b', uid: 'owner-b', preview: false}})).status, 404);
  assert.equal((await invoke({method: 'GET', action: 'original', importId: firstImportId, ctx: {organizationId: 'org-b', uid: 'owner-b', preview: false}})).status, 404);
  const noPurchase = await invoke({ctx: {...authorized, organizationId: 'org-a'}, data: importPayload({rows: contractRows}), action: 'preview'});
  // The route must request purchase and stock permissions in order; simulate an account missing the first.
  syntheticPermissions.set('org-a', new Set(['stock.view','quote.price.read']));
  const deniedPurchase = await invoke({ctx: authorized, data: importPayload({rows: contractRows}), action: 'preview'});
  syntheticPermissions.set('org-a', new Set(['purchase_orders.manage','quote.price.read']));
  const deniedStock = await invoke({ctx: authorized, data: importPayload({rows: contractRows}), action: 'preview'});
  syntheticPermissions.set('org-a', new Set(['purchase_orders.manage','stock.view']));
  const deniedPrice = await invoke({ctx: authorized, data: importPayload({rows: contractRows}), action: 'preview'});
  syntheticPermissions.set('org-a', new Set(['purchase_orders.manage','stock.view','quote.price.read']));
  assert.equal(noPurchase.status, 200, 'contrôle nominal rétabli pour le fixture autorisé');
  assert.equal(deniedPurchase.status, 403);
  assert.equal(deniedStock.status, 403);
  assert.equal(deniedPrice.status, 403);
  return '404 cross-organisation ; 403 purchase_orders.manage, stock.view et quote price read';
});

await check('batch de commit est atomique si la journalisation échoue', async () => {
  const payload = importPayload({rows: contractRows, validFrom: '2026-12-01'});
  const preview = await invoke({action: 'preview', data: payload});
  assert.equal(preview.status, 200);
  const before = db.prepare('SELECT COUNT(*) AS n FROM supplier_price_imports').get().n;
  failAudit = true;
  let failed;
  try {
    failed = await invoke({action: 'commit', data: {...payload, previewSignature: preview.body.previewSignature, operationKey: 'promax-reference-atomic-0003'}});
  } finally { failAudit = false; }
  assert.equal(failed.status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM supplier_price_imports').get().n, before, 'l’import ne doit pas rester sans journal d’audit');
  return 'rollback de l’insert fournisseur quand la seconde écriture échoue';
});

assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
db.close();

const endGate = await verifyStartGate().catch(error => ({error: String(error?.stack || error)}));
const finalHashes = await fileHashes();
const state = await readFile(path.join(syncRoot, 'ETAT-INTEGRATEUR.json'), 'utf8').then(JSON.parse).catch(() => null);
const modulesStable = Boolean(initialHashes) && integrityFiles.every(rel => initialHashes[rel] === finalHashes[rel]);
const stableAtEnd = !endGate.error && !endGate.unavailable && state && state.runtimeReady === true && state.runtimeHash === expectedRuntime && endGate.runtimeHash === expectedRuntime && modulesStable;
const report = {
  mission: '04 / lot A imports fournisseurs',
  generatedAt: new Date().toISOString(),
  authority: 'authorized by Louis in current conversation',
  environment: {node: process.version, database: 'node:sqlite in-memory', browserAssets: 'Ouvrane web worker and web bundles', runtimeReady: state ? state.runtimeReady : null, runtimeHash: state ? state.runtimeHash : null, runtimeHashVerified: stableAtEnd, synchroState: state ? 'disponible' : 'indisponible hors machine de mission'},
  initialGate: startGate || null,
  finalGate: endGate,
  sourceHashesAtStart: initialHashes,
  sourceHashesAtEnd: finalHashes,
  cases: results,
  summary: {passed: results.filter(x => x.status === 'PASS').length, failed: results.filter(x => x.status === 'FAIL').length, knownDefects, unexpectedFailures, modulesStable, stableAtEnd}
};
await mkdir(resultRoot, {recursive: true});
const serialized = JSON.stringify(report, null, 2) + '\n';
const replayName = `lot-A-imports-rejeu-${report.generatedAt.replace(/[:.]/g, '-')}.json`;
await writeFile(path.join(resultRoot, replayName), serialized, 'utf8');
await writeFile(path.join(resultRoot, 'lot-A-imports-resultats.json'), serialized, 'utf8');
console.log(`RESULT ${JSON.stringify(report.summary)}`);
console.log(`REPLAY ${path.join(resultRoot, replayName)}`);
console.log(`EVIDENCE ${path.join(resultRoot, 'lot-A-imports-resultats.json')}`);
if (!modulesStable) {
  console.error('INCONCLUSIF : l’empreinte des modules sources a changé pendant les essais.');
  process.exitCode = 2;
} else {
  if (!stableAtEnd) console.error('NOTE : état SYNCHRO indisponible ou empreinte runtime historique non applicable — garde de mission non concluante hors machine de mission.');
  if (unexpectedFailures || knownDefects) process.exitCode = 1;
}
