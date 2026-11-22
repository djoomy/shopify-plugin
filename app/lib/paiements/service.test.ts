import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DjomyClient } from "../djomy/client";
import { signPayload } from "../djomy/signature";
import { WebhookSignatureError } from "../djomy/webhook";
import { InvalidAmountError, UnsupportedCurrencyError } from "../djomy/currency";
import { InvalidPhoneError } from "../phone";
import {
  PaiementDejaResoluError,
  creerPaiement,
  traiterWebhook,
  type CreationPaiement,
  type DepotPaiement,
  type MajPaiement,
  type PaiementEnregistre,
  type PasserelleCommande,
} from "./service";

const SECRET = "secret-marchand";
const REFERENCE = "ORD-1001";

/** Dépôt en mémoire : même contrat que l'implémentation Prisma. */
function depotMemoire() {
  const paiements = new Map<string, PaiementEnregistre>();
  const evenements = new Set<string>();
  const journal: Array<{ eventId: string; paiementId: string | null }> = [];
  let compteur = 0;

  const depot: DepotPaiement = {
    async parReference(reference) {
      return (
        [...paiements.values()].find(
          (p) => p.merchantPaymentReference === reference,
        ) ?? null
      );
    },
    async creer(donnees: CreationPaiement) {
      const paiement: PaiementEnregistre = {
        id: `pay-${++compteur}`,
        shop: donnees.shop,
        channel: donnees.channel,
        merchantPaymentReference: donnees.merchantPaymentReference,
        djomyTransactionId: donnees.djomyTransactionId,
        amount: donnees.amount,
        currency: donnees.currency,
        status: donnees.status,
        shopifyOrderId: donnees.shopifyOrderId ?? null,
        shopifySessionGid: donnees.shopifySessionGid ?? null,
        redirectUrl: donnees.redirectUrl ?? null,
        lastEventId: null,
        resolvedAt: null,
      };
      paiements.set(paiement.id, paiement);
      return paiement;
    },
    async mettreAJour(id: string, maj: MajPaiement) {
      const actuel = paiements.get(id);
      if (!actuel) throw new Error(`paiement ${id} introuvable`);
      const suivant = {
        ...actuel,
        ...(maj.status !== undefined ? { status: maj.status } : {}),
        ...(maj.djomyTransactionId !== undefined
          ? { djomyTransactionId: maj.djomyTransactionId }
          : {}),
        ...(maj.lastEventId !== undefined ? { lastEventId: maj.lastEventId } : {}),
        ...(maj.redirectUrl !== undefined ? { redirectUrl: maj.redirectUrl } : {}),
        ...(maj.resolvedAt !== undefined ? { resolvedAt: maj.resolvedAt } : {}),
      };
      paiements.set(id, suivant);
      return suivant;
    },
    async evenementDejaTraite(eventId) {
      return evenements.has(eventId);
    },
    async enregistrerEvenement({ eventId, paiementId }) {
      evenements.add(eventId);
      journal.push({ eventId, paiementId });
    },
  };

  return { depot, paiements, journal };
}

function passerelleFactice() {
  return {
    marquerPayee: vi.fn(async () => {}),
    annoter: vi.fn(async () => {}),
  } satisfies PasserelleCommande;
}

function clientFactice(reponse: Record<string, unknown>) {
  const createGatewayPayment = vi.fn(async () => reponse);
  return {
    client: { createGatewayPayment } as unknown as DjomyClient,
    createGatewayPayment,
  };
}

const DEMANDE = {
  shop: "boutique.myshopify.com",
  channel: "manual",
  merchantPaymentReference: REFERENCE,
  montant: "150000.00",
  devise: "GNF",
  numeroPayeur: "+224623707722",
  countryCode: "GN",
  returnUrl: "https://boutique.myshopify.com/retour",
  shopifyOrderId: "gid://shopify/Order/1",
};

const REPONSE_DJOMY = {
  transactionId: "tx-djomy-1",
  status: "CREATED",
  redirectUrl: "https://pay.djomy.africa/abc",
};

describe("creerPaiement", () => {
  it("crée le paiement et renvoie l'URL de redirection", async () => {
    const { depot } = depotMemoire();
    const { client, createGatewayPayment } = clientFactice(REPONSE_DJOMY);

    const resultat = await creerPaiement(DEMANDE, { client, depot });

    expect(resultat.redirectUrl).toBe("https://pay.djomy.africa/abc");
    expect(resultat.reutilise).toBe(false);
    expect(resultat.paiement.djomyTransactionId).toBe("tx-djomy-1");
    expect(createGatewayPayment).toHaveBeenCalledOnce();
  });

  it("transmet un montant entier et un numéro normalisé à Djomy", async () => {
    const { depot } = depotMemoire();
    const { client, createGatewayPayment } = clientFactice(REPONSE_DJOMY);

    await creerPaiement(DEMANDE, { client, depot });

    expect(createGatewayPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 150000,
        payerNumber: "00224623707722",
        countryCode: "GN",
        merchantPaymentReference: REFERENCE,
      }),
    );
  });

  it("réutilise un paiement en cours au lieu d'en créer un second", async () => {
    const { depot } = depotMemoire();
    const { client, createGatewayPayment } = clientFactice(REPONSE_DJOMY);

    const premier = await creerPaiement(DEMANDE, { client, depot });
    const second = await creerPaiement(DEMANDE, { client, depot });

    // Un double envoi de formulaire ne doit jamais produire deux débits.
    expect(createGatewayPayment).toHaveBeenCalledOnce();
    expect(second.reutilise).toBe(true);
    expect(second.redirectUrl).toBe(premier.redirectUrl);
    expect(second.paiement.id).toBe(premier.paiement.id);
  });

  it("refuse de relancer un paiement déjà abouti", async () => {
    const { depot } = depotMemoire();
    const { client } = clientFactice(REPONSE_DJOMY);

    const cree = await creerPaiement(DEMANDE, { client, depot });
    await depot.mettreAJour(cree.paiement.id, { status: "SUCCESS" });

    await expect(creerPaiement(DEMANDE, { client, depot })).rejects.toThrow(
      PaiementDejaResoluError,
    );
  });

  it("refuse de relancer un paiement déjà échoué", async () => {
    const { depot } = depotMemoire();
    const { client } = clientFactice(REPONSE_DJOMY);

    const cree = await creerPaiement(DEMANDE, { client, depot });
    await depot.mettreAJour(cree.paiement.id, { status: "FAILED" });

    await expect(creerPaiement(DEMANDE, { client, depot })).rejects.toThrow(
      PaiementDejaResoluError,
    );
  });

  it("rejette une devise hors périmètre avant tout appel réseau", async () => {
    const { depot } = depotMemoire();
    const { client, createGatewayPayment } = clientFactice(REPONSE_DJOMY);

    await expect(
      creerPaiement({ ...DEMANDE, devise: "EUR" }, { client, depot }),
    ).rejects.toThrow(UnsupportedCurrencyError);
    expect(createGatewayPayment).not.toHaveBeenCalled();
  });

  it("rejette un montant décimal en GNF avant tout appel réseau", async () => {
    const { depot } = depotMemoire();
    const { client, createGatewayPayment } = clientFactice(REPONSE_DJOMY);

    await expect(
      creerPaiement({ ...DEMANDE, montant: "150000.50" }, { client, depot }),
    ).rejects.toThrow(InvalidAmountError);
    expect(createGatewayPayment).not.toHaveBeenCalled();
  });

  it("rejette un numéro invalide avant tout appel réseau", async () => {
    const { depot } = depotMemoire();
    const { client, createGatewayPayment } = clientFactice(REPONSE_DJOMY);

    await expect(
      creerPaiement({ ...DEMANDE, numeroPayeur: "123" }, { client, depot }),
    ).rejects.toThrow(InvalidPhoneError);
    expect(createGatewayPayment).not.toHaveBeenCalled();
  });

  it("retombe sur paymentUrl si redirectUrl est absente", async () => {
    const { depot } = depotMemoire();
    const { client } = clientFactice({
      transactionId: "tx-1",
      status: "CREATED",
      paymentUrl: "https://pay.djomy.africa/xyz",
    });

    const resultat = await creerPaiement(DEMANDE, { client, depot });
    expect(resultat.redirectUrl).toBe("https://pay.djomy.africa/xyz");
  });

  it("échoue explicitement si Djomy ne fournit aucune URL", async () => {
    const { depot } = depotMemoire();
    const { client } = clientFactice({ transactionId: "tx-1", status: "CREATED" });

    await expect(creerPaiement(DEMANDE, { client, depot })).rejects.toThrow(
      /URL de redirection/,
    );
  });
});

// --------------------------------------------------------------- webhooks

function webhookSigne(
  eventType: string,
  paiement: Record<string, unknown>,
  eventId = "evt-1",
) {
  const corps = JSON.stringify({
    message: "Statut du paiement",
    eventType,
    eventId,
    data: { payment: paiement },
    timestamp: "2026-08-24T10:31:00.000Z",
  });
  return { corps, signature: `v1:${signPayload(corps, SECRET)}` };
}

const PAIEMENT_OK = {
  transactionId: "tx-djomy-1",
  status: "SUCCESS",
  paidAmount: 150000,
  currency: "GNF",
  paymentMethod: "OM",
  merchantPaymentReference: REFERENCE,
};

describe("traiterWebhook", () => {
  let contexte: ReturnType<typeof depotMemoire>;
  let commandes: ReturnType<typeof passerelleFactice>;

  beforeEach(async () => {
    contexte = depotMemoire();
    commandes = passerelleFactice();
    const { client } = clientFactice(REPONSE_DJOMY);
    await creerPaiement(DEMANDE, { client, depot: contexte.depot });
  });

  const deps = () => ({ depot: contexte.depot, commandes });

  it("encaisse la commande sur un paiement réussi", async () => {
    const { corps, signature } = webhookSigne("payment.success", PAIEMENT_OK);

    const issue = await traiterWebhook(corps, signature, SECRET, deps());

    expect(issue.issue).toBe("encaisse");
    expect(commandes.marquerPayee).toHaveBeenCalledOnce();
    expect(commandes.marquerPayee).toHaveBeenCalledWith(
      DEMANDE.shop,
      DEMANDE.shopifyOrderId,
      expect.objectContaining({ status: "SUCCESS" }),
    );
    expect(commandes.annoter).not.toHaveBeenCalled();
  });

  it("rejette une signature invalide", async () => {
    const { corps } = webhookSigne("payment.success", PAIEMENT_OK);

    await expect(traiterWebhook(corps, "v1:deadbeef", SECRET, deps())).rejects.toThrow(
      WebhookSignatureError,
    );
    expect(commandes.marquerPayee).not.toHaveBeenCalled();
  });

  it("n'encaisse qu'une fois un webhook rejoué", async () => {
    const { corps, signature } = webhookSigne("payment.success", PAIEMENT_OK);

    await traiterWebhook(corps, signature, SECRET, deps());
    const second = await traiterWebhook(corps, signature, SECRET, deps());

    expect(second.issue).toBe("rejeu");
    expect(commandes.marquerPayee).toHaveBeenCalledOnce();
  });

  it("laisse la commande en attente si le montant diverge", async () => {
    const { corps, signature } = webhookSigne("payment.success", {
      ...PAIEMENT_OK,
      paidAmount: 100,
    });

    const issue = await traiterWebhook(corps, signature, SECRET, deps());

    expect(issue.issue).toBe("montant-divergent");
    expect(commandes.marquerPayee).not.toHaveBeenCalled();
    expect(commandes.annoter).toHaveBeenCalledWith(
      DEMANDE.shop,
      DEMANDE.shopifyOrderId,
      expect.stringContaining("écart avec la commande"),
    );
  });

  it("laisse la commande en attente si la devise diverge", async () => {
    const { corps, signature } = webhookSigne("payment.success", {
      ...PAIEMENT_OK,
      currency: "Dollar",
    });

    const issue = await traiterWebhook(corps, signature, SECRET, deps());

    expect(issue.issue).toBe("montant-divergent");
    expect(commandes.marquerPayee).not.toHaveBeenCalled();
  });

  it("refuse d'encaisser un montant manquant", async () => {
    const { corps, signature } = webhookSigne("payment.success", {
      ...PAIEMENT_OK,
      paidAmount: undefined,
    });

    const issue = await traiterWebhook(corps, signature, SECRET, deps());

    expect(issue.issue).toBe("montant-divergent");
    expect(commandes.marquerPayee).not.toHaveBeenCalled();
  });

  it("refuse d'encaisser un payment.success au statut non abouti", async () => {
    const { corps, signature } = webhookSigne("payment.success", {
      ...PAIEMENT_OK,
      status: "PENDING",
    });

    const issue = await traiterWebhook(corps, signature, SECRET, deps());

    expect(issue.issue).toBe("en-cours");
    expect(commandes.marquerPayee).not.toHaveBeenCalled();
  });

  it("annote la commande sur un paiement échoué", async () => {
    const { corps, signature } = webhookSigne("payment.failed", {
      ...PAIEMENT_OK,
      status: "FAILED",
    });

    const issue = await traiterWebhook(corps, signature, SECRET, deps());

    expect(issue.issue).toBe("echec");
    expect(commandes.marquerPayee).not.toHaveBeenCalled();
    expect(commandes.annoter).toHaveBeenCalledWith(
      DEMANDE.shop,
      DEMANDE.shopifyOrderId,
      expect.stringContaining("paiement échoué"),
    );
  });

  it("annote la commande sur un paiement annulé par le client", async () => {
    const { corps, signature } = webhookSigne("payment.cancelled", {
      ...PAIEMENT_OK,
      status: "CANCELLED",
    });

    const issue = await traiterWebhook(corps, signature, SECRET, deps());

    expect(issue.issue).toBe("echec");
    expect(commandes.annoter).toHaveBeenCalledWith(
      DEMANDE.shop,
      DEMANDE.shopifyOrderId,
      expect.stringContaining("annulé par le client"),
    );
  });

  it("n'annote pas la commande sur un simple passage en attente", async () => {
    const { corps, signature } = webhookSigne("payment.pending", {
      ...PAIEMENT_OK,
      status: "PENDING",
    });

    const issue = await traiterWebhook(corps, signature, SECRET, deps());

    expect(issue.issue).toBe("en-cours");
    expect(commandes.annoter).not.toHaveBeenCalled();
    expect(commandes.marquerPayee).not.toHaveBeenCalled();
  });

  it("signale une référence marchand inconnue sans échouer", async () => {
    const { corps, signature } = webhookSigne("payment.success", {
      ...PAIEMENT_OK,
      merchantPaymentReference: "ORD-INCONNUE",
    });

    const issue = await traiterWebhook(corps, signature, SECRET, deps());

    expect(issue.issue).toBe("inconnu");
    expect(commandes.marquerPayee).not.toHaveBeenCalled();
  });

  it("ignore un événement de transfert sortant", async () => {
    const corps = JSON.stringify({
      eventType: "payout.success",
      eventId: "evt-payout",
      data: { payout: { payoutId: "po-1", status: "SUCCESS" } },
    });
    const signature = `v1:${signPayload(corps, SECRET)}`;

    const issue = await traiterWebhook(corps, signature, SECRET, deps());

    expect(issue.issue).toBe("ignore");
    expect(commandes.marquerPayee).not.toHaveBeenCalled();
  });

  it("traite un payload V1 comme un payload V2", async () => {
    const corps = JSON.stringify({
      eventType: "payment.success",
      eventId: "evt-v1",
      data: PAIEMENT_OK,
    });
    const signature = `v1:${signPayload(corps, SECRET)}`;

    const issue = await traiterWebhook(corps, signature, SECRET, deps());

    expect(issue.issue).toBe("encaisse");
    expect(commandes.marquerPayee).toHaveBeenCalledOnce();
  });

  it("journalise chaque événement traité, rattaché à son paiement", async () => {
    const { corps, signature } = webhookSigne("payment.success", PAIEMENT_OK);
    await traiterWebhook(corps, signature, SECRET, deps());

    expect(contexte.journal).toHaveLength(1);
    expect(contexte.journal[0]?.paiementId).toBe("pay-1");
  });
});
