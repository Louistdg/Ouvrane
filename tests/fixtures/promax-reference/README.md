# Jeux de référence D03

Tous les articles, prix et noms sont synthétiques. `MANIFESTE.json` contient les SHA-256 et les tailles des fichiers fournis.

| Fichier | But |
| --- | --- |
| fournisseur-valide.csv | UTF-8 BOM, séparateur point-virgule, référence texte 00123, prix 12,50 HT, boîte de 10 à 121,00 TTC/21 %, ligne vide, accents/guillemets, désignation commençant par = conservée littéralement |
| fournisseur-valide.xlsx | Vrai classeur Excel reprenant les trois articles valides ; références stockées comme texte |
| fournisseur-erreurs.csv | Deux références identiques, prix absent, date ambiguë, unité inconnue, formule dans un prix |
| fournisseur-erreurs.xlsx | Vraie cellule formule avec résultat en cache 3, et référence numérique 123 ; les deux sont bloquées |
| date-a-confirmer.csv | 01/02/2026 demande un format explicite ; en FR, 1er février |
| colonnes-a-associer.csv | Huit en-têtes volontairement différents pour tester une association manuelle |
| fournisseur-10000.csv | 10 000 articles distincts R00001–R10000 pour qualification de taille, annulation et pagination |

Les valeurs brutes restent consultables dans l’aperçu. Les mêmes octets d’origine sont conservés lors d’une confirmation. Ni le classeur ni ses formules ne sont ouverts dans Excel ou exécutés. Le générateur emploie uniquement ExcelJS et Papa Parse déjà verrouillés à la racine de mission.
