import type { GetPaymentDto } from "../djomy/types";
import { estStatutFinal } from "../djomy/types";
import { estMemeMontant } from "../djomy/currency";
import type { DepotPaiement, PaiementEnregistre, PasserelleCommande } from "./service";

/**
 * Filet de sécurité : un webhook perdu ne doit pas laisser une commande
 * impayée indéfiniment. On interroge Djomy sur les paiements encore en cours.
 */

export interface SourceStatut {
  getPaymentStatus(transactionId: string): Promise<GetPaymentDto>;
}

export interface ResultatReconciliation {
  examines: number;
  encaisses: number;
  echoues: number;
  inchanges: number;
  expires: number;
  erreurs: number;
}

/** Délai au-delà duquel un paiement resté en attente est considéré expiré. */
export const DELAI_EXPIRATION_HEURES = 24;

export async function reconcilier(
  paiements: PaiementEnregistre[],
  deps: {
    clientPour(shop: string): Promise<SourceStatut>;
    depot: DepotPaiement;
    commandes: PasserelleCommande;
    maintenant?: () => Date;
  },
): Promise<ResultatReconciliation> {
  const maintenant = deps.maintenant ?? (() => new Date());
  const bilan: ResultatReconciliation = {
    examines: 0,
    encaisses: 0,
    echoues: 0,
    inchanges: 0,
    expires: 0,
    erreurs: 0,
  };

  for (const paiement of paiements) {
    bilan.examines++;

    // Un paiement dont l'acheteur n'a jamais rempli le formulaire n'a pas de
    // transaction Djomy : il ne reste qu'à l'expirer le moment venu.
    if (!paiement.djomyTransactionId) {
      bilan.inchanges++;
      continue;
    }

    let detail: GetPaymentDto;
    try {
      const client = await deps.clientPour(paiement.shop);
      detail = await client.getPaymentStatus(paiement.djomyTransactionId);
    } catch {
      // Djomy injoignable : on retentera au prochain passage, sans rien changer.
      bilan.erreurs++;
      continue;
    }

    if (detail.status === paiement.status) {
      bilan.inchanges++;
      continue;
    }

    if (detail.status === "SUCCESS" || detail.status === "CAPTURED") {
      // Même prudence que sur le webhook : un montant divergent n'encaisse pas.
      if (!estMemeMontant(detail.paidAmount ?? Number.NaN, paiement.amount, paiement.currency)) {
        await deps.depot.mettreAJour(paiement.id, {
          status: "ECART_MONTANT",
          echecRaison:
            `Réconciliation : montant reçu ${detail.paidAmount ?? "?"} ` +
            `au lieu de ${paiement.amount} ${paiement.currency}.`,
        });
        if (paiement.shopifyOrderId) {
          await deps.commandes.annoter(
            paiement.shop,
            paiement.shopifyOrderId,
            `Réconciliation Djomy : écart de montant, commande laissée en attente.`,
          );
        }
        bilan.erreurs++;
        continue;
      }

      const maj = await deps.depot.mettreAJour(paiement.id, {
        status: detail.status,
        paymentMethod: detail.paymentMethod ?? null,
        resolvedAt: maintenant(),
      });
      if (paiement.shopifyOrderId) {
        await deps.commandes.marquerPayee(paiement.shop, paiement.shopifyOrderId, maj);
      }
      bilan.encaisses++;
      continue;
    }

    const final = estStatutFinal(detail.status);
    await deps.depot.mettreAJour(paiement.id, {
      status: detail.status,
      resolvedAt: final ? maintenant() : null,
    });

    if (final) {
      bilan.echoues++;
      if (paiement.shopifyOrderId) {
        await deps.commandes.annoter(
          paiement.shop,
          paiement.shopifyOrderId,
          `Réconciliation Djomy : paiement clos avec le statut ${detail.status}.`,
        );
      }
    } else {
      bilan.inchanges++;
    }
  }

  return bilan;
}

/** Clôt les paiements restés en attente au-delà du délai. */
export async function expirer(
  paiements: PaiementEnregistre[],
  deps: {
    depot: DepotPaiement;
    commandes: PasserelleCommande;
    maintenant?: () => Date;
  },
): Promise<number> {
  const maintenant = deps.maintenant ?? (() => new Date());
  let comptes = 0;

  for (const paiement of paiements) {
    await deps.depot.mettreAJour(paiement.id, {
      status: "EXPIRED",
      echecRaison: `Aucune confirmation reçue sous ${DELAI_EXPIRATION_HEURES} h.`,
      resolvedAt: maintenant(),
    });

    if (paiement.shopifyOrderId) {
      await deps.commandes.annoter(
        paiement.shop,
        paiement.shopifyOrderId,
        `Paiement Djomy expiré : aucune confirmation reçue sous ${DELAI_EXPIRATION_HEURES} h.`,
      );
    }
    comptes++;
  }

  return comptes;
}
