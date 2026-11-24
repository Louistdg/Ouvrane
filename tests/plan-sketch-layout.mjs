import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const node={addEventListener(){}};
const c=vm.createContext({document:{querySelector:()=>node},MutationObserver:class{observe(){}},closeModal(){},backModal(){},openQuoteDraftFolder(){},addEventListener(){}});
vm.runInContext(readFileSync(new URL('../web/plans.js',import.meta.url),'utf8'),c);
vm.runInContext('const boxes=[{x:140,y:90,width:24,height:24}];for(let i=0;i<8;i++)planSketchLabelPosition(150,105,315,210,boxes);globalThis.boxes=boxes',c);
for(const box of c.boxes){assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=315&&box.y+box.height<=210)}
for(let i=0;i<c.boxes.length;i++)for(let j=i+1;j<c.boxes.length;j++){
 const a=c.boxes[i],b=c.boxes[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,'Dimension labels and annotation markers must not overlap in the crowded phone fixture');
}
console.log('PASS crowded phone sketch labels: eight dimensions plus annotation marker stay separate and within the page.');
