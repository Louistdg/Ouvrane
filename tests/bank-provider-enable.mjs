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
