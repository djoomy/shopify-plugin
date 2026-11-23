import prisma from "../../db.server";
import { chiffrer } from "../crypto.server";
import type {
  CreationPaiement,
  DepotPaiement,
  MajPaiement,
  PaiementEnregistre,
} from "./service";

type LignePaiement = {
  id: string;
  shop: string;
  channel: string;
  merchantPaymentReference: string;
  djomyTransactionId: string | null;
  amount: { toString(): string };
  currency: string;
  status: string;
  shopifyOrderId: string | null;
  shopifySessionGid: string | null;
  redirectUrl: string | null;
  lastEventId: string | null;
  resolvedAt: Date | null;
};

/** Le montant est un Decimal en base : on le rend en chaîne, jamais en float. */
function versModele(ligne: LignePaiement): PaiementEnregistre {
  return {
    id: ligne.id,
    shop: ligne.shop,
    channel: ligne.channel,
    merchantPaymentReference: ligne.merchantPaymentReference,
    djomyTransactionId: ligne.djomyTransactionId,
    amount: ligne.amount.toString(),
    currency: ligne.currency,
    status: ligne.status,
    shopifyOrderId: ligne.shopifyOrderId,
    shopifySessionGid: ligne.shopifySessionGid,
    redirectUrl: ligne.redirectUrl,
    lastEventId: ligne.lastEventId,
    resolvedAt: ligne.resolvedAt,
  };
}

/** Implémentation Prisma du dépôt utilisé par le service de paiement. */
export const depotPrisma: DepotPaiement = {
  async parReference(reference: string) {
    const ligne = await prisma.djomyPayment.findUnique({
      where: { merchantPaymentReference: reference },
    });
    return ligne ? versModele(ligne) : null;
  },

  async creer(donnees: CreationPaiement) {
    const cle = process.env.ENCRYPTION_KEY;
    const ligne = await prisma.djomyPayment.create({
      data: {
        shop: donnees.shop,
        channel: donnees.channel,
        merchantPaymentReference: donnees.merchantPaymentReference,
        djomyTransactionId: donnees.djomyTransactionId,
        amount: donnees.amount,
        currency: donnees.currency,
        djomyCurrency: donnees.djomyCurrency,
        status: donnees.status,
        shopifyOrderId: donnees.shopifyOrderId ?? null,
        shopifySessionGid: donnees.shopifySessionGid ?? null,
        redirectUrl: donnees.redirectUrl ?? null,
        paymentMethod: donnees.paymentMethod ?? null,
        // Le numéro du payeur est une donnée personnelle : chiffré au repos.
        payerNumberChiffre:
          donnees.payerNumber && cle ? chiffrer(donnees.payerNumber, cle) : null,
      },
    });
    return versModele(ligne);
  },

  async mettreAJour(id: string, maj: MajPaiement) {
    const ligne = await prisma.djomyPayment.update({
      where: { id },
      data: {
        ...(maj.status !== undefined ? { status: maj.status } : {}),
        ...(maj.djomyTransactionId !== undefined
          ? { djomyTransactionId: maj.djomyTransactionId }
          : {}),
        ...(maj.lastEventId !== undefined ? { lastEventId: maj.lastEventId } : {}),
        ...(maj.paymentMethod !== undefined ? { paymentMethod: maj.paymentMethod } : {}),
        ...(maj.redirectUrl !== undefined ? { redirectUrl: maj.redirectUrl } : {}),
        ...(maj.echecRaison !== undefined ? { echecRaison: maj.echecRaison } : {}),
        ...(maj.resolvedAt !== undefined ? { resolvedAt: maj.resolvedAt } : {}),
      },
    });
    return versModele(ligne);
  },

  async evenementDejaTraite(eventId: string) {
    const ligne = await prisma.djomyWebhookEvent.findUnique({ where: { eventId } });
    return Boolean(ligne);
  },

  async enregistrerEvenement({ eventId, eventType, paiementId, corpsBrut }) {
    // L'unicité de eventId est la garantie anti-rejeu : une insertion
    // concurrente échoue plutôt que de laisser passer un second traitement.
    await prisma.djomyWebhookEvent.create({
      data: { eventId, eventType, paiementId, corpsBrut, traiteA: new Date() },
    });
  },
};

/**
 * Crée l'enregistrement d'un paiement en attente de saisie, à la création de
 * la commande. L'acheteur n'a pas encore fourni son numéro : le paiement Djomy
 * n'est initié qu'à la soumission du formulaire.
 *
 * Idempotent sur la commande : un webhook `orders/create` rejoué ne crée pas
 * une seconde ligne.
 */
export async function preparerPaiement(params: {
  shop: string;
  shopifyOrderId: string;
  reference: string;
  amount: string;
  currency: string;
  djomyCurrency: string;
  /** Jeton de checkout Shopify, s'il est connu : cf. route `/pay/c/<jeton>`. */
  checkoutToken?: string | null;
}): Promise<PaiementEnregistre> {
  const existant = await prisma.djomyPayment.findFirst({
    where: { shop: params.shop, shopifyOrderId: params.shopifyOrderId },
  });
  if (existant) return versModele(existant);

  const ligne = await prisma.djomyPayment.create({
    data: {
      shop: params.shop,
      channel: "manual",
      merchantPaymentReference: params.reference,
      amount: params.amount,
      currency: params.currency,
      djomyCurrency: params.djomyCurrency,
      shopifyOrderId: params.shopifyOrderId,
      shopifyCheckoutToken: params.checkoutToken ?? null,
      status: "EN_ATTENTE_SAISIE",
    },
  });
  return versModele(ligne);
}

/** Paiements encore en attente, pour la réconciliation périodique. */
export async function paiementsEnAttente(depuisHeures = 24): Promise<PaiementEnregistre[]> {
  const seuil = new Date(Date.now() - depuisHeures * 3600 * 1000);
  const lignes = await prisma.djomyPayment.findMany({
    where: {
      status: { in: ["CREATED", "PENDING", "REDIRECTED", "AUTHORIZED"] },
      createdAt: { gte: seuil },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return lignes.map(versModele);
}

/** Paiements restés en attente au-delà du délai : à clore en expiration. */
export async function paiementsExpires(depuisHeures = 24): Promise<PaiementEnregistre[]> {
  const seuil = new Date(Date.now() - depuisHeures * 3600 * 1000);
  const lignes = await prisma.djomyPayment.findMany({
    where: {
      status: { in: ["CREATED", "PENDING", "REDIRECTED", "AUTHORIZED"] },
      createdAt: { lt: seuil },
    },
    take: 200,
  });
  return lignes.map(versModele);
}
