// Shared visibility for a quote and the visit/documents attached to it.
// Before a project exists, the customer directory permission is the boundary.
const refuse=(message,status)=>{throw Object.assign(Error(message),{status})};
export async function requireCommercialQuoteScope(env,ctx,quote,h){
  if(!quote)refuse('Devis introuvable.',404);
  if(quote.project_id)await h.requireFinanceProjectScope(env,ctx,quote.project_id);
  else await h.requirePermission(env,ctx,'customers.view');
}
export async function requireCommercialVisitScope(env,ctx,visit,h){
  if(!visit)refuse('Dossier de visite introuvable.',404);
  if(!visit.quote_id){await h.requirePermission(env,ctx,'customers.view');return null}
  const quote=await env.DB.prepare('SELECT id,project_id,customer_id FROM quotes_server WHERE organization_id=? AND id=? AND archived_at IS NULL').bind(ctx.organizationId,visit.quote_id).first();
  await requireCommercialQuoteScope(env,ctx,quote,h);
  return quote;
}
export function requireSameCommercialCustomer(sourceCustomerId,targetCustomerId,message='La visite et le devis doivent concerner le même client.'){
  if(sourceCustomerId&&String(sourceCustomerId)!==String(targetCustomerId||''))refuse(message,409);
}
