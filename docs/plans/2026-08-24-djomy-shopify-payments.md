# Extension de paiement mobile Djomy pour Shopify — Plan d'implémentation

> **Référence :** `DJOMY-SHOPIFY/2026/001`
> **Date :** 2026-08-24
> **Statut :** ✅ Validé — stratégie hybride, stack Node/TypeScript/Remix
> **Pour Claude :** implémenter tâche par tâche, dans l'ordre.

**Objectif :** permettre à une boutique Shopify d'encaisser en Orange Money, MTN MoMo, Kulu et carte via l'agrégateur Djomy.

**Architecture :** une app Shopify (Node/TypeScript, template Remix officiel) qui expose un connecteur Djomy réutilisable (`app/lib/djomy/`), branché sur deux canaux d'encaissement : une méthode de paiement manuelle réconciliée par webhook (livrable immédiat, sans approbation Shopify) puis une Payments App Extension offsite native au checkout (livrable après approbation Shopify Payments Partner). Le connecteur Djomy est identique dans les deux cas.

**Tech stack :** Node 20 · TypeScript · Remix (`@shopify/shopify-app-remix`) · Prisma · PostgreSQL · Shopify CLI · Vitest · Docker.

---

## 1. Ce que la documentation Djomy établit (vérifié le 2026-08-24)

Spec OpenAPI archivée : [docs/api/djomy-openapi-partner.json](../api/djomy-openapi-partner.json) (récupérée sur `https://developers.djomy.africa/documentation/openapi-partner.json`).

| Élément | Valeur |
| --- | --- |
| Base sandbox | `https://sandbox-api.djomy.africa` |
| Base production | ❗ non déclarée dans la spec — à obtenir auprès de Djomy |
| Auth | `X-API-KEY: <clientId>:<hex(HMAC_SHA256(clientId, clientSecret))>` |
| Token | `POST /v1/auth` → `data.accessToken`, `tokenType`, `expiresIn` = 3600 s |
| Appels protégés | `Authorization: Bearer <token>` **+** `X-API-KEY` (les deux) |
| Paiement redirigé | `POST /v1/payments/gateway` → `data.redirectUrl` |
| Paiement direct | `POST /v1/payments` (OM, MOMO, KULU — carte interdite ici) |
| Confirmation OTP | `POST /v1/payments/{transactionReference}/confirmOTP` |
| Statut | `GET /v1/payments/{transactionId}/status` |
| Webhook entrant | header `X-Webhook-Signature: v1:<signature>`, HMAC-SHA256 du payload avec `clientSecret` |
| Devises | `GNF`, `FCFA`, `Dollar`, `Leones` |
| Méthodes | `OM`, `MOMO`, `KULU`, `CARD` (VISA/MC) ; `SOUTRA_MONEY`, `PAYCARD`, `YMO`, `AMEX` annoncés |
| Statuts paiement | `CREATED`, `PENDING`, `REDIRECTED`, `AUTHORIZED`, `CAPTURED`, `SUCCESS`, `FAILED`, `CANCELLED` |
| Événements webhook | `payment.created/redirected/pending/cancelled/timeout/success/failed/refunded`, `payout.success/failed` |
| Payload webhook | V1 : données dans `data` · V2 : dans `data.payment` (nouvelles configs en V2) |

Champs de `POST /v1/payments/gateway` (`CreatePaymentCommand`) :
`amount`\*, `countryCode`\* (ISO-2, ex. `GN`), `payerNumber`\* (format international, ex. `00224623707722`), `allowedPaymentMethods[]`, `description`, `merchantPaymentReference`, `returnUrl` (https, obligatoire en redirection), `cancelUrl`, `metadata` (JSON plat, sans liste ni imbrication).

Réponse (`CreatedPaymentDto`) : `transactionId` (uuid), `status`, `paidAmount`, `paymentMethod`, `merchantPaymentReference`, `createdAt`, `redirectUrl`, `paymentUrl`, `allowedPaymentMethods`, `metadata`.

## 2. Points durs identifiés — à traiter, pas à contourner

| # | Point | Impact | Traitement prévu |
| --- | --- | --- | --- |
| D1 | **Aucun endpoint de remboursement** dans l'API Djomy (seul l'événement `payment.refunded` existe) | Shopify exige que le marchand puisse rembourser depuis l'admin. Bloquant pour l'approbation d'une payments extension | Question ouverte à Djomy (Q1). Repli : `refundSession` en échec explicite + remboursement manuel depuis l'espace Djomy, réconcilié par webhook |
| D2 | `payerNumber` **obligatoire** même sur le flux redirigé | Shopify ne garantit pas le téléphone de l'acheteur au checkout | Page intermédiaire de collecte du numéro hébergée par l'app avant redirection Djomy |
| D3 | Devises Djomy non ISO (`FCFA`, `Dollar`, `Leones`) | Mapping obligatoire depuis les codes Shopify (`XOF`, `USD`, `SLE`) | Table de correspondance + rejet explicite des devises hors périmètre |
| D4 | GNF est zero-decimal chez Shopify ; Djomy attend un `number` | Risque d'erreur d'un facteur 100 | Conversion centralisée et testée (`currency.ts`) |
| D5 | Aucune idempotence documentée côté Djomy | Double débit possible sur retry | Clé d'idempotence portée par `merchantPaymentReference` + verrou en base côté app |
| D6 | Shopify impose **mTLS**, 99,95 % de dispo, réponse support < 2 h | Contrainte d'exploitation, pas de code | À arbitrer avec la direction avant la phase native (hébergement, astreinte) |
| D7 | URL de production Djomy inconnue | Impossible de passer en live | Question Q2 |
| D8 | Format exact de la signature webhook non spécifié (payload brut ? corps canonicalisé ?) | Risque de rejeter tous les webhooks | Question Q3 + implémentation tolérante testée sur webhook réel sandbox |

## 3. Questions à lever auprès de Djomy (bloquantes pour le live, pas pour le développement)

- **Q1** — Existe-t-il une API de remboursement (totale/partielle) ? Sinon, quel est le processus et le délai ?
- **Q2** — Quelle est l'URL de base de production ? Les clés sandbox et production sont-elles distinctes ?
- **Q3** — La signature webhook est-elle `HMAC_SHA256(corps_brut_UTF8, clientSecret)` en hexadécimal, préfixée `v1:` ?
- **Q4** — Quelles limites de débit (`429`) et quelle politique de retry recommandée ?
- **Q5** — Le flux redirigé accepte-t-il un `payerNumber` factice si l'acheteur choisit la carte sur le portail ?
- **Q6** — Un paiement peut-il être annulé/expiré côté Djomy, et sous quel délai (`payment.timeout`) ?

## 4. Périmètre

**IN**
- Connecteur Djomy TypeScript testé : signature HMAC, cache de token, paiements, statut, webhooks.
- App Shopify embarquée : configuration des clés marchand, choix des méthodes, mode test.
- Canal 1 — méthode de paiement manuelle + page de paiement app + réconciliation automatique de la commande.
- Canal 2 — Payments App Extension offsite (code prêt, activable après approbation Shopify).
- Documentation projet (règle K) et guide d'installation marchand.

**OUT**
- Payouts Djomy (`/v1/payout-orders`) — hors sujet encaissement.
- Liens de paiement Djomy (`/v1/links`) — non nécessaires au checkout.
- Publication sur le Shopify App Store et dossier d'approbation Payments Partner (accompagnement possible, phase séparée).
- Gestion multi-devises dynamique (Shopify Markets).

## 5. Découpage en phases

| Phase | Contenu | Durée estimée | Dépendances |
| --- | --- | --- | --- |
| P0 | Socle projet, docs, CI, Docker | 0,5 j | — |
| P1 | Connecteur Djomy (`app/lib/djomy/`) + tests | 2 j | clés sandbox |
| P2 | App Shopify embarquée + configuration marchand | 1,5 j | compte Partner Shopify |
| P3 | Canal 1 — paiement manuel réconcilié | 2 j | P1, P2 |
| P4 | Canal 2 — Payments App Extension offsite | 3 j | P1, P2, approbation Shopify |
| P5 | Recette sandbox de bout en bout, doc marchand | 1,5 j | P3 |

Total développement : ~10,5 jours. Le passage en production dépend de Q1/Q2 et de l'approbation Shopify pour P4.

---

# Tâches

> Convention : chaque tâche suit test → échec → implémentation → succès → commit.
> Commandes lancées depuis la racine du projet.

## Phase P0 — Socle

### Tâche 0.1 : Initialiser le dépôt

**Fichiers :** `.gitignore`, `README.md`, `docs/*`

**Étapes**
1. `git init && git branch -M main`
2. Créer l'app Shopify : `npm init @shopify/app@latest -- --template remix --flavor typescript` dans un dossier temporaire, puis fusionner à la racine.
3. `.gitignore` : `node_modules`, `.env`, `.env.*`, `dist`, `build`, `.shopify`, `*.bak-*`, `prisma/dev.sqlite`.
4. Créer `docs/PROJECT-CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/TECHNICAL-DECISIONS.md`, `docs/VALIDATED-FEATURES.md`, `docs/KNOWN-ISSUES.md`, `docs/CHANGELOG.md` (règle K). Reporter dans `KNOWN-ISSUES.md` les points D1 à D8.
5. Commit : `chore: socle projet app Shopify Djomy`

**Vérification :** `npm run build` termine sans erreur.

### Tâche 0.2 : Outillage de test

**Fichiers :** `vitest.config.ts`, `package.json`

1. `npm i -D vitest @vitest/coverage-v8 msw`
2. Script `"test": "vitest run"`, `"test:watch": "vitest"`.
3. Test sentinelle `app/lib/__tests__/sanity.test.ts` : `expect(1).toBe(1)`.
4. `npm test` → 1 passed. Commit : `chore: vitest`

### Tâche 0.3 : Variables d'environnement

**Fichiers :** `.env.example`, `app/lib/env.server.ts`

```
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_APP_URL=
DATABASE_URL=postgresql://djomy:djomy@localhost:5432/djomy
DJOMY_BASE_URL=https://sandbox-api.djomy.africa
DJOMY_CLIENT_ID=
DJOMY_CLIENT_SECRET=
DJOMY_WEBHOOK_VERSION=V2
DJOMY_COUNTRY_CODE=GN
ENCRYPTION_KEY=
```

`env.server.ts` valide au démarrage avec `zod` et **échoue vite** si une variable manque. Jamais de secret journalisé (règle inviolable).

Commit : `chore: validation des variables d'environnement`

---

## Phase P1 — Connecteur Djomy

### Tâche 1.1 : Signature HMAC

**Fichiers :** créer `app/lib/djomy/signature.ts`, test `app/lib/djomy/__tests__/signature.test.ts`

**Étape 1 — test qui échoue**

```ts
import { describe, expect, it } from "vitest";
import { apiKeyHeader, signPayload, verifyWebhookSignature } from "../signature";

describe("signature Djomy", () => {
  it("construit l'en-tête X-API-KEY au format clientId:hex", () => {
    const header = apiKeyHeader("client-001", "secret");
    expect(header).toMatch(/^client-001:[0-9a-f]{64}$/);
  });

  it("signe le clientId avec le clientSecret comme clé", () => {
    // HMAC_SHA256(message = clientId, key = clientSecret)
    expect(signPayload("client-001", "secret")).toBe(
      signPayload("client-001", "secret"),
    );
    expect(signPayload("client-001", "secret")).not.toBe(
      signPayload("client-002", "secret"),
    );
  });

  it("accepte une signature webhook préfixée v1:", () => {
    const body = '{"eventType":"payment.success"}';
    const sig = `v1:${signPayload(body, "secret")}`;
    expect(verifyWebhookSignature(body, sig, "secret")).toBe(true);
  });

  it("rejette une signature falsifiée", () => {
    expect(verifyWebhookSignature("{}", "v1:deadbeef", "secret")).toBe(false);
  });

  it("rejette une signature de longueur différente sans lever", () => {
    expect(verifyWebhookSignature("{}", "v1:", "secret")).toBe(false);
  });
});
```

**Étape 2 :** `npx vitest run app/lib/djomy` → FAIL (module introuvable).

**Étape 3 — implémentation**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 hexadécimal, message signé avec le clientSecret comme clé. */
export function signPayload(message: string, clientSecret: string): string {
  return createHmac("sha256", clientSecret).update(message, "utf8").digest("hex");
}

/** En-tête X-API-KEY exigé sur toutes les requêtes Djomy. */
export function apiKeyHeader(clientId: string, clientSecret: string): string {
  return `${clientId}:${signPayload(clientId, clientSecret)}`;
}

/**
 * Vérifie l'en-tête X-Webhook-Signature (format `v1:<hex>`).
 * Comparaison à temps constant : une signature invalide ne doit rien révéler.
 */
export function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  clientSecret: string,
): boolean {
  if (!header) return false;
  const received = header.includes(":") ? header.split(":").pop()! : header;
  const expected = signPayload(rawBody, clientSecret);
  const a = Buffer.from(received, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
```

**Étape 4 :** `npx vitest run app/lib/djomy` → PASS.
**Étape 5 :** commit `feat(djomy): signature HMAC X-API-KEY et webhook`

> ⚠️ Le sens de `signPayload` pour le webhook (corps brut vs autre chaîne) reste à confirmer (Q3). Le test sera rejoué contre un vrai webhook sandbox en tâche 5.2.

### Tâche 1.2 : Conversion des montants et devises

**Fichiers :** créer `app/lib/djomy/currency.ts` + test

Règles à coder :
- Shopify transmet `amount` en chaîne décimale (`"150000.00"`) et `currency` en ISO-4217.
- Correspondance : `GNF → GNF`, `XOF → FCFA`, `USD → Dollar`, `SLE → Leones`. Toute autre devise → erreur `UnsupportedCurrencyError`.
- `GNF`, `XOF` sont zero-decimal : refuser une partie décimale non nulle plutôt que d'arrondir en silence.
- Retourner un `number` pour Djomy, jamais un float construit par `parseFloat` sur une valeur non validée.

Tests obligatoires : `"150000.00" + GNF → 150000` ; `"1500.50" + GNF → throw` ; `"12.34" + USD → 12.34` ; `"10" + EUR → throw`.

Commit : `feat(djomy): conversion montants et devises`

### Tâche 1.3 : Client HTTP et cache de token

**Fichiers :** créer `app/lib/djomy/client.ts`, `app/lib/djomy/types.ts`, `app/lib/djomy/errors.ts` + tests avec `msw`

Comportement attendu :
- `authenticate()` : `POST /v1/auth`, en-tête `X-API-KEY`, corps `{}` → mémorise `accessToken` avec expiration à `expiresIn - 60 s`.
- Le token est réutilisé tant qu'il est valide ; un `401` déclenche **une seule** ré-authentification puis rejoue la requête.
- Toute requête protégée porte `Authorization: Bearer` **et** `X-API-KEY`.
- `429` et `5xx` : 3 tentatives, backoff exponentiel 1 s / 2 s / 4 s. `4xx` hors 401/429 : échec immédiat.
- Erreurs typées portant `code`, `message`, `details`, `fieldsErrors` issus de `ErrorDetails`.
- Timeout réseau 15 s.
- Journalisation : jamais `clientSecret`, jamais le token, jamais le numéro de téléphone en clair (masquer en `00224******22`).

Méthodes : `createGatewayPayment()`, `createDirectPayment()`, `confirmOtp()`, `getPaymentStatus()`.

Tests `msw` : succès, 401 puis rejeu, 429 puis succès, 400 non rejoué, timeout.

Commit : `feat(djomy): client HTTP authentifié`

### Tâche 1.4 : Modèle de données

**Fichiers :** `prisma/schema.prisma`, migration

```prisma
model DjomyPayment {
  id                    String   @id @default(cuid())
  shop                  String
  channel               String   // "manual" | "offsite"
  shopifyOrderId        String?
  shopifySessionGid     String?  @unique   // gid Payments Apps API
  merchantPaymentReference String @unique  // clé d'idempotence
  djomyTransactionId    String?  @unique
  amount                Decimal  @db.Decimal(20, 4)
  currency              String
  djomyCurrency         String
  paymentMethod         String?
  payerNumber           String?             // chiffré au repos
  status                String              // miroir du statut Djomy
  lastEventId           String?             // eventId webhook déjà traité
  resolvedAt            DateTime?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@index([shop, status])
}

model DjomyCredential {
  shop         String   @id
  clientId     String
  clientSecret String   // chiffré au repos (ENCRYPTION_KEY)
  baseUrl      String
  testMode     Boolean  @default(true)
  updatedAt    DateTime @updatedAt
}
```

`merchantPaymentReference` unique = garde-fou anti double débit (D5).
`lastEventId` = garde-fou anti rejeu de webhook.

Commit : `feat(db): modèle paiements et identifiants Djomy`

### Tâche 1.5 : Chiffrement des secrets marchands

**Fichiers :** `app/lib/crypto.server.ts` + test

AES-256-GCM avec `ENCRYPTION_KEY` (32 octets base64), IV aléatoire par valeur, tag d'authentification stocké. Test : round-trip, altération du chiffré → erreur.

Commit : `feat(security): chiffrement des identifiants marchands`

---

## Phase P2 — App Shopify embarquée

### Tâche 2.1 : Écran de configuration

**Fichiers :** `app/routes/app.settings.tsx`

Formulaire Polaris : `clientId`, `clientSecret` (masqué, jamais réaffiché), `baseUrl` (sandbox/production), `countryCode`, méthodes autorisées (cases OM / MOMO / KULU / CARD), mode test.
Bouton **Tester la connexion** → appelle `authenticate()` et affiche un état lisible (succès / message d'erreur Djomy), sans exposer le secret.

Commit : `feat(app): écran de configuration Djomy`

### Tâche 2.2 : Webhooks de conformité Shopify

**Fichiers :** `app/routes/webhooks.tsx`

`customers/data_request`, `customers/redact`, `shop/redact` — obligatoires pour toute app Shopify. `shop/redact` supprime `DjomyCredential` et anonymise `payerNumber`.

Commit : `feat(app): webhooks de conformité`

---

## Phase P3 — Canal 1 : paiement manuel réconcilié

Flux : checkout Shopify avec méthode manuelle « Mobile Money (Djomy) » → commande créée avec `financial_status: pending` → l'acheteur est amené sur la page de paiement de l'app → paiement Djomy → webhook → commande marquée payée.

### Tâche 3.1 : Page de paiement hébergée

**Fichiers :** `app/routes/pay.$reference.tsx`

- Affiche le montant, la commande, un champ **numéro de téléphone** (résout D2) pré-rempli avec le téléphone Shopify s'il existe, et le choix de la méthode.
- Normalise le numéro au format international `00224XXXXXXXXX` (fonction testée à part, tâche 3.2).
- Appelle `createGatewayPayment()` avec `merchantPaymentReference = ORD-<orderId>-<n>`, `returnUrl`, `cancelUrl`, `metadata = { shop, order_id }`.
- Redirige vers `data.redirectUrl`.
- Page de retour : affiche le statut réel via `getPaymentStatus()`, jamais une confirmation optimiste.

### Tâche 3.2 : Normalisation des numéros

**Fichiers :** `app/lib/phone.ts` + test

`+224623707722`, `224623707722`, `623707722`, `00224 623 707 722` → `00224623707722`. Numéro invalide → erreur explicite. Tests pour GN (`00224`) et CI (`00225`).

Commit : `feat: normalisation des numéros de téléphone`

### Tâche 3.3 : Webhook Djomy

**Fichiers :** `app/routes/webhooks.djomy.tsx` + test

1. Lire le **corps brut** avant tout parsing JSON (indispensable pour la signature).
2. `verifyWebhookSignature()` → si faux, `401` et abandon.
3. Rejeu : si `eventId` déjà vu sur ce paiement, répondre `200` sans retraiter.
4. Extraire le paiement selon la version : `payload.data.payment ?? payload.data` (compatible V1 et V2).
5. Vérifier que `paidAmount` et `currency` correspondent à la commande — un écart n'est **jamais** accepté, il est journalisé et le paiement reste en attente.
6. `payment.success` → `orderMarkAsPaid` via Admin API. `payment.failed` / `payment.cancelled` / `payment.timeout` → annotation de commande. `payment.refunded` → annotation.
7. Toujours répondre `200` sur un événement correctement traité, `500` seulement si le retraitement est souhaitable.

Tests : signature invalide → 401 ; rejeu → 200 sans effet ; succès → commande payée ; montant divergent → non payée ; payload V1 et V2.

Commit : `feat: réception des webhooks Djomy`

### Tâche 3.4 : Filet de sécurité par interrogation

**Fichiers :** `app/jobs/reconcile.server.ts`

Toutes les 5 minutes, reprendre les paiements `PENDING` de moins de 24 h et interroger `GET /v1/payments/{id}/status`. Un webhook perdu ne doit pas laisser une commande impayée. Au-delà de 24 h → `EXPIRED` + annotation.

Commit : `feat: réconciliation périodique des paiements`

---

## Phase P4 — Canal 2 : Payments App Extension offsite

> ⚠️ Ne peut traiter de vrais paiements qu'après acceptation du dossier Payments Partner et signature de l'accord de partage de revenus. Le code est écrit et testable en mode test avant cela.

### Tâche 4.1 : Déclaration de l'extension

**Fichiers :** `extensions/djomy-offsite/shopify.extension.toml`

```toml
api_version = "2026-01"

[[extensions]]
type = "payments_extension"
name = "Djomy Mobile Money"
handle = "djomy-offsite"
payment_session_url = "https://<app>/payments/session"
refund_session_url  = "https://<app>/payments/refund"
merchant_label = "Djomy — Mobile Money"
buyer_label = "Orange Money, MTN MoMo, Kulu"
supported_countries = ["GN", "CI"]
supported_payment_methods = ["djomy-mobile-money"]
test_mode_available = true
```

`capture_session_url` et `void_session_url` ne sont déclarés que si Djomy confirme l'autorisation différée (Q6) — ne pas déclarer une capacité non tenue.

### Tâche 4.2 : `payment_session_url`

**Fichiers :** `app/routes/payments.session.tsx`

- Vérifier le HMAC Shopify de la requête.
- Idempotence : si `gid` déjà connu, renvoyer la même `redirect_url`.
- Créer le paiement Djomy avec `merchantPaymentReference = <gid>`.
- Répondre `{ redirect_url }` (< 8192 octets) pointant vers `pay.$reference` (collecte du numéro, D2).

### Tâche 4.3 : Résolution de session

**Fichiers :** `app/lib/shopify/payments.ts`

Depuis le webhook Djomy : `payment.success` → `paymentSessionResolve` ; `payment.failed` → `paymentSessionReject` (avec `reason` explicite) ; `payment.pending` → `paymentSessionPending`. Rediriger l'acheteur vers `nextAction.action.context.redirectUrl`.

### Tâche 4.4 : `refund_session_url` — traitement de D1

Tant que Q1 n'est pas tranchée : `refundSessionReject` avec un motif explicite (« remboursement à effectuer depuis l'espace marchand Djomy ») et une annotation de commande. **Ne jamais** résoudre un remboursement qui n'a pas eu lieu. À reprendre dès que Djomy fournit l'endpoint.

### Tâche 4.5 : mTLS

Configurer l'authentification TLS mutuelle avec le CA Shopify sur l'hébergement retenu (D6). Documenter la procédure dans `docs/ARCHITECTURE.md`.

---

## Phase P5 — Recette et documentation

### Tâche 5.1 : Recette sandbox de bout en bout

Scénarios à jouer et à consigner dans `docs/VALIDATED-FEATURES.md` :
paiement OM réussi · paiement refusé · abandon sur le portail · webhook rejoué · webhook falsifié · montant divergent · timeout · réseau Djomy indisponible · double soumission du formulaire.

### Tâche 5.2 : Confirmation du format de signature webhook

Capturer un webhook sandbox réel, vérifier que `verifyWebhookSignature` l'accepte. Si ce n'est pas le cas, corriger et **rejouer toute la suite de tests** (règle I).

### Tâche 5.3 : Guide d'installation marchand

`docs/INSTALLATION.md` : obtention des clés Djomy, installation de l'app, configuration, test en sandbox, bascule en production, procédure en cas de commande impayée.

---

## 6. Critères d'acceptation

- [ ] `npm test` : suite verte, couverture ≥ 80 % sur `app/lib/djomy/`.
- [ ] Aucun secret ni numéro complet dans les journaux.
- [ ] Un webhook falsifié est rejeté (test automatisé).
- [ ] Un webhook rejoué ne débite ni ne marque deux fois.
- [ ] Un montant divergent ne marque jamais la commande payée.
- [ ] Une commande payée en sandbox passe bien en `paid` dans l'admin Shopify.
- [ ] `docs/` à jour (règle K), points restants dans `KNOWN-ISSUES.md`.

## 7. Risques

| Risque | Probabilité | Impact | Parade |
| --- | --- | --- | --- |
| Approbation Payments Partner refusée ou lente | Élevée | Fort | Canal 1 livré et exploitable seul |
| Absence d'API de remboursement (D1) | Élevée | Fort | Procédure manuelle documentée, refus explicite côté Shopify |
| Signature webhook mal interprétée (D8) | Moyenne | Fort | Vérification sur webhook réel avant recette |
| URL de production indisponible (D7) | Moyenne | Fort | Q2 posée dès maintenant |
| Erreur d'échelle sur montants GNF (D4) | Faible | Très fort | Conversion centralisée et testée |
| mTLS et SLA 99,95 % (D6) | Moyenne | Moyen | Arbitrage hébergement avant P4 |
