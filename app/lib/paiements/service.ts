import type { DjomyClient } from "../djomy/client";
import {
  estMemeMontant,
  toDjomyAmount,
  toDjomyCurrency,
  toIsoCurrency,
} from "../djomy/currency";
import { estStatutFinal, type DjomyMetadata, type MethodePortail } from "../djomy/types";
import { estPaiementReussi, verifierWebhook, type WebhookVerifie } from "../djomy/webhook";
import { normaliserNumero } from "../phone";

/** Un paiement tel qu'il est conservé côté application. */
export interface PaiementEnregistre {
  id: string;
  shop: string;
  channel: string;
  merchantPaymentReference: string;
  djomyTransactionId: string | null;
  /** Montant attendu, en chaîne décimale, dans la devise de la commande. */
  amount: string;
  /** Code ISO-4217. */
  currency: string;
  status: string;
  shopifyOrderId: string | null;
  shopifySessionGid: string | null;
  redirectUrl: string | null;
  lastEventId: string | null;
  resolvedAt: Date | null;
}

export interface CreationPaiement {
  shop: string;
  channel: string;
  merchantPaymentReference: string;
  djomyTransactionId: string | null;
  amount: string;
  currency: string;
  djomyCurrency: string;
  status: string;
  shopifyOrderId?: string | null;
  shopifySessionGid?: string | null;
  redirectUrl?: string | null;
  paymentMethod?: string | null;
  payerNumber?: string | null;
}

export interface MajPaiement {
  status?: string;
  djomyTransactionId?: string | null;
  lastEventId?: string | null;
  paymentMethod?: string | null;
  redirectUrl?: string | null;
  echecRaison?: string | null;
  resolvedAt?: Date | null;
}

/** Accès au stockage des paiements. Implémenté sur Prisma en production. */
export interface DepotPaiement {
  parReference(reference: string): Promise<PaiementEnregistre | null>;
  creer(donnees: CreationPaiement): Promise<PaiementEnregistre>;
  mettreAJour(id: string, maj: MajPaiement): Promise<PaiementEnregistre>;
  evenementDejaTraite(eventId: string): Promise<boolean>;
  enregistrerEvenement(donnees: {
    eventId: string;
    eventType: string;
    paiementId: string | null;
    corpsBrut: string;
  }): Promise<void>;
}

/** Actions sur la commande Shopify. */
export interface PasserelleCommande {
  marquerPayee(
    shop: string,
    orderId: string,
    paiement: PaiementEnregistre,
  ): Promise<void>;
  annoter(shop: string, orderId: string, message: string): Promise<void>;
}

export interface DemandePaiement {
  shop: string;
  channel: string;
  merchantPaymentReference: string;
  /** Montant Shopify, en chaîne décimale. */
  montant: string;
  /** Code ISO-4217 de la commande. */
  devise: string;
  /** Numéro saisi par l'acheteur, dans n'importe quel format courant. */
  numeroPayeur: string;
  countryCode: string;
  returnUrl: string;
  cancelUrl?: string;
  description?: string;
  methodesAutorisees?: MethodePortail[];
  shopifyOrderId?: string | null;
  shopifySessionGid?: string | null;
  metadata?: DjomyMetadata;
}

export interface ResultatCreation {
  paiement: PaiementEnregistre;
  redirectUrl: string;
  /** Vrai si un paiement en cours a été réutilisé au lieu d'en créer un second. */
  reutilise: boolean;
}

export class PaiementDejaResoluError extends Error {
  constructor(readonly paiement: PaiementEnregistre) {
    super(
      `Le paiement ${paiement.merchantPaymentReference} est déjà clos ` +
        `(statut ${paiement.status}).`,
    );
    this.name = "PaiementDejaResoluError";
  }
}

/**
 * Crée un paiement Djomy avec redirection vers le portail.
 *
 * Idempotent : appelé deux fois avec la même référence, il ne crée pas deux
 * paiements. Un double envoi de formulaire ne doit jamais débiter deux fois.
 */
export async function creerPaiement(
  demande: DemandePaiement,
  deps: { client: DjomyClient; depot: DepotPaiement },
): Promise<ResultatCreation> {
  const existant = await deps.depot.parReference(demande.merchantPaymentReference);

  if (existant) {
    if (estStatutFinal(existant.status)) {
      throw new PaiementDejaResoluError(existant);
    }
    if (existant.redirectUrl) {
      return { paiement: existant, redirectUrl: existant.redirectUrl, reutilise: true };
    }
  }

  // Validation avant tout appel réseau : une devise ou un montant erroné doit
  // échouer ici, pas après avoir sollicité Djomy.
  const devise = toDjomyCurrency(demande.devise);
  const montant = toDjomyAmount(demande.montant, demande.devise);
  const numero = normaliserNumero(demande.numeroPayeur, demande.countryCode);

  const cree = await deps.client.createGatewayPayment({
    amount: montant,
    countryCode: demande.countryCode.toUpperCase(),
    payerNumber: numero,
    allowedPaymentMethods: demande.methodesAutorisees,
    description: demande.description,
    merchantPaymentReference: demande.merchantPaymentReference,
    returnUrl: demande.returnUrl,
    cancelUrl: demande.cancelUrl,
    metadata: demande.metadata,
  });

  const redirectUrl = cree.redirectUrl ?? cree.paymentUrl;
  if (!redirectUrl) {
    throw new Error(
      "Djomy n'a pas fourni d'URL de redirection : impossible de poursuivre le paiement.",
    );
  }

  const paiement = existant
    ? await deps.depot.mettreAJour(existant.id, {
        status: cree.status,
        djomyTransactionId: cree.transactionId,
        redirectUrl,
      })
    : await deps.depot.creer({
        shop: demande.shop,
        channel: demande.channel,
        merchantPaymentReference: demande.merchantPaymentReference,
        djomyTransactionId: cree.transactionId,
        amount: demande.montant,
        currency: demande.devise.toUpperCase(),
        djomyCurrency: devise,
        status: cree.status,
        shopifyOrderId: demande.shopifyOrderId ?? null,
        shopifySessionGid: demande.shopifySessionGid ?? null,
        redirectUrl,
        payerNumber: numero,
      });

  return { paiement, redirectUrl, reutilise: false };
}

export type IssueWebhook =
  | { issue: "rejeu"; eventId: string }
  | { issue: "inconnu"; eventId: string; reference?: string }
  | { issue: "ignore"; eventId: string; motif: string }
  | { issue: "montant-divergent"; eventId: string; paiement: PaiementEnregistre }
  | { issue: "encaisse"; eventId: string; paiement: PaiementEnregistre }
  | { issue: "echec"; eventId: string; paiement: PaiementEnregistre }
  | { issue: "en-cours"; eventId: string; paiement: PaiementEnregistre };

/**
 * Traite un webhook Djomy de bout en bout : vérification de signature,
 * protection contre le rejeu, contrôle du montant, mise à jour de la commande.
 *
 * Ne lève que si la signature est invalide ou le corps inexploitable — le
 * routeur peut alors répondre 401 ou 400.
 */
export async function traiterWebhook(
  corpsBrut: string,
  signature: string | null,
  clientSecret: string,
  deps: { depot: DepotPaiement; commandes: PasserelleCommande },
): Promise<IssueWebhook> {
  const webhook = verifierWebhook(corpsBrut, signature, clientSecret);

  if (await deps.depot.evenementDejaTraite(webhook.eventId)) {
    return { issue: "rejeu", eventId: webhook.eventId };
  }

  // Les transferts sortants ne concernent pas l'encaissement des commandes.
  if (!webhook.paiement) {
    await deps.depot.enregistrerEvenement({
      eventId: webhook.eventId,
      eventType: webhook.eventType,
      paiementId: null,
      corpsBrut,
    });
    return { issue: "ignore", eventId: webhook.eventId, motif: "événement hors paiement" };
  }

  const reference = webhook.paiement.merchantPaymentReference;
  const paiement = reference ? await deps.depot.parReference(reference) : null;

  if (!paiement) {
    await deps.depot.enregistrerEvenement({
      eventId: webhook.eventId,
      eventType: webhook.eventType,
      paiementId: null,
      corpsBrut,
    });
    return { issue: "inconnu", eventId: webhook.eventId, reference };
  }

  await deps.depot.enregistrerEvenement({
    eventId: webhook.eventId,
    eventType: webhook.eventType,
    paiementId: paiement.id,
    corpsBrut,
  });

  if (estPaiementReussi(webhook)) {
    return encaisser(webhook, paiement, deps);
  }

  return enregistrerNonSucces(webhook, paiement, deps);
}

async function encaisser(
  webhook: WebhookVerifie,
  paiement: PaiementEnregistre,
  deps: { depot: DepotPaiement; commandes: PasserelleCommande },
): Promise<IssueWebhook> {
  const paye = webhook.paiement!;

  // Un montant ou une devise qui ne correspond pas ne peut jamais valoir
  // encaissement : la commande reste en attente et l'écart est tracé.
  const ecartMontant = !estMemeMontant(
    paye.paidAmount ?? Number.NaN,
    paiement.amount,
    paiement.currency,
  );
  const ecartDevise = paye.currency
    ? securiserDevise(paye.currency) !== paiement.currency
    : false;

  if (ecartMontant || ecartDevise) {
    const message =
      `Paiement Djomy ${paye.transactionId} : écart avec la commande. ` +
      `Attendu ${paiement.amount} ${paiement.currency}, ` +
      `reçu ${paye.paidAmount ?? "?"} ${paye.currency ?? "?"}. ` +
      `Commande laissée en attente, vérification manuelle requise.`;

    const maj = await deps.depot.mettreAJour(paiement.id, {
      status: "ECART_MONTANT",
      djomyTransactionId: paye.transactionId,
      lastEventId: webhook.eventId,
      echecRaison: message,
    });

    if (paiement.shopifyOrderId) {
      await deps.commandes.annoter(paiement.shop, paiement.shopifyOrderId, message);
    }
    return { issue: "montant-divergent", eventId: webhook.eventId, paiement: maj };
  }

  const maj = await deps.depot.mettreAJour(paiement.id, {
    status: paye.status,
    djomyTransactionId: paye.transactionId,
    lastEventId: webhook.eventId,
    paymentMethod: paye.paymentMethod ?? null,
    resolvedAt: new Date(),
  });

  if (paiement.shopifyOrderId) {
    await deps.commandes.marquerPayee(paiement.shop, paiement.shopifyOrderId, maj);
  }

  return { issue: "encaisse", eventId: webhook.eventId, paiement: maj };
}

async function enregistrerNonSucces(
  webhook: WebhookVerifie,
  paiement: PaiementEnregistre,
  deps: { depot: DepotPaiement; commandes: PasserelleCommande },
): Promise<IssueWebhook> {
  const paye = webhook.paiement!;
  const echec = ["payment.failed", "payment.cancelled", "payment.timeout"].includes(
    webhook.eventType,
  );

  const maj = await deps.depot.mettreAJour(paiement.id, {
    status: paye.status,
    djomyTransactionId: paye.transactionId,
    lastEventId: webhook.eventId,
    paymentMethod: paye.paymentMethod ?? null,
    echecRaison: echec ? libelleEvenement(webhook.eventType) : null,
    resolvedAt: echec ? new Date() : null,
  });

  if (echec && paiement.shopifyOrderId) {
    await deps.commandes.annoter(
      paiement.shop,
      paiement.shopifyOrderId,
      `Paiement Djomy ${paye.transactionId} : ${libelleEvenement(webhook.eventType)}.`,
    );
  }

  return {
    issue: echec ? "echec" : "en-cours",
    eventId: webhook.eventId,
    paiement: maj,
  };
}

function libelleEvenement(eventType: string): string {
  switch (eventType) {
    case "payment.failed":
      return "paiement échoué";
    case "payment.cancelled":
      return "paiement annulé par le client";
    case "payment.timeout":
      return "paiement expiré sans réponse du client";
    case "payment.refunded":
      return "paiement remboursé côté Djomy";
    default:
      return eventType;
  }
}

/** Convertit un libellé de devise Djomy en code ISO, sans lever. */
function securiserDevise(libelle: string): string | null {
  try {
    return toIsoCurrency(libelle);
  } catch {
    return null;
  }
}
