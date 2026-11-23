/** @jsxImportSource preact */
// La ligne ci-dessus est indispensable : sans elle, le JSX est compilé pour
// React (réglage du tsconfig racine, celui de l'app Remix) et le bloc ne
// s'affiche pas.
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

// Adresse publique de l'app. L'extension est compilée et hébergée par
// Shopify : elle ne lit pas le `.env` du serveur.
const URL_APP = "https://djomy.ousmanebellasarl.com";

export default function extension() {
  render(<Remerciement />, document.body);
}

/**
 * Valeur courante d'un signal Shopify, suivie dans le temps.
 *
 * Certaines valeurs (jeton de checkout, moyens de paiement) peuvent arriver
 * après le premier affichage : sans abonnement, le bloc resterait vide.
 */
function useValeur(signal) {
  const [valeur, setValeur] = useState(signal?.value);

  useEffect(() => {
    if (!signal?.subscribe) return undefined;
    setValeur(signal.value);
    return signal.subscribe((suivante) => setValeur(suivante));
  }, [signal]);

  return valeur;
}

/**
 * Invite l'acheteur à régler sa commande.
 *
 * Le lien porte le jeton de checkout : l'app s'en sert pour retrouver le
 * paiement préparé par le webhook `orders/create` (route `/pay/c/<jeton>`).
 * L'extension ne fait aucun appel réseau.
 */
function Remerciement() {
  const jeton = useValeur(shopify.checkoutToken);
  const moyens = useValeur(shopify.selectedPaymentOptions) ?? [];

  // Dans l'éditeur de checkout, il n'y a ni commande ni jeton : on montre
  // tout de même le bloc, pour que le marchand voie où il le place.
  const dansEditeur = Boolean(shopify.extension?.editor);

  // Shopify n'expose pas le nom du moyen de paiement, seulement son type.
  // On ne masque le bloc que si l'on sait que le paiement n'est pas manuel :
  // une liste vide ne prouve rien. Pour une commande qui n'est pas une
  // commande Djomy, c'est l'app qui l'indique à l'acheteur.
  const autreMoyen =
    moyens.length > 0 && !moyens.some((option) => option.type === "manualPayment");

  if (!dansEditeur && (!jeton || autreMoyen)) return null;

  const lien = jeton ? `${URL_APP}/pay/c/${encodeURIComponent(jeton)}` : URL_APP;

  return (
    <s-banner heading={shopify.i18n.translate("titre")} tone="info">
      <s-stack gap="base">
        <s-text>{shopify.i18n.translate("message")}</s-text>
        <s-button variant="primary" href={lien} target="_blank">
          {shopify.i18n.translate("payer")}
        </s-button>
      </s-stack>
    </s-banner>
  );
}
