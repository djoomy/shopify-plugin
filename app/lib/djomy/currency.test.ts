import { describe, expect, it } from "vitest";
import {
  UnsupportedCurrencyError,
  InvalidAmountError,
  devisesSupportees,
  estMemeMontant,
  toDjomyAmount,
  toDjomyCurrency,
  toIsoCurrency,
} from "./currency";

describe("toDjomyCurrency", () => {
  it("mappe les codes ISO Shopify vers les libellés Djomy", () => {
    expect(toDjomyCurrency("GNF")).toBe("GNF");
    expect(toDjomyCurrency("XOF")).toBe("FCFA");
    expect(toDjomyCurrency("USD")).toBe("Dollar");
    expect(toDjomyCurrency("SLE")).toBe("Leones");
  });

  it("accepte un code en minuscules", () => {
    expect(toDjomyCurrency("gnf")).toBe("GNF");
  });

  it("refuse une devise hors périmètre Djomy plutôt que de deviner", () => {
    expect(() => toDjomyCurrency("EUR")).toThrow(UnsupportedCurrencyError);
    expect(() => toDjomyCurrency("XAF")).toThrow(UnsupportedCurrencyError);
    expect(() => toDjomyCurrency("")).toThrow(UnsupportedCurrencyError);
  });

  it("expose la liste des devises supportées", () => {
    expect(devisesSupportees()).toEqual(["GNF", "XOF", "USD", "SLE"]);
  });
});

describe("toIsoCurrency", () => {
  it("fait le chemin inverse pour comparer un webhook à une commande", () => {
    expect(toIsoCurrency("GNF")).toBe("GNF");
    expect(toIsoCurrency("FCFA")).toBe("XOF");
    expect(toIsoCurrency("Dollar")).toBe("USD");
    expect(toIsoCurrency("Leones")).toBe("SLE");
  });

  it("refuse un libellé Djomy inconnu", () => {
    expect(() => toIsoCurrency("Euro")).toThrow(UnsupportedCurrencyError);
  });
});

describe("toDjomyAmount", () => {
  it("convertit un montant Shopify en franc guinéen sans décimale", () => {
    expect(toDjomyAmount("150000.00", "GNF")).toBe(150000);
    expect(toDjomyAmount("150000", "GNF")).toBe(150000);
    expect(toDjomyAmount("150000.0", "GNF")).toBe(150000);
  });

  it("refuse une décimale non nulle sur une devise sans décimale", () => {
    // Arrondir en silence changerait le montant encaissé : on refuse.
    expect(() => toDjomyAmount("1500.50", "GNF")).toThrow(InvalidAmountError);
    expect(() => toDjomyAmount("1500.01", "XOF")).toThrow(InvalidAmountError);
  });

  it("conserve deux décimales sur une devise décimale", () => {
    expect(toDjomyAmount("12.34", "USD")).toBe(12.34);
    expect(toDjomyAmount("12.30", "USD")).toBe(12.3);
    expect(toDjomyAmount("12", "USD")).toBe(12);
  });

  it("refuse plus de deux décimales", () => {
    expect(() => toDjomyAmount("12.345", "USD")).toThrow(InvalidAmountError);
  });

  it("accepte un nombre autant qu'une chaîne", () => {
    expect(toDjomyAmount(150000, "GNF")).toBe(150000);
    expect(toDjomyAmount(12.34, "USD")).toBe(12.34);
  });

  it("refuse un montant nul ou négatif", () => {
    expect(() => toDjomyAmount("0", "GNF")).toThrow(InvalidAmountError);
    expect(() => toDjomyAmount("-100", "GNF")).toThrow(InvalidAmountError);
  });

  it("refuse une chaîne non numérique plutôt que de produire NaN", () => {
    expect(() => toDjomyAmount("abc", "GNF")).toThrow(InvalidAmountError);
    expect(() => toDjomyAmount("150 000", "GNF")).toThrow(InvalidAmountError);
    expect(() => toDjomyAmount("1,5", "GNF")).toThrow(InvalidAmountError);
    expect(() => toDjomyAmount("", "GNF")).toThrow(InvalidAmountError);
  });

  it("refuse un nombre non fini", () => {
    expect(() => toDjomyAmount(Number.NaN, "GNF")).toThrow(InvalidAmountError);
    expect(() => toDjomyAmount(Number.POSITIVE_INFINITY, "GNF")).toThrow(
      InvalidAmountError,
    );
  });

  it("refuse un montant au-delà de la limite de précision sûre", () => {
    expect(() => toDjomyAmount("999999999999999999999", "GNF")).toThrow(
      InvalidAmountError,
    );
  });

  it("propage l'erreur de devise non supportée", () => {
    expect(() => toDjomyAmount("100", "EUR")).toThrow(UnsupportedCurrencyError);
  });
});

describe("estMemeMontant", () => {
  it("compare le montant d'un webhook au montant attendu", () => {
    expect(estMemeMontant(150000, "150000.00", "GNF")).toBe(true);
    expect(estMemeMontant(12.34, "12.34", "USD")).toBe(true);
  });

  it("détecte un écart, même minime", () => {
    expect(estMemeMontant(149999, "150000.00", "GNF")).toBe(false);
    expect(estMemeMontant(12.35, "12.34", "USD")).toBe(false);
  });

  it("ne se laisse pas piéger par l'arithmétique flottante", () => {
    expect(estMemeMontant(0.1 + 0.2, "0.30", "USD")).toBe(true);
  });

  it("renvoie false plutôt que de lever si une valeur est invalide", () => {
    expect(estMemeMontant(Number.NaN, "150000", "GNF")).toBe(false);
    expect(estMemeMontant(100, "abc", "GNF")).toBe(false);
  });
});
