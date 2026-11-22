# Points ouverts

## D8 — Format de signature des webhooks : outillage prêt, confirmation en attente

La documentation Djomy indique un en-tête `X-Webhook-Signature: v1:<signature>`
sans préciser la chaîne signée. Notre implémentation retient
`HMAC_SHA256(corps_brut, clientSecret)` en hexadécimal — hypothèse la plus
probable, non confirmée.

**Outillage en place :** `npm run capture:webhook` démarre un serveur de
capture et l'expose sur une URL publique via cloudflared. À la réception d'un
webhook, il confronte la signature reçue à treize hypothèses (corps brut, corps
re-sérialisé, clé = clientId, préfixage par timestamp ou eventId, encodage
base64, SHA-256 simple…) et désigne celle qui correspond.

Chaîne vérifiée de bout en bout le 2026-08-24 : requête entrante depuis
Internet → tunnel Cloudflare → serveur de capture → formule identifiée.
Il ne manque qu'un webhook émis par Djomy lui-même.

**Ce qu'il reste à faire :**

1. `npm run capture:webhook` — laisser tourner.
2. Coller l'URL affichée dans l'espace développeur Djomy, rubrique webhooks.
3. `npm run verify:sandbox` dans un second terminal, puis régler le paiement
   sur l'URL de redirection obtenue.
4. Lire la conclusion affichée par le serveur de capture.

Si la formule diffère de l'hypothèse actuelle, corriger `verifyWebhookSignature`
dans [`app/lib/djomy/signature.ts`](../app/lib/djomy/signature.ts) et rejouer
toute la suite de tests.

⚠️ L'URL du tunnel est éphémère : elle change à chaque lancement et cesse de
répondre dès l'arrêt du script. Ne pas la laisser configurée chez Djomy
au-delà du diagnostic.

## Constaté sur le bac à sable — 2026-08-24

Vérifié par `npm run verify:sandbox` contre `sandbox-api.djomy.africa`.

### D11 — Djomy n'applique aucune idempotence sur `merchantPaymentReference` ⚠

Deux appels successifs avec la **même** référence marchand créent **deux
transactions distinctes** :

```
4fb3caee-f83d-4ca1-95b2-79e0eab11151
6fcb4aab-7350-4b2c-97f2-96c6d1d5ab94
```

Aucun endpoint ne permet de retrouver une transaction par sa référence
marchand : impossible de dédupliquer après coup.

**Conséquence retenue :** le client ne rejoue **jamais** une création de
paiement, même sur panne réseau ou 500 (cf. décision D-009). Les lectures et
l'authentification restent rejouées.

**Risque résiduel :** si la réponse se perd après création côté Djomy, une
nouvelle tentative de l'acheteur créera une seconde transaction. Seule une
idempotence côté Djomy pourrait le supprimer — question Q7.

### D10 — Erreurs de validation remontées en HTTP 500

Un `countryCode` inconnu produit un `500`, pas un `400`. Une erreur de saisie
est donc indiscernable d'une panne du service, ce qui rend tout rejeu
automatique dangereux sur les écritures. Contribue à la décision D-009.

### D9 — Djomy accepte un montant négatif

`amount: -100` a été accepté et le paiement créé
(`88e97c2d-36a6-40d8-ba0f-257d57d101c0`), avec une URL de redirection valide.

Notre `toDjomyAmount` refuse les montants nuls ou négatifs : le chemin normal
de l'application ne peut pas produire ce cas. À signaler à Djomy.

## Bloquants pour la mise en production

### D1 — Aucune API de remboursement chez Djomy

La spec OpenAPI n'expose aucun endpoint de remboursement. Seul l'événement
webhook `payment.refunded` existe, ce qui laisse penser que le remboursement
s'effectue depuis l'espace marchand Djomy.

Shopify exige que le marchand puisse rembourser depuis son admin. C'est un
critère d'approbation pour le canal offsite.

**En attendant :** `refundSessionReject` avec un motif explicite, plus une
annotation de commande. Ne jamais résoudre un remboursement qui n'a pas eu
lieu. Question Q1 posée à Djomy.

### D7 — URL de production Djomy inconnue

La spec ne déclare que `https://sandbox-api.djomy.africa`. Question Q2.

### D8 — Format exact de la signature webhook non spécifié

La documentation indique « le payload sera signé avec la clé secrète » et un
en-tête `X-Webhook-Signature: v1:signature`, sans préciser la chaîne signée.

L'implémentation retient `HMAC_SHA256(corps_brut_UTF8, clientSecret)` en
hexadécimal, par cohérence avec l'en-tête `X-API-KEY`. **À confirmer sur un
webhook sandbox réel avant toute recette.** Question Q3.

## Contraintes à traiter dans le code

### D2 — `payerNumber` obligatoire même en flux redirigé

`CreatePaymentCommand` déclare `payerNumber` requis, y compris pour le flux
avec redirection. Shopify ne garantit pas le téléphone de l'acheteur au
checkout.

**Traitement :** page intermédiaire hébergée par l'app pour collecter le
numéro avant redirection. Question Q5 sur le cas du paiement par carte.

### D5 — Idempotence non documentée côté Djomy

Aucune mention de clé d'idempotence ni de politique de rejeu. Un rejeu
pourrait produire un double débit.

**Traitement :** unicité de `merchantPaymentReference` et de `eventId` en
base. Question Q4 sur les limites de débit.

## Dette de vérification

### V1 — Adaptateurs non couverts par les tests unitaires

`app/lib/marchand/depot.server.ts`, `app/lib/paiements/depot.server.ts` et
`app/lib/paiements/commandes.server.ts` sont exclus de la mesure de couverture :
ils ne portent aucune décision métier, mais exigent une base PostgreSQL et une
session Shopify réelles.

Ils ne sont donc **pas vérifiés à ce jour**. La recette d'intégration (phase P5)
doit les exercer, en particulier :

- l'unicité de `merchantPaymentReference` sous insertion concurrente ;
- l'unicité de `eventId` comme garde-fou anti-rejeu ;
- `orderMarkAsPaid` et l'ajout de note sans écrasement de la note existante.

### V2 — Aucun appel réel à Djomy

Toute la vérification repose sur des doubles de test. Rien n'a été confronté au
bac à sable Djomy faute de clés.

## Contraintes d'exploitation

### D6 — Exigences Shopify pour le canal offsite

TLS mutuel avec le CA Shopify, disponibilité 99,95 %, réponse support sous
2 heures, webhooks de conformité. À arbitrer avant la phase P4 : hébergement
et astreinte.

## Questions ouvertes chez Djomy

| # | Question | Statut |
| --- | --- | --- |
| Q1 | API de remboursement disponible ? | ⏸ à poser |
| Q2 | URL de base en production ? | ⏸ à poser |
| Q3 | Chaîne exacte signée pour le webhook ? | ⏸ à poser |
| Q4 | Limites de débit et politique de rejeu ? | ⏸ à poser |
| Q5 | `payerNumber` factice accepté si paiement par carte ? | ⏸ à poser |
| Q6 | Délai avant `payment.timeout` ? Annulation possible ? | ⏸ à poser |
| Q7 | Une idempotence sur `merchantPaymentReference` est-elle prévue ? (D11) | 🔴 prioritaire |
| Q8 | Pourquoi un `countryCode` invalide renvoie-t-il 500 et non 400 ? (D10) | ⏸ à poser |
| Q9 | Les montants négatifs seront-ils rejetés côté Djomy ? (D9) | ⏸ à poser |
