import { describe, expect, it } from "vitest";
import { InvalidPhoneError, estNumeroValide, normaliserNumero, paysSupportes } from "./phone";

describe("normaliserNumero — Guinée", () => {
  it("accepte les formats courants et produit le format Djomy", () => {
    const attendu = "00224623707722";
    expect(normaliserNumero("00224623707722", "GN")).toBe(attendu);
    expect(normaliserNumero("+224623707722", "GN")).toBe(attendu);
    expect(normaliserNumero("224623707722", "GN")).toBe(attendu);
    expect(normaliserNumero("623707722", "GN")).toBe(attendu);
  });

  it("ignore espaces, tirets, points et parenthèses", () => {
    expect(normaliserNumero("00224 623 707 722", "GN")).toBe("00224623707722");
    expect(normaliserNumero("+224-623-707-722", "GN")).toBe("00224623707722");
    expect(normaliserNumero("(224) 623.707.722", "GN")).toBe("00224623707722");
    expect(normaliserNumero("  623707722  ", "GN")).toBe("00224623707722");
  });

  it("refuse un numéro trop court ou trop long", () => {
    expect(() => normaliserNumero("62370772", "GN")).toThrow(InvalidPhoneError);
    expect(() => normaliserNumero("6237077221", "GN")).toThrow(InvalidPhoneError);
    expect(() => normaliserNumero("00224623", "GN")).toThrow(/9 chiffres attendus/);
  });

  it("refuse une saisie vide ou sans chiffre", () => {
    expect(() => normaliserNumero("", "GN")).toThrow(/vide/);
    expect(() => normaliserNumero("   ", "GN")).toThrow(/vide/);
    expect(() => normaliserNumero("appelle-moi", "GN")).toThrow(/aucun chiffre/);
  });

  it("accepte le code pays en minuscules", () => {
    expect(normaliserNumero("623707722", "gn")).toBe("00224623707722");
  });
});

describe("normaliserNumero — Côte d'Ivoire", () => {
  it("gère les dix chiffres nationaux", () => {
    expect(normaliserNumero("+2250701020304", "CI")).toBe("002250701020304");
    expect(normaliserNumero("0701020304", "CI")).toBe("002250701020304");
    expect(normaliserNumero("00225 07 01 02 03 04", "CI")).toBe("002250701020304");
  });

  it("refuse un numéro à neuf chiffres", () => {
    expect(() => normaliserNumero("701020304", "CI")).toThrow(InvalidPhoneError);
  });
});

describe("normaliserNumero — pays", () => {
  it("refuse un pays hors périmètre", () => {
    expect(() => normaliserNumero("623707722", "FR")).toThrow(/non pris en charge/);
    expect(() => normaliserNumero("623707722", "")).toThrow(/non pris en charge/);
  });

  it("expose la liste des pays gérés", () => {
    expect(paysSupportes()).toContain("GN");
    expect(paysSupportes()).toContain("CI");
  });
});

describe("estNumeroValide", () => {
  it("renvoie un booléen sans lever", () => {
    expect(estNumeroValide("623707722", "GN")).toBe(true);
    expect(estNumeroValide("123", "GN")).toBe(false);
    expect(estNumeroValide("623707722", "FR")).toBe(false);
  });
});
