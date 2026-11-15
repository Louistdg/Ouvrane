# Reconstruction de `worker/bank-provider-enable.js`

## Goal

Recréer le module fournisseur Enable Banking d'Ouvrane, perdu à l'exclusion `cle-privee` de tous les
transferts, sans y remettre aucun secret, et ramener les 9 suites bancaires au vert.

## Current context / assumptions

Le fichier `worker/bank-provider-enable.js` (15 174 octets) n'existe plus nulle part : absent du
disque, de l'historique git, de GitHub (`Louistdg/Ouvrane`, une seule branche `main` au commit
`c5063d2`) et de la corbeille. Il a été écarté par le scanner de secrets du transfert, pour
`Ouvrane-Application` et `Ouvrane-recent`, avec le motif `cle-privee` (voir `EXCLUSIONS.json`).

Il est importé à deux endroits, qui définissent exactement sa surface publique :

- `worker/bank-connections.js:1` — `import {normalizeEnableTransactions,selectEnableBookedBalance} from './bank-provider-enable.js'`
- `scripts/bank-runtime.mjs:3` — `import {createEnableBankingProvider} from '../worker/bank-provider-enable.js'`

**Surface à reproduire, exactement :**

| Export | Appelé comme | Doit retourner |
|---|---|---|
| `createEnableBankingProvider({appId,privateKeyPem,fetchImpl})` | `bank-runtime.mjs:17` | un objet `provider` |
| `provider.institutions(country)` | `bank-connections.js:45,159` | un tableau **ou** `{aspsps:[…]}` |
| `provider.startAuthorization({bankName,country,redirectUrl,state,validUntil})` | `bank-connections.js:52` | `{url}` |
| `provider.authorize(code)` | `bank-connections.js:71` | `{session_id,aspsp:{name,country},accounts:[…],access:{valid_until}}` |
| `provider.deleteSession(sessionId)` | `bank-connections.js:97,147` | en cas d'absence, une erreur portant `.providerStatus===404` |
| `provider.transactions(accountId,{dateFrom,dateTo,continuationKey})` | `bank-connections.js:116` | brut, avec `transactions[]` et `continuation_key` |
| `provider.balances(accountId)` | `bank-connections.js:123` | brut, avec `balances[]` |
| `normalizeEnableTransactions(raw,{currency:'EUR'})` | `bank-connections.js:116` | `{transactions[],quarantined[],duplicateCount,continuationKey}` |
| `selectEnableBookedBalance(raw,'EUR')` | `bank-connections.js:123` | `{amountCents,type}` ou `null` |

**Conventions d'erreur exigées par l'appelant :** `bank-connections.js:27` surface à l'utilisateur tout
`error.code` qui respecte `/^ENABLE_[A-Z_]+$/`, sinon `BANK_CONNECTION_FAILED`. `bank-connections.js:147`
teste `error.providerStatus!==404`. Donc : `code` pour le diagnostic, `providerStatus` pour le statut HTTP.

**Aucun test existant ne couvre ce module.** Les 9 suites rouges échouent uniquement parce que la chaîne
d'import casse (`worker/index.js` → `bank-connections.js` → module absent). Elles ne deviennent pas une
spécification du comportement : ce sont un contrôle de non-régression. Le comportement lui-même doit donc
être couvert par un nouveau fichier de test, écrit avant le code.

**Format de sortie attendu par une suite** (relevé sur `tests/purchase-receipts-api.mjs`, qui passe) :

```json
{ "status": "PASS", "checks": 15, "scenarios": ["…", "…"] }
```

**Ce que la clé privée devient.** `scripts/bank-runtime.mjs` lit déjà la clé RSA et la clé de chiffrement
dans des fichiers, via `SOCLE_BANK_ENABLEBANKING_PRIVATE_KEY_PATH` et `SOCLE_BANK_ENCRYPTION_KEY_PATH`,
et passe `privateKeyPem` en paramètre. Le module reconstruit ne contient donc **aucun** secret, et le
scanner de secrets ne l'écartera plus.

**Hypothèses à confirmer avec Louis avant de commencer :**

1. Les statuts d'opération importés. Je propose : seul `BOOK` est importé, tout le reste part en
   quarantaine avec sa raison. L'original acceptait peut-être `PDNG` aussi.
2. Le choix du solde « booked ». Je propose l'ordre `ITBD`, `CLBD`, `PRCD`, puis un libellé contenant
   « booked », puis `ITAV`, puis `CLAV`, puis le premier de la devise. La documentation Enable Banking
   montre d'ailleurs un solde nommé « Booked balance » de type `CLAV`, ce qui rend le seul type
   insuffisant.
3. `externalId` d'une opération : `entry_reference`, sinon `transaction_id`, sinon `reference_number`.
   C'est la clé d'idempotence côté base (`bank-connections.js:130`), donc un choix à ne pas prendre à la légère.

## Architecture / proposed approach

Un seul fichier de production, `worker/bank-provider-enable.js`, sans dépendance et sans secret : un
signataire JWT RS256 via WebCrypto (disponible dans le worker comme sous Node, contrairement à
`node:crypto`), un client HTTP qui reçoit `fetchImpl` par injection, six méthodes de fournisseur, et deux
fonctions pures de normalisation. Le test `tests/bank-provider-enable.mjs` génère sa propre paire de clés
RSA à l'exécution et remplace `fetch` par un espion : aucun accès réseau, aucune clé versionnée.

## Step-by-step tasks

Chaque tâche se termine par une commande et sa sortie attendue. Toutes les commandes se lancent depuis
`D:\OUVRANE-TRAVAIL\ouvrane`.

### T1 — Branche de travail

```bash
cd /d/OUVRANE-TRAVAIL/ouvrane
git -c safe.directory=D:/OUVRANE-TRAVAIL/ouvrane switch -c reconstruction-connecteur-bancaire baseline-verte
git -c safe.directory=D:/OUVRANE-TRAVAIL/ouvrane status --porcelain
```

Attendu : `Switched to a new branch 'reconstruction-connecteur-bancaire'` puis une sortie vide
(arbre propre).

### T2 — Le test d'abord (doit échouer)

Créer `tests/bank-provider-enable.mjs` avec exactement ce contenu :

```js
// Couvre worker/bank-provider-enable.js : signature JWT, appels HTTP, normalisation des opérations,
// sélection du solde. Aucun accès réseau : la paire de clés est générée ici et fetch est remplacé.
import assert from 'node:assert/strict';
import {createEnableBankingProvider,normalizeEnableTransactions,selectEnableBookedBalance} from '../worker/bank-provider-enable.js';

const APP_ID='11111111-2222-3333-4444-555555555555';
const scenarios=[];let checks=0;
const check=(condition,message)=>{checks++;assert.ok(condition,message)};
const scenario=async(name,fn)=>{scenarios.push(name);await fn()};

function toBase64(bytes){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary)}
function toBase64Url(bytesOrText){
  const bytes=typeof bytesOrText==='string'?new TextEncoder().encode(bytesOrText):bytesOrText;
  return toBase64(bytes).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}
function fromBase64Url(value){
  const padded=value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4);
  const binary=atob(padded),bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
  return bytes;
}

const pair=await crypto.subtle.generateKey(
  {name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
  true,['sign','verify']);
const privateKeyPem='-----BEGIN PRIVATE KEY-----\n'+
  toBase64(new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey))).match(/.{1,64}/g).join('\n')+
  '\n-----END PRIVATE KEY-----\n';

function spy(handler){
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url:String(url),options});
    const result=handler(String(url),options)||{};
    const status=result.status??200;
    // 204, 205 et 304 interdisent un corps dans une Response.
    const body=[204,205,304].includes(status)?null:JSON.stringify(result.body??{});
    return new Response(body,{status,headers:{'content-type':'application/json'}});
  };
  return {calls,fetchImpl};
}

const provider=(handler)=>{const {calls,fetchImpl}=spy(handler);return {calls,provider:createEnableBankingProvider({appId:APP_ID,privateKeyPem,fetchImpl})}};

await scenario('Jeton RS256 conforme, signé par la clé de l’application',async()=>{
  const {calls,provider:client}=provider(()=>({body:{aspsps:[]}}));
  await client.institutions('BE');
  const header=String(calls[0].options.headers.authorization||'');
  check(header.startsWith('Bearer '),'en-tête Authorization absent');
  const [encodedHeader,encodedPayload,encodedSignature]=header.slice(7).split('.');
  const parsedHeader=JSON.parse(new TextDecoder().decode(fromBase64Url(encodedHeader)));
  const parsedPayload=JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload)));
  check(parsedHeader.alg==='RS256'&&parsedHeader.typ==='JWT','algorithme ou type de jeton incorrect');
  check(parsedHeader.kid===APP_ID,'kid différent de l’identifiant d’application');
  check(parsedPayload.iss==='enablebanking.com','issuer incorrect');
  check(parsedPayload.aud==='api.enablebanking.com','audience incorrecte');
  check(parsedPayload.exp>parsedPayload.iat,'jeton déjà expiré');
  check(parsedPayload.exp-parsedPayload.iat<=86400,'durée de vie supérieure à 24 heures');
  const signatureValid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',pair.publicKey,fromBase64Url(encodedSignature),
    new TextEncoder().encode(encodedHeader+'.'+encodedPayload));
  check(signatureValid,'signature du jeton invalide');
});

await scenario('Catalogue des banques d’un pays',async()=>{
  const {calls,provider:client}=provider(()=>({body:{aspsps:[{name:'Belfius',country:'BE',psu_types:['personal'],maximum_consent_validity:7776000}]}}));
  const catalogue=await client.institutions('be');
  check(calls[0].url.startsWith('https://api.enablebanking.com/aspsps?'),'hôte ou chemin du catalogue incorrect');
  const query=new URL(calls[0].url).searchParams;
  check(query.get('country')==='BE','pays non normalisé en majuscules');
  check(query.get('psu_type')==='personal','type d’utilisateur absent');
  check(catalogue.aspsps[0].name==='Belfius','catalogue non retourné tel quel');
});

await scenario('Démarrage d’autorisation : corps exact et adresse retournée',async()=>{
  const {calls,provider:client}=provider(()=>({body:{url:'https://auth.enablebanking.com/ais/start?sessionid=abc',authorization_id:'auth-1'}}));
  const started=await client.startAuthorization({bankName:'Belfius',country:'BE',redirectUrl:'https://ouvrane.be/bank/return',state:'org-A.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',validUntil:'2026-12-01T00:00:00.000Z'});
  const body=JSON.parse(calls[0].options.body);
  check(calls[0].options.method==='POST','méthode différente de POST');
  check(new URL(calls[0].url).pathname==='/auth','chemin différent de /auth');
  check(body.aspsp.name==='Belfius'&&body.aspsp.country==='BE','banque absente du corps');
  check(body.psu_type==='personal','type d’utilisateur absent du corps');
  check(body.redirect_url==='https://ouvrane.be/bank/return','adresse de retour absente');
  check(body.state==='org-A.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG','state absent du corps');
  check(body.access.valid_until==='2026-12-01T00:00:00.000Z','valid_until absent du corps');
  check(body.access.balances===true&&body.access.transactions===true,'droits de lecture non demandés');
  check(started.url==='https://auth.enablebanking.com/ais/start?sessionid=abc','adresse d’autorisation non retournée');
});

await scenario('Autorisation de session retournée telle quelle',async()=>{
  const session={session_id:'session-1',aspsp:{name:'Belfius',country:'BE'},access:{valid_until:'2026-12-01T00:00:00.000Z'},accounts:[{uid:'uid-1',currency:'EUR',identification_hash:'hash-1',account_id:{iban:'BE68539007547034'}}]};
  const {calls,provider:client}=provider(()=>({body:session}));
  const authorized=await client.authorize('code-1');
  check(new URL(calls[0].url).pathname==='/sessions','chemin différent de /sessions');
  check(JSON.parse(calls[0].options.body).code==='code-1','code absent du corps');
  check(authorized.session_id==='session-1'&&authorized.accounts.length===1,'session non retournée telle quelle');
});

await scenario('Fermeture de session : 404 toléré, autre erreur propagée',async()=>{
  const missing=provider(()=>({status:404,body:{error:'session_not_found'}})).provider;
  await missing.deleteSession('session-absente');
  const {calls,provider:client}=provider(()=>({status:204,body:null}));
  await client.deleteSession('session-1');
  check(calls[0].options.method==='DELETE','méthode différente de DELETE');
  check(new URL(calls[0].url).pathname==='/sessions/session-1','chemin de session incorrect');
  const refused=provider(()=>({status:500,body:{error:'internal_error'}})).provider;
  await assert.rejects(()=>refused.deleteSession('session-1'),error=>error.providerStatus===500);
});

await scenario('Opérations : paramètres de pagination et charge brute',async()=>{
  const payload={transactions:[{entry_reference:'ref-1'}],continuation_key:'suite-1'};
  const {calls,provider:client}=provider(()=>({body:payload}));
  const result=await client.transactions('uid-1',{dateFrom:'2026-09-01',dateTo:'2026-11-15',continuationKey:'page-0'});
  const query=new URL(calls[0].url).searchParams;
  check(new URL(calls[0].url).pathname==='/accounts/uid-1/transactions','chemin des opérations incorrect');
  check(query.get('date_from')==='2026-09-01'&&query.get('date_to')==='2026-11-15','période absente');
  check(query.get('continuation_key')==='page-0','clé de continuation absente');
  check(result.transactions.length===1&&result.continuation_key==='suite-1','charge non retournée telle quelle');
});

await scenario('Soldes : charge brute retournée',async()=>{
  const {calls,provider:client}=provider(()=>({body:{balances:[{name:'Booked balance',balance_type:'CLBD',balance_amount:{currency:'EUR',amount:'1234.56'}}]}}));
  const result=await client.balances('uid-1');
  check(new URL(calls[0].url).pathname==='/accounts/uid-1/balances','chemin des soldes incorrect');
  check(result.balances[0].balance_amount.amount==='1234.56','soldes non retournés tels quels');
});

await scenario('Refus de la banque converti en code ENABLE_ et statut conservé',async()=>{
  const {provider:client}=provider(()=>({status:401,body:{error:'invalid_token'}}));
  await assert.rejects(()=>client.institutions('BE'),error=>{
    check(error.code==='ENABLE_INVALID_TOKEN','code d’erreur non conforme au motif ENABLE_');
    check(error.providerStatus===401,'statut du fournisseur non conservé');
    return true;
  });
});

await scenario('Réponse illisible refusée sans casser le worker',async()=>{
  const {provider:client}=provider(()=>({body:{}}));
  await assert.rejects(()=>client.transactions('uid-1',{}),error=>error.code==='ENABLE_TRANSACTIONS_INVALID');
});

await scenario('Normalisation : débit, crédit, référence et contrepartie',async()=>{
  const raw={continuation_key:null,transactions:[
    {entry_reference:'debit-1',booking_date:'2026-11-10',credit_debit_indicator:'DBIT',status:'BOOK',transaction_amount:{currency:'EUR',amount:'120.50'},creditor:{name:'Fournisseur Béton'},remittance_information:['Facture 2026-114'],reference_number:'RF18539007547034'},
    {transaction_id:'credit-1',value_date:'2026-11-11',credit_debit_indicator:'CRDT',status:'BOOK',transaction_amount:{currency:'EUR',amount:'2500.00'},debtor:{name:'Client Dupont'},remittance_information:['Acompte chantier 42']},
  ]};
  const normalized=normalizeEnableTransactions(raw,{currency:'EUR'});
  check(normalized.transactions.length===2,'opérations valides non conservées');
  check(normalized.quarantined.length===0,'mise en quarantaine injustifiée');
  check(normalized.duplicateCount===0,'doublons comptés à tort');
  check(normalized.continuationKey===null,'clé de continuation non transmise');
  const debit=normalized.transactions[0];
  check(debit.externalId==='debit-1'&&debit.bookingDate==='2026-11-10','référence ou date du débit incorrecte');
  check(debit.amountCents===-12050,'montant du débit non signé en centimes');
  check(debit.currency==='EUR','devise du débit incorrecte');
  check(debit.counterparty==='Fournisseur Béton','contrepartie du débit incorrecte');
  check(debit.reference==='RF18539007547034','référence structurée perdue');
  check(debit.description.includes('Facture 2026-114'),'libellé du débit perdu');
  const credit=normalized.transactions[1];
  check(credit.externalId==='credit-1','repli sur transaction_id non appliqué');
  check(credit.bookingDate==='2026-11-11','repli sur value_date non appliqué');
  check(credit.amountCents===250000,'montant du crédit non signé en centimes');
  check(credit.counterparty==='Client Dupont','contrepartie du crédit incorrecte');
});

await scenario('Normalisation : quarantaine, doublons, devises et statuts',async()=>{
  const raw={continuation_key:'suite-2',transactions:[
    {entry_reference:'double-1',booking_date:'2026-11-10',credit_debit_indicator:'DBIT',status:'BOOK',transaction_amount:{currency:'EUR',amount:'10.00'}},
    {entry_reference:'double-1',booking_date:'2026-11-10',credit_debit_indicator:'DBIT',status:'BOOK',transaction_amount:{currency:'EUR',amount:'10.00'}},
    {entry_reference:'devise-1',booking_date:'2026-11-10',credit_debit_indicator:'DBIT',status:'BOOK',transaction_amount:{currency:'USD',amount:'10.00'}},
    {entry_reference:'statut-1',booking_date:'2026-11-10',credit_debit_indicator:'DBIT',status:'PDNG',transaction_amount:{currency:'EUR',amount:'10.00'}},
    {entry_reference:'date-1',credit_debit_indicator:'DBIT',status:'BOOK',transaction_amount:{currency:'EUR',amount:'10.00'}},
    {entry_reference:'montant-1',booking_date:'2026-11-10',credit_debit_indicator:'DBIT',status:'BOOK',transaction_amount:{currency:'EUR',amount:'pas un nombre'}},
    {booking_date:'2026-11-10',credit_debit_indicator:'DBIT',status:'BOOK',transaction_amount:{currency:'EUR',amount:'10.00'}},
  ]};
  const normalized=normalizeEnableTransactions(raw,{currency:'EUR'});
  check(normalized.transactions.length===1,'seule la première opération valide doit être conservée');
  check(normalized.duplicateCount===1,'doublon non compté');
  check(normalized.quarantined.length===5,'quarantaine incomplète');
  const reasons=normalized.quarantined.map(entry=>entry.reason).sort();
  check(JSON.stringify(reasons)===JSON.stringify(['date_illisible','devise_non_prise_en_charge','montant_illisible','reference_absente','statut_non_comptabilise']),'raisons de quarantaine inattendues : '+reasons.join(','));
  check(normalized.continuationKey==='suite-2','clé de continuation perdue');
});

await scenario('Solde comptable choisi, sinon rien',async()=>{
  const booked=selectEnableBookedBalance({balances:[
    {name:'Available balance',balance_type:'ITAV',balance_amount:{currency:'EUR',amount:'900.00'}},
    {name:'Booked balance',balance_type:'CLBD',balance_amount:{currency:'EUR',amount:'1234.56'}},
  ]},'EUR');
  check(booked&&booked.amountCents===123456,'solde comptable non retenu');
  check(booked.type==='CLBD','type de solde non retourné');
  const interim=selectEnableBookedBalance({balances:[
    {name:'Booked balance',balance_type:'ITBD',balance_amount:{currency:'EUR',amount:'10.00'}},
    {name:'Booked balance',balance_type:'CLBD',balance_amount:{currency:'EUR',amount:'20.00'}},
  ]},'EUR');
  check(interim.amountCents===1000,'priorité du solde du jour non respectée');
  const negative=selectEnableBookedBalance({balances:[{name:'Booked balance',balance_type:'CLBD',balance_amount:{currency:'EUR',amount:'-42.10'}}]},'EUR');
  check(negative.amountCents===-4210,'solde négatif mal converti');
  const other=selectEnableBookedBalance({balances:[{name:'Booked balance',balance_type:'CLBD',balance_amount:{currency:'USD',amount:'10.00'}}]},'EUR');
  check(other===null,'devise étrangère acceptée');
  check(selectEnableBookedBalance({balances:[]},'EUR')===null,'liste vide acceptée');
  check(selectEnableBookedBalance(null,'EUR')===null,'charge absente acceptée');
});

console.log(JSON.stringify({status:'PASS',checks,scenarios},null,2));
```

Lancer :

```bash
node tests/bank-provider-enable.mjs
```

Attendu (échec voulu) :

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\OUVRANE-TRAVAIL\ouvrane\worker\bank-provider-enable.js'
```

### T3 — Squelette du module (échec plus précis)

Créer `worker/bank-provider-enable.js` :

```js
// Fournisseur Enable Banking pour Ouvrane.
//
// Ce fichier ne contient AUCUN secret. scripts/bank-runtime.mjs lit la clé privée RSA et la clé
// de chiffrement dans des fichiers privés hors dépôt et les passe à createEnableBankingProvider().
// L'ancienne version embarquait une clé privée, ce qui l'a fait écarter de tous les transferts.

export function createEnableBankingProvider(){
  throw Object.assign(new Error('Fournisseur bancaire non implémenté.'),{code:'ENABLE_NOT_IMPLEMENTED'});
}

export function normalizeEnableTransactions(){
  throw Object.assign(new Error('Normalisation non implémentée.'),{code:'ENABLE_NOT_IMPLEMENTED'});
}

export function selectEnableBookedBalance(){
  throw Object.assign(new Error('Sélection de solde non implémentée.'),{code:'ENABLE_NOT_IMPLEMENTED'});
}
```

Lancer : `node tests/bank-provider-enable.mjs`

Attendu : plus d'`ERR_MODULE_NOT_FOUND`, mais `AssertionError` avec
`code: 'ENABLE_NOT_IMPLEMENTED'` — le premier scénario s'exécute bien.

### T4 — Outils internes et signature JWT

Remplacer le haut du fichier (avant les exports) par :

```js
const API_BASE='https://api.enablebanking.com';
const TOKEN_TTL_SECONDS=3600;
const REQUEST_TIMEOUT_MS=20000;
const MAX_REFERENCE_LENGTH=200;
const BOOKED_BALANCE_ORDER=['ITBD','CLBD','PRCD'];

const fail=(message,status=502,code='ENABLE_PROVIDER_FAILED')=>{throw Object.assign(new Error(message),{status,code})};
const text=(value,max=500)=>String(value??'').trim().slice(0,max);
const ascii=(value)=>String(value).replace(/[^\x20-\x7e]/g,'');

function base64url(value){
  const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
  let binary='';
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}

function pemToDer(pem){
  const match=/-----BEGIN ([A-Z ]+)-----([\s\S]+?)-----END \1-----/.exec(String(pem||''));
  if(!match)fail('Clé privée bancaire illisible.',503,'ENABLE_KEY_INVALID');
  let binary;
  try{binary=atob(match[2].replace(/\s+/g,''))}catch{fail('Clé privée bancaire illisible.',503,'ENABLE_KEY_INVALID')}
  const bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
  return bytes;
}

async function importSigningKey(pem){
  try{
    return await crypto.subtle.importKey('pkcs8',pemToDer(pem),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  }catch(error){
    if(error?.code)fail(error.message,error.status,error.code);
    fail('Clé privée bancaire refusée.',503,'ENABLE_KEY_INVALID');
  }
}

async function signedToken(appId,key){
  const now=Math.floor(Date.now()/1000);
  const header=base64url(JSON.stringify({typ:'JWT',alg:'RS256',kid:appId}));
  const payload=base64url(JSON.stringify({iss:'enablebanking.com',aud:'api.enablebanking.com',iat:now,exp:now+TOKEN_TTL_SECONDS}));
  const signing=header+'.'+payload;
  const signature=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(signing)));
  return signing+'.'+base64url(signature);
}

function centsOf(value,indicator){
  if(typeof value!=='string'&&typeof value!=='number')return null;
  const raw=String(value).trim().replace(',','.');
  if(!/^-?\d{1,15}(\.\d{1,2})?$/.test(raw))return null;
  const amount=Number(raw);
  if(!Number.isFinite(amount))return null;
  const magnitude=Math.round(Math.abs(amount)*100);
  if(!Number.isSafeInteger(magnitude))return null;
  if(indicator==='DBIT')return -magnitude;
  if(indicator==='CRDT')return magnitude;
  return Math.round(amount*100);
}
```

Lancer : `node tests/bank-provider-enable.mjs`

Attendu : le texte du scénario change mais rien ne passe tant que le fournisseur de T5 n'existe pas.
En pratique T4 et T5 se jettent ensemble dans le fichier ; la sortie attendue de T5 vaut pour les deux.

### T5 — Client HTTP et catalogue

Insérer avant les exports :

```js
async function call({path,method='GET',query,body,authorization,fetchImpl}){
  const url=new URL(API_BASE+path);
  for(const [name,value] of Object.entries(query||{}))if(value!==null&&value!==undefined&&value!=='')url.searchParams.set(name,value);
  const headers={accept:'application/json',authorization};
  if(body!==undefined)headers['content-type']='application/json';
  let response;
  try{
    response=await fetchImpl(url.href,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
  }catch{
    fail('La banque n’a pas répondu dans le délai imparti.',504,'ENABLE_TIMEOUT');
  }
  const raw=await response.text();
  let payload=null;
  if(raw){try{payload=JSON.parse(raw)}catch{payload=null}}
  if(!response.ok){
    const slug=ascii(text(payload?.error||payload?.code||payload?.message,80)).toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');
    throw Object.assign(new Error('La banque a refusé la demande.'),{providerStatus:response.status,code:slug?'ENABLE_'+slug:'ENABLE_HTTP_'+response.status});
  }
  return payload;
}
```

Puis remplacer l'export `createEnableBankingProvider` par :

```js
export function createEnableBankingProvider({appId,privateKeyPem,fetchImpl=globalThis.fetch}={}){
  const identifier=text(appId,200);
  if(!identifier)fail('Identifiant d’application bancaire manquant.',503,'ENABLE_APP_ID_MISSING');
  if(typeof fetchImpl!=='function')fail('Client HTTP bancaire indisponible.',503,'ENABLE_FETCH_MISSING');
  let signingKey=null;
  const request=async({path,method,query,body})=>{
    if(!signingKey)signingKey=importSigningKey(privateKeyPem);
    return call({path,method,query,body,fetchImpl,authorization:'Bearer '+await signedToken(identifier,await signingKey)});
  };
  return {
    async institutions(country){
      const payload=await request({path:'/aspsps',query:{country:text(country,2).toUpperCase(),psu_type:'personal'}});
      if(!payload||!Array.isArray(payload.aspsps))fail('Catalogue bancaire indisponible.',502,'ENABLE_CATALOGUE_INVALID');
      return payload;
    },
  };
}
```

Lancer : `node tests/bank-provider-enable.mjs`

Attendu : scénarios 1 et 2 passent, échec sur `client.startAuthorization is not a function`.

### T6 — Démarrage, autorisation et fermeture de session

Ajouter les trois méthodes dans l'objet retourné, après `institutions` :

```js
    async startAuthorization({bankName,country,redirectUrl,state,validUntil}){
      const payload=await request({path:'/auth',method:'POST',body:{
        access:{valid_until:validUntil,balances:true,transactions:true},
        aspsp:{name:text(bankName,160),country:text(country,2).toUpperCase()},
        psu_type:'personal',
        redirect_url:redirectUrl,
        state,
      }});
      const url=text(payload?.url,2048);
      if(!url)fail('La banque n’a pas fourni d’adresse d’autorisation.',502,'ENABLE_AUTHORIZATION_URL_MISSING');
      return {url,authorizationId:text(payload.authorization_id,200)||null};
    },
    async authorize(code){
      const payload=await request({path:'/sessions',method:'POST',body:{code}});
      if(!payload||!text(payload.session_id,200))fail('La banque n’a pas créé de session.',502,'ENABLE_SESSION_INVALID');
      return payload;
    },
    async deleteSession(sessionId){
      try{
        await request({path:'/sessions/'+encodeURIComponent(text(sessionId,200)),method:'DELETE'});
      }catch(error){
        if(error.providerStatus!==404)throw error;
      }
      return true;
    },
```

Lancer : `node tests/bank-provider-enable.mjs`

Attendu : scénarios 1 à 5 passent, échec sur `client.transactions is not a function`.

### T7 — Opérations et soldes

Ajouter après `deleteSession` :

```js
    async transactions(accountId,{dateFrom,dateTo,continuationKey}={}){
      const payload=await request({
        path:'/accounts/'+encodeURIComponent(text(accountId,200))+'/transactions',
        query:{date_from:dateFrom,date_to:dateTo,continuation_key:continuationKey},
      });
      if(!payload||!Array.isArray(payload.transactions))fail('La banque n’a pas retourné d’opérations lisibles.',502,'ENABLE_TRANSACTIONS_INVALID');
      return payload;
    },
    async balances(accountId){
      const payload=await request({path:'/accounts/'+encodeURIComponent(text(accountId,200))+'/balances'});
      if(!payload||!Array.isArray(payload.balances))fail('La banque n’a pas retourné de solde lisible.',502,'ENABLE_BALANCES_INVALID');
      return payload;
    },
```

Lancer : `node tests/bank-provider-enable.mjs`

Attendu : scénarios 1 à 9 passent, échec sur `normalizeEnableTransactions is not a function`
(l'export existe mais lève `ENABLE_NOT_IMPLEMENTED`).

### T8 — Normalisation des opérations

Ajouter ces fonctions avant les exports, puis remplacer le corps de `normalizeEnableTransactions` :

```js
function descriptionOf(row){
  const parts=[];
  if(Array.isArray(row?.remittance_information))for(const line of row.remittance_information)if(text(line,500))parts.push(text(line,500));
  if(text(row?.note,500))parts.push(text(row.note,500));
  return text(parts.join(' · '),500);
}

function counterpartyOf(row){
  const name=row?.credit_debit_indicator==='DBIT'?row?.creditor?.name:row?.debtor?.name;
  return text(name||row?.creditor?.name||row?.debtor?.name,240);
}
```

```js
export function normalizeEnableTransactions(payload,{currency='EUR'}={}){
  const rows=Array.isArray(payload?.transactions)?payload.transactions:[];
  const wanted=text(currency,3).toUpperCase();
  const transactions=[],quarantined=[],seen=new Set();
  let duplicateCount=0;
  for(const row of rows){
    const amount=row?.transaction_amount;
    const rowCurrency=text(amount?.currency,3).toUpperCase();
    const bookingDate=text(row?.booking_date||row?.value_date||row?.transaction_date,10);
    const amountCents=centsOf(amount?.amount,row?.credit_debit_indicator);
    const externalId=text(row?.entry_reference||row?.transaction_id||row?.reference_number,MAX_REFERENCE_LENGTH);
    const status=text(row?.status,8).toUpperCase();
    const reason=!externalId?'reference_absente'
      :amountCents===null?'montant_illisible'
      :!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)?'date_illisible'
      :rowCurrency!==wanted?'devise_non_prise_en_charge'
      :status&&status!=='BOOK'?'statut_non_comptabilise'
      :'';
    if(reason){
      quarantined.push({reason,externalId:externalId||null,bookingDate:bookingDate||null,status:status||null});
      continue;
    }
    if(seen.has(externalId)){duplicateCount++;continue}
    seen.add(externalId);
    transactions.push({
      externalId,
      bookingDate,
      amountCents,
      currency:wanted,
      description:descriptionOf(row),
      reference:text(row?.reference_number||row?.entry_reference,240),
      counterparty:counterpartyOf(row),
    });
  }
  return {transactions,quarantined,duplicateCount,continuationKey:text(payload?.continuation_key,4096)||null};
}
```

Lancer : `node tests/bank-provider-enable.mjs`

Attendu : scénarios 1 à 10 passent, échec sur la sélection de solde
(`selectEnableBookedBalance` lève encore `ENABLE_NOT_IMPLEMENTED`).

### T9 — Sélection du solde comptable

```js
export function selectEnableBookedBalance(payload,currency='EUR'){
  const rows=Array.isArray(payload?.balances)?payload.balances:[];
  const wanted=text(currency,3).toUpperCase();
  const candidates=[];
  for(const row of rows){
    const cents=centsOf(row?.balance_amount?.amount,null);
    const rowCurrency=text(row?.balance_amount?.currency,3).toUpperCase();
    if(cents===null||rowCurrency!==wanted)continue;
    candidates.push({cents,type:text(row?.balance_type,8).toUpperCase(),name:text(row?.name,80)});
  }
  if(!candidates.length)return null;
  const rank=candidate=>{
    const index=BOOKED_BALANCE_ORDER.indexOf(candidate.type);
    if(index!==-1)return index;
    if(/booked/i.test(candidate.name))return BOOKED_BALANCE_ORDER.length;
    if(candidate.type==='ITAV')return BOOKED_BALANCE_ORDER.length+1;
    if(candidate.type==='CLAV')return BOOKED_BALANCE_ORDER.length+2;
    return BOOKED_BALANCE_ORDER.length+3;
  };
  candidates.sort((left,right)=>rank(left)-rank(right));
  const chosen=candidates[0];
  return {amountCents:chosen.cents,type:chosen.type||null,name:chosen.name||null};
}
```

Lancer : `node tests/bank-provider-enable.mjs`

Attendu :

```
{
  "status": "PASS",
  "checks": 60,
  "scenarios": [ … 12 lignes … ]
}
```

et `echo $?` → `0`.

### T10 — Aucun secret dans le fichier

```bash
grep -c "PRIVATE KEY" worker/bank-provider-enable.js
grep -c "atob\|btoa" worker/bank-provider-enable.js
wc -l worker/bank-provider-enable.js
```

Attendu : `0` (aucune clé), puis `2` (les deux fonctions d'encodage, sans clé), puis environ 213 lignes.
Si le premier compte n'est pas zéro, la reconstruction est fausse et le transfert suivant écartera
encore le fichier.

### T11 — Construction

```bash
npm run build
```

Attendu : `exit 0`, la ligne `Worker and interface built.`, et **plus aucune ligne**
`build: worker/bank-provider-enable.js absent`. La ligne de garde reste en place dans
`scripts/build.mjs:106` : si l'avertissement réapparaît, le fichier a disparu à nouveau.

### T12 — Les neuf suites bancaires

```bash
for suite in archived-project-hours contact-files-api document-content-revocation hr-incremental-audit-api isolation-time-entry-integrity promax-reference-pointages time-hr-api top27-hours-finance-api topo-preview; do
  printf '%-40s ' "$suite"
  node --experimental-sqlite "tests/$suite.mjs" > D:/OUVRANE-TRAVAIL/suite-resultat.json 2>&1 \
    && python -c "import json;d=json.load(open(r'D:/OUVRANE-TRAVAIL/suite-resultat.json',encoding='utf-8'));print(d['status'],d['checks'])" \
    || tail -2 D:/OUVRANE-TRAVAIL/suite-resultat.json
done
```

Attendu : huit lignes `PASS` ou `RESULT <n>/<n>`, et une ligne rouge sur promax si `data/` est absent.

**Deux correctifs découverts pendant l'exécution :**

1. **La base d'amorçage.** Le transfert a exclu `data/socle.sqlite` (motif `base-locale-exclue`,
   4 128 768 octets) ; c'est un fichier local ignoré par git. Les suites API en ont besoin, pas
   seulement du schéma : `time-hr-api.mjs` exige un propriétaire actif et des tables
   `production_credentials` et `production_sessions` vides. La graine existe dans git sous
   `scripts/seed-batinova.sqlite` (2 801 664 octets, 1 entreprise, 6 rôles, propriétaire actif,
   aucune identité de production). La poser :

   ```bash
   mkdir -p data && cp scripts/seed-batinova.sqlite data/socle.sqlite
   ```

   `promax-reference-pointages.mjs` a en plus un chemin codé en dur vers l'ancienne machine :
   `const resultsRoot='D:/Ouvrane/Corrections/2026-10-24-INTEGRATION-PROMAX/retour-agent-tests'`
   (ligne 9). Sans ce dossier, il échoue en `ENOENT` ; avec, il passe à 8 contrôles. Le chemin
   mérite d'être rendu configurable.

2. **`topo-preview` n'est pas une suite.** Il démarre un serveur, écrit `READY.json` et attend un
   fichier `STOP` : il ne se termine jamais seul et refuse de réutiliser un dossier de sortie
   (`synthetic.sqlite` existant). Il a été ajouté aux exclusions de `scripts/test.mjs`, comme
   `production-v5-start.mjs` avant lui, avec un commentaire explicite.

### T13 — Base de référence complète

```bash
rm -f /d/OUVRANE-TRAVAIL/baseline-suites.jsonl
node /d/OUVRANE-TRAVAIL/baseline-run.mjs
```

Attendu : `terminé : 50 OK, 2 KO, 0 déjà connues, 52 suites au total`. Les deux restantes sont
`resilience-regressions.mjs` (bac à sable `resilience-vm/` absent) et `third-party-notices.mjs`
(faux `fs` du test sans `readdir`), toutes deux sans rapport avec la banque. Aucune régression.
### T14 — Documenter et commiter

Créer `docs/CONNECTEUR-BANCAIRE.md` :

```markdown
# Connecteur bancaire

`worker/bank-provider-enable.js` parle à l'API Enable Banking. Il ne contient aucun secret :
`scripts/bank-runtime.mjs` lit les fichiers privés et les lui passe.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `SOCLE_BANK_ENABLED` | `1` pour activer le connecteur |
| `SOCLE_BANK_ENABLEBANKING_APP_ID` | identifiant d'application (le `kid` du jeton) |
| `SOCLE_BANK_ENABLEBANKING_PRIVATE_KEY_PATH` | fichier de clé privée RSA, PKCS#8, 2048 bits minimum |
| `SOCLE_BANK_ENCRYPTION_KEY_PATH` | 32 octets encodés en base64, chiffre les sessions |
| `SOCLE_BANK_ORGANIZATION_ID` | entreprise autorisée |
| `SOCLE_BANK_OWNER_USER_ID` | propriétaire autorisé |
| `SOCLE_BANK_ENVIRONMENT` | `SANDBOX` ou `PRODUCTION` |
| `SOCLE_BANK_REDIRECT_URI` | doit valoir `https://ouvrane.be/bank/return` |

Les deux fichiers privés vivent hors dépôt. Aucun secret ne rentre dans un fichier versionné : le
scanner de secrets du transfert écarte tout fichier qui en contient, c'est ce qui a coûté la première
version de ce module.
```

Puis :

```bash
git -c safe.directory=D:/OUVRANE-TRAVAIL/ouvrane add worker/bank-provider-enable.js tests/bank-provider-enable.mjs docs/CONNECTEUR-BANCAIRE.md
git -c safe.directory=D:/OUVRANE-TRAVAIL/ouvrane -c user.name="Hermes" -c user.email="hermes@local" commit -m "Connecteur bancaire reconstruit sans secret : 9 suites de nouveau vertes"
git -c safe.directory=D:/OUVRANE-TRAVAIL/ouvrane tag -f baseline-banque-verte
```

Attendu : un commit, puis `baseline-banque-verte` dans `git tag -l`.

## Tests / validation

- Cycle TDD strict : le test de T2 échoue avant tout code, chaque tâche suivante déplace l'échec
  d'un cran et rien n'est écrit sans un test rouge préalable.
- Le test ne touche pas le réseau : `fetch` est remplacé, la paire de clés est générée localement,
  aucune clé n'est versionnée.
- Contrôle final : `npm run build` sans avertissement, les 9 suites bancaires vertes, 50/52 sur la
  base complète, aucun secret dans le fichier.
- Le comportement non couvert par les appelants (statuts importés, choix du solde, choix de
  `externalId`) est figé par des assertions explicites, donc modifiable en connaissance de cause.

## Risks, tradeoffs, and open questions

| Risque | Traitement |
|---|---|
| Le comportement exact de l'original est perdu | Trois décisions sont isolées et testées (statuts, solde, `externalId`). À valider par Louis avant le commit de T14. |
| L'hôte de l'adresse d'autorisation | `bank-connections.js:53` exige `auth.enablebanking.com`. Si le bac à sable renvoie `tilisy.enablebanking.com`, l'utilisateur reçoit un 502. À vérifier avec une vraie application `SANDBOX`. |
| Aucun test d'intégration réelle | Le test valide le contrat, pas le fournisseur. Une vérification de bout en bout demande une application Enable Banking et des identifiants, donc une action de Louis. |
| Nouvelle version non validée par la production | Le module n'est actif que si `SOCLE_BANK_ENABLED=1` et que la configuration est complète (`bank-runtime.mjs:8`), sinon le connecteur reste désactivé. Aucun risque pour la production existante. |
| Clé de chiffrement | `bank-connections.js:14` exige 32 octets en base64. Si la clé d'origine est perdue, les sessions déjà chiffrées en base deviennent illisibles et il faut réautoriser les comptes. À vérifier avant toute mise en production. |
| Le transfert écartera-t-il encore le fichier ? | Non si aucun secret n'y figure. Le contrôle de T10 le vérifie mécaniquement. |
