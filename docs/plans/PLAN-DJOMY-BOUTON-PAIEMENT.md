# PLAN — Lien « Payer maintenant » sur la page de remerciement

Référence : GTS/DJOMY/2026/003 — 2026-11-23

> **Pour Claude :** exécuter ce plan tâche par tâche, dans l'ordre, avec un
> commit par tâche. Ne pas démarrer avant validation du plan.

## Objectif

Après avoir validé sa commande avec le moyen de paiement « Djomy », l'acheteur
voit sur la page de remerciement Shopify un lien « Payer maintenant » qui
l'amène en un clic à la page de paiement de l'app. Aujourd'hui ce lien n'existe
que dans la note de commande, visible du seul marchand.

## Principe retenu

Shopify fournit à l'extension de la page de remerciement un **jeton de
checkout** (`shopify.checkoutToken`). La documentation indique qu'il correspond
au champ `checkout_token` de la commande, donc à celui du webhook
`orders/create`. Ce jeton est long et aléatoire.

1. Au webhook `orders/create`, l'app enregistre ce jeton avec le paiement.
2. L'extension affiche un lien vers `https://<app>/pay/c/<jeton>`.
3. Cette nouvelle route retrouve le paiement par son jeton et redirige vers la
   page existante `/pay/<référence>`. Si le webhook n'est pas encore arrivé,
   elle affiche une page d'attente qui se recharge seule.

Conséquences de ce choix :

- l'extension ne fait aucun appel réseau : pas de capacité `network_access`,
  pas de jeton de session à vérifier ;
- le lien reste non devinable, comme la référence actuelle ;
- la page de paiement et le lien en note de commande ne changent pas.

**Écarté :** appel `fetch` de l'extension vers l'app (demande d'accès réseau,
authentification, gestion de l'attente dans l'extension) ; lien construit sur
le numéro de commande (devinable, les numéros se suivent).

## Périmètre

| IN | OUT |
|---|---|
| Colonne `shopifyCheckoutToken` et migration Prisma | Page « État de la commande » et espace client |
| Enregistrement du jeton au webhook `orders/create` | E-mail ou SMS de relance à l'acheteur |
| Route `/pay/c/<jeton>` avec page d'attente | Redirection automatique sans clic (impossible hors Payments Apps) |
| Extension `purchase.thank-you.block.render` | Paiement natif Payments Apps |
| Documentation et procédure d'activation côté boutique | Commandes passées avant cette évolution (jeton absent) |

## Faits vérifiés dans la documentation Shopify (API 2026-10)

- Cible `purchase.thank-you.block.render` : prise en charge.
- `shopify.checkoutToken.value` : disponible sur cette cible, peut valoir
  `undefined`, correspond au `checkout_token` de la commande.
- Extensions écrites en Preact avec les composants `s-*` et l'objet global
  `shopify`. Lien externe : `<s-link href="…" target="_blank">`.
- Sur la page de remerciement, la commande peut ne pas être encore créée au
  moment de l'affichage : d'où la page d'attente.

## Points non confirmés, à lever pendant l'exécution

| Point | Où il est levé |
|---|---|
| Disponibilité de cette cible sur le forfait de la boutique (la documentation ne restreint à Plus que les étapes information, livraison et paiement) | Tâche 6, test sur la boutique de développement |
| Fichier d'extension écrit à la main, sans `shopify app generate extension` (champ `uid`) | Tâche 5 ; repli : génération par Ibrahima avec le CLI |
| Version du paquet `@shopify/ui-extensions` pour 2026-10 (npm publie jusqu'à 2026-01) | Tâche 5 ; repli : `api_version = "2026-01"` |
| Filtrage de l'affichage sur le seul moyen de paiement Djomy (`shopify.selectedPaymentOptions`) | Tâche 5 |

## Étapes

### Tâche 1 — Extraire le jeton de checkout du webhook (10 min)

**Fichiers :** `app/lib/paiements/commande-manuelle.ts`,
`app/lib/paiements/commande-manuelle.test.ts`

1. Écrire les tests, les lancer, constater l'échec :

```ts
describe("jetonCheckout", () => {
  it("retourne le checkout_token de la commande", () => {
    expect(jetonCheckout({ ...COMMANDE, checkout_token: "a1b2c3d4e5f60718293a4b5c6d7e8f90" }))
      .toBe("a1b2c3d4e5f60718293a4b5c6d7e8f90");
  });
  it("retourne null si le jeton est absent ou vide", () => {
    expect(jetonCheckout(COMMANDE)).toBeNull();
    expect(jetonCheckout({ ...COMMANDE, checkout_token: "  " })).toBeNull();
  });
  it("rejette un jeton trop court ou au format inattendu", () => {
    expect(jetonCheckout({ ...COMMANDE, checkout_token: "abc" })).toBeNull();
    expect(jetonCheckout({ ...COMMANDE, checkout_token: "../../etc/passwd-0000" })).toBeNull();
  });
});
```

2. Implémenter : ajouter `checkout_token?: string | null` à `CommandeShopify`,
   puis :

```ts
const FORMAT_JETON = /^[A-Za-z0-9_-]{16,128}$/;

/** Vrai si la valeur a la forme d'un jeton de checkout Shopify. */
export function estJetonCheckout(valeur: string): boolean {
  return FORMAT_JETON.test(valeur);
}

/** Jeton de checkout de la commande : il relie la page de remerciement au paiement. */
export function jetonCheckout(commande: CommandeShopify): string | null {
  const jeton = (commande.checkout_token ?? "").trim();
  return estJetonCheckout(jeton) ? jeton : null;
}
```

3. `npx vitest run app/lib/paiements/commande-manuelle.test.ts` : vert.
4. Commit : `feat: extraction du jeton de checkout d'une commande`.

### Tâche 2 — Colonne et migration (15 min)

**Fichiers :** `prisma/schema.prisma`, nouvelle migration
`prisma/migrations/1_checkout_token/migration.sql`

1. Dans `DjomyPayment`, après `shopifySessionGid` :

```prisma
  /// Jeton de checkout Shopify : relie la page de remerciement au paiement.
  shopifyCheckoutToken String? @unique
```

2. Générer la migration sans base, à partir de la migration précédente :

```bash
npx prisma migrate diff --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$URL_POSTGRES_JETABLE" --script \
  > prisma/migrations/1_checkout_token/migration.sql
```

   Résultat attendu : un `ALTER TABLE … ADD COLUMN "shopifyCheckoutToken" TEXT`
   et un `CREATE UNIQUE INDEX`. Aucune autre instruction.
3. Vérifier sur un PostgreSQL jetable : `0_init` puis `1_checkout_token`
   s'appliquent, et `prisma migrate diff` ne détecte aucun écart.
4. Commit : `feat: colonne shopifyCheckoutToken`.

La colonne est facultative : la migration n'affecte pas les lignes existantes.

### Tâche 3 — Enregistrer le jeton au webhook (15 min)

**Fichiers :** `app/lib/paiements/depot.server.ts`, `app/routes/webhooks.tsx`

1. `preparerPaiement` accepte `checkoutToken?: string | null` et l'écrit dans
   `shopifyCheckoutToken` à la création. Le chemin « paiement existant » reste
   inchangé (webhook rejoué).
2. Dans `prendreEnCharge`, passer `checkoutToken: jetonCheckout(commande)`.
3. `npm run typecheck && npm test` : les 215 tests existants restent verts.
4. Commit : `feat: jeton de checkout enregistré avec le paiement`.

### Tâche 4 — Route `/pay/c/<jeton>` (30 min)

**Fichiers :** `app/routes/pay.c.$jeton.tsx` (nouveau),
`app/lib/paiements/lien-checkout.ts` et son test (nouveaux)

1. Logique pure, testée d'abord :

```ts
export const ESSAIS_MAX = 10;

export type Decision =
  | { type: "rediriger"; vers: string }
  | { type: "attendre"; prochainEssai: number }
  | { type: "abandonner" };

/** Décide quoi répondre à l'acheteur arrivé depuis la page de remerciement. */
export function deciderLienCheckout(
  reference: string | null,
  essai: number,
): Decision {
  if (reference) return { type: "rediriger", vers: `/pay/${reference}` };
  if (essai < ESSAIS_MAX) return { type: "attendre", prochainEssai: essai + 1 };
  return { type: "abandonner" };
}
```

   Tests : redirection si la référence existe ; attente tant que
   `essai < ESSAIS_MAX` ; abandon ensuite ; un essai négatif ou non numérique
   est ramené à 0 par la route.
2. Route : le loader refuse (404) un jeton qui ne passe pas `estJetonCheckout`,
   cherche `prisma.djomyPayment.findUnique({ where: { shopifyCheckoutToken } })`,
   applique la décision. En attente, la page affiche « Préparation de votre
   paiement… » et se recharge après 3 secondes par
   `<meta http-equiv="refresh" content="3;url=?essai=N">`. À l'abandon :
   « Votre lien de paiement n'est pas encore prêt. Rechargez cette page dans
   quelques instants ou contactez la boutique. » Styles repris de
   `app/lib/ui/pay-styles.ts`.
3. `npm run typecheck && npm test && npm run build`.
4. Test manuel en local (pile Docker de test) : insérer un paiement avec un
   jeton, vérifier `302` vers `/pay/<référence>` ; jeton inconnu → page
   d'attente `200` ; jeton mal formé → `404`.
5. Commit : `feat: accès à la page de paiement par le jeton de checkout`.

### Tâche 5 — Extension de la page de remerciement (45 min)

**Fichiers (nouveaux) :** `extensions/djomy-payer/shopify.extension.toml`,
`extensions/djomy-payer/src/Remerciement.jsx`,
`extensions/djomy-payer/locales/fr.default.json`

Ajustements : `preact` et `@shopify/ui-extensions` en dépendances de
développement à la racine (pas de workspaces npm, pour ne pas modifier le
`Dockerfile`) ; `extensions` ajouté à `.dockerignore` et à `exclude` dans
`tsconfig.json`.

```toml
api_version = "2026-10"

[[extensions]]
name = "Paiement Djomy"
handle = "djomy-payer"
type = "ui_extension"

  [[extensions.targeting]]
  module = "./src/Remerciement.jsx"
  target = "purchase.thank-you.block.render"
```

```jsx
import "@shopify/ui-extensions/preact";
import { render } from "preact";

const URL_APP = "https://djomy.ousmanebellasarl.com";

export default function extension() {
  render(<Remerciement />, document.body);
}

function Remerciement() {
  const jeton = shopify.checkoutToken.value;
  if (!jeton) return null;

  return (
    <s-banner heading={shopify.i18n.translate("titre")} tone="info">
      <s-stack gap="base">
        <s-text>{shopify.i18n.translate("message")}</s-text>
        <s-link href={`${URL_APP}/pay/c/${jeton}`} target="_blank">
          {shopify.i18n.translate("payer")}
        </s-link>
      </s-stack>
    </s-banner>
  );
}
```

Textes : « Finalisez votre paiement », « Votre commande est enregistrée. Il
reste à la régler par mobile money ou carte bancaire. », « Payer maintenant ».

À trancher pendant la tâche : n'afficher le bloc que si le moyen de paiement
choisi est manuel (`shopify.selectedPaymentOptions`). Si l'information ne
permet pas d'isoler Djomy, le bloc s'affiche pour toute commande et la route
répond proprement pour les autres.

Commit : `feat: extension « Payer maintenant » sur la page de remerciement`.

### Tâche 6 — Mise en ligne et test réel (30 min, avec Ibrahima)

1. Pull request, fusion : la CI/CD déploie l'app et applique la migration.
2. Contrôle externe : `/pay/c/<jeton inconnu>` répond `200` (attente), la
   page d'accueil et les webhooks répondent comme avant.
3. Ibrahima lance `npm run deploy` (publie l'extension).
4. Ibrahima ajoute le bloc « Paiement Djomy » dans l'éditeur de checkout de la
   boutique, sur la page de remerciement.
5. Commande de test : le lien apparaît, mène à la page de paiement, le
   paiement bac à sable passe la commande à « payée ».

### Tâche 7 — Documentation (15 min)

`docs/ARCHITECTURE.md` (route et extension), `docs/VALIDATED-FEATURES.md`
(après le test réel), `docs/CHANGELOG.md`, `README.md` (étape d'activation du
bloc), `docs/TECHNICAL-DECISIONS.md` (D-011 : jeton de checkout plutôt
qu'appel réseau).

## Livrables

- Migration `1_checkout_token`, route `/pay/c/<jeton>`, extension
  `djomy-payer`, tests unitaires associés.
- Procédure d'activation du bloc pour le marchand.

## Risques

| Risque | Mesure |
|---|---|
| Régression sur le parcours actuel (note de commande, page de paiement) | Aucun code existant modifié hors l'ajout d'un champ facultatif ; suite de 215 tests ; contrôle externe après déploiement |
| Cible indisponible sur le forfait de la boutique cliente | Test en tâche 6 ; repli : page fixe « Payer ma commande » (option 2 déjà présentée) |
| Webhook en retard ou perdu | Page d'attente (10 essais, 30 s) puis message clair ; le lien en note de commande reste disponible |
| Jeton de checkout présent dans l'URL | Même sensibilité que la référence actuelle ; la page de paiement n'affiche que le montant |
| `npm run deploy` refuse l'extension écrite à la main | Repli : génération par le CLI, puis report du code |
| Bloc affiché pour un autre moyen de paiement manuel | Filtrage en tâche 5 ; à défaut, message neutre de la route |

## Dépendances

- Accès d'Ibrahima au CLI Shopify (`npm run deploy`) et à l'éditeur de
  checkout de la boutique de développement.
- Chaîne actuelle validée au préalable : lien présent en note de commande et
  paiement bac à sable abouti.
- `shopify.app.toml` (sujets de conformité) committé avant de commencer.

## Durée estimée

Environ 2 h 45, dont 30 min avec Ibrahima (tâche 6).

## Agents et skills

Agent principal. Skill `writing-plans` pour ce document. Pas de sous-agent.

## Points de validation

1. Validation de ce plan.
2. Après la tâche 4 : démonstration locale de la route avant d'écrire
   l'extension.
3. Avant la fusion (tâche 6) : accord pour déployer la migration en
   production.
4. Après le test réel : validation fonctionnelle par Ibrahima.
