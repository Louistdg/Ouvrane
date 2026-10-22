#!/usr/bin/env bash
# Cree un compte membre (TEAM_LEAD / WORKER / ACCOUNTING) sur une instance OUVRANE deja deployee.
#
# Pourquoi ce script existe : l'envoi des e-mails d'invitation n'est pas configure sur
# l'hebergement (SOCLE_EMAIL_FROM absent). Le proprietaire ne peut donc pas envoyer de lien
# depuis l'interface. Ce script ecrit l'invitation en base, puis laisse l'APPLICATION
# activer le compte via POST /auth/activate : le profil, l'adhesion, le hachage scrypt et
# l'audit restent produits par le code applicatif, jamais reimplementes ici.
#
# Usage :
#   bash o2switch-create-member.sh <email> <prenom> <nom> <role> <mot_de_passe>
#   role = ACCOUNTING | TEAM_LEAD | WORKER
#
# Prerequis : node/app en marche sur 127.0.0.1:3100, sqlite3 installe, SOCLE_PUBLIC_URL
# connu (defaut https://ouvrane.be) car /auth/activate exige une Origin de confiance.
set -euo pipefail

EMAIL="$1"; FIRST="$2"; LAST="$3"; ROLE="${4:-ACCOUNTING}"; PASS="$5"
DB="${OUVRANE_DB:-$HOME/ouvrane.be/app/data/socle.sqlite}"
BASE="${OUVRANE_BASE:-http://127.0.0.1:3100}"
ORIGIN="${OUVRANE_ORIGIN:-https://ouvrane.be}"
ORG="${OUVRANE_ORG:-org-local-owner}"

case "$ROLE" in
  ACCOUNTING) ROLE_ID="role-accounting-local-owner" ;;
  TEAM_LEAD)  ROLE_ID="role-team-lead-local-owner" ;;
  WORKER)     ROLE_ID="role-worker-local-owner" ;;
  *) echo "Role refuse : $ROLE (ACCOUNTING, TEAM_LEAD ou WORKER uniquement)." >&2; exit 2 ;;
esac

if sqlite3 "$DB" "SELECT 1 FROM profiles WHERE lower(email)=lower('$EMAIL');" | grep -q 1; then
  echo "Refus : un profil existe deja pour $EMAIL." >&2; exit 3
fi

RAW="$(cat /proc/sys/kernel/random/uuid)$(cat /proc/sys/kernel/random/uuid)"
HASH="$(printf %s "$RAW" | sha256sum | cut -d' ' -f1)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
EXP="$(date -u -d '+7 days' +%Y-%m-%dT%H:%M:%S.000Z)"
INV="invitation-$(cat /proc/sys/kernel/random/uuid)"
AUDIT="audit-$(cat /proc/sys/kernel/random/uuid)"

# Toute invitation en attente pour cette adresse est d'abord revoquee : pas d'empilement.
sqlite3 "$DB" "UPDATE organization_invitations SET status='revoked',revoked_at='$NOW' WHERE organization_id='$ORG' AND lower(email)=lower('$EMAIL') AND status='pending';"

sqlite3 "$DB" "INSERT INTO organization_invitations(id,organization_id,email,person_id,role_id,token_hash,status,expires_at,invited_by,created_at)
VALUES('$INV','$ORG','$EMAIL',NULL,'$ROLE_ID','$HASH','pending','$EXP','local-owner','$NOW');
INSERT INTO audit_logs(id,organization_id,user_id,action,entity_type,entity_id,new_values,created_at)
VALUES('$AUDIT','$ORG','local-owner','member.invited','organization_invitation','$INV','{\"email\":\"$EMAIL\",\"role\":\"$ROLE\",\"delivery_mode\":\"manual-operator\"}','$NOW');"

HTTP=$(curl -s -o /tmp/ouvrane-activate.out -w '%{http_code}' -X POST "$BASE/auth/activate" \
  -H 'content-type: application/json' -H "Origin: $ORIGIN" \
  --data "{\"token\":\"$RAW\",\"password\":\"$PASS\",\"firstName\":\"$FIRST\",\"lastName\":\"$LAST\"}")

if [ "$HTTP" != "200" ]; then
  echo "Activation refusee (HTTP $HTTP) : $(cat /tmp/ouvrane-activate.out)" >&2
  exit 4
fi

echo "Compte active (HTTP 200)."
sqlite3 "$DB" "SELECT p.id,p.first_name,p.last_name,p.email,r.code,om.status FROM profiles p JOIN organization_members om ON om.user_id=p.id JOIN roles r ON r.id=om.role_id WHERE lower(p.email)=lower('$EMAIL');"
