import type { ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { lireConfig, supprimerConfig } from "../lib/marchand/depot.server";
import { toDjomyCurrency } from "../lib/djomy/currency";
import {
  doitEtrePriseEnCharge,
  genererReference,
  identifiantCommande,
  jetonCheckout,
  type CommandeShopify,
} from "../lib/paiements/commande-manuelle";
import { preparerPaiement } from "../lib/paiements/depot.server";
import { commandesShopify } from "../lib/paiements/commandes.server";

/**
 * Webhooks Shopify.
 *
 * Les trois sujets de conformité (`customers/*`, `shop/redact`) sont
 * obligatoires pour toute application publiée.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop, session, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "ORDERS_CREATE":
      await prendreEnCharge(shop, payload as CommandeShopify);
      break;

    case "APP_UNINSTALLED":
      // La session part avec l'app ; les identifiants Djomy n'ont plus lieu d'être.
      if (session) {
        await prisma.session.deleteMany({ where: { shop } });
      }
      await supprimerConfig(shop);
      break;

    case "CUSTOMERS_DATA_REQUEST":
      // Aucune donnée client n'est conservée hors du numéro de payeur, chiffré
      // et rattaché à la commande. Rien à extraire au-delà de l'admin Shopify.
      break;

    case "CUSTOMERS_REDACT":
      await anonymiserPayeurs(shop);
      break;

    case "SHOP_REDACT":
      await prisma.djomyPayment.deleteMany({ where: { shop } });
      await supprimerConfig(shop);
      break;

    default:
      throw new Response("Sujet de webhook non pris en charge", { status: 404 });
  }

  return new Response();
}

/**
 * Prépare le paiement d'une commande réglée via la méthode manuelle Djomy,
 * puis dépose le lien de paiement en note de commande.
 *
 * Le paiement Djomy lui-même n'est initié qu'une fois l'acheteur arrivé sur la
 * page de paiement : c'est là qu'il fournit son numéro.
 */
async function prendreEnCharge(shop: string, commande: CommandeShopify): Promise<void> {
  if (!doitEtrePriseEnCharge(commande)) return;

  const orderId = identifiantCommande(commande);
  const montant = commande.total_price;
  const devise = commande.currency;

  if (!orderId || !montant || !devise) {
    console.warn(JSON.stringify({ message: "djomy.commande.incomplete", shop, orderId }));
    return;
  }

  const config = await lireConfig(shop);
  if (!config) {
    console.warn(JSON.stringify({ message: "djomy.commande.non-configure", shop }));
    return;
  }

  let djomyCurrency: string;
  try {
    djomyCurrency = toDjomyCurrency(devise);
  } catch {
    // Devise hors périmètre Djomy : la commande reste en attente, le marchand
    // est prévenu plutôt que de découvrir un paiement impossible.
    await commandesShopify.annoter(
      shop,
      orderId,
      `Devise ${devise} non prise en charge par Djomy. Paiement à traiter autrement.`,
    );
    return;
  }

  const paiement = await preparerPaiement({
    shop,
    shopifyOrderId: orderId,
    reference: genererReference(commande),
    amount: montant,
    currency: devise.toUpperCase(),
    djomyCurrency,
    checkoutToken: jetonCheckout(commande),
  });

  const lien = `${process.env.SHOPIFY_APP_URL ?? ""}/pay/${paiement.merchantPaymentReference}`;
  await commandesShopify.annoter(shop, orderId, `Lien de paiement Djomy : ${lien}`);
}

/** Efface les numéros de payeur d'une boutique, en conservant la traçabilité comptable. */
async function anonymiserPayeurs(shop: string): Promise<void> {
  await prisma.djomyPayment.updateMany({
    where: { shop },
    data: { payerNumberChiffre: null },
  });
}
