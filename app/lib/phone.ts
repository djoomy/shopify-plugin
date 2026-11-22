/**
 * Normalisation des numéros de téléphone au format attendu par Djomy :
 * indicatif international préfixé de « 00 », sans espace ni signe.
 * Exemple documenté : `00224623707722`.
 */

interface PlanNumerotation {
  /** Indicatif pays, sans préfixe. */
  indicatif: string;
  /** Longueur du numéro national, hors indicatif. */
  longueurNationale: number;
  /** Préfixe national parfois composé avant le numéro (ex. « 0 » en Côte d'Ivoire). */
  prefixeNational?: string;
}

const PLANS: Record<string, PlanNumerotation> = {
  GN: { indicatif: "224", longueurNationale: 9 },
  CI: { indicatif: "225", longueurNationale: 10 },
  SL: { indicatif: "232", longueurNationale: 8, prefixeNational: "0" },
  SN: { indicatif: "221", longueurNationale: 9 },
  ML: { indicatif: "223", longueurNationale: 8 },
};

export class InvalidPhoneError extends Error {
  constructor(
    readonly saisie: string,
    raison: string,
  ) {
    super(`Numéro de téléphone invalide : ${raison}`);
    this.name = "InvalidPhoneError";
  }
}

export function paysSupportes(): string[] {
  return Object.keys(PLANS);
}

/**
 * Convertit une saisie libre en numéro international préfixé `00`.
 *
 * Accepte `+224623707722`, `224623707722`, `00224 623 707 722`, `623707722`.
 * Lève plutôt que de deviner : un numéro erroné, c'est un paiement qui part
 * vers le mauvais compte.
 */
export function normaliserNumero(saisie: string, codePays: string): string {
  const pays = codePays?.trim().toUpperCase();
  const plan = PLANS[pays];
  if (!plan) {
    throw new InvalidPhoneError(
      saisie,
      `pays « ${codePays} » non pris en charge (attendus : ${paysSupportes().join(", ")}).`,
    );
  }

  if (!saisie?.trim()) {
    throw new InvalidPhoneError(saisie, "saisie vide.");
  }

  // On ne conserve que les chiffres, en mémorisant un éventuel « + » initial.
  const avecPlus = saisie.trim().startsWith("+");
  const chiffres = saisie.replace(/[^\d]/g, "");

  if (!chiffres) {
    throw new InvalidPhoneError(saisie, "aucun chiffre exploitable.");
  }

  let national: string;

  if (chiffres.startsWith(`00${plan.indicatif}`)) {
    national = chiffres.slice(2 + plan.indicatif.length);
  } else if (chiffres.startsWith(plan.indicatif) && !avecPlus) {
    // Ambiguïté possible avec un numéro national commençant par l'indicatif :
    // on tranche par la longueur totale.
    national =
      chiffres.length === plan.longueurNationale
        ? chiffres
        : chiffres.slice(plan.indicatif.length);
  } else if (chiffres.startsWith(plan.indicatif)) {
    national = chiffres.slice(plan.indicatif.length);
  } else {
    national = chiffres;
  }

  // Retrait du zéro national éventuel (ex. 07 xx xx xx xx en Côte d'Ivoire).
  if (
    plan.prefixeNational &&
    national.length === plan.longueurNationale + plan.prefixeNational.length &&
    national.startsWith(plan.prefixeNational)
  ) {
    national = national.slice(plan.prefixeNational.length);
  }

  if (national.length !== plan.longueurNationale) {
    throw new InvalidPhoneError(
      saisie,
      `${plan.longueurNationale} chiffres attendus après l'indicatif +${plan.indicatif}, ${national.length} reçus.`,
    );
  }

  return `00${plan.indicatif}${national}`;
}

/** Variante non levante, pour valider une saisie de formulaire. */
export function estNumeroValide(saisie: string, codePays: string): boolean {
  try {
    normaliserNumero(saisie, codePays);
    return true;
  } catch {
    return false;
  }
}
