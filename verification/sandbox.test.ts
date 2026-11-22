import { beforeAll, describe, expect, it } from "vitest";
import { DjomyClient } from "../app/lib/djomy/client";
import { apiKeyHeader } from "../app/lib/djomy/signature";
import { toDjomyAmount, toDjomyCurrency } from "../app/lib/djomy/currency";
import { normaliserNumero } from "../app/lib/phone";
import { masquerNumero } from "../app/lib/djomy/errors";
import { STATUTS } from "../app/lib/djomy/types";

/**
 * Vérification contre le bac à sable Djomy réel.
 *
 * Ces tests sortent sur le réseau : ils ne font pas partie de la suite
 * unitaire. Lancement : `npm run verify:sandbox`.
 *
 * Objectif : confronter notre implémentation à l'API telle qu'elle répond
 * vraiment, et non à l'idée qu'on s'en fait d'après la spécification.
 */

let client: DjomyClient;
let transactionId = "";
const REFERENCE = `VERIF-${Date.now()}`;
const NUMERO_TEST = "00224623707722"; // numéro d'exemple de la documentation

beforeAll(() => {
  try {
    process.loadEnvFile(".env");
  } catch {
    // .env absent : on se rabat sur l'environnement du processus.
  }

  const clientId = process.env.DJOMY_CLIENT_ID;
  const clientSecret = process.env.DJOMY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "DJOMY_CLIENT_ID et DJOMY_CLIENT_SECRET sont requis pour cette vérification.",
    );
  }

  client = new DjomyClient({
    baseUrl: process.env.DJOMY_BASE_URL ?? "https://sandbox-api.djomy.africa",
    clientId,
    clientSecret,
    maxTentatives: 2,
    timeoutMs: 20_000,
    journal: (message, contexte) =>
      console.log("  ›", message, JSON.stringify(contexte ?? {})),
  });
});

describe("authentification", () => {
  it("obtient un jeton d'accès avec la signature HMAC", async () => {
    const jeton = await client.authenticate(true);

    expect(jeton).toBeTruthy();
    expect(typeof jeton).toBe("string");
    console.log(`  ✓ jeton obtenu (${jeton.length} caractères)`);
  });

  it("réutilise le jeton mis en cache", async () => {
    const premier = await client.authenticate();
    const second = await client.authenticate();
    expect(second).toBe(premier);
  });

  it("refuse une signature calculée avec un mauvais secret", async () => {
    const mauvais = new DjomyClient({
      baseUrl: process.env.DJOMY_BASE_URL ?? "https://sandbox-api.djomy.africa",
      clientId: process.env.DJOMY_CLIENT_ID!,
      clientSecret: "secret-volontairement-faux",
      maxTentatives: 1,
    });

    await expect(mauvais.authenticate(true)).rejects.toThrow();
    console.log("  ✓ un secret erroné est bien rejeté par Djomy");
  });

  it("produit un en-tête X-API-KEY au format attendu", () => {
    const entete = apiKeyHeader(
      process.env.DJOMY_CLIENT_ID!,
      process.env.DJOMY_CLIENT_SECRET!,
    );
    expect(entete).toMatch(/^djomy-client-[\w-]+:[0-9a-f]{64}$/);
  });
});

describe("création d'un paiement avec redirection", () => {
  it("crée le paiement et renvoie une URL de redirection", async () => {
    const paiement = await client.createGatewayPayment({
      amount: toDjomyAmount("1000", "GNF"),
      countryCode: "GN",
      payerNumber: normaliserNumero(NUMERO_TEST, "GN"),
      allowedPaymentMethods: ["OM", "MOMO"],
      description: "Vérification d'intégration Shopify",
      merchantPaymentReference: REFERENCE,
      returnUrl: "https://exemple.trycloudflare.com/pay/retour",
      cancelUrl: "https://exemple.trycloudflare.com/pay/annule",
      metadata: { source: "verification", reference: REFERENCE },
    });

    console.log("  ✓ réponse Djomy :", JSON.stringify(paiement, null, 2));

    expect(paiement.transactionId).toBeTruthy();
    expect(STATUTS).toContain(paiement.status);
    expect(paiement.redirectUrl ?? paiement.paymentUrl).toMatch(/^https:\/\//);

    transactionId = paiement.transactionId;
  });

  it("confirme que la devise GNF est bien acceptée", () => {
    expect(toDjomyCurrency("GNF")).toBe("GNF");
  });

  it("ne divulgue jamais le numéro complet dans les journaux", () => {
    expect(masquerNumero(NUMERO_TEST)).toBe("00224*******22");
  });
});

describe("consultation du statut", () => {
  it("récupère le détail du paiement créé", async () => {
    expect(transactionId, "aucune transaction créée à l'étape précédente").toBeTruthy();

    const detail = await client.getPaymentStatus(transactionId);

    console.log("  ✓ statut Djomy :", JSON.stringify(detail, null, 2));

    expect(detail.transactionId).toBe(transactionId);
    expect(STATUTS).toContain(detail.status);
  });

  it("signale une transaction inexistante", async () => {
    await expect(
      client.getPaymentStatus("00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow();
  });
});

describe("comportement réel de Djomy sur les entrées invalides", () => {
  it("accepte un montant négatif — c'est notre code qui doit l'écarter", async () => {
    // Constat de vérification : le bac à sable crée le paiement sans broncher.
    // Voir D9 dans docs/KNOWN-ISSUES.md.
    const paiement = await client.createGatewayPayment({
      amount: -100,
      countryCode: "GN",
      payerNumber: NUMERO_TEST,
      merchantPaymentReference: `${REFERENCE}-NEG`,
      returnUrl: "https://exemple.trycloudflare.com/pay/retour",
    });

    expect(paiement.paidAmount).toBe(-100);
    console.log("  ⚠ Djomy a accepté un montant négatif :", paiement.transactionId);

    // Notre barrière : le montant n'atteint jamais l'API par le chemin normal.
    expect(() => toDjomyAmount("-100", "GNF")).toThrow();
  });

  it("répond 500 sur un code pays inconnu, et non 400", async () => {
    // Conséquence directe : notre politique de rejeu traite ce cas comme une
    // panne transitoire et le rejoue. Voir D10 dans docs/KNOWN-ISSUES.md.
    await expect(
      client.createGatewayPayment({
        amount: 1000,
        countryCode: "ZZ",
        payerNumber: NUMERO_TEST,
        merchantPaymentReference: `${REFERENCE}-ZZ`,
        returnUrl: "https://exemple.trycloudflare.com/pay/retour",
      }),
    ).rejects.toMatchObject({ statusHttp: 500 });
  });
});

describe("idempotence de la référence marchand", () => {
  it("indique si Djomy refuse une référence déjà utilisée", async () => {
    // Question déterminante : si Djomy accepte deux fois la même référence,
    // un rejeu réseau peut créer deux transactions pour une seule commande.
    const reference = `${REFERENCE}-IDEM`;
    const corps = {
      amount: 1000,
      countryCode: "GN",
      payerNumber: normaliserNumero(NUMERO_TEST, "GN"),
      merchantPaymentReference: reference,
      returnUrl: "https://exemple.trycloudflare.com/pay/retour",
    } as const;

    const premier = await client.createGatewayPayment({ ...corps });

    let second: { transactionId: string } | null = null;
    let refus: unknown = null;
    try {
      second = await client.createGatewayPayment({ ...corps });
    } catch (erreur) {
      refus = erreur;
    }

    if (refus) {
      console.log("  ✓ Djomy refuse une référence dupliquée :", String(refus));
    } else {
      console.log(
        "  ⚠ Djomy accepte une référence dupliquée — deux transactions créées :",
        premier.transactionId,
        second?.transactionId,
      );
    }

    // Le test constate, il ne juge pas : c'est la documentation qui tranche.
    expect(premier.transactionId).toBeTruthy();
  });
});
