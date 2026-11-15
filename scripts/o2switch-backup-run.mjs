import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {chmod,mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createProductionBackup} from './production-backup.mjs';

// Aucun chargement de .env ni secret nécessaire à une copie locale privée.
process.umask(0o077);
const [databasePath,directory]=process.argv.slice(2).map(value=>resolve(value));
if(!databasePath||!directory)throw Error('Usage: backup-run <database> <private-directory>');
await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
const statusPath=join(directory,'etat.json'),statusTemp=statusPath+'.partial';
let database;
try{
 database=new DatabaseSync(databasePath,{readOnly:true});
 const config={kind:'local',directory,retention:30};
 const result=await createProductionBackup({database,databasePath,config});
 const path=join(directory,result.name);await chmod(path,0o600);
 const checksumSha256=createHash('sha256').update(await readFile(path)).digest('hex');
 const check=new DatabaseSync(path,{readOnly:true});
 try{if(check.prepare('PRAGMA foreign_key_check').all().length)throw Error('Sauvegarde : références incohérentes.')}finally{check.close()}
 const runtimePath=join(dirname(fileURLToPath(import.meta.url)),'../dist/server/index.js');
 const runtimeSha256=createHash('sha256').update(await readFile(runtimePath)).digest('hex');
 await writeFile(statusTemp,JSON.stringify({success:true,at:new Date().toISOString(),...result,checksumSha256,runtimeSha256,retention:30},null,2),{mode:0o600});
 await rename(statusTemp,statusPath);
 console.log('BACKUP_AUTOMATIQUE_VERIFIE');
}catch(error){
 await writeFile(statusTemp,JSON.stringify({success:false,at:new Date().toISOString(),error:String(error.message)},null,2),{mode:0o600});
 await rename(statusTemp,statusPath);
 throw error;
}finally{database?.close()}
