import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import prisma from "../db.server";
import { LIBELLES_METHODES } from "../lib/marchand/config";
import { clientDjomyPour, lireConfig } from "../lib/marchand/depot.server";
import { estNumeroValide } from "../lib/phone";
import { estStatutFinal, type MethodePortail } from "../lib/djomy/types";
import { depotPrisma } from "../lib/paiements/depot.server";
import { PaiementDejaResoluError, creerPaiement } from "../lib/paiements/service";
import { styles } from "../lib/ui/pay-styles";

/**
 * Page de paiement hébergée par l'application.
 *
 * Djomy exige un numéro de payeur même sur le flux redirigé, alors que Shopify
 * ne le garantit pas au checkout : cette page comble cet écart.
 *
 * La référence, longue et aléatoire, sert de jeton d'accès : elle n'est connue
 * que de l'acheteur et du marchand.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const reference = params.reference ?? "";
  const paiement = await prisma.djomyPayment.findUnique({
    where: { merchantPaymentReference: reference },
  });

  if (!paiement) throw new Response("Paiement introuvable", { status: 404 });

  const config = await lireConfig(paiement.shop);
  if (!config) throw new Response("Boutique non configurée", { status: 409 });

  return json({
    reference,
    montant: paiement.amount.toString(),
    devise: paiement.currency,
    statut: paiement.status,
    clos: estStatutFinal(paiement.status),
    countryCode: config.countryCode,
    methodes: config.methodesAutorisees.map((code) => ({
      code,
      libelle: LIBELLES_METHODES[code as MethodePortail] ?? code,
    })),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const reference = params.reference ?? "";
  const donnees = await request.formData();
  const numero = String(donnees.get("numeroPayeur") ?? "").trim();

  const paiement = await prisma.djomyPayment.findUnique({
    where: { merchantPaymentReference: reference },
  });
  if (!paiement) throw new Response("Paiement introuvable", { status: 404 });

  const config = await lireConfig(paiement.shop);
  if (!config) throw new Response("Boutique non configurée", { status: 409 });

  if (!estNumeroValide(numero, config.countryCode)) {
    return json(
      { erreur: "Numéro de téléphone invalide. Exemple attendu : 623 70 77 22." },
      { status: 400 },
    );
  }

  const { client } = await clientDjomyPour(paiement.shop);
  const base = process.env.SHOPIFY_APP_URL ?? "";

  try {
    const resultat = await creerPaiement(
      {
        shop: paiement.shop,
        channel: paiement.channel,
        merchantPaymentReference: reference,
        montant: paiement.amount.toString(),
        devise: paiement.currency,
        numeroPayeur: numero,
        countryCode: config.countryCode,
        returnUrl: `${base}/pay/${reference}/retour`,
        cancelUrl: `${base}/pay/${reference}`,
        description: `Commande ${reference}`,
        methodesAutorisees: config.methodesAutorisees,
        shopifyOrderId: paiement.shopifyOrderId,
        metadata: { shop: paiement.shop, reference },
      },
      { client, depot: depotPrisma },
    );

    return redirect(resultat.redirectUrl);
  } catch (erreur) {
    if (erreur instanceof PaiementDejaResoluError) {
      return redirect(`/pay/${reference}/retour`);
    }
    return json({ erreur: messagePublic(erreur) }, { status: 502 });
  }
}

function messagePublic(erreur: unknown): string {
  if (erreur && typeof erreur === "object" && "messagePublic" in erreur) {
    return String((erreur as { messagePublic: string }).messagePublic);
  }
  if (erreur instanceof Error) return erreur.message;
  return "Le paiement n'a pas pu être initié.";
}

export const links = () => [];

export default function PagePaiement() {
  const { montant, devise, methodes, clos, statut } = useLoaderData<typeof loader>();
  const resultat = useActionData<typeof action>();
  const navigation = useNavigation();
  const enCours = navigation.state !== "idle";

  if (clos) {
    return (
      <main style={styles.page}>
        <section style={styles.carte}>
          <h1 style={styles.titre}>Paiement déjà traité</h1>
          <p style={styles.texte}>
            Ce paiement est clos (statut&nbsp;: {statut}). Aucune action n'est
            nécessaire.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <section style={styles.carte}>
        <h1 style={styles.titre}>Régler votre commande</h1>

        <p style={styles.montant}>
          {montant} {devise}
        </p>

        <p style={styles.texte}>
          Saisissez le numéro de téléphone associé à votre compte mobile money.
          Vous serez ensuite redirigé vers la page sécurisée de Djomy.
        </p>

        {methodes.length > 0 && (
          <p style={styles.texteDiscret}>
            Moyens acceptés&nbsp;: {methodes.map((m) => m.libelle).join(", ")}.
          </p>
        )}

        {resultat?.erreur && <p style={styles.erreur}>{resultat.erreur}</p>}

        <Form method="post" style={styles.formulaire}>
          <label htmlFor="numeroPayeur" style={styles.label}>
            Numéro de téléphone
          </label>
          <input
            id="numeroPayeur"
            name="numeroPayeur"
            type="tel"
            inputMode="tel"
            required
            autoComplete="tel"
            placeholder="623 70 77 22"
            style={styles.champ}
          />
          <button type="submit" disabled={enCours} style={styles.bouton}>
            {enCours ? "Redirection en cours…" : "Payer maintenant"}
          </button>
        </Form>

        <p style={styles.texteDiscret}>
          Votre numéro n'est utilisé que pour ce paiement.
        </p>
      </section>
    </main>
  );
}
