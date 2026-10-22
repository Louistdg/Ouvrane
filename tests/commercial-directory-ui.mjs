import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('../',import.meta.url)),output=process.argv[2];
const script=readFileSync(resolve(source,'web/quote-preproject.js'),'utf8');
function context(){const ctx=vm.createContext({quotesView:()=>'',contactsView:()=>'',iaCServerDirectoryPanel:()=>'',showQuote:()=>{},iaCCustomers:[],iaCSuppliers:[],iaCServerDirectoryState:'idle',storageRevision:12,iaCQuoteWorkspaceGeneration:1,__scope:'A',serverJson:async()=>({customers:[]})});ctx.iaCQuoteScope=()=>ctx.__scope;new vm.Script(script,{filename:'web/quote-preproject.js'}).runInContext(ctx);return ctx}
const results=[];
function record(name,passed,details){results.push({name,passed,details});console.log((passed?'PASS ':'FAIL ')+name)}
{
 const ctx=context();ctx.iaCCustomers=[{id:'a',companyName:'A',street:'Rue A'},{id:'b',companyName:'B',street:'Rue B'}];
 const fields={client:{value:'A'},clientAddress:{value:'Rue A'},clientAddressFixed:{checked:false}};
 ctx.select={value:'b',form:{querySelector:selector=>fields[selector.match(/name=["']?([^"'\]]+)/)?.[1]]||null}};
 vm.runInContext('e2e02ApplyCustomer(select)',ctx);
 record('Changing client A to B replaces the automatically supplied address',fields.clientAddress.value==='Rue B',{actualAddress:fields.clientAddress.value,expectedAddress:'Rue B'});
}
{
 const ctx=context(),requests=[];
 ctx.serverJson=()=>new Promise(resolve=>requests.push({scope:ctx.__scope,resolve}));
 const first=vm.runInContext('e2e02EnsureCustomers()',ctx).catch(error=>({rejected:String(error.message)}));
 ctx.__scope='B';ctx.iaCQuoteWorkspaceGeneration++;
 const second=vm.runInContext('e2e02EnsureCustomers()',ctx).catch(error=>({rejected:String(error.message)}));
 if(requests.length!==2){for(const r of requests)r.resolve({customers:[]});await Promise.all([first,second]);record('A delayed previous-account response cannot replace the current catalog',false,{requests:requests.length})}
 else{requests[1].resolve({customers:[{id:'customer-B'}]});await second;requests[0].resolve({customers:[{id:'customer-A'}]});await first;record('A delayed previous-account response cannot replace the current catalog',ctx.iaCCustomers[0]?.id==='customer-B',{actualCustomer:ctx.iaCCustomers[0]?.id,expectedCustomer:'customer-B'})}
}
{
 const ctx=context();let requests=0;ctx.serverJson=async()=>({customers:[{id:'version-'+(++requests)}]});
 await vm.runInContext('e2e02EnsureCustomers()',ctx);ctx.storageRevision++;
 await vm.runInContext('e2e02EnsureCustomers()',ctx);
 record('A newer workspace revision invalidates a previously loaded client catalog',requests===2,{requests,expectedRequests:2});
}
const report={checkedAt:new Date().toISOString(),method:'Actual quote-preproject.js evaluated in VM with minimal DOM fields and deterministic deferred HTTP transport; no network or browser',results,allPassed:results.every(r=>r.passed),scope:'Reproductions for the next UI implementation, not an application browser qualification'};
if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n');if(!report.allPassed)process.exitCode=1;
