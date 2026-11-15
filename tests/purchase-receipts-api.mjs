import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {purchaseOrdersWithReceipts} from '../worker/purchase-receipts.js';
const db=new DatabaseSync(':memory:');
db.exec(`CREATE TABLE field_delivery_notes(id TEXT PRIMARY KEY,organization_id TEXT,order_id TEXT);
CREATE TABLE field_delivery_lines(organization_id TEXT,delivery_note_id TEXT,order_line_id TEXT,received REAL);
INSERT INTO field_delivery_notes VALUES('a1','org','A'),('a2','org','A'),('b1','org','B'),('foreign','other','A'),('bad-tenant','other','C');
INSERT INTO field_delivery_lines VALUES('org','a1','line',2),('org','a2','line',3),('org','b1','line',1),('other','foreign','line',999),('org','bad-tenant','line',999);`);
const env={DB:{prepare:sql=>({bind:(...args)=>({all:async()=>({results:db.prepare(sql).all(...args)})})})}},ctx={organizationId:'org'},checks=[];
const order=(id='A',quantity=5,status='brouillon')=>({id,status,lines:[{id:'line',quantity,received:999,reference:'existing'}]});
async function check(label,fn){await fn();checks.push(label)}
async function read(orders,context=ctx){return purchaseOrdersWithReceipts(env,context,orders)}
await check('Réception complète : API reçue au lieu du brouillon historique',async()=>{const [o]=await read([order()]);assert.equal(o.status,'reçue');assert.equal(o.lines[0].received,5)});
await check('Livraisons partielles additionnées sans refaire une livraison',async()=>{const [o]=await read([order('A',8)]);assert.equal(o.status,'partiellement reçue');assert.equal(o.lines[0].received,5)});
await check('La même ligne dans deux commandes ne mélange pas leurs quantités',async()=>{const r=await read([order(),order('B',5)]);assert.equal(r[1].lines[0].received,1);assert.equal(r[1].status,'partiellement reçue')});
await check('L’autre entreprise ne complète pas la commande',async()=>assert.equal((await read([order()]))[0].lines[0].received,5));
await check('Même un lien incohérent de lignes vers une note étrangère est ignoré',async()=>assert.equal((await read([order('C')]))[0].lines[0].received,0));
await check('Le compteur fourni par le JSON n’est pas une preuve de réception',async()=>{const [o]=await read([order('absent')]);assert.equal(o.lines[0].received,0);assert.equal(o.status,'brouillon')});
await check('Une commande commandée sans réception conserve son état',async()=>assert.equal((await read([order('absent',5,'commandée')]))[0].status,'commandée'));
await check('Une annulation ne devient pas reçue à cause d’anciennes lignes',async()=>assert.equal((await read([order('A',5,'annulée')]))[0].status,'annulée'));
await check('Toutes les lignes doivent être reçues',async()=>{const o=order();o.lines.push({id:'second',quantity:1});assert.equal((await read([o]))[0].status,'partiellement reçue')});
await check('Une commande vide ne devient pas reçue',async()=>assert.equal((await read([{id:'empty',status:'brouillon',lines:[]}]))[0].status,'brouillon'));
await check('La présentation ne modifie ni les lignes ni l’objet source',async()=>{const o=order(),copy=JSON.stringify(o);const [r]=await read([o]);assert.equal(JSON.stringify(o),copy);assert.notEqual(r,o);assert.notEqual(r.lines[0],o.lines[0])});
await check('La lecture d’une entreprise reste indépendante',async()=>assert.equal((await read([order()],{organizationId:'other'}))[0].lines[0].received,999));
db.exec("INSERT INTO field_delivery_notes VALUES('fraction1','org','decimal'),('fraction2','org','decimal');INSERT INTO field_delivery_lines VALUES('org','fraction1','line',0.1),('org','fraction2','line',0.7)");
await check('Fractions : la tolérance est celle de la réception serveur',async()=>assert.equal((await read([order('decimal',0.8)]))[0].status,'reçue'));
await check('Une quantité réellement manquante reste partielle',async()=>assert.equal((await read([order('decimal',0.801)]))[0].status,'partiellement reçue'));
await check('Liste de commandes vide',async()=>assert.deepEqual(await read([]),[]));
db.close();console.log(JSON.stringify({status:'PASS',checks:checks.length,scenarios:checks},null,2));
