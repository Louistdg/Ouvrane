# Base de référence — copie de travail Ouvrane

Établi le 15 novembre 2026 sur la copie `D:\OUVRANE-TRAVAIL\ouvrane`, extraite de
`D:\TRANSFERT-PROJETS-2026-11-13\Ouvrane-Application`. L'archive de transfert n'a pas été modifiée.

Tag git : **baseline-verte** (commit `8744786`, arbre propre).
Ce document est le point de comparaison de tout le découpage à venir.

## Ce qui a été fait pour obtenir une base verte

| # | Problème | Correction |
|---|---|---|
| 1 | `node_modules` absent du transfert | `npm ci` : 219 paquets en 2 min |
| 2 | esbuild privé de son script d'installation (npm 12 bloque par défaut) | `npm install-scripts approve esbuild` |
| 3 | 5 fichiers suivis par git manquants dans la copie | restaurés depuis le dépôt (`git checkout --`) |
| 4 | `.openai/hosting.json` réclamé par la construction | copie rendue facultative, avertissement au lieu d'arrêt |
| 5 | `worker/bank-provider-enable.js` réclamé par la construction | copie rendue facultative, avertissement au lieu d'arrêt |

Après quoi : `npm run build` réussit (exit 0, `dist/server` 28 fichiers, 32 Mo) et la suite de tests
s'exécute.

## Base de référence des tests

Le lanceur officiel `scripts/test.mjs` s'arrête au premier échec, ce qui ne permet pas d'état des
lieux. Les 52 suites non exclues ont donc été lancées une par une (`D:\OUVRANE-TRAVAIL\baseline-run.mjs`,
résultats bruts dans `baseline-suites.jsonl`).

**41 suites vertes, 11 rouges.**

| Suite rouge | Cause |
|---|---|
| archived-project-hours.mjs | `bank-provider-enable.js` manquant |
| contact-files-api.mjs | `bank-provider-enable.js` manquant |
| document-content-revocation.mjs | `bank-provider-enable.js` manquant |
| hr-incremental-audit-api.mjs | `bank-provider-enable.js` manquant |
| isolation-time-entry-integrity.mjs | `bank-provider-enable.js` manquant |
| promax-reference-pointages.mjs | `bank-provider-enable.js` manquant |
| time-hr-api.mjs | `bank-provider-enable.js` manquant |
| top27-hours-finance-api.mjs | `bank-provider-enable.js` manquant |
| topo-preview.mjs | `bank-provider-enable.js` manquant |
| resilience-regressions.mjs | bac à sable `resilience-vm/web/` attendu, absent de la copie |
| third-party-notices.mjs | le faux `fs` du test n'implémente pas `readdir`, utilisé par `build.mjs` |

Les 39 suites restantes sont exclues par `scripts/test.mjs` lui-même : tests navigateur exigeant
Chromium/CDP, et suites exigeant le worker compilé.

## Le fichier bancaire écarté du transfert

`worker/bank-provider-enable.js` (15 174 octets) apparaît dans `EXCLUSIONS.json` avec le motif
**`cle-privee`**, pour `Ouvrane-Application` et pour `Ouvrane-recent`. Le fichier est importé par
`worker/bank-connections.js` (ligne 1) et par `scripts/bank-runtime.mjs` (ligne 3). Il n'existe plus
sur ce disque, aucun lecteur annexe ne le contient.

Deux conséquences :

1. Neuf suites resteront rouges tant qu'il n'est pas restauré depuis une sauvegarde.
2. Le fichier mélange du code et une clé privée. À son retour, il doit être scindé : le code dans le
   dépôt, la clé dans `.env`, sinon l'exclusion se reproduira à chaque transfert.

## Carte des routes

`docs/CARTE-ROUTES.md` : 155 routes extraites de `worker/index.js` (4 223 lignes).

| Gestionnaire défini dans | Routes |
|---|---:|
| `index.js` (à extraire) | 134 |
| `personal-followup.js` | 3 |
| `assignment-assets.js` | 2 |
| `time-entry-monthly.js` | 2 |
| les 16 autres modules déjà sortis | 1 chacun |
| reliquat non identifié | 1 (la route d'asset statique `/`) |

Autrement dit : 20 routes sur 155 sont déjà servies par un module, le reste tient encore dans
`index.js`. Le découpage commence par les familles les plus grosses de la carte, une par commit.

## Ce qui suit

1. Restaurer `worker/bank-provider-enable.js` depuis une sauvegarde, le scinder, relancer les 9 suites.
2. Découper `index.js` famille par famille, `npm run build` puis les 52 suites après chaque extraction.
3. Fournir le bac à sable `resilience-vm/` ou retirer la suite de la liste exécutée.
4. Corriger le faux `fs` de `tests/third-party-notices.mjs` (`readdir` manquant).
