import type { CSSProperties } from "react";

/**
 * Styles des pages de paiement publiques.
 *
 * Ces pages sont vues par l'acheteur hors de l'admin Shopify : elles n'ont
 * donc pas accès à Polaris. Styles en ligne, sans dépendance externe, pour
 * qu'elles s'affichent même sur une connexion lente.
 */
export const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    margin: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    background: "#f6f6f7",
    fontFamily:
      "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: "#202223",
  },
  carte: {
    width: "100%",
    maxWidth: "420px",
    background: "#ffffff",
    borderRadius: "12px",
    padding: "32px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.06)",
  },
  titre: { fontSize: "20px", fontWeight: 600, margin: "0 0 16px" },
  montant: {
    fontSize: "32px",
    fontWeight: 700,
    margin: "0 0 20px",
    letterSpacing: "-0.02em",
  },
  texte: { fontSize: "14px", lineHeight: 1.5, margin: "0 0 12px" },
  texteDiscret: {
    fontSize: "13px",
    lineHeight: 1.5,
    color: "#6d7175",
    margin: "16px 0 0",
  },
  erreur: {
    fontSize: "14px",
    lineHeight: 1.5,
    color: "#8e0b0b",
    background: "#fff0f0",
    border: "1px solid #f0c2c2",
    borderRadius: "8px",
    padding: "12px",
    margin: "0 0 16px",
  },
  succes: {
    fontSize: "14px",
    lineHeight: 1.5,
    color: "#0c5132",
    background: "#f0fbf5",
    border: "1px solid #b8e6cc",
    borderRadius: "8px",
    padding: "12px",
    margin: "0 0 16px",
  },
  formulaire: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" },
  label: { fontSize: "14px", fontWeight: 500 },
  champ: {
    width: "100%",
    boxSizing: "border-box",
    fontSize: "16px",
    padding: "12px",
    borderRadius: "8px",
    border: "1px solid #c9cccf",
    background: "#ffffff",
  },
  bouton: {
    marginTop: "8px",
    width: "100%",
    fontSize: "16px",
    fontWeight: 600,
    padding: "14px",
    borderRadius: "8px",
    border: "none",
    background: "#202223",
    color: "#ffffff",
    cursor: "pointer",
  },
};
