# Déploiement OUVRANE sur o2switch (ouvrane.be)

Déploiement manuel (Node 22 + proxy Apache + watchdog). Ce dossier contient
les fichiers d'exploitation réellement utilisés sur `ouvrane.be`.

## Arborescence sur le serveur

```
~/ouvrane.be/
├── .htaccess                 (refus d'accès à /app/, /data/ et aux dotfiles + proxy vers 127.0.0.1:3100)
├── .htaccess.bak-302         (ancien redirect temporaire vers Railway)
└── app/                      (code OUVRANE, SOUS la racine web — accès direct bloqué par le .htaccess)
    ├── .env                  (SOCLE_PUBLIC_URL, SOCLE_SESSION_SECRET, SOCLE_DATA_DIR… ; chmod 600 obligatoire)
    ├── data/socle.sqlite     (base persistante)
    ├── dist/server/index.js  (worker + assets embarqués, généré par le build)
    ├── node_modules/         (production seulement, npm prune --omit=dev)
    └── scripts/
        ├── o2switch-start.mjs   (charge .env, vérifie ses permissions, puis v5-start.mjs)
        ├── o2switch-watchdog.sh (relance l'app si /health ne répond pas)
        ├── o2switch-backup.sh   (sauvegarde SQLite quotidienne)
        └── o2switch-create-member.sh (crée un compte TEAM_LEAD/WORKER/ACCOUNTING)
```

## Créer un compte (secrétariat, chef d'équipe, ouvrier)

L'envoi des e-mails d'invitation n'est pas configuré sur l'hébergement : le propriétaire
ne peut pas envoyer de lien depuis l'interface. `o2switch-create-member.sh <email> <prénom>
<nom> <ACCOUNTING|TEAM_LEAD|WORKER>` écrit l'invitation en base puis laisse
l'application créer le compte via `POST /auth/activate` (profil, adhésion, hachage scrypt,
audit produits par le code applicatif). Le mot de passe ne passe jamais en argument (il
resterait visible dans `ps` et l'historique du shell) : définissez
`OUVRANE_MEMBER_PASSWORD=…` dans l'environnement de la commande ou laissez la saisie
masquée faire son travail. L'appel exige l'en-tête `Origin` de confiance
(`SOCLE_PUBLIC_URL`), sinon il répond `403 Origin refused`.

## Installation (résumé)

1. `tar` du code (sans `node_modules`, `data`, `dist`, `.git`) → `~/ouvrane.be/app/`.
2. `npm ci` puis `node scripts/build.mjs` (Node 22.23+ requis).
3. `.env` (voir modèle) puis **`chmod 600 ~/ouvrane.be/app/.env`** (le fichier contient
   `SOCLE_SESSION_SECRET` ; `o2switch-start.mjs` refuse de démarrer s'il est lisible par
   le groupe ou les autres) + `scripts/o2switch-start.mjs`.
4. `.htaccess` à la racine de `~/ouvrane.be/`.
5. Démarrage : `PORT=3100 nohup node scripts/o2switch-start.mjs > app.log 2>&1 &`.
6. Cron : watchdog toutes les 2 min + sauvegarde quotidienne 03:30.

## Variables d'environnement minimales (=.env)

```
SOCLE_PUBLIC_URL=https://ouvrane.be
SOCLE_SESSION_SECRET=<base64url de 32 octets min>
SOCLE_DATA_DIR=/home/<user>/ouvrane.be/app/data
SOCLE_V5_OWNER_EMAIL=<premier propriétaire>
SOCLE_V5_OWNER_PASSWORD=<mot de passe initial>
```

## Correctifs obligatoires du .htaccess

- **`DirectoryIndex index.html`**, sinon Apache transforme `/` en `/index.php` avant le
  proxy et l'app répond « Not found ».
- Les blocs de refus `<LocationMatch>` sur `/app/`, `/data/` et les dotfiles (plus la règle
  `RewriteRule ^ - [F]` associée), sinon ces fichiers vivant sous la racine web sont
  servibles par Apache directement : `.env` expose `SOCLE_SESSION_SECRET` et
  `app/data/socle.sqlite` contient la base complète.

## Notes

- L'app tourne en process de fond (pas Passenger) ; le watchdog assure la reprise.
- La sauvegarde quotidienne conserve 14 copies dans `~/ouvrane-backups/`.
- Ne jamais restaurer le seed désauthentifié par-dessus une vraie base.
