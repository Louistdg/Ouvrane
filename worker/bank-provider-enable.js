// Fournisseur Enable Banking pour Ouvrane.
//
// Ce fichier ne contient AUCUN secret. scripts/bank-runtime.mjs lit la clé privée RSA et la clé
// de chiffrement dans des fichiers privés hors dépôt et les passe à createEnableBankingProvider().
// L'ancienne version embarquait une clé privée, ce qui l'a fait écarter de tous les transferts.

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

export function createEnableBankingProvider({appId,privateKeyPem,fetchImpl=globalThis.fetch}={}){
  const identifier=text(appId,200);
  if(!identifier)fail('Identifiant d’application bancaire manquant.',503,'ENABLE_APP_ID_MISSING');
  if(typeof fetchImpl!=='function')fail('Client HTTP bancaire indisponible.',503,'ENABLE_FETCH_MISSING');
  let signingKey=null;
  const request=async ({path,method,query,body})=>{
    if(!signingKey)signingKey=importSigningKey(privateKeyPem);
    return call({path,method,query,body,fetchImpl,authorization:'Bearer '+await signedToken(identifier,await signingKey)});
  };
  return {
    async institutions(country){
      const payload=await request({path:'/aspsps',query:{country:text(country,2).toUpperCase(),psu_type:'personal'}});
      if(!payload||!Array.isArray(payload.aspsps))fail('Catalogue bancaire indisponible.',502,'ENABLE_CATALOGUE_INVALID');
      return payload;
    },
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
  };
}

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
