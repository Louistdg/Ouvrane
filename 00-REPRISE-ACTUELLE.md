# Ouvrane — reprise actuelle, TOP27 publié

Publication vérifiée le 2026-10-27T08:08:41.042111+00:00, après feu vert explicite et sauvegarde de la version précédente.

- Application : https://ouvrane.be/
- Rapport et reprise de publication : `D:\Ouvrane\Corrections\2026-10-27-TOPO-FIABILITE-INTERFACE\PUBLICATION\PUBLICATION.md`.
- Preuve de publication : `D:\Ouvrane\Corrections\2026-10-27-TOPO-FIABILITE-INTERFACE\PUBLICATION\PRODUCTION-VERIFIEE.json`.
- Candidate publiée : `D:\Ouvrane\Corrections\2026-10-27-TOPO-FIABILITE-INTERFACE\CANDIDAT\application`.
- Version composite : `15f529362f7a6080b35a55bf2f084ea504a1bfd9b50d7a45684b4f57fe569f4d`. L’ancienne empreinte `621603723d5cd2c549c63cb557b1b892214975b3ad94973773444152d9b0641a` concernait index.js seulement.
- 38 fichiers sources publiés avec le runtime figé ; 45 fichiers avaient été intégrés localement après sauvegarde.
- Sauvegarde privée avant publication : `D:\Donnees-Agents\Sauvegardes\Ouvrane\2026-10-27-TOPO-FIABILITE-INTERFACE\top27-20261027T074520Z`.
- Source active : travail bancaire non publié préservé. Ne pas publier cette source en bloc ; repartir de la candidate vérifiée.
- C04/F1–F6 et TOP27 sont publiés. Cause des 503 intermittentes inconnue ; téléphone physique/Safari non validés.
- Recette navigateur live incomplète : HTTP 421 (SNI) observé dans deux sessions DeskMCP, alors que les mêmes GET HTTP/1 et Node HTTP/2 depuis le même Windows répondent 200 en séquence et avec huit requêtes parallèles ; cause non établie, sans attribution à HTTP/2 seul. Reprendre avec les journaux Apache et le protocole/IP du navigateur.
- DT26 déjà clôturé : ne pas recréer, consommer ou replanifier.
- Parcours de transcription encore à identifier ; aucun gain de reconnaissance vocale revendiqué.

Les informations ci-dessous sont l’historique de septembre conservé ; elles ne décrivent pas l’état courant du projet.

---

# SOCLE — reprise actuelle

Dernière mise à jour : **26 septembre 2026**.

Base de référence de cet export : `SOCLE_b990_POINT7_VALIDE_2026-09-26.zip`.

## État rapide

- Points 1–7 : préservés.
- Point 8 / Documents privés et multi-relations : **VALIDÉ dans cet export**.
- Migration finale : `0014_documents_private_relations.sql`.
- Build : réussi.
- Tests automatiques non navigateur : **652 assertions réussies**.
- Local-auth : suite automatique bloquée par `spawn ... ENOENT`, **6/6 contrôles équivalents manuels réussis**.
- Tests navigateur : tentés, **0 assertion**, Chromium/CDP `127.0.0.1:9222` indisponible.
- Point 9 : **NON COMMENCÉ**.

Lire `00-ETAT-ACTUEL-ET-REPRISE.md` puis le rapport Point 8 avant toute suite. Ne jamais rouvrir `/api/state` aux collaborateurs et ne pas déplacer les fichiers privés dans `workspace_state`.