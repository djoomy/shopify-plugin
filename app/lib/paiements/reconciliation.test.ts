import { describe, expect, it, vi } from "vitest";
import type { GetPaymentDto } from "../djomy/types";
import { expirer, reconcilier, type SourceStatut } from "./reconciliation";
import type {
  DepotPaiement,
  MajPaiement,
  PaiementEnregistre,
  PasserelleCommande,
} from "./service";

function paiement(surcharge: Partial<PaiementEnregistre> = {}): PaiementEnregistre {
  return {
    id: "pay-1",
    shop: "boutique.myshopify.com",
    channel: "manual",
    merchantPaymentReference: "ORD-1001",
    djomyTransactionId: "tx-1",
    amount: "150000",
    currency: "GNF",
    status: "PENDING",
    shopifyOrderId: "gid://shopify/Order/1",
    shopifySessionGid: null,
    redirectUrl: "https://pay.djomy.africa/abc",
    lastEventId: null,
    resolvedAt: null,
    ...surcharge,
  };
}

function contexte(statutDjomy: Partial<GetPaymentDto> | Error) {
  const majs: Array<{ id: string; maj: MajPaiement }> = [];

  const depot = {
    mettreAJour: vi.fn(async (id: string, maj: MajPaiement) => {
      majs.push({ id, maj });
      return { ...paiement(), ...maj } as PaiementEnregistre;
    }),
  } as unknown as DepotPaiement;

  const commandes = {
    marquerPayee: vi.fn(async () => {}),
    annoter: vi.fn(async () => {}),
  } satisfies PasserelleCommande;

  const client: SourceStatut = {
    getPaymentStatus: vi.fn(async () => {
      if (statutDjomy instanceof Error) throw statutDjomy;
      return { transactionId: "tx-1", status: "PENDING", ...statutDjomy } as GetPaymentDto;
    }),
  };

  return {
    depot,
    commandes,
    majs,
    deps: {
      depot,
      commandes,
      clientPour: async () => client,
      maintenant: () => new Date("2026-08-24T12:00:00Z"),
    },
  };
}

describe("reconcilier", () => {
  it("encaisse un paiement passé à SUCCESS depuis le dernier passage", async () => {
    const c = contexte({ status: "SUCCESS", paidAmount: 150000, paymentMethod: "OM" });

    const bilan = await reconcilier([paiement()], c.deps);

    expect(bilan.encaisses).toBe(1);
    expect(c.commandes.marquerPayee).toHaveBeenCalledOnce();
    expect(c.majs[0]?.maj.status).toBe("SUCCESS");
    expect(c.majs[0]?.maj.resolvedAt).toEqual(new Date("2026-08-24T12:00:00Z"));
  });

  it("refuse d'encaisser si le montant diverge", async () => {
    const c = contexte({ status: "SUCCESS", paidAmount: 100 });

    const bilan = await reconcilier([paiement()], c.deps);

    expect(bilan.encaisses).toBe(0);
    expect(bilan.erreurs).toBe(1);
    expect(c.commandes.marquerPayee).not.toHaveBeenCalled();
    expect(c.majs[0]?.maj.status).toBe("ECART_MONTANT");
    expect(c.commandes.annoter).toHaveBeenCalled();
  });

  it("refuse d'encaisser si le montant est absent", async () => {
    const c = contexte({ status: "SUCCESS" });

    const bilan = await reconcilier([paiement()], c.deps);

    expect(bilan.encaisses).toBe(0);
    expect(c.commandes.marquerPayee).not.toHaveBeenCalled();
  });

  it("clôt et annote un paiement devenu FAILED", async () => {
    const c = contexte({ status: "FAILED" });

    const bilan = await reconcilier([paiement()], c.deps);

    expect(bilan.echoues).toBe(1);
    expect(c.majs[0]?.maj.status).toBe("FAILED");
    expect(c.majs[0]?.maj.resolvedAt).not.toBeNull();
    expect(c.commandes.annoter).toHaveBeenCalledWith(
      "boutique.myshopify.com",
      "gid://shopify/Order/1",
      expect.stringContaining("FAILED"),
    );
  });

  it("ne clôt pas un paiement passé de CREATED à REDIRECTED", async () => {
    const c = contexte({ status: "REDIRECTED" });

    const bilan = await reconcilier([paiement({ status: "CREATED" })], c.deps);

    expect(bilan.inchanges).toBe(1);
    expect(c.majs[0]?.maj.resolvedAt).toBeNull();
    expect(c.commandes.annoter).not.toHaveBeenCalled();
  });

  it("ne touche à rien si le statut n'a pas bougé", async () => {
    const c = contexte({ status: "PENDING" });

    const bilan = await reconcilier([paiement()], c.deps);

    expect(bilan.inchanges).toBe(1);
    expect(c.depot.mettreAJour).not.toHaveBeenCalled();
  });

  it("ignore un paiement sans transaction Djomy", async () => {
    const c = contexte({ status: "SUCCESS", paidAmount: 150000 });

    const bilan = await reconcilier([paiement({ djomyTransactionId: null })], c.deps);

    expect(bilan.inchanges).toBe(1);
    expect(c.depot.mettreAJour).not.toHaveBeenCalled();
  });

  it("laisse le paiement intact si Djomy est injoignable", async () => {
    const c = contexte(new Error("service injoignable"));

    const bilan = await reconcilier([paiement()], c.deps);

    expect(bilan.erreurs).toBe(1);
    expect(c.depot.mettreAJour).not.toHaveBeenCalled();
    expect(c.commandes.marquerPayee).not.toHaveBeenCalled();
  });

  it("poursuit le lot malgré l'échec d'un paiement", async () => {
    let appel = 0;
    const depot = {
      mettreAJour: vi.fn(async (_id: string, maj: MajPaiement) => ({
        ...paiement(),
        ...maj,
      })),
    } as unknown as DepotPaiement;
    const commandes = {
      marquerPayee: vi.fn(async () => {}),
      annoter: vi.fn(async () => {}),
    } satisfies PasserelleCommande;

    const bilan = await reconcilier([paiement({ id: "a" }), paiement({ id: "b" })], {
      depot,
      commandes,
      clientPour: async () => ({
        getPaymentStatus: async () => {
          appel++;
          if (appel === 1) throw new Error("panne");
          return { transactionId: "tx-1", status: "SUCCESS", paidAmount: 150000 } as GetPaymentDto;
        },
      }),
    });

    expect(bilan.examines).toBe(2);
    expect(bilan.erreurs).toBe(1);
    expect(bilan.encaisses).toBe(1);
  });

  it("renvoie un bilan vide sur une liste vide", async () => {
    const c = contexte({ status: "SUCCESS" });
    const bilan = await reconcilier([], c.deps);
    expect(bilan.examines).toBe(0);
  });
});

describe("expirer", () => {
  it("clôt le paiement et annote la commande", async () => {
    const c = contexte({ status: "PENDING" });

    const comptes = await expirer([paiement()], {
      depot: c.depot,
      commandes: c.commandes,
      maintenant: () => new Date("2026-08-24T12:00:00Z"),
    });

    expect(comptes).toBe(1);
    expect(c.majs[0]?.maj.status).toBe("EXPIRED");
    expect(c.commandes.annoter).toHaveBeenCalledWith(
      "boutique.myshopify.com",
      "gid://shopify/Order/1",
      expect.stringContaining("expiré"),
    );
  });

  it("n'annote rien en l'absence de commande rattachée", async () => {
    const c = contexte({ status: "PENDING" });

    await expirer([paiement({ shopifyOrderId: null })], {
      depot: c.depot,
      commandes: c.commandes,
    });

    expect(c.commandes.annoter).not.toHaveBeenCalled();
  });
});
