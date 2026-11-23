/**
 * Accès à la page de paiement depuis la page de remerciement Shopify.
 *
 * L'acheteur arrive avec son jeton de checkout. Le paiement est préparé par
 * le webhook `orders/create`, qui peut arriver après lui : on le fait alors
 * patienter quelques secondes plutôt que de lui opposer une erreur.
 */

/** Nombre de rechargements avant d'abandonner (un toutes les 3 secondes). */
export const ESSAIS_MAX = 10;

/** Délai entre deux essais, en secondes. */
export const DELAI_ESSAI_S = 3;

export type Decision =
  | { type: "rediriger"; vers: string }
  | { type: "attendre"; prochainEssai: number }
  | { type: "abandonner" };

/** Décide quoi répondre, selon que le paiement est déjà préparé ou non. */
export function deciderLienCheckout(reference: string | null, essai: number): Decision {
  if (reference) return { type: "rediriger", vers: `/pay/${reference}` };
  if (essai < ESSAIS_MAX) return { type: "attendre", prochainEssai: essai + 1 };
  return { type: "abandonner" };
}

/** Compteur d'essais lu dans l'URL : jamais négatif, jamais au-delà du plafond. */
export function lireEssai(brut: string | null): number {
  if (!brut || !/^\d+$/.test(brut)) return 0;
  return Math.min(Number(brut), ESSAIS_MAX);
}
