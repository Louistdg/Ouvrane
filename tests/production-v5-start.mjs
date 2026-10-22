import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {existsSync, mkdtempSync, readFileSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join, dirname, relative, isAbsolute, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync, backup} from 'node:sqlite';
import {openProductionDatabase} from '../scripts/production-db.mjs';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'socle-v5-start-'));
const temporaryRelative = relative(root, temporary);
assert.ok(isAbsolute(temporaryRelative) || temporaryRelative === '..' || temporaryRelative.startsWith('..' + sep), 'Production qualification must stay outside the source tree');
const portableNode = process.platform === 'win32'
  ? 'D:\\socle V5\\08-OUTILS\\node22\\node-v22.23.3-win-x64\\node.exe'
  : '/mnt/d/socle V5/08-OUTILS/node22/node-v22.23.3-win-x64/node.exe';
const node22 = process.env.SOCLE_NODE22_EXE || (process.versions.node.startsWith('22.') ? process.execPath : portableNode);
const version = spawnSync(node22, ['--version'], {encoding: 'utf8'});
assert.equal(version.status, 0, 'An executable official Node 22 is required');
assert.match(version.stdout.trim(), /^v22\./, 'Production subprocesses must use the target major version');
assert.ok(existsSync(join(root, 'scripts/v5-start.mjs')), 'V5 startup script must be implemented before running this check');
assert.ok(existsSync(join(root, 'dist/server/index.js')), 'Use an already built worker; this test never builds the shared tree');
const seed = join(root, 'scripts/seed-batinova.sqlite');
const seedHash = createHash('sha256').update(readFileSync(seed)).digest('hex');
const candidate = join(root, 'data/socle.sqlite');
const candidateHash = createHash('sha256').update(readFileSync(candidate)).digest('hex');
const sessionSecret = randomBytes(32).toString('base64url');
const origin = 'https://v5-bootstrap.qa.invalid';
const email = 'first-owner@v5-qualification.invalid';
const password = randomBytes(24).toString('base64url');
const replacementPassword = randomBytes(24).toString('base64url');
const children = new Set();
const sensitive = [sessionSecret, password, replacementPassword, email];

function readDatabase(path, callback) {
  const database = new DatabaseSync(path, {readOnly: true});
  try { return callback(database); } finally { database.close(); }
}
async function seedCopy(name, modify) {
  const path = join(temporary, name + '.sqlite');
  const source = new DatabaseSync(seed, {readOnly: true});
  try { await backup(source, path); } finally { source.close(); }
  if (modify) { const database = new DatabaseSync(path); try { modify(database); } finally { database.close(); } }
  return path;
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function launch(name, variables = {}, volumeOverride) {
  const volume = volumeOverride || join(temporary, name);
  mkdirSync(volume, {recursive: true});
  const port = await freePort();
  const env = {...process.env};
  for (const key of Object.keys(env)) if (key.startsWith('SOCLE_') || key.startsWith('RAILWAY_') || ['LOCAL_TEST_MODE', 'DATABASE_URL', 'WEB_CONCURRENCY'].includes(key)) delete env[key];
  Object.assign(env, {NODE_ENV: 'production', PORT: String(port), SOCLE_PUBLIC_URL: origin, SOCLE_DATA_DIR: volume, SOCLE_SESSION_SECRET: sessionSecret, SOCLE_BACKUP_DIRECTORY: join(volume, 'backups'), ...variables});
  const child = spawn(node22, [join(root, 'scripts/v5-start.mjs')], {cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  const result = {child, port, volume, databasePath: join(volume, 'socle.sqlite'), stdout: '', stderr: '', exit: null};
  children.add(child);
  child.stdout.on('data', bytes => {result.stdout = (result.stdout + bytes.toString()).slice(-32000);});
  child.stderr.on('data', bytes => {result.stderr = (result.stderr + bytes.toString()).slice(-32000);});
  result.closed = new Promise((resolve, reject) => {child.once('error', reject); child.once('close', (code, signal) => {result.exit = {code, signal}; children.delete(child); resolve(result.exit);});});
  return result;
}
async function stop(result) {
  if (result.exit) return;
  result.child.kill('SIGTERM');
  await Promise.race([result.closed, new Promise((_, reject) => setTimeout(() => reject(Error('Startup subprocess did not stop')), 10000).unref())]);
}
function privateLogs(result) {
  const logs = result.stdout + result.stderr;
  for (const value of sensitive) assert.equal(logs.includes(value), false, 'Startup logs must not disclose credentials, owner email or session secret');
}
async function expectFailure(name, variables, messagePattern = /V5|seed|patron|propri[eé]taire|owner|initial|amor[cç]|credential|ambigu/i) {
  const result = await launch(name, variables);
  let timedOut = false;
  await Promise.race([result.closed, new Promise(resolve => setTimeout(() => {timedOut = true; resolve();}, 20000).unref())]);
  if (timedOut) await stop(result);
  assert.equal(timedOut, false, 'Invalid first startup must fail before opening a long-running server');
  assert.notEqual(result.exit.code, 0, 'Invalid first startup must exit unsuccessfully');
  privateLogs(result);
  assert.match(result.stdout + result.stderr, messagePattern, 'Failure must explain the startup configuration problem');
  assert.equal(existsSync(result.databasePath + '.v5-provisioned'), false, 'Rejected provisioning must not leave a success marker');
  if (existsSync(result.databasePath)) readDatabase(result.databasePath, db => {
    const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='production_credentials'").get();
    if (has) assert.equal(db.prepare('SELECT COUNT(*) n FROM production_credentials').get().n, 0, 'Rejected first startup must not create a credential');
  });
  return result;
}
async function ready(result) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (result.exit) throw Error('Valid V5 startup exited before becoming healthy');
    try { const response = await fetch('http://127.0.0.1:' + result.port + '/health', {signal: AbortSignal.timeout(1500)}); if (response.status === 200) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('Valid V5 startup did not become healthy');
}
const request = (result, path, options = {}) => fetch('http://127.0.0.1:' + result.port + path, {redirect: 'manual', ...options, headers: {origin, ...(options.headers || {})}, signal: AbortSignal.timeout(10000)});
const login = (result, passwordValue) => request(result, '/auth/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({email, password: passwordValue})});

async function expectRecoveryRefusal(name, source) {
  const credentials = path => readDatabase(path, db => db.prepare('SELECT * FROM production_credentials ORDER BY user_id').all());
  const before = JSON.stringify(credentials(source));
  const result = await launch(name, {SOCLE_V5_SEED_PATH: source, SOCLE_V5_OWNER_EMAIL: email, SOCLE_V5_OWNER_PASSWORD: replacementPassword});
  const deadline = Date.now() + 20000;
  while (!result.exit && Date.now() < deadline) {
    let healthy = false;
    try { healthy = (await fetch('http://127.0.0.1:' + result.port + '/health', {signal: AbortSignal.timeout(1000)})).status === 200; } catch {}
    if (healthy) { await stop(result); break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!result.exit) await stop(result);
  privateLogs(result);
  assert.equal(JSON.stringify(credentials(result.databasePath)) === before, true, 'Restoring without an eligible owner must preserve every existing password hash, disabled state and credential field');
  assert.notEqual(result.exit.code, 0, 'Existing credentials without an eligible owner require explicit recovery, even without the marker');
  assert.match(result.stdout + result.stderr, /explicit recovery/i, 'Refusal explains the recovery requirement without exposing account data');
  assert.equal(existsSync(result.databasePath + '.v5-provisioned'), false, 'Recovery refusal never writes a provisioning marker');
}

try {
  await expectFailure('missing-seed', {SOCLE_V5_SEED_PATH: join(temporary, 'does-not-exist.sqlite'), SOCLE_V5_OWNER_EMAIL: email, SOCLE_V5_OWNER_PASSWORD: password});
  await expectFailure('missing-owner-credentials', {SOCLE_V5_SEED_PATH: seed});
  await expectFailure('partial-email', {SOCLE_V5_SEED_PATH: seed, SOCLE_V5_OWNER_EMAIL: email});
  await expectFailure('partial-password', {SOCLE_V5_SEED_PATH: seed, SOCLE_V5_OWNER_PASSWORD: password});
  await expectFailure('no-silent-v4-fallback', {SOCLE_V5_SEED_PATH: seed, SOCLE_V4_OWNER_EMAIL: email, SOCLE_V4_OWNER_PASSWORD: password});

  const emptySeed = join(temporary, 'empty-seed.sqlite');
  const empty = openProductionDatabase({databasePath: emptySeed, migrationsDirectory: join(root, 'drizzle')});
  empty.close();
  await expectFailure('seed-without-owner', {SOCLE_V5_SEED_PATH: emptySeed, SOCLE_V5_OWNER_EMAIL: email, SOCLE_V5_OWNER_PASSWORD: password});

  const initial = await launch('valid-owner', {SOCLE_V5_SEED_PATH: seed, SOCLE_V5_OWNER_EMAIL: email, SOCLE_V5_OWNER_PASSWORD: password});
  await ready(initial);
  assert.equal((await request(initial, '/api/state')).status, 401);
  assert.equal((await request(initial, '/__local-test/login')).status, 404, 'Production cannot expose local-test impersonation');
  const firstLogin = await login(initial, password);
  assert.equal(firstLogin.status, 200, 'The newly provisioned owner must actually authenticate');
  const cookie = firstLogin.headers.get('set-cookie');
  assert.ok(cookie?.includes('HttpOnly') && cookie.includes('Secure') && cookie.includes('SameSite=Lax'));
  assert.equal((await request(initial, '/api/state', {headers: {cookie}})).status, 200, 'Production session grants the real owner workspace');
  const initialOwner = readDatabase(initial.databasePath, db => {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM local_test_sessions').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM local_test_identities').get().n, 0);
    const row = db.prepare('SELECT user_id,password_hash FROM production_credentials WHERE email=? AND disabled_at IS NULL').get(email);
    assert.ok(row); return row;
  });
  const markerPath = initial.databasePath + '.v5-provisioned';
  assert.ok(existsSync(markerPath), 'Successful V5 provisioning has its own persistent marker');
  const marker = readFileSync(markerPath, 'utf8');
  await stop(initial); privateLogs(initial);

  const restarted = await launch('valid-owner-restart', {SOCLE_V5_SEED_PATH: seed, SOCLE_V5_OWNER_EMAIL: email, SOCLE_V5_OWNER_PASSWORD: replacementPassword}, initial.volume);
  await ready(restarted);
  assert.equal((await login(restarted, password)).status, 200, 'Restart preserves the existing password');
  assert.equal((await login(restarted, replacementPassword)).status, 401, 'Changed bootstrap environment cannot silently reset an established password');
  readDatabase(restarted.databasePath, db => assert.equal(db.prepare('SELECT password_hash FROM production_credentials WHERE user_id=?').get(initialOwner.user_id).password_hash, initialOwner.password_hash));
  assert.equal(readFileSync(markerPath, 'utf8'), marker, 'Normal restart does not rewrite the provisioning marker');
  await stop(restarted); privateLogs(restarted);

  rmSync(markerPath);
  const restored = await launch('restored-without-marker', {SOCLE_V5_SEED_PATH: join(temporary, 'missing-on-restore.sqlite')}, initial.volume);
  await ready(restored);
  assert.equal((await login(restored, password)).status, 200, 'A restored eligible credential remains usable without bootstrap variables or the old seed');
  assert.ok(existsSync(markerPath), 'An eligible restored database gets an adoption marker');
  await stop(restored); privateLogs(restored);

  const disabledOwnerSeed = await seedCopy('restore-disabled-owner', db => {
    db.exec('DELETE FROM local_test_sessions;DELETE FROM local_test_identities;');
    db.prepare('UPDATE profiles SET email=? WHERE id=?').run(email, initialOwner.user_id);
    db.prepare('INSERT INTO production_credentials(user_id,email,password_hash,disabled_at,failed_attempts,locked_until,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(initialOwner.user_id, email, initialOwner.password_hash, '2026-10-20T10:00:00Z', 4, 123456, '2026-10-19T08:00:00Z', '2026-10-20T10:00:00Z');
  });
  await expectRecoveryRefusal('restore-disabled-owner-no-marker', disabledOwnerSeed);

  const workerCredentialSeed = await seedCopy('restore-worker-credential', db => {
    const role = db.prepare("SELECT id,organization_id FROM roles WHERE code='WORKER' LIMIT 1").get(), userId = 'qa-restored-worker';
    const workerEmail = 'restored-worker@v5-qualification.invalid', stamp = '2026-10-20T10:00:00Z';
    sensitive.push(workerEmail);
    db.prepare('INSERT INTO profiles(id,first_name,last_name,email,created_at,updated_at,identity_kind) VALUES(?,?,?,?,?,?,?)').run(userId, 'QA', 'Restored worker', workerEmail, stamp, stamp, 'account');
    db.prepare('INSERT INTO organization_members(id,organization_id,user_id,role_id,status,joined_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('qa-restored-worker-member', role.organization_id, userId, role.id, 'active', stamp, stamp, stamp);
    db.prepare('INSERT INTO production_credentials(user_id,email,password_hash,created_at,updated_at) VALUES(?,?,?,?,?)').run(userId, workerEmail, initialOwner.password_hash, stamp, stamp);
  });
  await expectRecoveryRefusal('restore-worker-without-owner-no-marker', workerCredentialSeed);

  const secondOwnerId = 'qa-owner-' + randomUUID();
  const ambiguousSeed = await seedCopy('ambiguous-owners', db => {
    const role = db.prepare("SELECT r.id,r.organization_id FROM roles r WHERE r.code='OWNER' LIMIT 1").get();
    const stamp = new Date().toISOString();
    db.prepare('INSERT INTO profiles(id,first_name,last_name,email,created_at,updated_at,identity_kind) VALUES(?,?,?,?,?,?,?)').run(secondOwnerId, 'QA', 'Second owner', 'second-owner@v5-qualification.invalid', stamp, stamp, 'account');
    db.prepare('INSERT INTO organization_members(id,organization_id,user_id,role_id,status,joined_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('qa-member-' + randomUUID(), role.organization_id, secondOwnerId, role.id, 'active', stamp, stamp, stamp);
  });
  const ambiguous = await expectFailure('ambiguous-owner', {SOCLE_V5_SEED_PATH: ambiguousSeed, SOCLE_V5_OWNER_EMAIL: email, SOCLE_V5_OWNER_PASSWORD: password}, /ambigu|plusieurs|multiple|OWNER_USER_ID/i);
  const selected = await launch('explicit-owner', {SOCLE_V5_SEED_PATH: ambiguousSeed, SOCLE_V5_OWNER_EMAIL: email, SOCLE_V5_OWNER_PASSWORD: password, SOCLE_V5_OWNER_USER_ID: secondOwnerId}, ambiguous.volume);
  await ready(selected);
  assert.equal((await login(selected, password)).status, 200);
  readDatabase(selected.databasePath, db => assert.equal(db.prepare('SELECT user_id FROM production_credentials WHERE email=?').get(email).user_id, secondOwnerId, 'Explicit OWNER selection chooses the requested active profile'));
  await stop(selected); privateLogs(selected);

  assert.equal(createHash('sha256').update(readFileSync(seed)).digest('hex'), seedHash, 'Embedded source seed stays unchanged');
  assert.equal(createHash('sha256').update(readFileSync(candidate)).digest('hex'), candidateHash, 'Candidate database stays unchanged');
  console.log('PASS V5 startup on Node22: missing seed/owner/partial credentials and ambiguous owner fail fast; no V4 fallback; explicit active OWNER selection; local identities and sessions purged; actual production login/session; private logs; own V5 marker; restart preserves credentials; restored eligible database is adopted without reset; disabled owner and worker-only restores require explicit recovery with all credentials unchanged; original seed/candidate unchanged.');
} finally {
  for (const child of children) child.kill('SIGTERM');
  await Promise.allSettled([...children].map(child => new Promise(resolve => child.once('close', resolve))));
  rmSync(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
}
