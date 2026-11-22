# Décisions techniques

## D-001 — Stratégie hybride plutôt que native seule

**Date :** 2026-08-24 · **Statut :** actée

Shopify réserve les payments extensions aux Partners approuvés. Le délai
d'approbation n'est pas maîtrisable.

Le connecteur Djomy est donc écrit indépendamment du canal d'encaissement.
Le canal manuel est livré d'abord, le canal offsite se branche ensuite sur le
même connecteur.

**Écarté :** viser uniquement l'extension native — rien d'exploitable avant
une échéance inconnue.

## D-002 — Node / TypeScript / Remix

**Date :** 2026-08-24 · **Statut :** actée

Template officiel Shopify. Les librairies `@shopify/*`, les exemples de
payments extensions et le CLI sont alignés dessus.

**Écarté :** Django et Laravel — tout le socle Shopify (OAuth, sessions,
webhooks, Payments Apps API) serait à réécrire, sans support officiel.

## D-003 — Refus des arrondis silencieux sur les montants

**Date :** 2026-08-24 · **Statut :** actée

GNF et XOF n'ont pas de décimale. Shopify transmet les montants en chaîne
décimale. Arrondir un montant décimal reviendrait à décider à la place du
marchand du montant encaissé.

`toDjomyAmount` lève sur toute décimale non nulle pour une devise entière.

## D-004 — Correspondance explicite des devises

**Date :** 2026-08-24 · **Statut :** actée

Djomy n'utilise pas les codes ISO-4217 : sa spec expose `GNF`, `FCFA`,
`Dollar`, `Leones`. La correspondance est explicite dans les deux sens, et
toute devise hors périmètre est rejetée plutôt que devinée.

`GNF → GNF` · `XOF → FCFA` · `USD → Dollar` · `SLE → Leones`

## D-005 — Injection de `fetch` plutôt qu'interception réseau

**Date :** 2026-08-24 · **Statut :** actée

Le client Djomy reçoit `fetch`, l'horloge et la fonction d'attente par
configuration. Les tests deviennent déterministes et instantanés : aucun
délai réel, aucune dépendance à un serveur simulé.

## D-006 — Vérification de signature avant analyse du webhook

**Date :** 2026-08-24 · **Statut :** actée

`verifierWebhook` contrôle la signature sur le corps brut avant tout
`JSON.parse`. Un corps non authentifié n'est jamais interprété.

## D-007 — Statut de paiement recoupé avec le type d'événement

**Date :** 2026-08-24 · **Statut :** actée

`estPaiementReussi` exige à la fois `eventType = payment.success` et un
statut `SUCCESS` ou `CAPTURED`. Une incohérence entre les deux n'autorise pas
l'encaissement.

## D-009 — Aucun rejeu automatique sur la création d'un paiement

**Date :** 2026-08-24 · **Statut :** actée · **Origine :** vérification sandbox

Deux constats faits contre l'API réelle :

- Djomy n'applique aucune idempotence sur `merchantPaymentReference` : deux
  appels identiques créent deux transactions (D11).
- Une erreur de validation peut remonter en HTTP 500, indiscernable d'une
  panne réelle (D10).

Rejouer automatiquement une création exposerait donc à un double débit.
`createGatewayPayment` et `createDirectPayment` s'exécutent en une seule
tentative. L'authentification et les lectures de statut, sans effet de bord,
conservent leurs trois tentatives.

**Écarté :** conserver un rejeu uniforme — plus simple à lire, mais le prix
d'un double débit chez un acheteur n'est pas une simplification acceptable.

## D-008 — Reprise sur 401 hors quota de rejeu

**Date :** 2026-08-24 · **Statut :** actée

Un jeton périmé n'est pas une panne du service. La ré-authentification ne
consomme donc pas une des trois tentatives réservées aux erreurs
transitoires.

## D-010 — Hébergement sur le VPS existant, derrière le Caddy partagé

**Date :** 2026-11-22 · **Statut :** actée

L'app tourne en Docker sur le VPS qui héberge déjà d'autres applications, et
s'expose par le proxy Caddy en place, via un fichier de site importé et le
réseau Docker `edge`. Aucun fichier des autres applications n'est modifié.

**Écarté :**

- Render (offre gratuite) : mise en veille incompatible avec le délai de 5 s
  des webhooks Shopify, base supprimée après 30 jours.
- Hébergement mutualisé : dossier d'application dans la racine web publique,
  arrêt de l'app après inactivité.
- Un second proxy dédié : les ports 80 et 443 sont déjà pris par Caddy.

**Conséquence :** l'exposition HTTPS dépend du Caddy d'une autre application.
Sa réinstallation sans le dossier des sites importés couperait l'accès à
l'app.

