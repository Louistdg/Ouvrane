// OUVRANE V4 — démarrage de production : seed BatiNova (base de démo embarquée)
// puis provision du compte patron avec les MÊMES identifiants que OUVRANE V3.
import {copyFileSync, existsSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {openProductionDatabase} from './production-db.mjs';
import {provisionCredential} from './production-auth.mjs';
import {productionConfig} from './production-config.mjs';
import {startProduction} from './production.mjs';

const config=productionConfig(process.env);
const seedPath=process.env.SOCLE_V4_SEED_PATH||'/app/scripts/seed-batinova.sqlite';
const marker=config.databasePath+'.v4-provisioned';

// 1. Volume vide → copie de la base de démonstration BatiNova embarquée.
if(!existsSync(config.databasePath)&&existsSync(seedPath)){
  copyFileSync(seedPath,config.databasePath);
  console.log('OUVRANE V4: base de démonstration installée dans le volume.');
}
const storage=openProductionDatabase({databasePath:config.databasePath,migrationsDirectory:fileURLToPath(new URL('../drizzle/',import.meta.url))});
try{
  // 2. Provision du compte patron avec les identifiants OUVRANE (une seule fois).
  const email=String(process.env.SOCLE_V4_OWNER_EMAIL||'').trim().toLowerCase();
  const password=process.env.SOCLE_V4_OWNER_PASSWORD;
  if(email&&password&&!existsSync(marker)){
    const db=storage.database;
    db.exec('DELETE FROM local_test_sessions;');
    db.exec('DELETE FROM local_test_identities;');
    const owner=db.prepare("SELECT p.id FROM profiles p JOIN organization_members m ON m.user_id=p.id JOIN roles r ON r.id=m.role_id WHERE r.code='OWNER' AND m.status='active' LIMIT 1").get();
    if(!owner)throw Error('OUVRANE V4: profil patron introuvable dans la base de démonstration.');
    db.prepare("UPDATE profiles SET identity_kind='account', email=? WHERE id=?").run(email,owner.id);
    await provisionCredential(db,{userId:owner.id,password,secret:config.sessionSecret});
    writeFileSync(marker,JSON.stringify({userId:owner.id,provisionedAt:new Date().toISOString()}),{mode:0o600});
    console.log('OUVRANE V4: compte patron provisionné avec les identifiants SOCLE.');
  }
}finally{storage.close();}

const runtime=await startProduction();
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>runtime.close().then(()=>process.exit(0)));
