import { describe, expect, it } from "vitest";
import {
  DjomyApiError,
  DjomyNetworkError,
  DjomyProtocolError,
  masquerNumero,
} from "./errors";

describe("DjomyApiError", () => {
  it("compose un message situant l'endpoint et le code HTTP", () => {
    const erreur = new DjomyApiError("/v1/payments", 400, "payerNumber invalide");
    expect(erreur.message).toBe("Djomy /v1/payments → HTTP 400 : payerNumber invalide");
    expect(erreur.name).toBe("DjomyApiError");
  });

  it("conserve les détails renvoyés par Djomy", () => {
    const erreur = new DjomyApiError("/v1/payments", 422, "refusé", {
      code: 422,
      message: "montant trop faible",
      fieldsErrors: ["amount"],
    });
    expect(erreur.details?.fieldsErrors).toEqual(["amount"]);
  });

  it("ne juge rejouables que 429 et les erreurs serveur", () => {
    expect(new DjomyApiError("/x", 429, "quota").estRejouable).toBe(true);
    expect(new DjomyApiError("/x", 500, "boom").estRejouable).toBe(true);
    expect(new DjomyApiError("/x", 503, "maintenance").estRejouable).toBe(true);
    expect(new DjomyApiError("/x", 400, "corps invalide").estRejouable).toBe(false);
    expect(new DjomyApiError("/x", 401, "clé invalide").estRejouable).toBe(false);
    expect(new DjomyApiError("/x", 403, "interdit").estRejouable).toBe(false);
    expect(new DjomyApiError("/x", 422, "non traitable").estRejouable).toBe(false);
  });

  it("propose un message public sans détail technique", () => {
    expect(new DjomyApiError("/x", 429, "quota").messagePublic).toMatch(/saturé/);
    expect(new DjomyApiError("/x", 500, "stack trace interne").messagePublic).toMatch(
      /indisponible/,
    );
    expect(new DjomyApiError("/x", 500, "stack trace interne").messagePublic).not.toMatch(
      /stack trace/,
    );
  });

  it("reprend le message métier de Djomy quand il est exploitable", () => {
    const erreur = new DjomyApiError("/x", 422, "brut", { message: "solde insuffisant" });
    expect(erreur.messagePublic).toBe("solde insuffisant");
  });

  it("retombe sur un message neutre faute de détail", () => {
    expect(new DjomyApiError("/x", 400, "brut").messagePublic).toBe(
      "Le paiement n'a pas pu être initié.",
    );
  });
});

describe("DjomyNetworkError", () => {
  it("est toujours rejouable", () => {
    expect(new DjomyNetworkError("/v1/payments").estRejouable).toBe(true);
  });

  it("conserve la cause d'origine sans l'exposer publiquement", () => {
    const cause = new TypeError("fetch failed");
    const erreur = new DjomyNetworkError("/v1/payments", cause);
    expect(erreur.cause).toBe(cause);
    expect(erreur.messagePublic).not.toContain("fetch failed");
  });
});

describe("DjomyProtocolError", () => {
  it("n'est jamais rejouable : rejouer ne changerait rien", () => {
    expect(new DjomyProtocolError("/x", "data absent").estRejouable).toBe(false);
  });

  it("expose la raison côté journal, pas côté acheteur", () => {
    const erreur = new DjomyProtocolError("/x", "champ « data » absent");
    expect(erreur.message).toContain("data");
    expect(erreur.messagePublic).toBe("Le paiement n'a pas pu être initié.");
  });
});

describe("masquerNumero", () => {
  it("laisse voir l'indicatif et les deux derniers chiffres", () => {
    expect(masquerNumero("00224623707722")).toBe("00224*******22");
  });

  it("masque intégralement un numéro trop court pour être découpé", () => {
    expect(masquerNumero("1234567")).toBe("*******");
    expect(masquerNumero("12")).toBe("**");
  });

  it("gère l'absence de numéro", () => {
    expect(masquerNumero(undefined)).toBe("");
    expect(masquerNumero(null)).toBe("");
    expect(masquerNumero("")).toBe("");
  });

  it("ne laisse jamais apparaître le numéro complet", () => {
    const numero = "00224623707722";
    expect(masquerNumero(numero)).not.toContain("623707");
  });
});
