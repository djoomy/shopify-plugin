# Fonctionnalités validées

Une fonctionnalité n'entre ici qu'une fois son résultat réel vérifié.
Ces comportements sont protégés : toute modification qui les casse est une
régression à corriger avant de poursuivre.

## Vérifié par tests automatisés — 2026-08-24

Suite complète : `npm test` → **212 tests, 12 fichiers**.
Couverture de la logique métier : 96,9 % des lignes, 90,5 % des branches.

Les adaptateurs d'entrée-sortie (`depot.server.ts`, `commandes.server.ts`) sont
exclus de cette mesure : ils ne portent aucune décision métier et exigent une
base et une session Shopify réelles. Ils relèvent de la recette d'intégration,
encore à faire.

### Signature HMAC — `app/lib/djomy/signature.ts` (22 tests)

- En-tête `X-API-KEY` au format `<clientId>:<hex 64>`, conforme à la doc Djomy.
- Signature = `HMAC_SHA256(message, clientSecret)`, encodage UTF-8 respecté.
- Vérification de webhook : préfixe `v1:` optionnel, casse et espaces tolérés.
- Rejet d'une signature falsifiée, d'un corps altéré d'un seul caractère,
  d'un secret différent, d'une signature non hexadécimale ou de longueur
  différente — sans jamais lever d'exception.
- Comparaison à temps constant.

### Client HTTP — `app/lib/djomy/client.ts` (26 tests)

- `POST /v1/auth` avec `X-API-KEY` seul et corps `{}`.
- Jeton mis en cache, réutilisé, renouvelé 60 s avant expiration.
- Une seule authentification malgré des appels concurrents.
- `401` → une ré-authentification puis rejeu ; abandon si le `401` persiste.
- `429` et `5xx` rejoués trois fois avec attente 1 s puis 2 s.
- `400`, `422` jamais rejoués.
- Panne réseau et dépassement de délai convertis en `DjomyNetworkError`.
- `success: false` traité comme une erreur même sur un code HTTP 2xx.
- Réponse sans `data` ou non JSON signalée en `DjomyProtocolError`.
- Journaux exempts de secret, de jeton et de numéro complet.

### Montants et devises — `app/lib/djomy/currency.ts` (20 tests)

- Correspondance ISO ↔ Djomy dans les deux sens, devise inconnue rejetée.
- GNF et XOF : toute décimale non nulle refusée, jamais arrondie.
- USD et SLE : deux décimales au maximum.
- Montant nul, négatif, non numérique, non fini ou hors précision entière
  sûre : refusé.
- Comparaison de montants insensible aux artefacts de l'arithmétique
  flottante.

### Webhooks — `app/lib/djomy/webhook.ts` (21 tests)

- Signature vérifiée avant toute analyse du contenu.
- Payloads V1 et V2 produisant des données de paiement identiques.
- Transferts sortants (`payout.*`) reconnus en V2.
- `eventId` exigé : sans lui, aucune protection contre le rejeu.
- `estPaiementReussi` exige `payment.success` **et** un statut abouti.

### Numéros de téléphone — `app/lib/phone.ts` (10 tests)

- Guinée et Côte d'Ivoire, formats `+224`, `00224`, `224`, national.
- Espaces, tirets, points et parenthèses ignorés.
- Longueur incorrecte, saisie vide ou pays hors périmètre : refusés.

### Chiffrement — `app/lib/crypto.server.ts` (13 tests)

- AES-256-GCM, IV aléatoire par valeur, aller-retour fidèle.
- Chiffré ou tag altéré : rejeté, jamais de valeur fausse renvoyée.
- Message d'erreur ne révélant pas la cause.

### Erreurs typées — `app/lib/djomy/errors.ts` (14 tests)

- `estRejouable` vrai pour `429` et `5xx`, faux pour `400`, `401`, `403`, `422` :
  c'est cette règle qui pilote les rejeux du client.
- Panne réseau toujours rejouable ; erreur de protocole jamais rejouable.
- Message destiné à l'acheteur exempt de détail technique et de cause interne.
- Masquage des numéros : indicatif et deux derniers chiffres seulement.

### Configuration — `app/lib/env.server.ts` (8 tests)

- Variable manquante signalée nommément, sans divulguer aucune valeur.
- `SHOPIFY_APP_URL` imposée en https, `ENCRYPTION_KEY` de 32 octets.

### Configuration marchand — `app/lib/marchand/config.ts` (21 tests)

- Validation de tous les champs en un passage : chaque champ fautif est
  signalé, pas seulement le premier.
- Secret conservé si le champ est laissé vide lors d'une mise à jour.
- URL non https, pays hors périmètre, liste de méthodes vide : refusés.
- Méthodes inconnues de Djomy écartées — Djomy retomberait silencieusement sur
  la liste complète, le marchand doit le savoir.
- Aucun secret dans les messages d'erreur.

### Service de paiement — `app/lib/paiements/service.ts` (24 tests)

- Création : montant entier et numéro normalisé transmis à Djomy.
- Idempotence : un double envoi de formulaire réutilise le paiement en cours
  au lieu d'en créer un second.
- Un paiement déjà abouti ou échoué ne peut pas être relancé.
- Devise, montant et numéro validés **avant** tout appel réseau.
- Webhook : signature invalide rejetée, rejeu neutralisé, référence inconnue
  signalée sans échec.
- **Un montant ou une devise divergents n'encaissent jamais** : la commande
  reste en attente et l'écart est annoté.
- Un `payment.success` au statut non abouti n'encaisse pas.
- Échec, annulation, expiration : commande annotée, jamais marquée payée.
- Payloads V1 et V2 traités à l'identique.

### Prise en charge des commandes — `app/lib/paiements/commande-manuelle.ts` (21 tests)

- Seules les commandes en attente réglées via une passerelle « Djomy » sont
  prises en charge.
- Référence de paiement non devinable : 24 caractères hexadécimaux aléatoires,
  car elle sert de jeton d'accès à la page de paiement.
- Téléphone récupéré par ordre de préférence pour pré-remplir le formulaire.

### Réconciliation — `app/lib/paiements/reconciliation.ts` (12 tests)

- Un paiement passé à `SUCCESS` est encaissé, avec le même contrôle de montant
  que sur le webhook.
- Djomy injoignable : le paiement reste intact, retenté au passage suivant.
- L'échec d'un paiement n'interrompt pas le traitement du lot.
- Expiration : commande annotée, paiement clos.

## Vérifié manuellement — 2026-08-24

- `npx tsc --noEmit` : aucun écart de typage.
- `npx prisma validate` : schéma valide.
- `npm run build` : application construite, 32 modules côté serveur.

## Vérifié contre l'API Djomy réelle — 2026-08-24

`npm run verify:sandbox` → **12 tests, tous verts**, contre
`sandbox-api.djomy.africa`.

- **Authentification HMAC validée en conditions réelles** : l'en-tête
  `X-API-KEY: <clientId>:<HMAC_SHA256(clientId, clientSecret)>` est accepté,
  `POST /v1/auth` renvoie un jeton de 402 caractères.
- Un secret erroné est bien rejeté par Djomy.
- Jeton mis en cache et réutilisé entre deux appels.
- **Création d'un paiement avec redirection réussie** : `POST
  /v1/payments/gateway` renvoie un `transactionId`, un statut `CREATED` et une
  URL de redirection (`https://sandbox.djomy.africa/c/…`).
- **Consultation du statut conforme à nos types** : `transactionId`, `status`,
  `paidAmount`, `payerIdentifier`, `merchantPaymentReference`, `currency`,
  `createdAt`, `allowedPaymentMethods`, `metadata` — tous présents et du type
  attendu.
- Les métadonnées transmises sont bien restituées.
- Une transaction inexistante est signalée par une erreur.
- Le numéro du payeur n'apparaît jamais en entier dans les journaux.

Trois écarts de comportement de Djomy ont été constatés à cette occasion et
consignés : D9, D10 et D11 dans KNOWN-ISSUES.md. D11 a entraîné une correction
du client (décision D-009).

## Non encore vérifié

- Le format de signature des webhooks reste à confirmer sur un webhook réel
  (cf. D8) : impossible sans URL publique recevant une notification Djomy.
- Les adaptateurs Prisma et Admin API (cf. V1).
- Le parcours complet, du checkout à la commande payée.
- Les adaptateurs Prisma et Admin API n'ont pas été exercés contre une vraie
  base ni une vraie boutique.
- Le parcours complet, du checkout à la commande payée, n'a pas été joué.
