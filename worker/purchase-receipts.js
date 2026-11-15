// Read the receipt journal rather than trusting receipt counters in legacy JSON.
export async function purchaseOrdersWithReceipts(env,ctx,orders){
 if(!orders.length)return [];
 const result=await env.DB.prepare(`SELECT dn.order_id,dl.order_line_id,SUM(dl.received) received
 FROM field_delivery_lines dl JOIN field_delivery_notes dn
 ON dn.id=dl.delivery_note_id AND dn.organization_id=dl.organization_id
 WHERE dl.organization_id=? AND dn.organization_id=? GROUP BY dn.order_id,dl.order_line_id`).bind(ctx.organizationId,ctx.organizationId).all();
 const totals=new Map();
 for(const row of result.results||result){const id=String(row.order_id);if(!totals.has(id))totals.set(id,new Map());totals.get(id).set(String(row.order_line_id),Number(row.received||0))}
 return orders.map(order=>{
  const lines=(Array.isArray(order.lines)?order.lines:[]).map(line=>({...line,received:totals.get(String(order.id))?.get(String(line.id))||0}));
  const any=lines.some(line=>line.received>0),full=lines.length>0&&lines.every(line=>line.received+1e-9>=Number(line.quantity));
  const status=order.status==='annulée'?order.status:full?'reçue':any?'partiellement reçue':order.status;
  return {...order,lines,status};
 });
}
