import "@shopify/ui-extensions/preact";
import { render } from "preact";

// Adresse publique de l'app. L'extension est compilée et hébergée par
// Shopify : elle ne lit pas le `.env` du serveur.
const URL_APP = "https://djomy.ousmanebellasarl.com";

export default function extension() {
  render(<Remerciement />, document.body);
}

/**
 * Invite l'acheteur à régler sa commande.
 *
 * Le lien porte le jeton de checkout : l'app s'en sert pour retrouver le
 * paiement préparé par le webhook `orders/create` (route `/pay/c/<jeton>`).
 * L'extension ne fait aucun appel réseau.
 */
function Remerciement() {
  const jeton = shopify.checkoutToken.value;

  // Shopify n'expose pas le nom du moyen de paiement, seulement son type :
  // le bloc s'affiche pour tout paiement manuel. Si la commande n'est pas
  // une commande Djomy, l'app l'indique à l'acheteur.
  const paiementManuel = shopify.selectedPaymentOptions.value.some(
    (option) => option.type === "manualPayment",
  );

  if (!jeton || !paiementManuel) return null;

  return (
    <s-banner heading={shopify.i18n.translate("titre")} tone="info">
      <s-stack gap="base">
        <s-text>{shopify.i18n.translate("message")}</s-text>
        <s-button
          variant="primary"
          href={`${URL_APP}/pay/c/${encodeURIComponent(jeton)}`}
          target="_blank"
        >
          {shopify.i18n.translate("payer")}
        </s-button>
      </s-stack>
    </s-banner>
  );
}
