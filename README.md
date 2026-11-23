# Djomy pour Shopify

Extension de paiement mobile pour Shopify, adossée à l'agrégateur [Djomy](https://djomy.africa) :
Orange Money, MTN Mobile Money, Kulu, et carte via le portail Djomy.

## État

Socle et connecteur Djomy livrés et testés. Les canaux d'encaissement sont en cours.
Voir le [plan d'implémentation](docs/plans/2026-08-24-djomy-shopify-payments.md).

| Brique | État |
| --- | --- |
| Authentification HMAC | ✅ **validée contre l'API réelle** |
| Création de paiement et consultation de statut | ✅ **validées contre l'API réelle** |
| Vérification des signatures de webhook | ✅ testé (format à confirmer, D8) |
| Client HTTP Djomy (jeton, rejeux, erreurs typées) | ✅ testé |
| Conversion montants et devises | ✅ testé |
| Normalisation des numéros de téléphone | ✅ testé |
| Chiffrement des secrets marchands | ✅ testé |
| Modèle de données | ✅ schéma validé |
| App Shopify embarquée + configuration marchand | ✅ compile, recette à faire |
| Canal manuel : page de paiement, webhook, réconciliation | ✅ logique testée |
| Webhooks de conformité Shopify | ✅ implémenté |
| Recette sandbox de bout en bout | ⏸ à faire (clés Djomy requises) |
| Payments App Extension offsite | ⏸ à faire (approbation Shopify requise) |

## Démarrage

```bash
cp .env.example .env
openssl rand -base64 32          # à reporter dans ENCRYPTION_KEY
npm install
npm test
```

Base de données locale :

```bash
docker run --name djomy-pg -e POSTGRES_USER=djomy -e POSTGRES_PASSWORD=djomy \
  -e POSTGRES_DB=djomy -p 5432:5432 -d postgres:16
npm run prisma:migrate
```

## Commandes

| Commande | Effet |
| --- | --- |
| `npm test` | Suite de tests unitaires |
| `npm run verify:sandbox` | Vérification contre l'API Djomy réelle (réseau) |
| `npm run capture:webhook` | Capture un webhook Djomy réel et identifie sa signature |
| `npm run test:coverage` | Tests + couverture |
| `npm run typecheck` | Vérification TypeScript |
| `npm run config:link` | Rattache le dossier à une app du Partner Dashboard |
| `npm run dev` | Serveur de développement Shopify |

## Comment fonctionne le canal manuel

1. Le marchand crée une méthode de paiement manuelle dont le nom contient
   « Djomy » (Réglages → Paiements → Méthodes manuelles).
2. Le marchand ajoute le bloc « Paiement Djomy » à la page de remerciement,
   depuis l'éditeur de checkout (Réglages → Paiement → Personnaliser).
3. À la commande, le webhook `orders/create` prépare un paiement et dépose le
   lien `/pay/<référence>` en note de commande.
4. Sur la page de remerciement, l'acheteur clique sur « Payer maintenant »,
   saisit son numéro, puis est redirigé vers le portail Djomy.
5. Le webhook Djomy confirme le paiement ; la commande passe en payée.
6. Un passage de réconciliation rattrape les webhooks perdus.

L'URL de webhook à renseigner côté Djomy est affichée dans l'écran de
configuration de l'application.

## Documentation

- [Contexte projet](docs/PROJECT-CONTEXT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Décisions techniques](docs/TECHNICAL-DECISIONS.md)
- [Fonctionnalités validées](docs/VALIDATED-FEATURES.md)
- [Points ouverts](docs/KNOWN-ISSUES.md)
- [Spec OpenAPI Djomy](docs/api/djomy-openapi-partner.json)
