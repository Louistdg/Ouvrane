import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function fixture(){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{isConnected:true,disabled:false,innerHTML:'',textContent:'',value:'',dataset:{},addEventListener(){},querySelector:node});return nodes.get(id)};
 let resolve,reject;const response=new Promise((a,b)=>{resolve=a;reject=b});
 const c=vm.createContext({console,structuredClone,crypto:globalThis.crypto,esc:s=>String(s??''),document:{querySelector:node},MutationObserver:class{observe(){}},closeModal(){},backModal(){},openQuoteDraftFolder(){},addEventListener(){},toast(){},serverJson:()=>response});
 vm.runInContext(readFileSync(new URL('../web/plans.js',import.meta.url),'utf8'),c);
 const run=s=>vm.runInContext(s,c);
 run(`renderPlanPage=async()=>{};
 const input={pageNumber:1,pageWidth:600,pageHeight:400,calibration:null,annotations:[]};
 planDesk={root:document.querySelector('#planDesk'),plan:{id:'p'},version:{id:'v'},versions:[{id:'v'}],pageNumber:1,input:structuredClone(input),pending:[],dirty:true,editRevision:1,readOnly:false,annotations:[{id:'historical',planVersionId:'v',pageNumber:1,version:1,input:structuredClone(input)},{id:'latest',planVersionId:'v',pageNumber:1,version:2,input:structuredClone(input)}],snapshot:{version:2},pdf:{getPage:async()=>({getViewport:()=>({width:600,height:400})})}};`);
 const snapshot={id:'saved',planVersionId:'v',pageNumber:1,version:3,input:{pageNumber:1,pageWidth:600,pageHeight:400,calibration:null,annotations:[]}};
 return {run,node,resolve:()=>resolve({snapshot}),reject:()=>reject(Error('old save failed'))};
}
for(const outcome of ['success','failure']){
 const f=fixture(),pending=f.run('savePlanAnnotations()');await f.run("loadPlanPage(1,'historical')");
 const status=f.node('#planStatus');status.textContent='Historical view';
 outcome==='success'?f.resolve():f.reject();await pending;
 assert.equal(f.run('planDesk.snapshot.id'),'historical',outcome+' must retain history');
 assert.equal(f.run('planDesk.readOnly'),true);assert.equal(f.node('#planSave').disabled,true);
 assert.equal(status.textContent,'Historical view');
 if(outcome==='success')assert.equal(f.run("planDesk.annotations.some(a=>a.id==='saved')"),true);
 console.log('PASS late '+outcome+' retains historical view and its disabled save button');
}
{
 const f=fixture(),pending=f.run('savePlanAnnotations()');await f.run('loadPlanPage(2)');await f.run('loadPlanPage(1)');
 f.resolve();await pending;assert.equal(f.run('planDesk.snapshot.id'),'latest');assert.equal(f.run('planDesk.pageSequence'),2);
 console.log('PASS page A to B to A does not let an old response reload the current view');
}
{
 const f=fixture(),pending=f.run('savePlanAnnotations()');f.run("planDesk.versionSequence=1;planDesk.root.querySelector('#planStatus').textContent='Loading revision'");
 f.reject();await pending;assert.equal(f.node('#planStatus').textContent,'Loading revision');
 console.log('PASS late error cannot overwrite a revision load');
}
{
 const f=fixture(),pending=f.run('savePlanAnnotations()');f.run("planDesk.input.annotations.push({id:'new-edit'});markPlanDirty()");f.resolve();await pending;
 assert.equal(f.run('planDesk.dirty'),true);assert.equal(f.run('planDesk.input.annotations[0].id'),'new-edit');assert.equal(f.run('planDesk.snapshot.version'),3);
 console.log('PASS same-view edits survive and retain the successful server version');
}
{
 const f=fixture(),pending=f.run('savePlanAnnotations()');f.run('planDesk.pending=[{x:.1,y:.2}]');f.resolve();await pending;
 assert.equal(f.run('planDesk.pending.length'),1);assert.equal(f.run('planDesk.snapshot.version'),3);
 console.log('PASS an unfinished new drawing survives a save response');
}
{
 const f=fixture(),pending=f.run('savePlanAnnotations()');f.run('planDesk.symbolEditor={dirty:true,stroke:[]}');f.resolve();await pending;
 assert.equal(f.run('planDesk.symbolEditor.dirty'),true);assert.equal(f.run('planDesk.snapshot.version'),3);
 console.log('PASS a custom-symbol draft survives a prior annotation save response');
}
{
 const f=fixture(),pending=f.run('savePlanAnnotations()');f.resolve();await pending;
 assert.equal(f.run('planDesk.snapshot.id'),'saved');assert.equal(f.run('planDesk.dirty'),false);assert.equal(f.node('#planSave').disabled,false);
 console.log('PASS an unchanged view refreshes after its own successful save');
}
