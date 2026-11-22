# PLAN — Mise à disposition de l'app Djomy sur Shopify via Render

Référence : GTS/DJOMY/2026/002 — 2026-10-06

## Objectif

Rendre l'application installable par une boutique Shopify : serveur hébergé
sur Render (HTTPS public + PostgreSQL), configuration publiée par
`shopify app deploy`. Le lien d'installation (distribution personnalisée) sera
généré plus tard, quand le domaine de la boutique cliente sera connu.

## Périmètre

| IN | OUT |
|---|---|
| Migration Prisma initiale (absente aujourd'hui) | Création d'une boutique de développement |
| Blueprint `render.yaml` (service web + PostgreSQL) | Publication sur l'App Store (revue Shopify) |
| Dépôt GitHub privé et push du code | Paiements natifs Payments Apps (P4 : mTLS, SLA, approbation) |
| Variables d'environnement de production sur Render | URL Djomy de production (Q2 non résolue → sandbox) |
| Mise à jour de `shopify.app.toml` + `shopify app deploy` | Installation sur la boutique du client |
| Vérification de santé de l'URL publique | |

## Étapes

| # | Étape | Qui | Durée |
|---|---|---|---|
| 1 | Générer `prisma/migrations/0_init` depuis le schéma (`prisma migrate diff --from-empty`), sans base | Claude | 10 min |
| 2 | Ajouter `render.yaml` : service web Node 22, `npm ci && npm run build`, démarrage `npm run setup && npm start`, base PostgreSQL gérée | Claude | 15 min |
| 3 | Committer l'état actuel (toml, vite, web.toml, migration, blueprint) | Claude | 5 min |
| 4 | Créer un dépôt GitHub **privé** et y pousser `main` | Ibrahima (ou Claude via `gh` après accord) | 5 min |
| 5 | Sur Render : *New → Blueprint* → choisir le dépôt ; saisir les secrets (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `ENCRYPTION_KEY`, Djomy) | Ibrahima | 15 min |
| 6 | Récupérer l'URL `https://<service>.onrender.com`, la reporter dans `SHOPIFY_APP_URL` (Render) et dans `shopify.app.toml` (`application_url`, `redirect_urls`) | Ibrahima + Claude | 5 min |
| 7 | `shopify app deploy` (publie URL, scopes, webhooks) | Claude après validation | 5 min |
| 8 | Vérifier : page d'accueil en HTTPS 200, `/webhooks` rejette une requête non signée (401), version visible dans le Dev Dashboard | Claude | 10 min |
| 9 | Documenter : `ARCHITECTURE.md` (hébergement), `TECHNICAL-DECISIONS.md` (choix Render), `CHANGELOG.md`, procédure du lien d'installation | Claude | 15 min |

Durée estimée : ~1 h 30, dont ~25 min d'actions de ta part.

## Livrables

- `prisma/migrations/0_init/migration.sql`, `render.yaml`
- App en ligne sur `*.onrender.com`, version Shopify publiée
- Procédure « générer le lien d'installation pour une boutique cliente »

## Risques

| Risque | Mesure |
|---|---|
| Offre gratuite Render : mise en veille → webhooks Shopify en timeout (5 s) | Offre payante (~7 $ web + ~7 $ base) avant l'installation chez le client |
| Base gratuite Render supprimée après 30 jours | Même mesure ; pas de données réelles avant |
| Secrets exposés | Saisis uniquement dans Render, `sync: false` dans le blueprint, jamais committés |
| `shopify app deploy` modifie l'app Partner | Exécuté seulement après URL Render vérifiée |
| Djomy en sandbox uniquement | Les paiements réels attendent Q2 (URL de production) |

## Dépendances

Compte GitHub, compte Render (gratuit), clés API Shopify, `ENCRYPTION_KEY`
(`openssl rand -base64 32`), identifiants Djomy sandbox.

## Agents et skills

Agent principal uniquement. Aucun skill spécifique.

## Points de validation

1. Validation de ce plan.
2. Accord avant le push GitHub (étape 4).
3. Accord avant `shopify app deploy` (étape 7).
