import { unauthenticated } from "../../shopify.server";
import type { PaiementEnregistre, PasserelleCommande } from "./service";

const MARQUER_PAYEE = `#graphql
  mutation djomyOrderMarkAsPaid($input: OrderMarkAsPaidInput!) {
    orderMarkAsPaid(input: $input) {
      order { id displayFinancialStatus }
      userErrors { field message }
    }
  }`;

const LIRE_NOTE = `#graphql
  query djomyOrderNote($id: ID!) {
    order(id: $id) { id note }
  }`;

const MAJ_NOTE = `#graphql
  mutation djomyOrderUpdate($input: OrderInput!) {
    orderUpdate(input: $input) {
      order { id }
      userErrors { field message }
    }
  }`;

interface ErreurUtilisateur {
  field?: string[] | null;
  message: string;
}

function verifierErreurs(operation: string, erreurs?: ErreurUtilisateur[] | null): void {
  if (erreurs && erreurs.length > 0) {
    throw new Error(
      `Shopify ${operation} : ${erreurs.map((e) => e.message).join(" · ")}`,
    );
  }
}

/**
 * Actions sur les commandes Shopify, via l'Admin API.
 *
 * Le webhook Djomy n'est pas une requête Shopify authentifiée : on ouvre donc
 * une session administrateur à partir de la boutique concernée.
 */
export const commandesShopify: PasserelleCommande = {
  async marquerPayee(shop: string, orderId: string, paiement: PaiementEnregistre) {
    const { admin } = await unauthenticated.admin(shop);

    const reponse = await admin.graphql(MARQUER_PAYEE, {
      variables: { input: { id: orderId } },
    });
    const corps = (await reponse.json()) as {
      data?: { orderMarkAsPaid?: { userErrors?: ErreurUtilisateur[] } };
    };
    verifierErreurs("orderMarkAsPaid", corps.data?.orderMarkAsPaid?.userErrors);

    await this.annoter(
      shop,
      orderId,
      `Paiement Djomy encaissé — transaction ${paiement.djomyTransactionId ?? "?"}, ` +
        `référence ${paiement.merchantPaymentReference}.`,
    );
  },

  async annoter(shop: string, orderId: string, message: string) {
    const { admin } = await unauthenticated.admin(shop);

    // On relit la note avant d'écrire : l'écraser effacerait une information
    // saisie par le marchand.
    const lecture = await admin.graphql(LIRE_NOTE, { variables: { id: orderId } });
    const corpsLecture = (await lecture.json()) as {
      data?: { order?: { note?: string | null } | null };
    };

    const existante = corpsLecture.data?.order?.note ?? "";
    const horodatage = new Date().toISOString();
    const ajout = `[Djomy ${horodatage}] ${message}`;
    const note = existante ? `${existante}\n${ajout}` : ajout;

    const reponse = await admin.graphql(MAJ_NOTE, {
      variables: { input: { id: orderId, note } },
    });
    const corps = (await reponse.json()) as {
      data?: { orderUpdate?: { userErrors?: ErreurUtilisateur[] } };
    };
    verifierErreurs("orderUpdate", corps.data?.orderUpdate?.userErrors);
  },
};
