import { describe, expect, it } from "vitest";
import { ESSAIS_MAX, deciderLienCheckout, lireEssai } from "./lien-checkout";

describe("deciderLienCheckout", () => {
  it("redirige vers la page de paiement dès que le paiement existe", () => {
    expect(deciderLienCheckout("1001-abcdef", 0)).toEqual({
      type: "rediriger",
      vers: "/pay/1001-abcdef",
    });
  });

  it("redirige même au dernier essai", () => {
    expect(deciderLienCheckout("1001-abcdef", ESSAIS_MAX)).toEqual({
      type: "rediriger",
      vers: "/pay/1001-abcdef",
    });
  });

  it("fait patienter tant que le paiement n'est pas encore préparé", () => {
    expect(deciderLienCheckout(null, 0)).toEqual({ type: "attendre", prochainEssai: 1 });
    expect(deciderLienCheckout(null, ESSAIS_MAX - 1)).toEqual({
      type: "attendre",
      prochainEssai: ESSAIS_MAX,
    });
  });

  it("abandonne une fois les essais épuisés", () => {
    expect(deciderLienCheckout(null, ESSAIS_MAX)).toEqual({ type: "abandonner" });
    expect(deciderLienCheckout(null, ESSAIS_MAX + 5)).toEqual({ type: "abandonner" });
  });
});

describe("lireEssai", () => {
  it("lit un compteur entier positif", () => {
    expect(lireEssai("3")).toBe(3);
  });

  it("ramène à zéro une valeur absente, négative ou non numérique", () => {
    expect(lireEssai(null)).toBe(0);
    expect(lireEssai("")).toBe(0);
    expect(lireEssai("-2")).toBe(0);
    expect(lireEssai("abc")).toBe(0);
    expect(lireEssai("1.5")).toBe(0);
  });

  it("plafonne une valeur démesurée", () => {
    expect(lireEssai("999999")).toBe(ESSAIS_MAX);
  });
});
