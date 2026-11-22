# Contexte projet

## Objectif

Permettre à une boutique Shopify d'encaisser en mobile money via Djomy :
Orange Money (`OM`), MTN Mobile Money (`MOMO`), Kulu (`KULU`), et carte
bancaire (`CARD`) via le portail Djomy.

## Marché visé

Guinée en premier (devise GNF, indicatif +224), Côte d'Ivoire ensuite
(XOF, +225). Djomy déclare également les devises `Dollar` et `Leones`.

## Contrainte structurante

Shopify réserve les extensions de paiement natives aux Partners approuvés
par son programme Payments Platform : candidature, double revue, accord de
partage de revenus, mTLS, disponibilité 99,95 %, support sous 2 heures.

La conséquence dicte l'architecture : le connecteur Djomy est écrit une
seule fois, et deux canaux d'encaissement s'y branchent.

1. **Canal manuel** — aucune approbation requise, exploitable rapidement.
   La commande est créée en attente de paiement, l'acheteur paie sur une page
   hébergée par l'app, le webhook Djomy marque la commande payée.
2. **Canal offsite** — Payments App Extension native au checkout, activable
   dès l'approbation Shopify obtenue.

## Décisions déjà prises

| Sujet | Décision | Date |
| --- | --- | --- |
| Stratégie d'intégration | Hybride : canal manuel puis canal natif | 2026-08-24 |
| Stack | Node 20+ / TypeScript / Remix / Prisma / PostgreSQL | 2026-08-24 |

## Sources

- Documentation Djomy : https://developers.djomy.africa/
- Spec OpenAPI archivée : [api/djomy-openapi-partner.json](api/djomy-openapi-partner.json)
- Extensions de paiement Shopify : https://shopify.dev/docs/apps/build/payments
