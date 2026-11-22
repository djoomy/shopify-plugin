import { randomBytes } from "node:crypto";

/**
 * Règles de prise en charge d'une commande Shopify par le canal manuel.
 *
 * Le marchand crée une méthode de paiement manuelle dont le nom contient
 * « Djomy ». Seules les commandes passées avec cette méthode, et encore en
 * attente de paiement, sont prises en charge.
 */

/** Extrait utile du payload `orders/create`. */
export interface CommandeShopify {
  id?: number | string;
  admin_graphql_api_id?: string;
  name?: string;
  gateway?: string | null;
  payment_gateway_names?: string[] | null;
  financial_status?: string | null;
  total_price?: string | null;
  currency?: string | null;
  phone?: string | null;
  customer?: { phone?: string | null } | null;
  billing_address?: { phone?: string | null } | null;
  shipping_address?: { phone?: string | null } | null;
}

const MARQUEUR_PASSERELLE = "djomy";

/** Vrai si la commande doit donner lieu à un paiement Djomy. */
export function doitEtrePriseEnCharge(commande: CommandeShopify): boolean {
  if (!commande) return false;

  // Une commande déjà payée ou remboursée n'a rien à faire ici.
  const statut = (commande.financial_status ?? "").toLowerCase();
  if (statut && statut !== "pending") return false;

  const passerelles = [
    commande.gateway ?? "",
    ...(commande.payment_gateway_names ?? []),
  ].map((nom) => String(nom).toLowerCase());

  return passerelles.some((nom) => nom.includes(MARQUEUR_PASSERELLE));
}

/**
 * Référence marchand transmise à Djomy, également utilisée comme jeton d'accès
 * à la page de paiement : elle doit donc être non devinable.
 */
export function genererReference(
  commande: CommandeShopify,
  aleatoire: () => string = () => randomBytes(12).toString("hex"),
): string {
  const nom = (commande.name ?? String(commande.id ?? "")).replace(/[^\w-]/g, "");
  return `${nom || "ORD"}-${aleatoire()}`;
}

/** Identifiant GraphQL de la commande, quel que soit le format reçu. */
export function identifiantCommande(commande: CommandeShopify): string | null {
  if (commande.admin_graphql_api_id) return commande.admin_graphql_api_id;
  if (commande.id !== undefined && commande.id !== null) {
    return `gid://shopify/Order/${commande.id}`;
  }
  return null;
}

/** Premier numéro de téléphone exploitable, pour pré-remplir le formulaire. */
export function telephoneProbable(commande: CommandeShopify): string | null {
  const candidats = [
    commande.phone,
    commande.customer?.phone,
    commande.billing_address?.phone,
    commande.shipping_address?.phone,
  ];
  return candidats.find((valeur) => Boolean(valeur?.trim())) ?? null;
}
