import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Chiffrement au repos des secrets marchands (clientSecret Djomy).
 *
 * AES-256-GCM : confidentialité et authenticité. Un chiffré altéré est rejeté
 * au déchiffrement plutôt que de produire une valeur silencieusement fausse.
 *
 * Format stocké : `v1.<iv base64url>.<tag base64url>.<chiffré base64url>`
 */

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const TAILLE_IV = 12; // recommandation GCM
const TAILLE_CLE = 32; // AES-256

export class ChiffrementError extends Error {
  constructor(raison: string) {
    super(`Chiffrement : ${raison}`);
    this.name = "ChiffrementError";
  }
}

/** Décode et valide la clé maîtresse (32 octets, encodée en base64). */
export function chargerCle(cleBase64: string): Buffer {
  if (!cleBase64) {
    throw new ChiffrementError("ENCRYPTION_KEY manquante.");
  }
  let cle: Buffer;
  try {
    cle = Buffer.from(cleBase64, "base64");
  } catch {
    throw new ChiffrementError("ENCRYPTION_KEY n'est pas du base64 valide.");
  }
  if (cle.length !== TAILLE_CLE) {
    throw new ChiffrementError(
      `ENCRYPTION_KEY doit faire ${TAILLE_CLE} octets une fois décodée (${cle.length} reçus). ` +
        `Générer avec : openssl rand -base64 32`,
    );
  }
  return cle;
}

export function chiffrer(clair: string, cleBase64: string): string {
  const cle = chargerCle(cleBase64);
  const iv = randomBytes(TAILLE_IV);
  const chiffreur = createCipheriv(ALGO, cle, iv);
  const chiffre = Buffer.concat([
    chiffreur.update(clair, "utf8"),
    chiffreur.final(),
  ]);
  const tag = chiffreur.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    chiffre.toString("base64url"),
  ].join(".");
}

export function dechiffrer(stocke: string, cleBase64: string): string {
  const cle = chargerCle(cleBase64);
  const morceaux = stocke?.split(".") ?? [];

  if (morceaux.length !== 4 || morceaux[0] !== VERSION) {
    throw new ChiffrementError("format de valeur chiffrée non reconnu.");
  }

  const [, ivB64, tagB64, chiffreB64] = morceaux as [string, string, string, string];

  try {
    const dechiffreur = createDecipheriv(
      ALGO,
      cle,
      Buffer.from(ivB64, "base64url"),
    );
    dechiffreur.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      dechiffreur.update(Buffer.from(chiffreB64, "base64url")),
      dechiffreur.final(),
    ]).toString("utf8");
  } catch {
    // Message volontairement avare : ne rien révéler sur la cause de l'échec.
    throw new ChiffrementError("valeur chiffrée illisible ou altérée.");
  }
}

/** Génère une clé maîtresse utilisable comme ENCRYPTION_KEY. */
export function genererCle(): string {
  return randomBytes(TAILLE_CLE).toString("base64");
}
