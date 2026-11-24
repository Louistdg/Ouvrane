// Préférences utilisateur : /api/me/preferences et le réglage partagé des jours visibles du planning.
//
// Extrait de worker/index.js. Comme les autres modules de worker/, ce fichier ne connaît de son hôte
// que les crochets reçus en dernier argument : json, body, rows, now, exactObject et accessPolicy.

const USER_PREFERENCE_BODY_LIMIT=20*1024,USER_PREFERENCE_VALUE_LIMIT=16*1024;
const USER_PREFERENCE_SCHEMAS=Object.freeze({
  dashboard:Object.freeze({version:1,keys:new Set(['layout','widgets','density','canvas','job-tabs','jobs-order','task-folders','task-spatial-desk','document-folders','home-widgets','home-layout'])}),
  'quick-actions':Object.freeze({version:1,keys:new Set(['items'])}),
  'saved-views':Object.freeze({version:1,keys:new Set(['definitions'])}),
  resume:Object.freeze({version:1,keys:new Set(['context'])}),
});
const USER_PREFERENCE_FORBIDDEN_FIELDS=/^(?:user_?id|organization_?id|role|permissions?|scope|access|authorization|auth|token|secret|credential|membership|project_?access)$/i;

export function validateUserPreferenceValue(value){
  const seen=new Set();let nodes=0;
  function visit(item,depth){
    if(depth>8||++nodes>1500)throw Object.assign(Error('Préférence trop complexe.'),{status:400});
    if(item===null||typeof item==='boolean'||typeof item==='number')return;
    if(typeof item==='string'){if(item.length>2048)throw Object.assign(Error('Texte de préférence trop long.'),{status:400});return;}
    if(typeof item!=='object')throw Object.assign(Error('Valeur de préférence invalide.'),{status:400});
    if(seen.has(item))throw Object.assign(Error('Valeur de préférence cyclique.'),{status:400});seen.add(item);
    if(Array.isArray(item)){if(item.length>200)throw Object.assign(Error('Liste de préférence trop longue.'),{status:400});for(const child of item)visit(child,depth+1);}
    else{const keys=Object.keys(item);if(keys.length>100)throw Object.assign(Error('Préférence trop complexe.'),{status:400});for(const key of keys){if(key.length>80||USER_PREFERENCE_FORBIDDEN_FIELDS.test(key))throw Object.assign(Error('Une préférence ne peut contenir de droit, identité ou secret.'),{status:400});visit(item[key],depth+1);}}
    seen.delete(item);
  }
  if(value===null||typeof value!=='object')throw Object.assign(Error('La préférence doit être un objet ou une liste JSON.'),{status:400});
  visit(value,0);
  const serialized=JSON.stringify(value),size=new TextEncoder().encode(serialized).length;
  if(size>USER_PREFERENCE_VALUE_LIMIT)throw Object.assign(Error('Préférence trop volumineuse.'),{status:413});
  return serialized;
}

function validateHomeLayout(value,h){
  const data=h.exactObject(value,['positions','mobileOrder']),ids=new Set(['weather','portals','attention','messages','tasks','calendar','jobs','invoices','expenses','accounting-links']);
  if(!data.positions||typeof data.positions!=='object'||Array.isArray(data.positions)||!Array.isArray(data.mobileOrder)||data.mobileOrder.some(item=>!ids.has(item))||new Set(data.mobileOrder).size!==data.mobileOrder.length)throw Object.assign(Error('Disposition d’accueil invalide.'),{status:400});
  for(const [key,item] of Object.entries(data.positions)){
    if(!ids.has(key))throw Object.assign(Error('Bloc d’accueil inconnu.'),{status:400});
    const p=h.exactObject(item,['column','row','span']);
    if(![0,1].includes(p.column)||!Number.isInteger(p.row)||p.row<0||p.row>500||![1,2].includes(p.span)||p.column+p.span>2)throw Object.assign(Error('Position de bloc invalide.'),{status:400});
  }
  return validateUserPreferenceValue(value);
}

function userPreferenceDescriptor(namespace,key){
  const descriptor=USER_PREFERENCE_SCHEMAS[namespace];
  if(!descriptor||!descriptor.keys.has(key))throw Object.assign(Error('Espace ou clé de préférence inconnus.'),{status:400});
  return descriptor;
}

async function requireUserPreferencePermission(env,ctx,h){
  const policy=await h.accessPolicy(env,ctx);
  // Reuse an existing application-entry permission. Preferences add no grant
  // and do not participate in authorization or resource-scope decisions.
  if(!(policy.owner||['workspace.view','accounting.view','ui.module.personal.view','ui.module.planning.view','planning.view'].some(permission=>policy.has(permission))))throw Object.assign(Error('Aucune autorisation active pour les préférences utilisateur.'),{status:403});
}

export async function userPreferencesRoute(request,url,env,ctx,namespace,key,h){
  await requireUserPreferencePermission(env,ctx,h);
  if([...url.searchParams.keys()].length)throw Object.assign(Error('Paramètre de requête inattendu.'),{status:400});
  const org=ctx.organizationId,uid=ctx.uid,sharedPlanningDays=namespace==='planning'&&key==='visible-days';
  const present=row=>row?{namespace:row.namespace,key:row.preference_key,schemaVersion:Number(row.schema_version),value:JSON.parse(row.value_json),createdAt:row.created_at,updatedAt:row.updated_at}:null;
  if(sharedPlanningDays){
    if(request.method!=='GET'&&ctx.roleCode!=='OWNER')throw Object.assign(Error('Seul le patron peut régler les jours visibles du planning.'),{status:403});
    if(request.method==='GET'){
      const row=await env.DB.prepare("SELECT 'planning' AS namespace,preference_key,schema_version,value_json,created_at,updated_at FROM organization_preferences WHERE organization_id=? AND preference_key='planning-visible-days' AND schema_version=1").bind(org).first();
      return h.json({preference:present(row)});
    }
    if(request.method==='PUT'){
      const data=h.exactObject(await h.body(request,USER_PREFERENCE_BODY_LIMIT),['schemaVersion','value']);
      if(data.schemaVersion!==1)throw Object.assign(Error('Version de schéma de préférence inconnue.'),{status:400});
      const settings=h.exactObject(data.value,['days']),days=settings.days,allowedDays=new Set([0,1,2,3,4,5,6]);
      if(!Array.isArray(days)||days.length<5||days.length>7||days.some(day=>!Number.isInteger(day)||!allowedDays.has(day))||new Set(days).size!==days.length||[1,2,3,4,5].some(day=>!days.includes(day)))throw Object.assign(Error('Le planning doit conserver les jours ouvrés et ne peut ajouter que samedi ou dimanche.'),{status:400});
      const valueJson=validateUserPreferenceValue({days:[1,2,3,4,5,...[6,0].filter(day=>days.includes(day))]}),stamp=h.now();
      await env.DB.prepare("INSERT INTO organization_preferences(organization_id,preference_key,schema_version,value_json,created_at,updated_at,updated_by) VALUES(?,'planning-visible-days',1,?,?,?,?) ON CONFLICT(organization_id,preference_key,schema_version) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by").bind(org,valueJson,stamp,stamp,uid).run();
      const row=await env.DB.prepare("SELECT 'planning' AS namespace,preference_key,schema_version,value_json,created_at,updated_at FROM organization_preferences WHERE organization_id=? AND preference_key='planning-visible-days' AND schema_version=1").bind(org).first();
      return h.json({preference:present(row)});
    }
    if(request.method==='DELETE'){
      await env.DB.prepare("DELETE FROM organization_preferences WHERE organization_id=? AND preference_key='planning-visible-days'").bind(org).run();
      return new Response(null,{status:204,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
    }
    return h.json({error:'Méthode non autorisée.'},405);
  }
  const target=namespace===undefined?null:userPreferenceDescriptor(namespace,key);
  if(target===null){
    if(request.method!=='GET')return h.json({error:'Méthode non autorisée.'},405);
    const stored=await h.rows(env.DB.prepare('SELECT namespace,preference_key,schema_version,value_json,created_at,updated_at FROM user_preferences WHERE organization_id=? AND user_id=? ORDER BY namespace,preference_key,schema_version').bind(org,uid));
    return h.json({preferences:stored.filter(row=>USER_PREFERENCE_SCHEMAS[row.namespace]?.version===Number(row.schema_version)).map(present)});
  }
  if(request.method==='GET'){
    const row=await env.DB.prepare('SELECT namespace,preference_key,schema_version,value_json,created_at,updated_at FROM user_preferences WHERE organization_id=? AND user_id=? AND namespace=? AND preference_key=? AND schema_version=?').bind(org,uid,namespace,key,target.version).first();
    return h.json({preference:present(row)});
  }
  if(request.method==='PUT'){
    const homeLayout=namespace==='dashboard'&&key==='home-layout';
    const data=h.exactObject(await h.body(request,USER_PREFERENCE_BODY_LIMIT),homeLayout?['schemaVersion','value','expectedValue']:['schemaVersion','value']);
    if(data.schemaVersion!==target.version)throw Object.assign(Error('Version de schéma de préférence inconnue.'),{status:400});
    const value=data.value;
    const valueJson=homeLayout?validateHomeLayout(value,h):validateUserPreferenceValue(value),stamp=h.now();
    if(homeLayout){
      if(!Object.hasOwn(data,'expectedValue'))throw Object.assign(Error('La version de départ de la disposition est obligatoire.'),{status:400});
      const expected=data.expectedValue===null?null:validateHomeLayout(data.expectedValue,h);
      const read=()=>env.DB.prepare('SELECT namespace,preference_key,schema_version,value_json,created_at,updated_at FROM user_preferences WHERE organization_id=? AND user_id=? AND namespace=? AND preference_key=? AND schema_version=?').bind(org,uid,namespace,key,target.version).first();
      const previous=await read();
      if(previous?.value_json===valueJson)return h.json({preference:present(previous),replayed:true});
      if((previous?.value_json??null)!==expected)throw Object.assign(Error('La disposition a changé dans une autre fenêtre. Rechargez-la avant de reprendre.'),{status:409});
      if(expected===null){
        await env.DB.prepare('INSERT OR IGNORE INTO user_preferences(organization_id,user_id,namespace,preference_key,schema_version,value_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(org,uid,namespace,key,target.version,valueJson,stamp,stamp).run();
      }else{
        await env.DB.prepare('UPDATE user_preferences SET value_json=?,updated_at=? WHERE organization_id=? AND user_id=? AND namespace=? AND preference_key=? AND schema_version=? AND value_json=?').bind(valueJson,stamp,org,uid,namespace,key,target.version,expected).run();
      }
      const saved=await read();
      if(saved?.value_json!==valueJson)throw Object.assign(Error('La disposition a changé dans une autre fenêtre. Rechargez-la avant de reprendre.'),{status:409});
      return h.json({preference:present(saved)});
    }
    await env.DB.prepare('INSERT INTO user_preferences(organization_id,user_id,namespace,preference_key,schema_version,value_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,user_id,namespace,preference_key,schema_version) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at').bind(org,uid,namespace,key,target.version,valueJson,stamp,stamp).run();
    const row=await env.DB.prepare('SELECT namespace,preference_key,schema_version,value_json,created_at,updated_at FROM user_preferences WHERE organization_id=? AND user_id=? AND namespace=? AND preference_key=? AND schema_version=?').bind(org,uid,namespace,key,target.version).first();
    return h.json({preference:present(row)});
  }
  if(request.method==='DELETE'){
    await env.DB.prepare('DELETE FROM user_preferences WHERE organization_id=? AND user_id=? AND namespace=? AND preference_key=?').bind(org,uid,namespace,key).run();
    return new Response(null,{status:204,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
  }
  return h.json({error:'Méthode non autorisée.'},405);
}
