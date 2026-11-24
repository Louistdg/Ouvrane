import {readFileSync,statSync} from 'node:fs';
import {createPrivateKey} from 'node:crypto';
import {createEnableBankingProvider} from '../worker/bank-provider-enable.js';

// Disabled until an operator supplies the real application ID and private files.
// These values never enter the browser bundle or a database response.
export function createBankingRuntime(env=process.env,{readFile=readFileSync,statFile=statSync,fetchImpl=fetch,logger=console}={}){
 if(env.SOCLE_BANK_ENABLED!=='1')return null;
 try{
  const appId=String(env.SOCLE_BANK_ENABLEBANKING_APP_ID||'').trim(),keyPath=String(env.SOCLE_BANK_ENABLEBANKING_PRIVATE_KEY_PATH||''),secretPath=String(env.SOCLE_BANK_ENCRYPTION_KEY_PATH||''),organization=String(env.SOCLE_BANK_ORGANIZATION_ID||'').trim(),owner=String(env.SOCLE_BANK_OWNER_USER_ID||'').trim(),environment=String(env.SOCLE_BANK_ENVIRONMENT||''),redirectUrl=String(env.SOCLE_BANK_REDIRECT_URI||'https://ouvrane.be/bank/return');
  if(!appId||!keyPath||!secretPath||!organization||!owner||!['SANDBOX','PRODUCTION'].includes(environment))throw Error('configuration');
  for(const path of [keyPath,secretPath]){const info=statFile(path);if(!info.isFile()||info.size>32768)throw Error('private-file')}
  const privateKeyPem=String(readFile(keyPath,'utf8')),secretKey=String(readFile(secretPath,'utf8')).trim();
  const privateKey=createPrivateKey(privateKeyPem);if(privateKey.asymmetricKeyType!=='rsa'||privateKey.asymmetricKeyDetails.modulusLength<2048)throw Error('private-key');
  if(!/^[A-Za-z0-9+/]{43}=$/.test(secretKey)||Buffer.from(secretKey,'base64').length!==32)throw Error('encryption-key');
  const url=new URL(redirectUrl);if(!['https://ouvrane.be','https://www.ouvrane.be'].includes(url.origin)||url.pathname!=='/bank/return'||url.search||url.hash||url.username||url.password)throw Error('redirect');
  return {provider:createEnableBankingProvider({appId,privateKeyPem:privateKey.export({type:'pkcs8',format:'pem'}),fetchImpl}),secretKey,environment,redirectUrl:url.href,allowedOrganizationId:organization,allowedOwnerId:owner,evaluation:true};
 }catch{
  logger.warn?.('Connecteur bancaire désactivé : configuration privée à compléter ou corriger.');
  return null;
 }
}
