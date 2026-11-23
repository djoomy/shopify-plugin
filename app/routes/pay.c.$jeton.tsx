import type { HeadersFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import prisma from "../db.server";
import { estJetonCheckout } from "../lib/paiements/commande-manuelle";
import {
  DELAI_ESSAI_S,
  deciderLienCheckout,
  lireEssai,
} from "../lib/paiements/lien-checkout";
import { styles } from "../lib/ui/pay-styles";

/**
 * Point d'entrée depuis la page de remerciement Shopify.
 *
 * L'extension de checkout y envoie l'acheteur avec son jeton de checkout. On
 * retrouve le paiement préparé par le webhook `orders/create`, puis on
 * redirige vers la page de paiement. Si le webhook n'est pas encore passé, la
 * page patiente et se recharge seule.
 *
 * Le jeton, long et aléatoire, tient lieu de jeton d'accès, au même titre que
 * la référence de la page de paiement.
 */
export async function loader({ params, request }: LoaderFunctionArgs) {
  const jeton = params.jeton ?? "";
  if (!estJetonCheckout(jeton)) {
    throw new Response("Lien de paiement invalide", { status: 404 });
  }

  const paiement = await prisma.djomyPayment.findUnique({
    where: { shopifyCheckoutToken: jeton },
    select: { merchantPaymentReference: true },
  });

  const essai = lireEssai(new URL(request.url).searchParams.get("essai"));
  const decision = deciderLienCheckout(paiement?.merchantPaymentReference ?? null, essai);

  if (decision.type === "rediriger") return redirect(decision.vers);

  // Jamais mis en cache : chaque rechargement doit réinterroger la base.
  const entetes = { "Cache-Control": "no-store" };

  if (decision.type === "attendre") {
    return json(
      { enAttente: true as const, suite: `?essai=${decision.prochainEssai}` },
      { headers: entetes },
    );
  }
  return json({ enAttente: false as const, suite: "?essai=0" }, { headers: entetes });
}

/** Reporte sur la page l'en-tête de cache posé par le loader. */
export const headers: HeadersFunction = ({ loaderHeaders }) => ({
  "Cache-Control": loaderHeaders.get("Cache-Control") ?? "no-store",
});

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const balises = [
    { title: "Paiement de votre commande" },
    { name: "robots", content: "noindex" },
  ];
  if (data?.enAttente) {
    // Rechargement sans JavaScript : fonctionne sur tous les navigateurs.
    return [
      ...balises,
      { httpEquiv: "refresh", content: `${DELAI_ESSAI_S};url=${data.suite}` },
    ];
  }
  return balises;
};

export default function LienCheckout() {
  const { enAttente, suite } = useLoaderData<typeof loader>();

  if (enAttente) {
    return (
      <main style={styles.page}>
        <section style={styles.carte}>
          <h1 style={styles.titre}>Préparation de votre paiement…</h1>
          <p style={styles.texte}>
            Votre commande est bien enregistrée. Cette page s'actualise seule
            dans quelques secondes.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <section style={styles.carte}>
        <h1 style={styles.titre}>Lien de paiement pas encore prêt</h1>
        <p style={styles.texte}>
          Nous n'avons pas trouvé de paiement à régler pour cette commande. Si
          vous avez choisi le paiement mobile, réessayez dans quelques
          instants ou contactez la boutique.
        </p>
        <p style={styles.texte}>
          <a href={suite}>Réessayer</a>
        </p>
      </section>
    </main>
  );
}
