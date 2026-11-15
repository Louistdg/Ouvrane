import {normalizeEnableTransactions,selectEnableBookedBalance} from './bank-provider-enable.js';

const MAX_ACCOUNTS=10,MAX_ROWS=5000,MAX_PAGES=20;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const text=(value,max=240)=>String(value??'').trim().slice(0,max);
const list=async statement=>(await statement.all()).results||[];
const uuid=()=>crypto.randomUUID();
function base64(bytes){return btoa(String.fromCharCode(...bytes))}
function bytes(value){return Uint8Array.from(atob(value),c=>c.charCodeAt(0))}
const randomState=()=>base64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
async function sha(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
function exact(value,keys){if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(k=>!keys.includes(k)))fail('Paramètres bancaires invalides.');return value}
function operation(value){if(typeof value!=='string'||!/^[A-Za-z0-9:_-]{12,160}$/.test(value))fail('Clé d’opération bancaire invalide.');return value}
function configured(env,ctx){try{const c=env.BANKING,u=new URL(c?.redirectUrl);return Boolean(c?.provider&&bytes(c.secretKey).length===32&&['https://ouvrane.be','https://www.ouvrane.be'].includes(u.origin)&&u.pathname==='/bank/return'&&!u.search&&!u.hash&&c.allowedOrganizationId===ctx.organizationId&&c.allowedOwnerId===ctx.uid&&['SANDBOX','PRODUCTION'].includes(c.environment))}catch{return false}}
function owner(ctx){if(ctx.roleCode!=='OWNER'||ctx.preview)fail('Connexion bancaire réservée au propriétaire connecté.',403)}
function config(env,ctx){if(!configured(env,ctx))fail('Le connecteur bancaire de cet espace reste à configurer.',503);return env.BANKING}
async function seal(config,value,aad){const key=await crypto.subtle.importKey('raw',bytes(config.secretKey),'AES-GCM',false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(aad)},key,new TextEncoder().encode(value));return base64(iv)+'.'+base64(new Uint8Array(encrypted))}
async function unseal(config,value,aad){try{const [iv,data]=String(value).split('.');const key=await crypto.subtle.importKey('raw',bytes(config.secretKey),'AES-GCM',false,['decrypt']);return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:new TextEncoder().encode(aad)},key,bytes(data)))}catch{fail('La connexion bancaire nécessite une nouvelle autorisation.',409)}}
const aad=(ctx,id,purpose)=>[ctx.organizationId,ctx.uid,id,purpose].join(':');
function accountHashes(a){const values=[a.identification_hash,...(Array.isArray(a.identification_hashes)?a.identification_hashes:[])].filter(x=>typeof x==='string'&&x.length>10&&x.length<=2048);if(!values.length)fail('La banque n’a pas fourni d’identité de compte stable.',502);return [...new Set(values)].sort()}
function groupedAccounts(accounts){
 if(!Array.isArray(accounts)||!accounts.length||accounts.length>MAX_ACCOUNTS)fail('La banque n’a pas retourné une liste de comptes exploitable.',502);
 const groups=[];
 for(const a of accounts){if(!a.uid||a.currency!=='EUR')fail('Ce premier raccordement accepte uniquement les comptes en euros.',422);const hashes=accountHashes(a);const matches=groups.filter(g=>g.hashes.some(x=>hashes.includes(x)));if(matches.length>1)fail('Identités bancaires ambiguës : aucun compte importé.',409);if(matches.length){const group=matches[0];group.hashes=[...new Set([...group.hashes,...hashes])].sort();if(String(a.account_id?.iban||'').startsWith('BE'))group.account=a;}else groups.push({account:a,hashes});}
 return groups;
}
function publicError(error){return /^ENABLE_[A-Z_]+$/.test(error?.code||'')?error.code:'BANK_CONNECTION_FAILED'}
async function ownedConnection(env,ctx,id){const row=await env.DB.prepare('SELECT * FROM bank_connections WHERE organization_id=? AND owner_user_id=? AND id=?').bind(ctx.organizationId,ctx.uid,id).first();if(!row)fail('Connexion bancaire introuvable.',404);return row}
async function remoteAccounts(env,ctx,id){return list(env.DB.prepare('SELECT r.*,a.name,a.iban,a.currency,a.last_synced_at,a.provider_balance_verified_at FROM bank_remote_accounts r JOIN bank_accounts a ON a.id=r.bank_account_id AND a.organization_id=r.organization_id WHERE r.organization_id=? AND r.owner_user_id=? AND r.connection_id=? AND a.archived_at IS NULL AND a.private_owner_user_id=?').bind(ctx.organizationId,ctx.uid,id,ctx.uid))}
function publicAccount(row){const iban=String(row.iban||'').replaceAll(' ','');return {id:row.bank_account_id,name:row.name,ibanMasked:iban?iban.slice(0,2)+'••••'+iban.slice(-4):'',currency:row.currency,lastSyncedAt:row.last_synced_at||null,balanceKnown:Boolean(row.provider_balance_verified_at)}}
async function publicConnection(env,ctx,row,stamp=new Date().toISOString()){const expired=row.status==='connected'?row.access_expires_at<=stamp:row.status==='awaiting_authorization'&&row.state_expires_at<=stamp;return {id:row.id,aspspName:row.aspsp_name,country:row.country,status:expired?'expired':row.status,expiresAt:row.access_expires_at||row.state_expires_at,lastSyncedAt:row.last_synced_at,accounts:(await remoteAccounts(env,ctx,row.id)).map(publicAccount)}}
function privateAudit(h,env,ctx,action,entity,id,value){return h.auditStatement(env,ctx,action,entity,id,value,null,ctx.uid)}
function guard(env,ctx,id,predicate,values=[]){return env.DB.prepare(`INSERT INTO bank_connection_guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM organization_members m JOIN roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=? AND m.user_id=? AND m.status='active' AND r.code='OWNER') AND (${predicate}) THEN 1 ELSE 0 END)`).bind(id,ctx.organizationId,ctx.uid,...values)}
const dropGuard=(env,id)=>env.DB.prepare('DELETE FROM bank_connection_guards WHERE id=?').bind(id);

async function connectionStatus(env,ctx,h){const organization=await env.DB.prepare('SELECT id,name FROM organizations WHERE id=?').bind(ctx.organizationId).first();const connections=await list(env.DB.prepare('SELECT * FROM bank_connections WHERE organization_id=? AND owner_user_id=? ORDER BY created_at DESC LIMIT 50').bind(ctx.organizationId,ctx.uid));return h.json({configured:configured(env,ctx),provider:'enablebanking',mode:'evaluation',organization,connections:await Promise.all(connections.map(r=>publicConnection(env,ctx,r,h.now())))})}

async function start(request,env,ctx,h){
 const c=config(env,ctx),data=exact(await h.body(request,12000),['aspspName','country','operationKey']),key=operation(data.operationKey),name=text(data.aspspName,160),country=text(data.country,2).toUpperCase();
 if(!name||!['BE','LT'].includes(country))fail('Choisissez une banque disponible pour ce compte.');
 const fingerprint=await sha(JSON.stringify({name,country,environment:c.environment}));
 let existing=await env.DB.prepare('SELECT * FROM bank_connections WHERE organization_id=? AND owner_user_id=? AND operation_key=?').bind(ctx.organizationId,ctx.uid,key).first();
 const replay=async row=>{if(row.request_hash!==fingerprint)fail('Cette clé correspond à une autre connexion.',409);if(row.status==='awaiting_authorization'&&row.state_expires_at>h.now()&&row.authorization_url_cipher)return h.json({id:row.id,url:await unseal(c,row.authorization_url_cipher,aad(ctx,row.id,'authorization')),expiresAt:row.state_expires_at,replayed:true});fail('Cette tentative est déjà en cours ou terminée. Ouvrez une nouvelle connexion.',409)};
 if(existing)return replay(existing);
 const catalogue=await c.provider.institutions(country),banks=Array.isArray(catalogue)?catalogue:catalogue.aspsps;
 if(!Array.isArray(banks)||!banks.some(b=>b.name===name&&b.country===country&&(!Array.isArray(b.psu_types)||b.psu_types.includes('personal'))))fail('Banque indisponible dans le catalogue du connecteur.',422);
 const id='bank-connection-'+uuid(),state=ctx.organizationId+'.'+randomState(),stateHash=await sha(state),stamp=h.now(),expires=new Date(Date.parse(stamp)+10*60000).toISOString();
 try{await h.dbBatch(env,[env.DB.prepare("INSERT INTO bank_connections(id,organization_id,owner_user_id,provider_environment,aspsp_name,country,status,operation_key,request_hash,state_hash,state_expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,'starting',?,?,?,?,?,?)").bind(id,ctx.organizationId,ctx.uid,c.environment,name,country,key,fingerprint,stateHash,expires,stamp,stamp),privateAudit(h,env,ctx,'bank.connection.started','bank_connection',id,{status:'starting'})])}catch(error){existing=await env.DB.prepare('SELECT * FROM bank_connections WHERE organization_id=? AND owner_user_id=? AND operation_key=?').bind(ctx.organizationId,ctx.uid,key).first();if(existing)return replay(existing);throw error}
 try{
  const maximum=Number(banks.find(b=>b.name===name&&b.country===country)?.maximum_consent_validity),seconds=Number.isFinite(maximum)&&maximum>0?Math.min(maximum,180*86400):86400;
  const validUntil=new Date(Date.parse(stamp)+seconds*1000).toISOString();
  const result=await c.provider.startAuthorization({bankName:name,country,redirectUrl:c.redirectUrl,state,validUntil});
  const url=new URL(result.url);if(url.protocol!=='https:'||url.hostname!=='auth.enablebanking.com'||url.username||url.password)fail('Adresse d’autorisation bancaire refusée.',502);
  const encrypted=await seal(c,url.href,aad(ctx,id,'authorization')),g=uuid();
  await h.dbBatch(env,[guard(env,ctx,g,"EXISTS(SELECT 1 FROM bank_connections WHERE id=? AND status='starting')",[id]),env.DB.prepare("UPDATE bank_connections SET status='awaiting_authorization',authorization_url_cipher=?,updated_at=? WHERE id=? AND organization_id=? AND owner_user_id=? AND status='starting'").bind(encrypted,h.now(),id,ctx.organizationId,ctx.uid),dropGuard(env,g)]);
  return h.json({id,url:url.href,expiresAt:expires},201);
 }catch(error){await env.DB.prepare("UPDATE bank_connections SET status='failed',last_error_code=?,updated_at=? WHERE id=? AND status='starting'").bind(publicError(error),h.now(),id).run();throw Object.assign(new Error('L’autorisation bancaire n’a pas pu être préparée. Réessayez depuis Ouvrane.'),{status:error.status>=400&&error.status<500?error.status:502})}
}

async function complete(request,env,ctx,h){
 const c=config(env,ctx),data=exact(await h.body(request,16000),['state','code']),state=text(data.state,250),code=text(data.code,4000);
 if(typeof data.state!=='string'||data.state!==state||typeof data.code!=='string'||data.code!==code||!state.startsWith(ctx.organizationId+'.')||!code||!/^[A-Za-z0-9_-]{43}$/.test(state.slice(ctx.organizationId.length+1)))fail('Retour bancaire invalide.');
 const row=await env.DB.prepare('SELECT * FROM bank_connections WHERE organization_id=? AND owner_user_id=? AND state_hash=?').bind(ctx.organizationId,ctx.uid,await sha(state)).first();
 if(!row)fail('Autorisation bancaire introuvable.',404);
 if(row.status==='connected')return h.json({connection:await publicConnection(env,ctx,row),accountsConnected:(await remoteAccounts(env,ctx,row.id)).length,replayed:true});
 if(row.status!=='awaiting_authorization'||row.state_expires_at<=h.now())fail('Cette autorisation a expiré ou a déjà été utilisée.',409);
 const token=uuid(),g=uuid();
 try{await h.dbBatch(env,[guard(env,ctx,g,"EXISTS(SELECT 1 FROM bank_connections WHERE id=? AND status='awaiting_authorization' AND state_expires_at>?)",[row.id,h.now()]),env.DB.prepare("UPDATE bank_connections SET status='completing',completion_token=?,authorization_url_cipher=NULL,updated_at=? WHERE id=? AND status='awaiting_authorization'").bind(token,h.now(),row.id),dropGuard(env,g)])}catch{fail('Cette autorisation est déjà en cours de traitement.',409)}
 let sessionId,sessionRevoked=false;
 try{
  const session=await c.provider.authorize(code);sessionId=text(session.session_id,200);if(!sessionId)fail('La session bancaire retournée est invalide.',502);
  const sessionCipher=await seal(c,sessionId,aad(ctx,row.id,'session'));
  await env.DB.prepare("UPDATE bank_connections SET provider_session_cipher=? WHERE id=? AND status='completing' AND completion_token=?").bind(sessionCipher,row.id,token).run();
  if(session.aspsp?.name!==row.aspsp_name||session.aspsp?.country!==row.country)fail('La banque retournée ne correspond pas à l’autorisation.',502);
  const groups=groupedAccounts(session.accounts),allRemote=await list(env.DB.prepare('SELECT * FROM bank_remote_accounts WHERE organization_id=?').bind(ctx.organizationId));
  const expiryValue=text(session.access?.valid_until,64);if(!Number.isFinite(Date.parse(expiryValue))||Date.parse(expiryValue)<=Date.parse(h.now()))fail('La session bancaire n’est pas valide.',502);
  const expiry=new Date(expiryValue).toISOString(),statements=[],stamp=h.now(),guardId=uuid();
  statements.push(guard(env,ctx,guardId,"EXISTS(SELECT 1 FROM bank_connections WHERE id=? AND status='completing' AND completion_token=?)",[row.id,token]));
  const selectedIds=new Set();
  for(const {account,hashes} of groups){
   const matches=allRemote.filter(r=>JSON.parse(r.aliases_json).some(x=>hashes.includes(x)));
   if(matches.length>1||matches.some(r=>r.owner_user_id!==ctx.uid))fail('L’identité du compte nécessite une vérification privée.',409);
   const previous=matches[0],accountId=previous?.bank_account_id||'bank-account-'+uuid();if(selectedIds.has(accountId))fail('Compte bancaire dupliqué dans le retour.',409);selectedIds.add(accountId);
   const existing=previous?await env.DB.prepare('SELECT * FROM bank_accounts WHERE id=? AND organization_id=? AND private_owner_user_id=? AND archived_at IS NULL').bind(accountId,ctx.organizationId,ctx.uid).first():null;
   if(previous&&!existing)fail('Le compte bancaire existant nécessite une vérification.',409);
   const iban=text(account.account_id?.iban,64).replaceAll(' ',''),name=text(row.aspsp_name+' · '+(iban?iban.slice(-4):'EUR'),160),encrypted=await seal(c,String(account.uid),aad(ctx,accountId,'account'));
   const aliases=[...new Set([...(previous?JSON.parse(previous.aliases_json):[]),...hashes])].sort();
   if(!previous){statements.push(env.DB.prepare("INSERT INTO bank_accounts(id,organization_id,name,iban,currency,current_balance_cents,provider,external_id,private_owner_user_id,created_at,updated_at) VALUES(?,?,?,?,'EUR',0,'enablebanking',?,?,?,?)").bind(accountId,ctx.organizationId,name,iban||null,hashes[0],ctx.uid,stamp,stamp));statements.push(env.DB.prepare("INSERT INTO bank_remote_accounts(bank_account_id,organization_id,owner_user_id,connection_id,identity_hash,aliases_json,provider_account_cipher,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(accountId,ctx.organizationId,ctx.uid,row.id,hashes[0],JSON.stringify(aliases),encrypted,stamp,stamp))}
   else statements.push(env.DB.prepare('UPDATE bank_remote_accounts SET connection_id=?,aliases_json=?,provider_account_cipher=?,updated_at=? WHERE bank_account_id=? AND organization_id=? AND owner_user_id=?').bind(row.id,JSON.stringify(aliases),encrypted,stamp,accountId,ctx.organizationId,ctx.uid));
  }
  statements.push(env.DB.prepare("UPDATE bank_connections SET status='connected',provider_session_cipher=?,access_expires_at=?,completion_token=NULL,last_error_code=NULL,updated_at=? WHERE id=? AND status='completing' AND completion_token=?").bind(sessionCipher,expiry,stamp,row.id,token),privateAudit(h,env,ctx,'bank.connection.authorized','bank_connection',row.id,{accounts:groups.length,private:true}),dropGuard(env,guardId));
  await h.dbBatch(env,statements);
  return h.json({connection:await publicConnection(env,ctx,await ownedConnection(env,ctx,row.id),h.now()),accountsConnected:groups.length},201);
 }catch(error){
  const current=await ownedConnection(env,ctx,row.id);
  if(current.status==='connected')return h.json({connection:await publicConnection(env,ctx,current,h.now()),accountsConnected:(await remoteAccounts(env,ctx,row.id)).length,replayed:true});
  if(sessionId){try{await c.provider.deleteSession(sessionId);sessionRevoked=true}catch{}}
  await env.DB.prepare("UPDATE bank_connections SET status='failed',completion_token=NULL,provider_session_cipher=CASE WHEN ? THEN NULL ELSE provider_session_cipher END,last_error_code=?,updated_at=? WHERE id=? AND status='completing' AND completion_token=?").bind(sessionRevoked?1:0,sessionId&&!sessionRevoked?'BANK_REVOCATION_REQUIRED':publicError(error),h.now(),row.id,token).run();
  throw Object.assign(new Error('La connexion bancaire n’a pas été finalisée. Vérifiez son état avant un nouvel essai.'),{status:error.status>=400&&error.status<500?error.status:502});
 }
}

async function synchronize(request,env,ctx,h,connectionId){
 const c=config(env,ctx),data=exact(await h.body(request,12000),['operationKey']),key=operation(data.operationKey),connection=await ownedConnection(env,ctx,connectionId);
 const prior=await env.DB.prepare('SELECT * FROM bank_sync_runs WHERE organization_id=? AND connection_id=? AND operation_key=?').bind(ctx.organizationId,connectionId,key).first();if(prior){if(prior.status==='succeeded')return h.json({...JSON.parse(prior.summary_json),replayed:true});fail('Cette synchronisation est déjà en cours ou a échoué. Relisez son état avant de recommencer.',409)}
 if(connection.status!=='connected'||connection.access_expires_at<=h.now())fail('Une nouvelle autorisation bancaire est nécessaire.',409);
 const accounts=await remoteAccounts(env,ctx,connectionId);if(!accounts.length||accounts.length>MAX_ACCOUNTS)fail('Aucun compte actif à synchroniser pour cette connexion.',409);
 const stamp=h.now(),token=uuid(),runId='bank-sync-'+uuid(),guardId=uuid(),lease=new Date(Date.parse(stamp)+120000).toISOString();
 try{await h.dbBatch(env,[guard(env,ctx,guardId,"EXISTS(SELECT 1 FROM bank_connections WHERE id=? AND status='connected' AND (sync_token IS NULL OR sync_expires_at<=?))",[connectionId,stamp]),env.DB.prepare('UPDATE bank_connections SET sync_token=?,sync_expires_at=?,updated_at=? WHERE id=?').bind(token,lease,stamp,connectionId),env.DB.prepare("INSERT INTO bank_sync_runs(id,organization_id,owner_user_id,connection_id,operation_key,status,created_at) VALUES(?,?,?,?,?,'running',?)").bind(runId,ctx.organizationId,ctx.uid,connectionId,key,stamp),dropGuard(env,guardId)])}catch{fail('Une synchronisation est déjà en cours. Attendez son résultat.',409)}
 try{
  const dateTo=stamp.slice(0,10),dateFrom=new Date(Date.parse(stamp)-90*86400000).toISOString().slice(0,10),fetched=[],deadline=Date.now()+60000;let totalRows=0,quarantined=0,duplicates=0;
  const assertTime=()=>{if(Date.now()>deadline)fail('La banque a mis trop de temps à répondre. Aucun import partiel validé.',504)};
  for(const account of accounts){
   assertTime();const uid=await unseal(c,account.provider_account_cipher,aad(ctx,account.bank_account_id,'account')),transactions=[],seenPages=new Set();let continuationKey=null;
   for(let page=0;page<MAX_PAGES;page++){
    assertTime();const raw=await c.provider.transactions(uid,{dateFrom,dateTo,continuationKey}),normalized=normalizeEnableTransactions(raw,{currency:'EUR'});
    totalRows+=(raw.transactions||[]).length;if(totalRows>MAX_ROWS)fail('Historique bancaire trop volumineux pour cet import.',422);
    if(normalized.transactions.some(t=>t.bookingDate<dateFrom||t.bookingDate>dateTo))fail('La banque a retourné une opération hors période autorisée.',502);
    transactions.push(...normalized.transactions);quarantined+=normalized.quarantined.length;duplicates+=normalized.duplicateCount||0;
    continuationKey=normalized.continuationKey;if(!continuationKey)break;if(seenPages.has(continuationKey)||page===MAX_PAGES-1)fail('Pagination bancaire incohérente : aucun import partiel.',502);seenPages.add(continuationKey);
   }
   const combined=new Map();for(const tx of transactions){const previous=combined.get(tx.externalId);if(previous&&JSON.stringify(previous)!==JSON.stringify(tx))fail('Deux opérations bancaires contradictoires portent la même référence.',409);if(previous)duplicates++;else combined.set(tx.externalId,tx)}
   assertTime();const balance=selectEnableBookedBalance(await c.provider.balances(uid),'EUR');fetched.push({account,transactions:[...combined.values()],balance});
  }
  assertTime();const statements=[],finish=h.now(),g=uuid();let imported=0;
  statements.push(guard(env,ctx,g,"EXISTS(SELECT 1 FROM bank_connections WHERE id=? AND status='connected' AND sync_token=? AND sync_expires_at>?)",[connectionId,token,finish]));
  for(const {account,transactions,balance} of fetched){
   const accountGuard=uuid();statements.push(guard(env,ctx,accountGuard,"EXISTS(SELECT 1 FROM bank_remote_accounts r JOIN bank_accounts a ON a.id=r.bank_account_id WHERE r.bank_account_id=? AND r.connection_id=? AND r.owner_user_id=? AND a.archived_at IS NULL AND a.private_owner_user_id=?)",[account.bank_account_id,connectionId,ctx.uid,ctx.uid]));
   for(const tx of transactions){
    const operationKey='enablebanking:'+await sha(account.bank_account_id+':'+tx.externalId),existing=await env.DB.prepare('SELECT * FROM bank_transactions WHERE organization_id=? AND idempotency_key=?').bind(ctx.organizationId,operationKey).first();
    if(existing){if(existing.bank_account_id!==account.bank_account_id||existing.transaction_date!==tx.bookingDate||Number(existing.amount_cents)!==tx.amountCents||existing.currency!==tx.currency)fail('Une opération déjà importée a changé. Vérification nécessaire.',409);duplicates++;continue}
    imported++;statements.push(env.DB.prepare("INSERT INTO bank_transactions(id,organization_id,bank_account_id,transaction_date,amount_cents,currency,description,reference,counterparty_name,status,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'unreconciled',?,?,?)").bind('bank-tx-'+uuid(),ctx.organizationId,account.bank_account_id,tx.bookingDate,tx.amountCents,tx.currency,text(tx.description,500),text(tx.reference,240),text(tx.counterparty,240),operationKey,finish,finish));
   }
   if(balance)statements.push(env.DB.prepare('UPDATE bank_accounts SET current_balance_cents=?,provider_balance_verified_at=?,provider_balance_type=?,last_synced_at=?,updated_at=? WHERE id=? AND organization_id=? AND private_owner_user_id=?').bind(balance.amountCents,finish,balance.type,finish,finish,account.bank_account_id,ctx.organizationId,ctx.uid));
   else statements.push(env.DB.prepare('UPDATE bank_accounts SET provider_balance_verified_at=NULL,provider_balance_type=NULL,last_synced_at=?,updated_at=? WHERE id=? AND organization_id=? AND private_owner_user_id=?').bind(finish,finish,account.bank_account_id,ctx.organizationId,ctx.uid));
   statements.push(dropGuard(env,accountGuard));
  }
  const summary={importedCount:imported,duplicateCount:duplicates,quarantinedCount:quarantined,accountsCount:accounts.length,unknownBalanceCount:fetched.filter(x=>!x.balance).length,dateFrom,dateTo};
  statements.push(env.DB.prepare("UPDATE bank_sync_runs SET status='succeeded',summary_json=?,completed_at=? WHERE id=? AND status='running'").bind(JSON.stringify(summary),finish,runId),env.DB.prepare('UPDATE bank_connections SET sync_token=NULL,sync_expires_at=NULL,last_synced_at=?,last_error_code=NULL,updated_at=? WHERE id=? AND sync_token=?').bind(finish,finish,connectionId,token),privateAudit(h,env,ctx,'bank.connection.synced','bank_connection',connectionId,summary),dropGuard(env,g));
  await h.dbBatch(env,statements);return h.json(summary);
 }catch(error){await h.dbBatch(env,[env.DB.prepare("UPDATE bank_sync_runs SET status='failed',completed_at=? WHERE id=? AND status='running'").bind(h.now(),runId),env.DB.prepare('UPDATE bank_connections SET sync_token=NULL,sync_expires_at=NULL,last_error_code=?,updated_at=? WHERE id=? AND sync_token=?').bind(publicError(error),h.now(),connectionId,token)]);throw Object.assign(new Error('La synchronisation bancaire n’a pas été validée. Les opérations existantes sont conservées.'),{status:error.status>=400&&error.status<500?error.status:502})}
}

async function disconnect(request,env,ctx,h,id){
 exact(await h.body(request,1000),[]);const row=await ownedConnection(env,ctx,id);if(row.status==='disconnected')return h.json({disconnected:true,replayed:true});
 if(['starting','completing'].includes(row.status))fail('Une autorisation bancaire est en cours. Attendez son résultat avant de la déconnecter.',409);
 const c=config(env,ctx);if(row.provider_session_cipher){const session=await unseal(c,row.provider_session_cipher,aad(ctx,id,'session'));try{await c.provider.deleteSession(session)}catch(error){if(error.providerStatus!==404)fail('La révocation bancaire n’a pas été confirmée. Réessayez.',502)}}
 const g=uuid();
 try{await h.dbBatch(env,[guard(env,ctx,g,"EXISTS(SELECT 1 FROM bank_connections WHERE id=? AND status=? AND provider_session_cipher IS ?)",[id,row.status,row.provider_session_cipher]),env.DB.prepare("UPDATE bank_connections SET status='disconnected',provider_session_cipher=NULL,authorization_url_cipher=NULL,sync_token=NULL,sync_expires_at=NULL,updated_at=? WHERE id=? AND organization_id=? AND owner_user_id=?").bind(h.now(),id,ctx.organizationId,ctx.uid),privateAudit(h,env,ctx,'bank.connection.disconnected','bank_connection',id,{disconnected:true,historyPreserved:true}),dropGuard(env,g)])}
 catch{fail('La connexion ou vos droits ont changé. Actualisez son état avant de terminer la déconnexion.',409)}
 return h.json({disconnected:true});
}

export async function bankConnectionsRoute(request,url,env,ctx,h,action='',connectionId=null){
 owner(ctx);
 if(request.method==='GET'&&!action&&!connectionId)return connectionStatus(env,ctx,h);
 if(request.method==='GET'&&action==='institutions'){
  const c=config(env,ctx),country=text(url.searchParams.get('country')||'BE',2).toUpperCase();if(!['BE','LT'].includes(country))fail('Pays bancaire non pris en charge.');
  const result=await c.provider.institutions(country),items=Array.isArray(result)?result:result.aspsps;
  if(!Array.isArray(items))fail('Catalogue bancaire indisponible.',502);
  return h.json({institutions:items.filter(x=>x.country===country&&(!Array.isArray(x.psu_types)||x.psu_types.includes('personal'))).map(x=>({name:x.name,country:x.country}))});
 }
 if(request.method==='POST'&&action==='start')return start(request,env,ctx,h);
 if(request.method==='POST'&&action==='complete')return complete(request,env,ctx,h);
 if(request.method==='POST'&&connectionId&&action==='sync')return synchronize(request,env,ctx,h,connectionId);
 if(request.method==='POST'&&connectionId&&action==='disconnect')return disconnect(request,env,ctx,h,connectionId);
 return h.json({error:'Méthode non autorisée.'},405);
}
