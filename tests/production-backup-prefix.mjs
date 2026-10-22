import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {backupConfig,createProductionBackup,listS3Objects,parseS3ListPage,s3Request,selectStaleBackupKeys} from '../scripts/production-backup.mjs';
import {productionConfig} from '../scripts/production-config.mjs';

// All credentials and endpoints are synthetic. fetch is intercepted before any S3 operation.
const env={SOCLE_BACKUP_S3_ENDPOINT:'https://s3.test.invalid',SOCLE_BACKUP_S3_REGION:'test-region',SOCLE_BACKUP_S3_BUCKET:'shared-test-bucket',SOCLE_BACKUP_S3_ACCESS_KEY_ID:'synthetic-access',SOCLE_BACKUP_S3_SECRET_ACCESS_KEY:'synthetic-secret',SOCLE_BACKUP_S3_URL_STYLE:'path',SOCLE_BACKUP_S3_PREFIX:'ouvrane-v5'};
assert.equal(backupConfig(env).prefix,'ouvrane-v5/','The configured V5 namespace must reach the real backup configuration');
const dir=await mkdtemp(join(tmpdir(),'socle-backup-prefix-')),databasePath=join(dir,'socle.sqlite'),database=new DatabaseSync(databasePath);
database.exec("CREATE TABLE organizations(id TEXT PRIMARY KEY);INSERT INTO organizations VALUES('synthetic-organization')");
const realFetch=globalThis.fetch;
try{
 const productionEnv={PORT:'3000',SOCLE_PUBLIC_URL:'https://example.invalid',SOCLE_SESSION_SECRET:'a'.repeat(43),SOCLE_DATA_DIR:dir};
 for(const prefix of [undefined,'','ouvrane-v5','ouvrane-v5/','environments/ouvrane-v5','A0_x-y']){
  const config=backupConfig({...env,SOCLE_BACKUP_S3_PREFIX:prefix}),expected=prefix?prefix.replace(/\/$/,'')+'/':'';
  assert.equal(config.prefix,expected);assert.doesNotThrow(()=>productionConfig({...productionEnv,SOCLE_BACKUP_S3_PREFIX:prefix}));
 }
 for(const prefix of ['.','..','../v5','v5/..','v5/.','v5//nested','/v5','v5//','v5\\nested','v5%2Fnested','v5?x','v5#x',' v5','v5 ','v5 space','https://v5',7,{},'x'.repeat(257)]){
  assert.throws(()=>backupConfig({...env,SOCLE_BACKUP_S3_PREFIX:prefix}),/PREFIX/,'An unsafe S3 prefix is rejected');
  assert.throws(()=>productionConfig({...productionEnv,SOCLE_BACKUP_S3_PREFIX:prefix}),/PREFIX/,'Production boot rejects an unsafe prefix before enabling the runtime');
 }
 assert.throws(()=>backupConfig({SOCLE_BACKUP_S3_PREFIX:'ouvrane-v5'}),/incomplète/,'A namespace alone must not silently disable S3 backups');
 const xml=(objects,nextToken=null)=>'<ListBucketResult><EncodingType>url</EncodingType>'+objects.map(o=>'<Contents><Key>'+encodeURIComponent(o.key)+'</Key><LastModified>'+new Date(o.lastModified).toISOString()+'</LastModified></Contents>').join('')+'<IsTruncated>'+(nextToken?'true':'false')+'</IsTruncated>'+(nextToken?'<NextContinuationToken>'+nextToken+'</NextContinuationToken>':'')+'</ListBucketResult>';
 const object=(scope,index)=>({key:scope+'socle-2026-09-'+String(index).padStart(2,'0')+'.sqlite',lastModified:Date.UTC(2026,8,1)+index*86400000});
 const seeded=[...Array.from({length:35},(_,i)=>object('daily/',i)),...Array.from({length:35},(_,i)=>object('ouvrane-v4/daily/',i)),...Array.from({length:35},(_,i)=>object('ouvrane-v5/daily/',i)),object('ouvrane-v50/daily/',1),object('ouvrane-v5/daily-old/',1),object('ouvrane-v5/daily/../daily/',1)];
 const v5=backupConfig(env),v5Scope='ouvrane-v5/daily/';
 assert.equal(parseS3ListPage(xml(seeded),v5.prefix).objects.length,35,'Unexpected keys from another version are discarded locally');
 const stale=selectStaleBackupKeys(seeded,seeded.find(o=>o.key.startsWith(v5Scope)).key,30,v5.prefix);assert.equal(stale.length,5);assert.ok(stale.every(key=>key.startsWith(v5Scope)&&!key.includes('/../')));
 assert.throws(()=>selectStaleBackupKeys(seeded,'daily/socle-v3.sqlite',30,v5.prefix),/périmètre/,'Rotation refuses a new-copy key owned by a different version');
 for(const [prefix,style]of [['ouvrane-v5','path'],['','path'],['environments/ouvrane-v5','path'],['ouvrane-v5','virtual'],['ouvrane-v5','virtual-host']]){
  const config=backupConfig({...env,SOCLE_BACKUP_S3_PREFIX:prefix,SOCLE_BACKUP_S3_URL_STYLE:style}),scope=config.prefix+'daily/',stored=new Map(),calls=[],deleted=[],objects=[...seeded];
  if(prefix==='environments/ouvrane-v5')objects.push(...Array.from({length:35},(_,i)=>object(scope,i)));
  globalThis.fetch=async(input,options)=>{
   const url=new URL(input),method=options.method,key=decodeURIComponent(url.pathname.slice(config.style==='path'?('/'+config.bucket+'/').length:1));calls.push({method,key,url});
   assert.equal(url.hostname,config.style==='path'?'s3.test.invalid':config.bucket+'.s3.test.invalid','Both S3 addressing styles preserve the configured bucket');
   if(method==='GET'&&url.searchParams.has('list-type')){
    assert.equal(url.searchParams.get('prefix'),scope,'Every list page carries the configured namespace');
    const all=[...objects,...[...stored.keys()].map(key=>({key,lastModified:Date.UTC(2026,9,20)}))],page=url.searchParams.has('continuation-token')?all.slice(43):all.slice(0,43);
    return new Response(xml(page,url.searchParams.has('continuation-token')?null:'next-token'));
   }
   assert.ok(key.startsWith(scope),'Every object operation remains in its own backup namespace');
   if(method==='PUT'){stored.set(key,Buffer.from(options.body));return new Response('')}
   if(method==='GET'){assert.ok(stored.has(key),'Verification reads the exact newly uploaded backup');return new Response(stored.get(key))}
   if(method==='DELETE'){deleted.push(key);return new Response('')}
   assert.fail('Unexpected S3 method '+method);
  };
  const logs=[],logger={log:message=>logs.push(message),error:(...args)=>logs.push(args.join(' '))};
  const result=await createProductionBackup({database,databasePath,config,logger,now:()=>new Date('2026-10-20T00:00:00Z')});
  assert.equal(result.integrity,'ok');assert.equal(result.count,1);assert.equal(stored.size,1);assert.equal(deleted.length,6,'Rotation preserves exactly thirty generations inside the active namespace');
  const newest=[...stored.keys()][0];assert.ok(newest.startsWith(scope));assert.ok(!deleted.includes(newest));assert.ok(deleted.every(key=>key.startsWith(scope)&&!key.includes('/../')));
  const ownBefore=objects.filter(o=>o.key.startsWith(scope)&&!o.key.includes('/../')).length+1;assert.equal(ownBefore-deleted.length,30);
  assert.equal(calls.filter(c=>c.method==='PUT').length,1);assert.equal(calls.filter(c=>c.method==='GET'&&!c.url.searchParams.has('list-type')).length,1);assert.equal(calls.filter(c=>c.url.searchParams.has('list-type')).length,2,'Pagination never drops the prefix');
  assert.ok(!logs.some(line=>line.includes('ÉCHEC')),'A mixed bucket response must not turn a successful backup into failed cleanup');
  const listed=await listS3Objects(config);assert.ok(listed.every(o=>o.key.startsWith(scope)&&!o.key.includes('/../')));
  const before=calls.length;for(const method of ['PUT','GET','DELETE'])for(const key of ['outside/file.sqlite',scope+'../other.sqlite',scope+'%2e%2e/other.sqlite',scope+'sub\\other.sqlite',scope+''])await assert.rejects(()=>s3Request(config,method,key),/périmètre/);
  if(prefix)for(const method of ['PUT','GET','DELETE'])await assert.rejects(()=>s3Request(config,method,'daily/socle-v3.sqlite'),/périmètre/);
  await assert.rejects(()=>s3Request(config,'GET','',Buffer.alloc(0),{'list-type':'2',prefix:'other/daily/'}),/périmètre/);assert.equal(calls.length,before,'Rejected cross-version operations never reach fetch');
 }
 console.log('PASS backup prefix: strict boot validation, V5/legacy/nested namespaces, verified real SQLite copies, scoped pagination and 30-generation retention, hostile mixed lists and cross-prefix request refusal');
}finally{globalThis.fetch=realFetch;database.close();await rm(dir,{recursive:true,force:true})}
