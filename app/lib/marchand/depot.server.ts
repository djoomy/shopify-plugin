import prisma from "../../db.server";
import { chiffrer, dechiffrer } from "../crypto.server";
import { DjomyClient } from "../djomy/client";
import {
  METHODES_PAR_DEFAUT,
  normaliserMethodes,
  serialiserMethodes,
  type ConfigMarchand,
} from "./config";

/** Boutique dont la configuration Djomy n'est pas encore renseignée. */
export class MarchandNonConfigureError extends Error {
  constructor(readonly shop: string) {
    super(
      "Cette boutique n'a pas encore de configuration Djomy. " +
        "Renseignez vos identifiants dans les réglages de l'application.",
    );
    this.name = "MarchandNonConfigureError";
  }
}

function cleChiffrement(): string {
  const cle = process.env.ENCRYPTION_KEY;
  if (!cle) {
    throw new Error(
      "ENCRYPTION_KEY absente : impossible de lire ou d'écrire un secret marchand.",
    );
  }
  return cle;
}

/** Configuration complète, secret déchiffré. Ne jamais renvoyer telle quelle à l'interface. */
export async function lireConfig(shop: string): Promise<ConfigMarchand | null> {
  const ligne = await prisma.djomyCredential.findUnique({ where: { shop } });
  if (!ligne) return null;

  return {
    clientId: ligne.clientId,
    clientSecret: dechiffrer(ligne.clientSecretChiffre, cleChiffrement()),
    baseUrl: ligne.baseUrl,
    countryCode: ligne.countryCode,
    methodesAutorisees: normaliserMethodes(ligne.methodesAutorisees),
    testMode: ligne.testMode,
  };
}

/**
 * Configuration destinée à l'affichage : le secret n'en fait jamais partie.
 * Seule son existence est signalée, pour que le marchand sache qu'il peut
 * laisser le champ vide.
 */
export async function lireConfigAffichable(shop: string): Promise<
  (Omit<ConfigMarchand, "clientSecret"> & { secretEnregistre: boolean }) | null
> {
  const ligne = await prisma.djomyCredential.findUnique({ where: { shop } });
  if (!ligne) return null;

  return {
    clientId: ligne.clientId,
    baseUrl: ligne.baseUrl,
    countryCode: ligne.countryCode,
    methodesAutorisees: normaliserMethodes(ligne.methodesAutorisees),
    testMode: ligne.testMode,
    secretEnregistre: Boolean(ligne.clientSecretChiffre),
  };
}

/** Secret déjà enregistré, pour permettre une mise à jour sans le ressaisir. */
export async function lireSecretExistant(shop: string): Promise<string | undefined> {
  const ligne = await prisma.djomyCredential.findUnique({ where: { shop } });
  if (!ligne?.clientSecretChiffre) return undefined;
  return dechiffrer(ligne.clientSecretChiffre, cleChiffrement());
}

export async function enregistrerConfig(
  shop: string,
  config: ConfigMarchand,
): Promise<void> {
  const donnees = {
    clientId: config.clientId,
    clientSecretChiffre: chiffrer(config.clientSecret, cleChiffrement()),
    baseUrl: config.baseUrl,
    countryCode: config.countryCode,
    methodesAutorisees: serialiserMethodes(
      config.methodesAutorisees.length ? config.methodesAutorisees : METHODES_PAR_DEFAUT,
    ),
    testMode: config.testMode,
  };

  await prisma.djomyCredential.upsert({
    where: { shop },
    create: { shop, ...donnees },
    update: donnees,
  });
}

/** Supprime les identifiants d'une boutique (désinstallation, effacement RGPD). */
export async function supprimerConfig(shop: string): Promise<void> {
  await prisma.djomyCredential.deleteMany({ where: { shop } });
}

/** Construit un client Djomy à partir de la configuration enregistrée. */
export async function clientDjomyPour(shop: string): Promise<{
  client: DjomyClient;
  config: ConfigMarchand;
}> {
  const config = await lireConfig(shop);
  if (!config) throw new MarchandNonConfigureError(shop);

  return {
    config,
    client: new DjomyClient({
      baseUrl: config.baseUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      timeoutMs: Number(process.env.DJOMY_TIMEOUT_MS ?? 15_000),
      journal: (message, contexte) => {
        // Le client masque déjà les données sensibles avant de journaliser.
        console.log(JSON.stringify({ message, shop, ...contexte }));
      },
    }),
  };
}
