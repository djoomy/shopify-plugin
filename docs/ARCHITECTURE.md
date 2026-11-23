# Architecture

## Vue d'ensemble

```
                    ┌──────────────────────────────┐
  Checkout Shopify  │      App Shopify (Remix)     │        API Djomy
        │           │                              │
        │  canal 1  │  routes/pay.$reference       │   POST /v1/auth
        ├──────────>│  routes/webhooks.djomy       │   POST /v1/payments/gateway
        │           │  routes/app.settings         │   POST /v1/payments
        │  canal 2  │                              │   GET  /v1/payments/{id}/status
        └──────────>│  routes/payments.session     │
                    │  routes/payments.refund      │<── webhook X-Webhook-Signature
                    │                              │
                    │  lib/djomy/  ← connecteur    │
                    │  lib/crypto.server.ts        │
                    │  Prisma / PostgreSQL         │
                    └──────────────────────────────┘
```

## Connecteur Djomy — `app/lib/djomy/`

| Fichier | Rôle |
| --- | --- |
| `signature.ts` | HMAC-SHA256 : en-tête `X-API-KEY` et vérification des webhooks |
| `client.ts` | Transport HTTP, cache de jeton, rejeux, erreurs typées |
| `webhook.ts` | Vérification puis analyse des webhooks (V1 et V2) |
| `currency.ts` | Correspondance ISO ↔ Djomy, contrôle de précision des montants |
| `types.ts` | Types issus de la spec OpenAPI |
| `errors.ts` | Erreurs typées et masquage des données sensibles |

Le connecteur ne connaît ni Shopify ni Prisma. Il est testable seul et
réutilisable sur un autre socle.

## Routes

| Route | Rôle | Accès |
| --- | --- | --- |
| `app/_index` | Tableau de bord des paiements | Admin Shopify |
| `app/settings` | Identifiants Djomy, méthodes, test de connexion | Admin Shopify |
| `webhooks` | Conformité RGPD, désinstallation, `orders/create` | HMAC Shopify |
| `webhooks/djomy/:shop` | Notifications Djomy | Signature Djomy |
| `pay/:reference` | Saisie du numéro, redirection vers Djomy | Référence-jeton |
| `pay/:reference/retour` | Statut réel après retour du portail | Référence-jeton |

La référence de paiement fait 24 caractères hexadécimaux aléatoires : elle sert
de jeton d'accès aux pages publiques, qui n'ont pas de session Shopify.

## Couches

```
routes/            adaptateurs HTTP, aucune décision métier
  ↓
lib/paiements/     service.ts, reconciliation.ts, commande-manuelle.ts
  ↓                (logique métier pure, dépendances injectées)
lib/djomy/         connecteur Djomy
  ↓
*.server.ts        adaptateurs Prisma et Admin API Shopify
```

Le service de paiement reçoit son dépôt, sa passerelle de commande et son
client Djomy par injection. Les tests s'exécutent donc sans base de données ni
appel réseau.

## Authentification Djomy

```
signature = HMAC_SHA256(message = clientId, clé = clientSecret) → hex
X-API-KEY: <clientId>:<signature>

POST /v1/auth  (X-API-KEY seul, corps {})
  → accessToken, expiresIn = 3600 s

Requêtes protégées : Authorization: Bearer <token>  +  X-API-KEY
```

Le jeton est mis en cache jusqu'à 60 secondes avant son expiration. Un `401`
déclenche une seule ré-authentification suivie d'un rejeu ; cette reprise ne
consomme pas de tentative de rejeu, un jeton périmé n'étant pas une panne.

## Politique de rejeu

| Situation | Comportement |
| --- | --- |
| Panne réseau, délai dépassé | 3 tentatives, attente 1 s puis 2 s |
| `429`, `5xx` | 3 tentatives, même attente |
| `401` (une fois) | Ré-authentification puis rejeu |
| `400`, `403`, `422` | Échec immédiat — la requête est en cause |

## Sécurité

- `clientSecret` marchand et numéros de payeur chiffrés en AES-256-GCM
  (`app/lib/crypto.server.ts`), clé maîtresse dans `ENCRYPTION_KEY`.
- Webhooks vérifiés sur le **corps brut** : toute re-sérialisation invaliderait
  la signature. Comparaison à temps constant.
- Journaux : jamais de secret, de jeton ni de numéro complet. Les numéros sont
  masqués (`00224*******22`).
- Configuration validée au démarrage ; l'application refuse de démarrer si une
  variable manque.

## Idempotence

Deux garde-fous, chacun porté par une contrainte d'unicité en base :

- `DjomyPayment.merchantPaymentReference` — un paiement par commande.
- `DjomyWebhookEvent.eventId` — un webhook rejoué n'est jamais retraité.

## mTLS

Exigé par Shopify pour le canal offsite (phase P4). À configurer sur
l'hébergement retenu avec le certificat CA Shopify. Non requis pour le canal
manuel.

## Lien de paiement sur la page de remerciement

Avec un moyen de paiement manuel, Shopify ne redirige pas l'acheteur. Une
extension de checkout (`extensions/djomy-payer`, cible
`purchase.thank-you.block.render`) affiche donc un bouton « Payer
maintenant » sur la page de remerciement.

1. Le webhook `orders/create` enregistre le `checkout_token` de la commande
   dans `DjomyPayment.shopifyCheckoutToken`.
2. L'extension lit le même jeton (`shopify.checkoutToken`) et pointe vers
   `/pay/c/<jeton>`. Elle ne fait aucun appel réseau.
3. La route `app/routes/pay.c.$jeton.tsx` retrouve le paiement et redirige
   vers `/pay/<référence>`. Si le webhook n'est pas encore arrivé, elle
   patiente : dix rechargements espacés de trois secondes, puis un message.

Shopify n'expose pas le nom du moyen de paiement à l'extension, seulement son
type : le bouton s'affiche pour tout paiement manuel. Le lien déposé en note
de commande reste en place.

L'adresse de l'app est une constante de `Remerciement.jsx` : la modifier
impose un nouveau `npm run deploy`.

## Hébergement et déploiement

Production : `https://djomy.ousmanebellasarl.com`, sur un VPS partagé
avec d'autres applications.

| Élément | Emplacement |
|---|---|
| App + PostgreSQL | `docker-compose.yml`, projet `djomy-shopify`, dossier `/opt/djomy-shopify` |
| Secrets | `/opt/djomy-shopify/.env`, présent uniquement sur le serveur |
| Proxy HTTPS | Caddy partagé du serveur ; site décrit dans `deploy/caddy/djomy-shopify.caddy` |
| Lien proxy → app | réseau Docker externe `edge`, alias `djomy-shopify`, port 3000 |
| DNS | enregistrement A du sous-domaine, géré chez le registraire du domaine |

Le port `127.0.0.1:3100` du serveur ne sert qu'au contrôle de santé du
déploiement. La base n'est jointe que par l'app, sous l'alias `djomy-db`.

Déploiement continu (`.github/workflows/ci-cd.yml`) : typecheck, tests et
build à chaque push ; à chaque push sur `main`, envoi du code par rsync puis
`docker compose up -d --build`. Les migrations Prisma s'appliquent au
démarrage du conteneur.

Deux opérations restent manuelles :

- **Site Caddy** : copier `deploy/caddy/djomy-shopify.caddy` dans le dossier
  des sites du Caddy partagé, valider, puis recharger. À refaire seulement si
  ce fichier change.
- **Configuration Shopify** : `npm run deploy` après toute modification de
  `shopify.app.toml`.

