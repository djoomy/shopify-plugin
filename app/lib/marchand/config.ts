import { METHODES_PORTAIL, type MethodePortail } from "../djomy/types";
import { paysSupportes } from "../phone";

/**
 * Configuration Djomy d'une boutique, telle que saisie par le marchand.
 * Ce module ne connaît ni la base de données ni Shopify : il valide et
 * normalise, rien de plus.
 */
export interface ConfigMarchand {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  countryCode: string;
  methodesAutorisees: MethodePortail[];
  testMode: boolean;
}

export const URL_SANDBOX = "https://sandbox-api.djomy.africa";

export class ConfigInvalideError extends Error {
  constructor(readonly champs: Record<string, string>) {
    super(`Configuration Djomy invalide : ${Object.keys(champs).join(", ")}`);
    this.name = "ConfigInvalideError";
  }
}

/** Méthodes proposées par défaut sur le portail de paiement. */
export const METHODES_PAR_DEFAUT: MethodePortail[] = ["OM", "MOMO", "KULU", "CARD"];

/**
 * Valide une saisie de formulaire et produit une configuration exploitable.
 *
 * `clientSecret` peut être omis lors d'une mise à jour : dans ce cas le secret
 * déjà enregistré est conservé, l'interface ne le réaffichant jamais.
 */
export function validerConfig(
  saisie: Record<string, unknown>,
  secretExistant?: string,
): ConfigMarchand {
  const champs: Record<string, string> = {};

  const clientId = texte(saisie.clientId);
  if (!clientId) champs.clientId = "Identifiant client Djomy requis.";

  const clientSecret = texte(saisie.clientSecret) || (secretExistant ?? "");
  if (!clientSecret) champs.clientSecret = "Clé secrète Djomy requise.";

  const baseUrl = texte(saisie.baseUrl) || URL_SANDBOX;
  if (!estUrlHttps(baseUrl)) {
    champs.baseUrl = "L'URL de l'API Djomy doit être une adresse https valide.";
  }

  const countryCode = texte(saisie.countryCode).toUpperCase() || "GN";
  if (!paysSupportes().includes(countryCode)) {
    champs.countryCode = `Pays non pris en charge (attendus : ${paysSupportes().join(", ")}).`;
  }

  const methodesAutorisees = normaliserMethodes(saisie.methodesAutorisees);
  if (methodesAutorisees.length === 0) {
    champs.methodesAutorisees = "Sélectionnez au moins une méthode de paiement.";
  }

  if (Object.keys(champs).length > 0) throw new ConfigInvalideError(champs);

  return {
    clientId,
    clientSecret,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    countryCode,
    methodesAutorisees,
    testMode: booleen(saisie.testMode),
  };
}

/**
 * Normalise une liste de méthodes : accepte un tableau ou une chaîne séparée
 * par des virgules, ignore les valeurs inconnues, supprime les doublons.
 *
 * Djomy ignore silencieusement une méthode mal orthographiée et retombe sur
 * la liste complète : on écarte donc les valeurs invalides ici plutôt que de
 * laisser le marchand croire que son filtrage s'applique.
 */
export function normaliserMethodes(valeur: unknown): MethodePortail[] {
  const brut = Array.isArray(valeur)
    ? valeur
    : typeof valeur === "string"
      ? valeur.split(",")
      : [];

  const vues = new Set<string>();
  const retenues: MethodePortail[] = [];

  for (const element of brut) {
    const code = String(element).trim().toUpperCase();
    if (!code || vues.has(code)) continue;
    vues.add(code);
    if ((METHODES_PORTAIL as readonly string[]).includes(code)) {
      retenues.push(code as MethodePortail);
    }
  }

  return retenues;
}

/** Sérialisation pour stockage : liste séparée par des virgules. */
export function serialiserMethodes(methodes: MethodePortail[]): string {
  return methodes.join(",");
}

function texte(valeur: unknown): string {
  return typeof valeur === "string" ? valeur.trim() : "";
}

function booleen(valeur: unknown): boolean {
  if (typeof valeur === "boolean") return valeur;
  const brut = String(valeur ?? "").toLowerCase();
  return brut === "true" || brut === "on" || brut === "1";
}

function estUrlHttps(valeur: string): boolean {
  try {
    return new URL(valeur).protocol === "https:";
  } catch {
    return false;
  }
}

/** Libellés affichés au marchand et à l'acheteur. */
export const LIBELLES_METHODES: Record<MethodePortail, string> = {
  OM: "Orange Money",
  MOMO: "MTN Mobile Money",
  KULU: "Kulu",
  SOUTRA_MONEY: "Soutra Money",
  PAYCARD: "PayCard",
  CARD: "Carte bancaire (VISA, MasterCard)",
};
