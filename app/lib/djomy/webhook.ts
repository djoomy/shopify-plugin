import { verifyWebhookSignature } from "./signature";
import type {
  EvenementDjomy,
  PayoutWebhookEventDto,
  TransactionWebhookEventDto,
  WebhookEvent,
} from "./types";

/** Signature absente, malformée ou ne correspondant pas au corps reçu. */
export class WebhookSignatureError extends Error {
  constructor() {
    super("Signature du webhook Djomy invalide : notification ignorée.");
    this.name = "WebhookSignatureError";
  }
}

/** Corps illisible ou ne respectant pas l'enveloppe attendue. */
export class WebhookPayloadError extends Error {
  constructor(raison: string) {
    super(`Webhook Djomy inexploitable : ${raison}`);
    this.name = "WebhookPayloadError";
  }
}

export interface WebhookVerifie {
  evenement: WebhookEvent;
  eventType: EvenementDjomy;
  eventId: string;
  /** Présent sur les événements `payment.*`. */
  paiement?: TransactionWebhookEventDto;
  /** Présent sur les événements `payout.*` en V2. */
  payout?: PayoutWebhookEventDto;
  /** Version détectée d'après la forme du champ `data`. */
  version: "V1" | "V2";
}

const PREFIXE_PAIEMENT = "payment.";
const PREFIXE_PAYOUT = "payout.";

/**
 * Vérifie puis analyse un webhook Djomy.
 *
 * Le corps doit être fourni **brut**, exactement tel que reçu : toute
 * re-sérialisation JSON invaliderait la signature.
 *
 * Gère indifféremment les payloads V1 (données directement dans `data`) et
 * V2 (`data.payment` / `data.payout`).
 */
export function verifierWebhook(
  corpsBrut: string,
  signature: string | null | undefined,
  clientSecret: string,
): WebhookVerifie {
  if (!verifyWebhookSignature(corpsBrut, signature, clientSecret)) {
    throw new WebhookSignatureError();
  }
  return analyserWebhook(corpsBrut);
}

/**
 * Analyse un webhook déjà authentifié.
 * Exposé séparément pour les tests et les rejeux depuis la base.
 */
export function analyserWebhook(corpsBrut: string): WebhookVerifie {
  let brut: unknown;
  try {
    brut = JSON.parse(corpsBrut);
  } catch {
    throw new WebhookPayloadError("corps JSON illisible.");
  }

  if (!brut || typeof brut !== "object" || Array.isArray(brut)) {
    throw new WebhookPayloadError("objet JSON attendu.");
  }

  const evenement = brut as WebhookEvent;

  if (typeof evenement.eventType !== "string" || !evenement.eventType) {
    throw new WebhookPayloadError("champ « eventType » absent.");
  }
  if (typeof evenement.eventId !== "string" || !evenement.eventId) {
    // eventId porte l'idempotence : sans lui, impossible d'écarter un rejeu.
    throw new WebhookPayloadError("champ « eventId » absent.");
  }
  if (!evenement.data || typeof evenement.data !== "object") {
    throw new WebhookPayloadError("champ « data » absent.");
  }

  const data = evenement.data as Record<string, unknown>;
  const estV2 = "payment" in data || "payout" in data;

  const resultat: WebhookVerifie = {
    evenement,
    eventType: evenement.eventType,
    eventId: evenement.eventId,
    version: estV2 ? "V2" : "V1",
  };

  if (evenement.eventType.startsWith(PREFIXE_PAIEMENT)) {
    const paiement = (estV2 ? data.payment : data) as
      | TransactionWebhookEventDto
      | undefined;
    if (!paiement || typeof paiement.transactionId !== "string") {
      throw new WebhookPayloadError(
        "données de paiement absentes ou sans « transactionId ».",
      );
    }
    resultat.paiement = paiement;
    return resultat;
  }

  if (evenement.eventType.startsWith(PREFIXE_PAYOUT)) {
    const payout = data.payout as PayoutWebhookEventDto | undefined;
    if (!payout || typeof payout.payoutId !== "string") {
      throw new WebhookPayloadError(
        "données de transfert absentes ou sans « payoutId ».",
      );
    }
    resultat.payout = payout;
    return resultat;
  }

  throw new WebhookPayloadError(`type d'événement inconnu : ${evenement.eventType}.`);
}

/** Événements qui closent définitivement le cycle de vie d'un paiement. */
const EVENEMENTS_FINAUX: readonly string[] = [
  "payment.success",
  "payment.failed",
  "payment.cancelled",
  "payment.timeout",
];

export function estEvenementFinal(eventType: string): boolean {
  return EVENEMENTS_FINAUX.includes(eventType);
}

/** Vrai uniquement pour l'événement qui autorise à encaisser la commande. */
export function estPaiementReussi(webhook: WebhookVerifie): boolean {
  if (webhook.eventType !== "payment.success") return false;
  const statut = webhook.paiement?.status;
  return statut === "SUCCESS" || statut === "CAPTURED";
}
