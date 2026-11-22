import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signature HMAC-SHA256 hexadécimale.
 *
 * Djomy signe toujours un message avec le `clientSecret` comme clé :
 *   - en-tête X-API-KEY : message = clientId
 *   - webhook           : message = corps brut de la requête
 *
 * Voir la rubrique « Comment générer une signature » de la documentation Djomy.
 */
export function signPayload(message: string, clientSecret: string): string {
  return createHmac("sha256", clientSecret).update(message, "utf8").digest("hex");
}

/**
 * En-tête `X-API-KEY` exigé sur toutes les requêtes Djomy.
 * Format documenté : `<clientId>:<HMAC-SIGNATURE>`.
 */
export function apiKeyHeader(clientId: string, clientSecret: string): string {
  if (!clientId) {
    throw new Error("Djomy : clientId manquant, impossible de signer la requête.");
  }
  if (!clientSecret) {
    throw new Error("Djomy : clientSecret manquant, impossible de signer la requête.");
  }
  return `${clientId}:${signPayload(clientId, clientSecret)}`;
}

/**
 * Vérifie l'en-tête `X-Webhook-Signature` d'un webhook Djomy.
 *
 * Format documenté : `v1:<signature>`. Le préfixe de version est optionnel ici
 * pour rester compatible si Djomy le fait évoluer.
 *
 * Un webhook dont la signature ne correspond pas doit être ignoré : c'est la
 * seule preuve que la notification vient bien de Djomy.
 */
export function verifyWebhookSignature(
  rawBody: string,
  header: string | null | undefined,
  clientSecret: string,
): boolean {
  if (!header || !clientSecret) return false;

  const recue = header.trim().split(":").pop()?.trim().toLowerCase() ?? "";
  if (!/^[0-9a-f]+$/.test(recue)) return false;

  const attendue = signPayload(rawBody, clientSecret);
  const a = Buffer.from(recue, "hex");
  const b = Buffer.from(attendue, "hex");

  // timingSafeEqual lève si les longueurs diffèrent : on compare avant.
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
