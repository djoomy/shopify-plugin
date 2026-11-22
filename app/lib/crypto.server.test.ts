import { describe, expect, it } from "vitest";
import {
  ChiffrementError,
  chargerCle,
  chiffrer,
  dechiffrer,
  genererCle,
} from "./crypto.server";

const CLE = genererCle();

describe("chargerCle", () => {
  it("accepte une clé de 32 octets encodée en base64", () => {
    expect(chargerCle(CLE)).toHaveLength(32);
  });

  it("refuse une clé absente", () => {
    expect(() => chargerCle("")).toThrow(/manquante/);
  });

  it("refuse une clé de mauvaise taille et indique comment en générer une", () => {
    expect(() => chargerCle(Buffer.from("trop court").toString("base64"))).toThrow(
      /openssl rand -base64 32/,
    );
  });
});

describe("chiffrer / dechiffrer", () => {
  it("restitue la valeur d'origine", () => {
    const secret = "clientSecret-djomy-ultra-confidentiel";
    expect(dechiffrer(chiffrer(secret, CLE), CLE)).toBe(secret);
  });

  it("gère les caractères non ASCII", () => {
    const secret = "clé-secrète-àéîôü-☕";
    expect(dechiffrer(chiffrer(secret, CLE), CLE)).toBe(secret);
  });

  it("gère une chaîne vide", () => {
    expect(dechiffrer(chiffrer("", CLE), CLE)).toBe("");
  });

  it("ne laisse jamais apparaître le clair dans la valeur stockée", () => {
    const secret = "clientSecret-djomy";
    expect(chiffrer(secret, CLE)).not.toContain(secret);
  });

  it("produit un chiffré différent à chaque appel (IV aléatoire)", () => {
    expect(chiffrer("meme-secret", CLE)).not.toBe(chiffrer("meme-secret", CLE));
  });

  it("rejette un chiffré altéré au lieu de renvoyer une valeur fausse", () => {
    const stocke = chiffrer("secret", CLE);
    const morceaux = stocke.split(".");
    const altere = [
      morceaux[0],
      morceaux[1],
      morceaux[2],
      Buffer.from("donnee-falsifiee").toString("base64url"),
    ].join(".");
    expect(() => dechiffrer(altere, CLE)).toThrow(ChiffrementError);
  });

  it("rejette un tag d'authentification altéré", () => {
    const morceaux = chiffrer("secret", CLE).split(".");
    const altere = [
      morceaux[0],
      morceaux[1],
      Buffer.from(randomTag()).toString("base64url"),
      morceaux[3],
    ].join(".");
    expect(() => dechiffrer(altere, CLE)).toThrow(ChiffrementError);
  });

  it("rejette un déchiffrement avec une autre clé", () => {
    const stocke = chiffrer("secret", CLE);
    expect(() => dechiffrer(stocke, genererCle())).toThrow(ChiffrementError);
  });

  it("rejette un format inconnu", () => {
    expect(() => dechiffrer("pas-du-tout-chiffre", CLE)).toThrow(/format/);
    expect(() => dechiffrer("v2.a.b.c", CLE)).toThrow(/format/);
    expect(() => dechiffrer("", CLE)).toThrow(/format/);
  });

  it("ne révèle pas la cause exacte d'un échec de déchiffrement", () => {
    const stocke = chiffrer("secret", CLE);
    try {
      dechiffrer(stocke, genererCle());
      expect.unreachable("le déchiffrement aurait dû échouer");
    } catch (erreur) {
      expect((erreur as Error).message).not.toContain("secret");
    }
  });
});

function randomTag(): string {
  return "0123456789abcdef";
}
