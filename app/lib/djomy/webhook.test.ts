import { describe, expect, it } from "vitest";
import { signPayload } from "./signature";
import {
  WebhookPayloadError,
  WebhookSignatureError,
  analyserWebhook,
  estEvenementFinal,
  estPaiementReussi,
  verifierWebhook,
} from "./webhook";

const SECRET = "secret-marchand";

const PAIEMENT = {
  transactionId: "123e4567-e89b-12d3-a456-426614174000",
  status: "SUCCESS",
  paidAmount: 10000,
  receivedAmount: 9000,
  fees: 1000,
  paymentMethod: "OM",
  merchantPaymentReference: "ORD-1001",
  payerIdentifier: "00224623000001",
  currency: "GNF",
  createdAt: "2026-07-13T10:30:00.000Z",
};

/** Payload V1 : les données occupent directement `data`. */
const V1 = {
  message: "Statut du paiement",
  eventType: "payment.success",
  eventId: "8bfd5709-737c-4254-99a7-57a3d630b349",
  data: PAIEMENT,
  paymentLinkReference: "LINK-REF",
  timestamp: "2026-07-13T10:31:00.000Z",
};

/** Payload V2 : les données sont imbriquées sous `data.payment`. */
const V2 = { ...V1, data: { payment: PAIEMENT } };

const V2_PAYOUT = {
  message: "Statut du transfert",
  eventType: "payout.success",
  eventId: "aaaaaaaa-737c-4254-99a7-57a3d630b349",
  data: {
    payout: {
      payoutId: "po-1",
      reference: "PO-REF",
      status: "SUCCESS",
      amount: 5000,
      currency: "GNF",
    },
  },
};

function signer(payload: unknown): { corps: string; entete: string } {
  const corps = JSON.stringify(payload);
  return { corps, entete: `v1:${signPayload(corps, SECRET)}` };
}

describe("verifierWebhook", () => {
  it("accepte un webhook correctement signé", () => {
    const { corps, entete } = signer(V2);
    const resultat = verifierWebhook(corps, entete, SECRET);
    expect(resultat.eventType).toBe("payment.success");
    expect(resultat.paiement?.transactionId).toBe(PAIEMENT.transactionId);
  });

  it("rejette une signature invalide", () => {
    const { corps } = signer(V2);
    expect(() => verifierWebhook(corps, "v1:deadbeef", SECRET)).toThrow(
      WebhookSignatureError,
    );
  });

  it("rejette une signature absente", () => {
    const { corps } = signer(V2);
    expect(() => verifierWebhook(corps, null, SECRET)).toThrow(WebhookSignatureError);
  });

  it("rejette un corps altéré après signature", () => {
    const { entete } = signer(V2);
    const altere = JSON.stringify({
      ...V2,
      data: { payment: { ...PAIEMENT, paidAmount: 999999 } },
    });
    expect(() => verifierWebhook(altere, entete, SECRET)).toThrow(
      WebhookSignatureError,
    );
  });

  it("rejette un webhook signé avec un autre secret marchand", () => {
    const corps = JSON.stringify(V2);
    const entete = `v1:${signPayload(corps, "secret-d-un-autre-marchand")}`;
    expect(() => verifierWebhook(corps, entete, SECRET)).toThrow(
      WebhookSignatureError,
    );
  });

  it("vérifie la signature avant d'analyser le contenu", () => {
    // Un corps illisible mais mal signé doit remonter l'erreur de signature.
    expect(() => verifierWebhook("pas du json", "v1:deadbeef", SECRET)).toThrow(
      WebhookSignatureError,
    );
  });
});

describe("analyserWebhook — versions de payload", () => {
  it("lit un paiement en V1", () => {
    const resultat = analyserWebhook(JSON.stringify(V1));
    expect(resultat.version).toBe("V1");
    expect(resultat.paiement?.merchantPaymentReference).toBe("ORD-1001");
  });

  it("lit un paiement en V2", () => {
    const resultat = analyserWebhook(JSON.stringify(V2));
    expect(resultat.version).toBe("V2");
    expect(resultat.paiement?.merchantPaymentReference).toBe("ORD-1001");
  });

  it("produit les mêmes données de paiement en V1 et en V2", () => {
    expect(analyserWebhook(JSON.stringify(V1)).paiement).toEqual(
      analyserWebhook(JSON.stringify(V2)).paiement,
    );
  });

  it("lit un transfert sortant en V2", () => {
    const resultat = analyserWebhook(JSON.stringify(V2_PAYOUT));
    expect(resultat.payout?.payoutId).toBe("po-1");
    expect(resultat.paiement).toBeUndefined();
  });
});

describe("analyserWebhook — payloads incorrects", () => {
  it("refuse un corps non JSON", () => {
    expect(() => analyserWebhook("<html>")).toThrow(WebhookPayloadError);
  });

  it("refuse un tableau JSON", () => {
    expect(() => analyserWebhook("[]")).toThrow(/objet JSON attendu/);
  });

  it("refuse un eventType absent", () => {
    expect(() => analyserWebhook(JSON.stringify({ eventId: "x", data: {} }))).toThrow(
      /eventType/,
    );
  });

  it("refuse un eventId absent : sans lui, aucune protection contre le rejeu", () => {
    expect(() =>
      analyserWebhook(JSON.stringify({ eventType: "payment.success", data: PAIEMENT })),
    ).toThrow(/eventId/);
  });

  it("refuse un champ data absent", () => {
    expect(() =>
      analyserWebhook(JSON.stringify({ eventType: "payment.success", eventId: "x" })),
    ).toThrow(/data/);
  });

  it("refuse un paiement sans transactionId", () => {
    expect(() =>
      analyserWebhook(
        JSON.stringify({ eventType: "payment.success", eventId: "x", data: { statut: "ok" } }),
      ),
    ).toThrow(/transactionId/);
  });

  it("refuse un type d'événement inconnu", () => {
    expect(() =>
      analyserWebhook(
        JSON.stringify({ eventType: "facture.emise", eventId: "x", data: {} }),
      ),
    ).toThrow(/type d'événement inconnu/);
  });
});

describe("estPaiementReussi", () => {
  it("n'autorise l'encaissement que sur payment.success au statut abouti", () => {
    expect(estPaiementReussi(analyserWebhook(JSON.stringify(V2)))).toBe(true);

    const capture = { ...V2, data: { payment: { ...PAIEMENT, status: "CAPTURED" } } };
    expect(estPaiementReussi(analyserWebhook(JSON.stringify(capture)))).toBe(true);
  });

  it("refuse un payment.success dont le statut n'est pas abouti", () => {
    // Incohérence entre l'événement et le statut : on ne présume pas du succès.
    const incoherent = { ...V2, data: { payment: { ...PAIEMENT, status: "PENDING" } } };
    expect(estPaiementReussi(analyserWebhook(JSON.stringify(incoherent)))).toBe(false);
  });

  it("refuse tout autre événement", () => {
    for (const type of ["payment.pending", "payment.failed", "payment.refunded"]) {
      const autre = { ...V2, eventType: type };
      expect(estPaiementReussi(analyserWebhook(JSON.stringify(autre)))).toBe(false);
    }
  });
});

describe("estEvenementFinal", () => {
  it("identifie les événements qui closent le cycle de vie", () => {
    expect(estEvenementFinal("payment.success")).toBe(true);
    expect(estEvenementFinal("payment.failed")).toBe(true);
    expect(estEvenementFinal("payment.cancelled")).toBe(true);
    expect(estEvenementFinal("payment.timeout")).toBe(true);
    expect(estEvenementFinal("payment.pending")).toBe(false);
    expect(estEvenementFinal("payment.created")).toBe(false);
  });
});
