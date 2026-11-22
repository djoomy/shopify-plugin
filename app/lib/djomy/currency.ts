/**
 * Correspondance entre les codes ISO-4217 utilisés par Shopify et les libellés
 * de devise attendus/renvoyés par Djomy.
 *
 * Djomy n'utilise pas de codes ISO : sa spec expose `GNF`, `FCFA`, `Dollar`,
 * `Leones`. La conversion doit donc être explicite dans les deux sens.
 */
const ISO_VERS_DJOMY = {
  GNF: "GNF",
  XOF: "FCFA",
  USD: "Dollar",
  SLE: "Leones",
} as const;

export type IsoCurrency = keyof typeof ISO_VERS_DJOMY;
export type DjomyCurrency = (typeof ISO_VERS_DJOMY)[IsoCurrency];

/** Nombre de décimales par devise. GNF et XOF n'en ont aucune. */
const DECIMALES: Record<IsoCurrency, number> = {
  GNF: 0,
  XOF: 0,
  USD: 2,
  SLE: 2,
};

export class UnsupportedCurrencyError extends Error {
  constructor(public readonly devise: string) {
    super(
      `Devise « ${devise} » non supportée par Djomy. ` +
        `Devises attendues : ${devisesSupportees().join(", ")}.`,
    );
    this.name = "UnsupportedCurrencyError";
  }
}

export class InvalidAmountError extends Error {
  constructor(public readonly montant: unknown, raison: string) {
    super(`Montant invalide (${String(montant)}) : ${raison}`);
    this.name = "InvalidAmountError";
  }
}

export function devisesSupportees(): IsoCurrency[] {
  return Object.keys(ISO_VERS_DJOMY) as IsoCurrency[];
}

/** Code ISO Shopify → libellé Djomy. */
export function toDjomyCurrency(iso: string): DjomyCurrency {
  const code = iso?.trim().toUpperCase();
  if (!code || !(code in ISO_VERS_DJOMY)) {
    throw new UnsupportedCurrencyError(iso);
  }
  return ISO_VERS_DJOMY[code as IsoCurrency];
}

/** Libellé Djomy → code ISO Shopify. */
export function toIsoCurrency(djomy: string): IsoCurrency {
  const libelle = djomy?.trim();
  const entree = Object.entries(ISO_VERS_DJOMY).find(
    ([, valeur]) => valeur.toLowerCase() === libelle?.toLowerCase(),
  );
  if (!entree) throw new UnsupportedCurrencyError(djomy);
  return entree[0] as IsoCurrency;
}

function normaliserIso(iso: string): IsoCurrency {
  const code = iso?.trim().toUpperCase();
  if (!code || !(code in ISO_VERS_DJOMY)) throw new UnsupportedCurrencyError(iso);
  return code as IsoCurrency;
}

/**
 * Convertit un montant Shopify (chaîne décimale ou nombre) en `number` accepté
 * par Djomy, en validant qu'il correspond bien à la précision de la devise.
 *
 * Un montant sur une devise sans décimale n'est jamais arrondi en silence :
 * un arrondi déciderait à la place du marchand du montant réellement encaissé.
 */
export function toDjomyAmount(montant: string | number, iso: string): number {
  const devise = normaliserIso(iso);
  const brut = typeof montant === "number" ? String(montant) : montant?.trim();

  if (!brut || !/^\d+(\.\d+)?$/.test(brut)) {
    throw new InvalidAmountError(
      montant,
      "format attendu : nombre positif en notation décimale, séparateur point.",
    );
  }

  const [partieEntiere = "", partieDecimale = ""] = brut.split(".");
  const decimalesAutorisees = DECIMALES[devise];

  if (decimalesAutorisees === 0) {
    if (/[^0]/.test(partieDecimale)) {
      throw new InvalidAmountError(
        montant,
        `la devise ${devise} ne comporte pas de décimale.`,
      );
    }
  } else if (partieDecimale.replace(/0+$/, "").length > decimalesAutorisees) {
    throw new InvalidAmountError(
      montant,
      `la devise ${devise} accepte au maximum ${decimalesAutorisees} décimales.`,
    );
  }

  const valeur = Number(brut);
  if (!Number.isFinite(valeur) || valeur <= 0) {
    throw new InvalidAmountError(montant, "le montant doit être strictement positif.");
  }
  if (Number(partieEntiere) > Number.MAX_SAFE_INTEGER) {
    throw new InvalidAmountError(
      montant,
      "montant au-delà de la précision entière sûre de JavaScript.",
    );
  }

  return valeur;
}

/**
 * Compare le montant reçu (webhook ou statut Djomy) au montant attendu par la
 * commande Shopify, en unités mineures pour rester à l'abri des flottants.
 *
 * Renvoie `false` sur toute valeur inexploitable : un écart de montant ne doit
 * jamais être interprété comme une correspondance.
 */
export function estMemeMontant(
  recu: number,
  attendu: string | number,
  iso: string,
): boolean {
  let facteur: number;
  try {
    facteur = 10 ** DECIMALES[normaliserIso(iso)];
  } catch {
    return false;
  }

  const attenduBrut = typeof attendu === "number" ? attendu : Number(attendu?.trim());
  if (!Number.isFinite(recu) || !Number.isFinite(attenduBrut)) return false;

  return Math.round(recu * facteur) === Math.round(attenduBrut * facteur);
}
