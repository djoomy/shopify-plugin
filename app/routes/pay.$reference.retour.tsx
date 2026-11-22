import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import prisma from "../db.server";
import { estStatutFinal } from "../lib/djomy/types";
import { clientDjomyPour } from "../lib/marchand/depot.server";
import { depotPrisma } from "../lib/paiements/depot.server";
import { styles } from "../lib/ui/pay-styles";

/**
 * Page de retour depuis le portail Djomy.
 *
 * Le statut affiché provient d'une interrogation directe de l'API : le retour
 * de l'acheteur sur cette page ne prouve rien sur l'issue du paiement.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const reference = params.reference ?? "";
  const paiement = await prisma.djomyPayment.findUnique({
    where: { merchantPaymentReference: reference },
  });

  if (!paiement) throw new Response("Paiement introuvable", { status: 404 });

  let statut = paiement.status;

  if (paiement.djomyTransactionId && !estStatutFinal(statut)) {
    try {
      const { client } = await clientDjomyPour(paiement.shop);
      const detail = await client.getPaymentStatus(paiement.djomyTransactionId);
      statut = detail.status;

      if (detail.status !== paiement.status) {
        // Le webhook fait foi pour encaisser ; ici on ne fait que rafraîchir
        // l'affichage et l'état local.
        await depotPrisma.mettreAJour(paiement.id, { status: detail.status });
      }
    } catch {
      // Djomy injoignable : on affiche le dernier statut connu plutôt qu'une erreur.
    }
  }

  return json({
    reference,
    statut,
    montant: paiement.amount.toString(),
    devise: paiement.currency,
  });
}

const MESSAGES: Record<string, { titre: string; texte: string; ton: "succes" | "erreur" | "neutre" }> = {
  SUCCESS: {
    titre: "Paiement confirmé",
    texte: "Votre paiement a bien été reçu. Votre commande est en cours de traitement.",
    ton: "succes",
  },
  CAPTURED: {
    titre: "Paiement confirmé",
    texte: "Votre paiement a bien été reçu. Votre commande est en cours de traitement.",
    ton: "succes",
  },
  FAILED: {
    titre: "Paiement échoué",
    texte: "Le paiement n'a pas abouti. Vous pouvez réessayer depuis le lien de paiement.",
    ton: "erreur",
  },
  CANCELLED: {
    titre: "Paiement annulé",
    texte: "Vous avez interrompu le paiement. Le lien reste valable pour réessayer.",
    ton: "erreur",
  },
};

const PAR_DEFAUT = {
  titre: "Paiement en cours de traitement",
  texte:
    "Votre paiement est en cours de vérification. Cette page se mettra à jour, " +
    "et votre commande sera confirmée dès réception.",
  ton: "neutre" as const,
};

export default function PageRetour() {
  const { statut, montant, devise, reference } = useLoaderData<typeof loader>();
  const message = MESSAGES[statut] ?? PAR_DEFAUT;

  return (
    <main style={styles.page}>
      <section style={styles.carte}>
        <h1 style={styles.titre}>{message.titre}</h1>
        <p style={styles.montant}>
          {montant} {devise}
        </p>
        <p style={message.ton === "succes" ? styles.succes : message.ton === "erreur" ? styles.erreur : styles.texte}>
          {message.texte}
        </p>
        <p style={styles.texteDiscret}>Référence : {reference}</p>
        {message.ton === "erreur" && (
          <p style={styles.texteDiscret}>
            <a href={`/pay/${reference}`}>Reprendre le paiement</a>
          </p>
        )}
      </section>
    </main>
  );
}
