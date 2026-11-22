import { describe, expect, it } from "vitest";
import { chargerEnv, type SourceEnv } from "./env.server";
import { genererCle } from "./crypto.server";

const BASE = {
  SHOPIFY_API_KEY: "cle-api",
  SHOPIFY_API_SECRET: "secret-api",
  SHOPIFY_APP_URL: "https://djomy.example.com",
  DATABASE_URL: "postgresql://djomy:djomy@localhost:5432/djomy",
  ENCRYPTION_KEY: genererCle(),
} satisfies SourceEnv;

describe("chargerEnv", () => {
  it("accepte une configuration complète et applique les valeurs par défaut", () => {
    const env = chargerEnv({ ...BASE });
    expect(env.DJOMY_BASE_URL).toBe("https://sandbox-api.djomy.africa");
    expect(env.DJOMY_COUNTRY_CODE).toBe("GN");
    expect(env.DJOMY_TIMEOUT_MS).toBe(15_000);
    expect(env.NODE_ENV).toBe("development");
  });

  it("signale chaque variable manquante", () => {
    expect(() => chargerEnv({})).toThrow(/SHOPIFY_API_KEY/);
    expect(() => chargerEnv({})).toThrow(/DATABASE_URL/);
    expect(() => chargerEnv({})).toThrow(/ENCRYPTION_KEY/);
  });

  it("ne divulgue aucune valeur dans le message d'erreur", () => {
    try {
      chargerEnv({ ...BASE, SHOPIFY_APP_URL: "http://valeur-tres-reconnaissable.test" });
      expect.unreachable("la configuration aurait dû être rejetée");
    } catch (erreur) {
      expect((erreur as Error).message).not.toContain("valeur-tres-reconnaissable");
    }
  });

  it("impose https sur l'URL de l'application", () => {
    expect(() => chargerEnv({ ...BASE, SHOPIFY_APP_URL: "http://djomy.example.com" })).toThrow(
      /https/,
    );
  });

  it("refuse une clé de chiffrement de mauvaise taille", () => {
    expect(() =>
      chargerEnv({ ...BASE, ENCRYPTION_KEY: Buffer.from("court").toString("base64") }),
    ).toThrow(/32 octets/);
  });

  it("refuse une URL Djomy malformée", () => {
    expect(() => chargerEnv({ ...BASE, DJOMY_BASE_URL: "sandbox-api.djomy.africa" })).toThrow(
      /DJOMY_BASE_URL/,
    );
  });

  it("convertit le délai d'expiration en nombre", () => {
    expect(chargerEnv({ ...BASE, DJOMY_TIMEOUT_MS: "20000" }).DJOMY_TIMEOUT_MS).toBe(20_000);
  });

  it("refuse un délai d'expiration négatif", () => {
    expect(() => chargerEnv({ ...BASE, DJOMY_TIMEOUT_MS: "-1" })).toThrow(
      /DJOMY_TIMEOUT_MS/,
    );
  });
});
