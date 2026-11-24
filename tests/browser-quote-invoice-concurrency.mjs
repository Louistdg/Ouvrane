import assert from 'node:assert/strict';
import {connectBrowser,waitForApp} from './helpers/browser-cdp.mjs';
const base=process.env.SOCLE_TEST_URL,browser=await connectBrowser(base),tab=await browser.createSession(base);
try{
 await tab.navigate(base);await tab.evaluate(`fetch('/__local-test/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'direction@batinova.example'})})`,'race-login');await tab.reload();await waitForApp(tab);
 const api=async(path,method='GET',data)=>tab.evaluate(`fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{'content-type':'application/json'},${data===undefined?'':`body:JSON.stringify(${JSON.stringify(data)}),`}}).then(async r=>({status:r.status,data:await r.json()}))`,'race-api');
 const c=await api('/api/customers','POST',{type:'individual',firstName:'QA',lastName:'Concurrence facture',street:'Rue test',city:'Namur',country:'BE'});assert.equal(c.status,201,JSON.stringify(c));
 const q=await api('/api/quotes','POST',{customerId:c.data.customer.id,title:'Contrat unique concurrence',client:'QA',clientAddress:'Namur',date:'2026-10-25',validUntil:'2026-11-25',status:'accepted',lines:[{label:'Prestation unique',qty:1,unit:'forfait',price:100,vat:21}]});assert.equal(q.status,201,JSON.stringify(q));
 const token=Date.now(),payload={quoteId:q.data.quote.id,customerId:c.data.customer.id,projectId:null,invoiceNumber:'QA-RACE-'+token,issueDate:'2026-10-25',dueDate:'2026-11-25',subtotalCents:10000,vatAmountCents:2100,notes:'Concurrence synthétique'};
 const responses=await tab.evaluate(`Promise.all([${JSON.stringify(payload)},${JSON.stringify({...payload,invoiceNumber:payload.invoiceNumber+'-B'})}].map(body=>fetch('/api/invoices',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(async r=>({status:r.status,data:await r.json()}))))`,'concurrent-invoices');
 assert.deepEqual(responses.map(v=>v.status).sort(),[201,409],JSON.stringify(responses));
 const invoices=(await api('/api/invoices')).data.invoices.filter(v=>v.quoteId===payload.quoteId);assert.equal(invoices.length,1,'One accepted quote must not create two invoices concurrently');
 console.log('PASS concurrent quote invoices: one creation, one business conflict, exactly one invoice.');
}finally{await tab.close();await browser.close();}
