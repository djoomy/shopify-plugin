import { describe, expect, it } from "vitest";
import {
  ConfigInvalideError,
  METHODES_PAR_DEFAUT,
  URL_SANDBOX,
  normaliserMethodes,
  serialiserMethodes,
  validerConfig,
} from "./config";

const SAISIE = {
  clientId: "djomy-merchant-001",
  clientSecret: "secret-djomy",
  baseUrl: URL_SANDBOX,
  countryCode: "GN",
  methodesAutorisees: ["OM", "MOMO"],
  testMode: "on",
};

describe("validerConfig", () => {
  it("accepte une saisie complète", () => {
    const config = validerConfig({ ...SAISIE });
    expect(config).toEqual({
      clientId: "djomy-merchant-001",
      clientSecret: "secret-djomy",
      baseUrl: URL_SANDBOX,
      countryCode: "GN",
      methodesAutorisees: ["OM", "MOMO"],
      testMode: true,
    });
  });

  it("applique les valeurs par défaut", () => {
    const config = validerConfig({
      clientId: "id",
      clientSecret: "secret",
      methodesAutorisees: ["OM"],
    });
    expect(config.baseUrl).toBe(URL_SANDBOX);
    expect(config.countryCode).toBe("GN");
    expect(config.testMode).toBe(false);
  });

  it("nettoie les espaces autour des saisies", () => {
    const config = validerConfig({ ...SAISIE, clientId: "  id-avec-espaces  " });
    expect(config.clientId).toBe("id-avec-espaces");
  });

  it("retire le slash final de l'URL", () => {
    const config = validerConfig({ ...SAISIE, baseUrl: `${URL_SANDBOX}/` });
    expect(config.baseUrl).toBe(URL_SANDBOX);
  });

  it("met le code pays en majuscules", () => {
    expect(validerConfig({ ...SAISIE, countryCode: "ci" }).countryCode).toBe("CI");
  });

  it("conserve le secret déjà enregistré si le champ est laissé vide", () => {
    const config = validerConfig({ ...SAISIE, clientSecret: "" }, "secret-deja-enregistre");
    expect(config.clientSecret).toBe("secret-deja-enregistre");
  });

  it("préfère le secret nouvellement saisi", () => {
    const config = validerConfig({ ...SAISIE, clientSecret: "nouveau" }, "ancien");
    expect(config.clientSecret).toBe("nouveau");
  });

  it("signale chaque champ fautif plutôt que de s'arrêter au premier", () => {
    try {
      validerConfig({ clientId: "", clientSecret: "", baseUrl: "http://djomy", countryCode: "FR" });
      expect.unreachable("la configuration aurait dû être rejetée");
    } catch (erreur) {
      const champs = (erreur as ConfigInvalideError).champs;
      expect(Object.keys(champs).sort()).toEqual([
        "baseUrl",
        "clientId",
        "clientSecret",
        "countryCode",
        "methodesAutorisees",
      ]);
    }
  });

  it("refuse une URL non https", () => {
    expect(() => validerConfig({ ...SAISIE, baseUrl: "http://api.djomy.africa" })).toThrow(
      ConfigInvalideError,
    );
  });

  it("refuse une URL malformée", () => {
    expect(() => validerConfig({ ...SAISIE, baseUrl: "api.djomy.africa" })).toThrow(
      ConfigInvalideError,
    );
  });

  it("refuse un pays hors périmètre", () => {
    expect(() => validerConfig({ ...SAISIE, countryCode: "FR" })).toThrow(
      ConfigInvalideError,
    );
  });

  it("refuse une liste de méthodes vide", () => {
    expect(() => validerConfig({ ...SAISIE, methodesAutorisees: [] })).toThrow(
      ConfigInvalideError,
    );
  });

  it("refuse une liste ne contenant que des méthodes inconnues", () => {
    // Djomy retomberait sur toutes les méthodes : mieux vaut le dire au marchand.
    expect(() => validerConfig({ ...SAISIE, methodesAutorisees: ["BITCOIN"] })).toThrow(
      ConfigInvalideError,
    );
  });

  it("ne divulgue pas le secret dans le message d'erreur", () => {
    try {
      validerConfig({ clientId: "", clientSecret: "secret-tres-reconnaissable", methodesAutorisees: ["OM"] });
      expect.unreachable("la configuration aurait dû être rejetée");
    } catch (erreur) {
      expect((erreur as Error).message).not.toContain("secret-tres-reconnaissable");
    }
  });
});

describe("normaliserMethodes", () => {
  it("accepte un tableau", () => {
    expect(normaliserMethodes(["OM", "MOMO"])).toEqual(["OM", "MOMO"]);
  });

  it("accepte une chaîne séparée par des virgules", () => {
    expect(normaliserMethodes("OM,MOMO,CARD")).toEqual(["OM", "MOMO", "CARD"]);
  });

  it("met en majuscules et retire les espaces", () => {
    expect(normaliserMethodes(" om , momo ")).toEqual(["OM", "MOMO"]);
  });

  it("écarte les méthodes inconnues de Djomy", () => {
    expect(normaliserMethodes(["OM", "BITCOIN", "MOMO"])).toEqual(["OM", "MOMO"]);
  });

  it("supprime les doublons", () => {
    expect(normaliserMethodes(["OM", "OM", "om"])).toEqual(["OM"]);
  });

  it("renvoie une liste vide sur une valeur inexploitable", () => {
    expect(normaliserMethodes(undefined)).toEqual([]);
    expect(normaliserMethodes(null)).toEqual([]);
    expect(normaliserMethodes(42)).toEqual([]);
    expect(normaliserMethodes("")).toEqual([]);
  });
});

describe("serialiserMethodes", () => {
  it("fait l'aller-retour avec normaliserMethodes", () => {
    expect(normaliserMethodes(serialiserMethodes(METHODES_PAR_DEFAUT))).toEqual(
      METHODES_PAR_DEFAUT,
    );
  });
});
