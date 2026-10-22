/* Parse files off the UI thread. Never evaluate spreadsheet formulas. */
importScripts('/papaparse.js','/exceljs.js');
function zipBudget(buffer){
 const v=new DataView(buffer);let end=-1;
 for(let p=buffer.byteLength-22;p>=Math.max(0,buffer.byteLength-65557);p--)if(v.getUint32(p,true)===0x06054b50){end=p;break}
 if(end<0)throw Error('Archive XLSX invalide.');
 const count=v.getUint16(end+10,true),offset=v.getUint32(end+16,true);if(count>2000||offset>=end)throw Error('Archive XLSX trop complexe.');
 let p=offset,total=0;
 for(let i=0;i<count;i++){
  if(p+46>end||v.getUint32(p,true)!==0x02014b50)throw Error('Archive XLSX invalide.');
  const size=v.getUint32(p+24,true);total+=size;
  if(total>20000000||v.getUint16(p+8,true)&1)throw Error('Classeur trop volumineux une fois décompressé, ou chiffré.');
  p+=46+v.getUint16(p+28,true)+v.getUint16(p+30,true)+v.getUint16(p+32,true);
 }
}
function cell(value){
 if(value===null||value===undefined)return '';
 if(typeof value==='number'||typeof value==='string')return String(value);
 if(typeof value==='object'&&value.richText)return value.richText.map(x=>x.text).join('');
 if(typeof value==='object'&&(value.formula||value.sharedFormula))throw Error('Les formules ne sont pas importées : fournissez un export en valeurs.');
 throw Error('Cellule non textuelle ou numérique : fournissez un export en valeurs.');
}
self.onmessage=async({data})=>{
 try{
  let sheets=[];
  if(data.filename.toLowerCase().endsWith('.csv')){
   const text=new TextDecoder('utf-8',{fatal:true}).decode(data.buffer);const parsed=Papa.parse(text,{skipEmptyLines:'greedy',preview:2002});
   if(parsed.errors.length)throw Error('CSV illisible : '+parsed.errors[0].message);
   sheets=[{name:'CSV',rows:parsed.data}];
  }else{
   zipBudget(data.buffer);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(data.buffer);
   if(workbook.worksheets.length>20)throw Error('Maximum 20 feuilles.');
   for(const sheet of workbook.worksheets){if(sheet.rowCount>2001||sheet.columnCount>50)throw Error('Maximum 2 000 lignes de données et 50 colonnes.');const rows=[];sheet.eachRow({includeEmpty:false},row=>rows.push(row.values.slice(1).map(cell)));sheets.push({name:sheet.name,rows})}
  }
  if(sheets.some(s=>s.rows.length>2001||s.rows.some(r=>r.length>50||r.some(x=>String(x).length>1000))))throw Error('Fichier trop grand : maximum 2 000 lignes, 50 colonnes, cellules de 1 000 caractères.');
  self.postMessage({sheets});
 }catch(e){self.postMessage({error:e.message||'Fichier illisible.'})}
};
