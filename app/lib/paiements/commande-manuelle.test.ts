import { describe, expect, it } from "vitest";
import {
  doitEtrePriseEnCharge,
  genererReference,
  identifiantCommande,
  telephoneProbable,
  type CommandeShopify,
} from "./commande-manuelle";

const COMMANDE: CommandeShopify = {
  id: 1234567890,
  admin_graphql_api_id: "gid://shopify/Order/1234567890",
  name: "#1001",
  gateway: "Mobile Money (Djomy)",
  payment_gateway_names: ["Mobile Money (Djomy)"],
  financial_status: "pending",
  total_price: "150000",
  currency: "GNF",
};

describe("doitEtrePriseEnCharge", () => {
  it("accepte une commande en attente réglée via une passerelle Djomy", () => {
    expect(doitEtrePriseEnCharge(COMMANDE)).toBe(true);
  });

  it("reconnaît la passerelle quelle que soit la casse", () => {
    expect(doitEtrePriseEnCharge({ ...COMMANDE, gateway: "DJOMY mobile money" })).toBe(
      true,
    );
  });

  it("se contente de payment_gateway_names si gateway est absent", () => {
    expect(
      doitEtrePriseEnCharge({
        ...COMMANDE,
        gateway: null,
        payment_gateway_names: ["Paiement Djomy"],
      }),
    ).toBe(true);
  });

  it("écarte une commande réglée par une autre passerelle", () => {
    expect(
      doitEtrePriseEnCharge({
        ...COMMANDE,
        gateway: "shopify_payments",
        payment_gateway_names: ["shopify_payments"],
      }),
    ).toBe(false);
  });

  it("écarte une commande déjà payée", () => {
    expect(doitEtrePriseEnCharge({ ...COMMANDE, financial_status: "paid" })).toBe(false);
  });

  it("écarte une commande remboursée", () => {
    expect(doitEtrePriseEnCharge({ ...COMMANDE, financial_status: "refunded" })).toBe(
      false,
    );
  });

  it("accepte une commande sans statut financier renseigné", () => {
    expect(doitEtrePriseEnCharge({ ...COMMANDE, financial_status: null })).toBe(true);
  });

  it("écarte un payload vide", () => {
    expect(doitEtrePriseEnCharge({})).toBe(false);
  });
});

describe("genererReference", () => {
  it("combine le nom de commande et une part aléatoire", () => {
    expect(genererReference(COMMANDE, () => "abcdef123456")).toBe("1001-abcdef123456");
  });

  it("retire les caractères non exploitables du nom", () => {
    expect(genererReference({ name: "#10/01" }, () => "x")).toBe("1001-x");
  });

  it("retombe sur l'identifiant si le nom manque", () => {
    expect(genererReference({ id: 42 }, () => "x")).toBe("42-x");
  });

  it("reste utilisable même sans nom ni identifiant", () => {
    expect(genererReference({}, () => "x")).toBe("ORD-x");
  });

  it("produit une référence différente à chaque appel", () => {
    expect(genererReference(COMMANDE)).not.toBe(genererReference(COMMANDE));
  });

  it("produit une part aléatoire assez longue pour ne pas être devinée", () => {
    const reference = genererReference(COMMANDE);
    // La référence sert de jeton d'accès à la page de paiement.
    expect(reference.split("-").pop()).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe("identifiantCommande", () => {
  it("privilégie l'identifiant GraphQL fourni par Shopify", () => {
    expect(identifiantCommande(COMMANDE)).toBe("gid://shopify/Order/1234567890");
  });

  it("reconstruit l'identifiant à partir de l'id numérique", () => {
    expect(identifiantCommande({ id: 42 })).toBe("gid://shopify/Order/42");
  });

  it("renvoie null faute d'identifiant", () => {
    expect(identifiantCommande({})).toBeNull();
  });
});

describe("telephoneProbable", () => {
  it("prend le téléphone de la commande en priorité", () => {
    expect(
      telephoneProbable({ phone: "+224623707722", customer: { phone: "+224600000000" } }),
    ).toBe("+224623707722");
  });

  it("retombe sur le client, puis l'adresse de facturation, puis la livraison", () => {
    expect(telephoneProbable({ customer: { phone: "+224601" } })).toBe("+224601");
    expect(telephoneProbable({ billing_address: { phone: "+224602" } })).toBe("+224602");
    expect(telephoneProbable({ shipping_address: { phone: "+224603" } })).toBe("+224603");
  });

  it("ignore les valeurs vides", () => {
    expect(telephoneProbable({ phone: "  ", customer: { phone: "+224604" } })).toBe(
      "+224604",
    );
  });

  it("renvoie null si aucun numéro n'est disponible", () => {
    expect(telephoneProbable({})).toBeNull();
  });
});
