import { z } from "zod";

/**
 * Validation de la configuration au démarrage.
 *
 * Une variable manquante ou mal formée arrête l'application immédiatement :
 * mieux vaut ne pas démarrer que traiter des paiements avec une configuration
 * incomplète. Aucune valeur n'est jamais journalisée.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Shopify
  SHOPIFY_API_KEY: z.string().min(1, "SHOPIFY_API_KEY manquante"),
  SHOPIFY_API_SECRET: z.string().min(1, "SHOPIFY_API_SECRET manquante"),
  SHOPIFY_APP_URL: z
    .string()
    .url("SHOPIFY_APP_URL doit être une URL absolue")
    .refine((v) => v.startsWith("https://"), "SHOPIFY_APP_URL doit être en https"),
  SCOPES: z.string().default("write_orders,read_orders"),

  // Base de données
  DATABASE_URL: z.string().min(1, "DATABASE_URL manquante"),

  // Djomy
  DJOMY_BASE_URL: z
    .string()
    .url("DJOMY_BASE_URL doit être une URL absolue")
    .default("https://sandbox-api.djomy.africa"),
  DJOMY_CLIENT_ID: z.string().optional(),
  DJOMY_CLIENT_SECRET: z.string().optional(),
  DJOMY_COUNTRY_CODE: z.string().length(2).default("GN"),
  DJOMY_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  // Chiffrement des secrets marchands
  ENCRYPTION_KEY: z
    .string()
    .min(1, "ENCRYPTION_KEY manquante (générer : openssl rand -base64 32)")
    .refine(
      (v) => Buffer.from(v, "base64").length === 32,
      "ENCRYPTION_KEY doit valoir 32 octets une fois décodée en base64",
    ),
});

export type Env = z.infer<typeof schema>;

let cache: Env | null = null;

/** Source de configuration : `process.env` en production, un objet en test. */
export type SourceEnv = Record<string, string | undefined>;

export function chargerEnv(source: SourceEnv = process.env): Env {
  const resultat = schema.safeParse(source);

  if (!resultat.success) {
    // On liste les variables fautives, jamais leur valeur.
    const details = resultat.error.issues
      .map((probleme) => `  - ${probleme.path.join(".")} : ${probleme.message}`)
      .join("\n");
    throw new Error(`Configuration invalide :\n${details}`);
  }

  return resultat.data;
}

/** Configuration validée, mise en cache pour la durée du processus. */
export function env(): Env {
  cache ??= chargerEnv();
  return cache;
}

/** Réinitialise le cache — usage réservé aux tests. */
export function reinitialiserEnv(): void {
  cache = null;
}
