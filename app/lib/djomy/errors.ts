import type { ErrorDetails } from "./types";

/** Erreur renvoyée par l'API Djomy, enrichie du contexte de la requête. */
export class DjomyApiError extends Error {
  readonly statusHttp: number;
  readonly details?: ErrorDetails;
  readonly endpoint: string;

  constructor(
    endpoint: string,
    statusHttp: number,
    message: string,
    details?: ErrorDetails,
  ) {
    super(`Djomy ${endpoint} → HTTP ${statusHttp} : ${message}`);
    this.name = "DjomyApiError";
    this.endpoint = endpoint;
    this.statusHttp = statusHttp;
    this.details = details;
  }

  /** Les erreurs de validation ne se rejouent pas : le corps est en cause. */
  get estRejouable(): boolean {
    return this.statusHttp === 429 || this.statusHttp >= 500;
  }

  /** Message affichable à un acheteur, sans détail technique ni secret. */
  get messagePublic(): string {
    if (this.statusHttp === 429) {
      return "Le service de paiement est momentanément saturé. Réessayez dans un instant.";
    }
    if (this.statusHttp >= 500) {
      return "Le service de paiement est momentanément indisponible. Réessayez dans un instant.";
    }
    return this.details?.message ?? "Le paiement n'a pas pu être initié.";
  }
}

/** Panne réseau, DNS, TLS ou dépassement de délai côté client. */
export class DjomyNetworkError extends Error {
  constructor(
    readonly endpoint: string,
    readonly cause?: unknown,
  ) {
    super(`Djomy ${endpoint} : le service est injoignable.`);
    this.name = "DjomyNetworkError";
  }

  get estRejouable(): boolean {
    return true;
  }

  get messagePublic(): string {
    return "Le service de paiement est momentanément injoignable. Réessayez dans un instant.";
  }
}

/** Réponse reçue mais inexploitable (JSON invalide, `data` absent). */
export class DjomyProtocolError extends Error {
  constructor(
    readonly endpoint: string,
    raison: string,
  ) {
    super(`Djomy ${endpoint} : réponse inexploitable — ${raison}`);
    this.name = "DjomyProtocolError";
  }

  get estRejouable(): boolean {
    return false;
  }

  get messagePublic(): string {
    return "Le paiement n'a pas pu être initié.";
  }
}

/** Masque un numéro de téléphone pour les journaux : 00224******22. */
export function masquerNumero(numero: string | undefined | null): string {
  if (!numero) return "";
  if (numero.length <= 7) return "*".repeat(numero.length);
  return `${numero.slice(0, 5)}${"*".repeat(numero.length - 7)}${numero.slice(-2)}`;
}
