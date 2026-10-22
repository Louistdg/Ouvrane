// The returned statement must be first in the same atomic batch as the replan.
export function planningReplanCheckStatement(env,ctx,selectedRows,operationKey,stamp){
 if(!Array.isArray(selectedRows)||!selectedRows.length||selectedRows.some(row=>String(row.organization_id)!==String(ctx.organizationId)||typeof row.guard_json!=='string'))throw Object.assign(Error('planning_replan_stale'),{status:409});
 const guards=selectedRows.map(row=>({id:String(row.id),guardJson:row.guard_json}));
 return env.DB.prepare('INSERT INTO planning_replan_checks(organization_id,id,operation_key,guards_json,created_by,created_at) VALUES(?,?,?,?,?,?)').bind(ctx.organizationId,'replan-check:'+operationKey,operationKey,JSON.stringify(guards),ctx.uid,stamp);
}
