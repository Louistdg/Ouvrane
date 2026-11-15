# Connecteur bancaire

`worker/bank-provider-enable.js` parle à l'API Enable Banking. Il ne contient aucun secret :
`scripts/bank-runtime.mjs` lit les fichiers privés et les lui passe.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `SOCLE_BANK_ENABLED` | `1` pour activer le connecteur |
| `SOCLE_BANK_ENABLEBANKING_APP_ID` | identifiant d'application (le `kid` du jeton) |
| `SOCLE_BANK_ENABLEBANKING_PRIVATE_KEY_PATH` | fichier de clé privée RSA, PKCS#8, 2048 bits minimum |
| `SOCLE_BANK_ENCRYPTION_KEY_PATH` | 32 octets encodés en base64, chiffre les sessions |
| `SOCLE_BANK_ORGANIZATION_ID` | entreprise autorisée |
| `SOCLE_BANK_OWNER_USER_ID` | propriétaire autorisé |
| `SOCLE_BANK_ENVIRONMENT` | `SANDBOX` ou `PRODUCTION` |
| `SOCLE_BANK_REDIRECT_URI` | doit valoir `https://ouvrane.be/bank/return` |

Les deux fichiers privés vivent hors dépôt. Aucun secret ne rentre dans un fichier versionné : le
scanner de secrets du transfert écarte tout fichier qui en contient, c'est ce qui a coûté la première
version de ce module.

## Ce que le module expose

| Export | Rôle |
|---|---|
| `createEnableBankingProvider({appId,privateKeyPem,fetchImpl})` | fabrique le client : catalogue, autorisation, session, opérations, soldes |
| `normalizeEnableTransactions(payload,{currency})` | convertit les opérations brutes en lignes importables, avec quarantaine et doublons |
| `selectEnableBookedBalance(payload,currency)` | choisit le solde comptable d'un compte |

Les erreurs du fournisseur portent un `code` conforme au motif `ENABLE_*` et un `providerStatus`.
`worker/bank-connections.js` s'appuie sur ces deux champs pour décider du message montré à l'utilisateur.

## Décisions prises lors de la reconstruction

Le fichier d'origine est perdu : il avait été écarté de tous les transferts avec le motif `cle-privee`.
Le comportement a donc été reconstruit à partir des deux appelants, du schéma
`drizzle/0068_bank_connections.sql` et de la documentation publique d'Enable Banking. Trois choix
méritent relecture :

1. **Statuts importés.** Seul `BOOK` est importé. `PDNG`, `HOLD`, `SCHD`, `CNCL`, `RJCT` et `OTHR`
   partent en quarantaine avec la raison `statut_non_comptabilise`.
2. **Solde comptable.** Ordre de préférence : `ITBD`, puis `CLBD`, puis `PRCD`, puis un libellé
   contenant « booked », puis `ITAV`, puis `CLAV`, puis le premier solde de la devise. La documentation
   Enable Banking montre un solde nommé « Booked balance » de type `CLAV`, d'où ce classement qui ne
   repose pas sur le seul type.
3. **Référence d'idempotence.** `entry_reference`, sinon `transaction_id`, sinon `reference_number`.
   C'est la clé qui empêche un double import, elle est hachée dans `bank_transactions.idempotency_key`.

Le test `tests/bank-provider-enable.mjs` fige ces trois choix : 12 scénarios, 60 contrôles, sans réseau.
