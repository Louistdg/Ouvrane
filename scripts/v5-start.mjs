// OUVRANE V5 has its own volume and explicit first-owner provisioning.
import {copyFileSync,existsSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {openProductionDatabase} from './production-db.mjs';
import {provisionCredential} from './production-auth.mjs';
import {productionConfig} from './production-config.mjs';
import {startProduction} from './production.mjs';

const config=productionConfig(process.env);
const seedPath=process.env.SOCLE_V5_SEED_PATH||fileURLToPath(new URL('./seed-batinova.sqlite',import.meta.url));
const marker=config.databasePath+'.v5-provisioned';
if(!existsSync(config.databasePath)){
 if(!existsSync(seedPath))throw Error('OUVRANE: no existing database or explicit seed is available.');
 copyFileSync(seedPath,config.databasePath);
 console.log('OUVRANE: initial database copied into its persistent volume.');
}
const storage=openProductionDatabase({databasePath:config.databasePath,migrationsDirectory:fileURLToPath(new URL('../drizzle/',import.meta.url))});
try{
 const db=storage.database;
 const eligibleOwners=db.prepare(`SELECT DISTINCT p.id FROM profiles p JOIN production_credentials c ON c.user_id=p.id
  WHERE p.identity_kind='account' AND c.disabled_at IS NULL AND NOT EXISTS(SELECT 1 FROM local_test_identities i WHERE i.profile_id=p.id)
  AND EXISTS(SELECT 1 FROM organization_members m JOIN roles r ON r.id=m.role_id AND r.organization_id=m.organization_id
   WHERE m.user_id=p.id AND m.status='active' AND r.code='OWNER')`).all();
 if(eligibleOwners.length){
  // Restoring a database without its marker must not reset an existing password.
  if(!existsSync(marker))writeFileSync(marker,JSON.stringify({version:5,mode:'existing-accounts',initializedAt:new Date().toISOString()}),{mode:0o600});
  console.log('OUVRANE: existing production accounts preserved.');
 }else{
  // A restored database can lose its marker, but its credentials are never fresh seed data.
  if(db.prepare('SELECT 1 FROM production_credentials LIMIT 1').get())throw Error('OUVRANE: existing production credentials have no eligible owner account; explicit recovery is required.');
  if(existsSync(marker))throw Error('OUVRANE: provisioned database has no eligible owner account; explicit recovery is required.');
  const email=String(process.env.SOCLE_V5_OWNER_EMAIL||'').trim().toLowerCase(),password=process.env.SOCLE_V5_OWNER_PASSWORD,userId=String(process.env.SOCLE_V5_OWNER_USER_ID||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||typeof password!=='string'||password.length<8||Buffer.byteLength(password)>1024)throw Error('OUVRANE: first-owner email and password are required before opening the service.');
  const owners=db.prepare(`SELECT DISTINCT p.id,p.email FROM profiles p JOIN organization_members m ON m.user_id=p.id
   JOIN roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.status='active' AND r.code='OWNER' AND p.identity_kind='account' ORDER BY p.id`).all();
  const matching=owners.filter(p=>String(p.email||'').trim().toLowerCase()===email),candidates=userId?owners.filter(p=>p.id===userId):matching.length?matching:owners;
  if(candidates.length!==1)throw Error('OUVRANE: first-owner selection is missing or ambiguous; configure SOCLE_V5_OWNER_USER_ID.');
  const owner=candidates[0];
  const otherEmail=db.prepare('SELECT id FROM profiles WHERE lower(trim(email))=? AND id<>? LIMIT 1').get(email,owner.id);
  if(otherEmail)throw Error('OUVRANE: the first-owner email already belongs to another profile.');
  // The embedded demo identities never become production sessions or credentials.
  db.exec('BEGIN IMMEDIATE');
  try{
   db.exec('DELETE FROM local_test_sessions;DELETE FROM local_test_identities;');
   db.prepare("UPDATE profiles SET identity_kind='account',email=?,updated_at=? WHERE id=?").run(email,new Date().toISOString(),owner.id);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
  await provisionCredential(db,{userId:owner.id,password,secret:config.sessionSecret});
  writeFileSync(marker,JSON.stringify({version:5,mode:'first-owner',userId:owner.id,initializedAt:new Date().toISOString()}),{mode:0o600});
  console.log('OUVRANE: first owner initialized; local simulation identities removed.');
 }
}finally{storage.close()}
const runtime=await startProduction();
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>runtime.close().then(()=>process.exit(0)));
