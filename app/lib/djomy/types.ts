/**
 * Types issus de la spec OpenAPI Djomy (docs/api/djomy-openapi-partner.json).
 * Les noms de champs reprennent exactement ceux de l'API.
 */

/** Méthodes de paiement acceptées à l'initiation d'un paiement direct. */
export const METHODES_DIRECTES = ["OM", "MOMO", "KULU"] as const;
export type MethodeDirecte = (typeof METHODES_DIRECTES)[number];

/** Méthodes affichables sur le portail de paiement Djomy. */
export const METHODES_PORTAIL = [
  "OM",
  "MOMO",
  "KULU",
  "SOUTRA_MONEY",
  "PAYCARD",
  "CARD",
] as const;
export type MethodePortail = (typeof METHODES_PORTAIL)[number];

/** Statuts renvoyés par l'API et les webhooks. */
export const STATUTS = [
  "CREATED",
  "PENDING",
  "REDIRECTED",
  "AUTHORIZED",
  "CAPTURED",
  "SUCCESS",
  "FAILED",
  "CANCELLED",
] as const;
export type StatutPaiement = (typeof STATUTS)[number];

/** Statuts au-delà desquels plus aucun changement n'est attendu. */
export const STATUTS_FINAUX: readonly StatutPaiement[] = [
  "SUCCESS",
  "CAPTURED",
  "FAILED",
  "CANCELLED",
];

export function estStatutFinal(statut: string): boolean {
  return STATUTS_FINAUX.includes(statut as StatutPaiement);
}

/** Événements webhook Djomy. */
export const EVENEMENTS = [
  "payment.created",
  "payment.redirected",
  "payment.pending",
  "payment.cancelled",
  "payment.timeout",
  "payment.success",
  "payment.failed",
  "payment.refunded",
  "payout.success",
  "payout.failed",
] as const;
export type EvenementDjomy = (typeof EVENEMENTS)[number];

/** Métadonnées : JSON plat, sans liste ni structure imbriquée (contrainte Djomy). */
export type DjomyMetadata = Record<string, string | number | boolean>;

/** Enveloppe commune à toutes les réponses de l'API partenaire. */
export interface PartnerApiResponse<T> {
  success?: boolean;
  message?: string;
  data?: T;
  error?: ErrorDetails;
  errors?: string[];
  path?: string;
  eventType?: string;
  timestamp?: string;
  status?: number;
}

export interface ErrorDetails {
  code?: number;
  message?: string;
  details?: string;
  fieldsErrors?: string[];
}

export interface AccessTokenDto {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

/** Corps de `POST /v1/payments/gateway` (paiement avec redirection). */
export interface CreatePaymentCommand {
  amount: number;
  countryCode: string;
  payerNumber: string;
  allowedPaymentMethods?: MethodePortail[];
  description?: string;
  merchantPaymentReference?: string;
  returnUrl?: string;
  cancelUrl?: string;
  metadata?: DjomyMetadata;
}

/** Corps de `POST /v1/payments` (paiement direct, sans redirection). */
export interface InitiatePaymentCommand {
  paymentMethod: MethodeDirecte;
  payerIdentifier: string;
  amount: number;
  countryCode: string;
  description?: string;
  merchantPaymentReference?: string;
  returnUrl?: string;
  cancelUrl?: string;
  metadata?: DjomyMetadata;
}

export interface CreatedPaymentDto {
  transactionId: string;
  status: StatutPaiement;
  paidAmount?: number;
  paymentMethod?: string;
  merchantPaymentReference?: string;
  createdAt?: string;
  /** Présente uniquement sur le flux avec redirection vers le portail Djomy. */
  redirectUrl?: string;
  paymentUrl?: string;
  allowedPaymentMethods?: string[];
  metadata?: DjomyMetadata;
}

export interface GetPaymentDto {
  transactionId: string;
  status: StatutPaiement;
  paidAmount?: number;
  paymentMethod?: string;
  receivedAmount?: number;
  fees?: number;
  payerIdentifier?: string;
  merchantPaymentReference?: string;
  currency?: string;
  createdAt?: string;
  allowedPaymentMethods?: string[];
  metadata?: DjomyMetadata;
  providerReference?: string;
}

/** Corps d'un webhook, structure `data` du paiement (V1 comme V2). */
export interface TransactionWebhookEventDto {
  transactionId: string;
  status: StatutPaiement;
  paidAmount?: number;
  receivedAmount?: number;
  fees?: number;
  paymentMethod?: string;
  payerIdentifier?: string;
  merchantPaymentReference?: string;
  currency?: string;
  createdAt?: string;
  providerReference?: string;
}

export interface PayoutWebhookEventDto {
  payoutId: string;
  reference?: string;
  orderReference?: string;
  status: "SUCCESS" | "FAILED" | "REJECTED";
  amount?: number;
  fees?: number;
  currency?: string;
  provider?: string;
  destinationAccountNumber?: string;
  beneficiaryName?: string;
  providerReference?: string;
  createdAt?: string;
}

/**
 * Enveloppe d'un webhook Djomy.
 *
 * En V1, les données du paiement occupent directement `data`.
 * En V2, elles sont sous `data.payment` (ou `data.payout`).
 */
export interface WebhookEvent {
  message?: string;
  eventType: EvenementDjomy;
  eventId: string;
  data: TransactionWebhookEventDto | { payment?: TransactionWebhookEventDto; payout?: PayoutWebhookEventDto };
  paymentLinkReference?: string;
  timestamp?: string;
  metadata?: DjomyMetadata;
}
