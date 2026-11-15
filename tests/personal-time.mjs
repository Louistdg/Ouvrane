import assert from 'node:assert/strict';
await import('../web/personal-time.js');
const time=globalThis.ouvranePersonalTime,checks=[];function check(label,fn){fn();checks.push(label)}
check('Rendez-vous d’été converti depuis Bruxelles',()=>assert.equal(time.resolve('2026-07-08T09:00'),'2026-07-08T07:00:00.000Z'));
check('Rendez-vous d’hiver converti depuis Bruxelles',()=>assert.equal(time.resolve('2026-12-08T09:00'),'2026-12-08T08:00:00.000Z'));
check('Heure inexistante au printemps refusée',()=>assert.throws(()=>time.resolve('2026-03-29T02:30'),/n’existe pas/));
check('Heure répétée en automne exige un choix explicite',()=>assert.throws(()=>time.resolve('2026-10-25T02:30'),/deux fois/));
check('Deux instants distincts pour l’heure répétée',()=>assert.deepEqual(time.candidates('2026-10-25T02:30').map(v=>v.iso),['2026-10-25T00:30:00.000Z','2026-10-25T01:30:00.000Z']));
check('Choix explicite de la seconde heure respecté',()=>assert.equal(time.resolve('2026-10-25T02:30','2026-10-25T01:30:00.000Z'),'2026-10-25T01:30:00.000Z'));
check('Choix qui ne correspond pas à cette heure refusé',()=>assert.throws(()=>time.resolve('2026-10-25T02:30','2026-10-25T03:30:00Z'),/Choisissez/));
check('31 février refusé',()=>assert.throws(()=>time.resolve('2026-02-31T09:00'),/n’existe pas/));
check('Une année bissextile valide reste disponible',()=>assert.equal(time.resolve('2028-02-29T09:00'),'2028-02-29T08:00:00.000Z'));
check('Affichage reconverti dans le même fuseau',()=>assert.equal(time.local('2026-10-24T23:30:00Z'),'2026-10-25T01:30'));
check('La date métier ne dépend pas de minuit UTC',()=>assert.equal(time.day('2026-10-24T23:30:00Z'),'2026-10-25'));
check('Heure invalide refusée',()=>assert.throws(()=>time.resolve('2026-10-24T29:01'),/invalide/));
console.log(JSON.stringify({status:'PASS',checks:checks.length,scenarios:checks},null,2));
