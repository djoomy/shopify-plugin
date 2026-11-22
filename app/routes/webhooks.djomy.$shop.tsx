import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { WebhookPayloadError, WebhookSignatureError } from "../lib/djomy/webhook";
import { lireConfig } from "../lib/marchand/depot.server";
import { commandesShopify } from "../lib/paiements/commandes.server";
import { depotPrisma } from "../lib/paiements/depot.server";
import { traiterWebhook } from "../lib/paiements/service";

/**
 * Réception des notifications Djomy.
 *
 * La boutique est portée par l'URL : chaque marchand configure sa propre
 * adresse dans son espace développeur Djomy, ce qui permet de retrouver le
 * `clientSecret` avec lequel vérifier la signature.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Méthode non autorisée", { status: 405 });
  }

  const shop = params.shop;
  if (!shop) {
    return json({ recu: false, motif: "boutique absente de l'URL" }, { status: 400 });
  }

  // Le corps doit être lu brut : toute re-sérialisation invaliderait la signature.
  const corpsBrut = await request.text();
  const signature = request.headers.get("X-Webhook-Signature");

  const config = await lireConfig(shop);
  if (!config) {
    // Sans identifiants, la signature est invérifiable : on ne traite rien.
    console.warn(JSON.stringify({ message: "djomy.webhook.non-configure", shop }));
    return json({ recu: false, motif: "boutique non configurée" }, { status: 404 });
  }

  try {
    const issue = await traiterWebhook(corpsBrut, signature, config.clientSecret, {
      depot: depotPrisma,
      commandes: commandesShopify,
    });

    console.log(
      JSON.stringify({ message: "djomy.webhook.traite", shop, issue: issue.issue, eventId: issue.eventId }),
    );

    return json({ recu: true, issue: issue.issue });
  } catch (erreur) {
    if (erreur instanceof WebhookSignatureError) {
      console.warn(JSON.stringify({ message: "djomy.webhook.signature-invalide", shop }));
      return json({ recu: false, motif: "signature invalide" }, { status: 401 });
    }

    if (erreur instanceof WebhookPayloadError) {
      console.warn(
        JSON.stringify({ message: "djomy.webhook.payload-invalide", shop, detail: erreur.message }),
      );
      return json({ recu: false, motif: "payload invalide" }, { status: 400 });
    }

    // Erreur interne : on répond 500 pour que Djomy réémette la notification.
    console.error(
      JSON.stringify({
        message: "djomy.webhook.erreur",
        shop,
        detail: erreur instanceof Error ? erreur.message : String(erreur),
      }),
    );
    return json({ recu: false }, { status: 500 });
  }
}

/** Un GET sur cette adresse permet au marchand de vérifier qu'elle répond. */
export async function loader() {
  return json({ service: "webhook Djomy", methode: "POST attendu" }, { status: 405 });
}
