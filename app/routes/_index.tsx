import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { login } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
}

export default function Accueil() {
  return (
    <main style={{ fontFamily: "Inter, sans-serif", padding: "48px", maxWidth: "560px" }}>
      <h1>Djomy pour Shopify</h1>
      <p>
        Encaissez en Orange Money, MTN Mobile Money, Kulu et carte bancaire via
        l'agrégateur Djomy.
      </p>
      <p>Installez l'application depuis votre administration Shopify.</p>
    </main>
  );
}
