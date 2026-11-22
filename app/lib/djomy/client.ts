import { apiKeyHeader } from "./signature";
import {
  DjomyApiError,
  DjomyNetworkError,
  DjomyProtocolError,
  masquerNumero,
} from "./errors";
import type {
  AccessTokenDto,
  CreatePaymentCommand,
  CreatedPaymentDto,
  GetPaymentDto,
  InitiatePaymentCommand,
  PartnerApiResponse,
} from "./types";

export interface DjomyConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** Délai maximal d'une requête, en millisecondes. */
  timeoutMs?: number;
  /** Nombre total de tentatives sur erreur rejouable (1 = pas de retry). */
  maxTentatives?: number;
  /** Injectables pour les tests. */
  fetchImpl?: typeof fetch;
  attendre?: (ms: number) => Promise<void>;
  maintenant?: () => number;
  journal?: (message: string, contexte?: Record<string, unknown>) => void;
}

const TIMEOUT_PAR_DEFAUT = 15_000;
const TENTATIVES_PAR_DEFAUT = 3;
/** Marge de sécurité avant expiration du token, en millisecondes. */
const MARGE_EXPIRATION = 60_000;

interface TokenEnCache {
  valeur: string;
  expireA: number;
}

/**
 * Client de l'API partenaire Djomy.
 *
 * Gère l'authentification HMAC, le cache du jeton d'accès, les rejeux sur
 * erreur transitoire, et convertit les réponses en erreurs typées.
 *
 * Aucun secret, jeton ou numéro complet n'est écrit dans les journaux.
 */
export class DjomyClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxTentatives: number;
  private readonly fetchImpl: typeof fetch;
  private readonly attendre: (ms: number) => Promise<void>;
  private readonly maintenant: () => number;
  private readonly journal: (m: string, c?: Record<string, unknown>) => void;

  private token: TokenEnCache | null = null;
  /** Authentification en cours, pour éviter les appels concurrents à /v1/auth. */
  private authEnCours: Promise<string> | null = null;

  constructor(private readonly config: DjomyConfig) {
    if (!config.baseUrl) throw new Error("Djomy : baseUrl manquante.");
    if (!config.clientId) throw new Error("Djomy : clientId manquant.");
    if (!config.clientSecret) throw new Error("Djomy : clientSecret manquant.");

    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? TIMEOUT_PAR_DEFAUT;
    this.maxTentatives = config.maxTentatives ?? TENTATIVES_PAR_DEFAUT;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.attendre =
      config.attendre ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maintenant = config.maintenant ?? (() => Date.now());
    this.journal = config.journal ?? (() => {});
  }

  // ---------------------------------------------------------------- auth

  /**
   * Renvoie un jeton d'accès valide, depuis le cache si possible.
   * `forcer` invalide le cache : utilisé après un 401.
   */
  async authenticate(forcer = false): Promise<string> {
    if (!forcer && this.token && this.token.expireA > this.maintenant()) {
      return this.token.valeur;
    }
    if (this.authEnCours) return this.authEnCours;

    this.authEnCours = this.demanderToken().finally(() => {
      this.authEnCours = null;
    });
    return this.authEnCours;
  }

  private async demanderToken(): Promise<string> {
    const reponse = await this.requete<AccessTokenDto>("/v1/auth", {
      methode: "POST",
      corps: {},
      avecBearer: false,
    });

    if (!reponse.accessToken) {
      throw new DjomyProtocolError("/v1/auth", "accessToken absent de la réponse.");
    }

    const dureeMs = (reponse.expiresIn ?? 3600) * 1000;
    this.token = {
      valeur: reponse.accessToken,
      expireA: this.maintenant() + Math.max(dureeMs - MARGE_EXPIRATION, 0),
    };
    this.journal("djomy.auth.ok", { expiresIn: reponse.expiresIn });
    return reponse.accessToken;
  }

  /** Vide le cache de jeton (rotation de clés, changement de configuration). */
  invaliderToken(): void {
    this.token = null;
  }

  // ------------------------------------------------------------ paiements

  /**
   * Paiement avec redirection vers le portail Djomy.
   * Seul flux autorisant les cartes VISA/MasterCard.
   */
  async createGatewayPayment(
    commande: CreatePaymentCommand,
  ): Promise<CreatedPaymentDto> {
    this.journal("djomy.payment.gateway", {
      reference: commande.merchantPaymentReference,
      montant: commande.amount,
      payeur: masquerNumero(commande.payerNumber),
    });
    return this.requete<CreatedPaymentDto>("/v1/payments/gateway", {
      methode: "POST",
      corps: commande,
      rejouable: false,
    });
  }

  /**
   * Paiement direct, sans redirection : le payeur confirme depuis son téléphone
   * (OM, MOMO) ou via l'application Kulu. Cartes non autorisées ici.
   */
  async createDirectPayment(
    commande: InitiatePaymentCommand,
  ): Promise<CreatedPaymentDto> {
    this.journal("djomy.payment.direct", {
      reference: commande.merchantPaymentReference,
      montant: commande.amount,
      methode: commande.paymentMethod,
      payeur: masquerNumero(commande.payerIdentifier),
    });
    return this.requete<CreatedPaymentDto>("/v1/payments", {
      methode: "POST",
      corps: commande,
      rejouable: false,
    });
  }

  /** Confirmation d'un paiement direct par code à usage unique. */
  async confirmOtp(
    transactionReference: string,
    oneTimePin: string,
  ): Promise<GetPaymentDto> {
    return this.requete<GetPaymentDto>(
      `/v1/payments/${encodeURIComponent(transactionReference)}/confirmOTP`,
      { methode: "POST", corps: { oneTimePin } },
    );
  }

  /** Statut courant d'un paiement. Source de vérité en cas de webhook perdu. */
  async getPaymentStatus(transactionId: string): Promise<GetPaymentDto> {
    return this.requete<GetPaymentDto>(
      `/v1/payments/${encodeURIComponent(transactionId)}/status`,
      { methode: "GET" },
    );
  }

  // -------------------------------------------------------------- transport

  private async requete<T>(
    endpoint: string,
    options: {
      methode: "GET" | "POST";
      corps?: unknown;
      avecBearer?: boolean;
      /**
       * Faux pour les opérations qui créent un paiement.
       *
       * Vérifié sur le bac à sable : Djomy n'applique aucune idempotence sur
       * `merchantPaymentReference` — deux appels identiques créent deux
       * transactions distinctes. Et une erreur de validation peut remonter en
       * HTTP 500, indiscernable d'une panne. Rejouer automatiquement une
       * création exposerait donc à un double débit.
       */
      rejouable?: boolean;
    },
  ): Promise<T> {
    const avecBearer = options.avecBearer !== false;
    const maxTentatives = options.rejouable === false ? 1 : this.maxTentatives;
    let reauthFaite = false;
    // La ré-authentification après un 401 ne consomme pas de tentative :
    // ce n'est pas un échec transitoire du service, c'est un jeton périmé.
    let tentative = 1;

    for (;;) {
      let reponse: Response;

      try {
        reponse = await this.envoyer(endpoint, options, avecBearer);
      } catch (erreur) {
        const echec = new DjomyNetworkError(endpoint, erreur);
        if (tentative >= maxTentatives) throw echec;
        await this.attendreAvantRejeu(tentative, endpoint, "reseau");
        tentative++;
        continue;
      }

      // 401 : le jeton a peut-être expiré côté Djomy. Une seule reprise.
      if (reponse.status === 401 && avecBearer && !reauthFaite) {
        reauthFaite = true;
        this.invaliderToken();
        await this.authenticate(true);
        continue;
      }

      if (reponse.ok) return this.lireDonnees<T>(endpoint, reponse);

      const erreur = await this.lireErreur(endpoint, reponse);
      if (!erreur.estRejouable || tentative >= maxTentatives) throw erreur;
      await this.attendreAvantRejeu(tentative, endpoint, `http-${reponse.status}`);
      tentative++;
    }
  }

  private async envoyer(
    endpoint: string,
    options: { methode: "GET" | "POST"; corps?: unknown },
    avecBearer: boolean,
  ): Promise<Response> {
    const entetes: Record<string, string> = {
      Accept: "application/json",
      "X-API-KEY": apiKeyHeader(this.config.clientId, this.config.clientSecret),
    };

    if (avecBearer) {
      entetes.Authorization = `Bearer ${await this.authenticate()}`;
    }

    let corps: string | undefined;
    if (options.methode === "POST") {
      corps = JSON.stringify(options.corps ?? {});
      entetes["Content-Type"] = "application/json";
    }

    const controleur = new AbortController();
    const minuterie = setTimeout(() => controleur.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
        method: options.methode,
        headers: entetes,
        body: corps,
        signal: controleur.signal,
      });
    } finally {
      clearTimeout(minuterie);
    }
  }

  private async lireDonnees<T>(endpoint: string, reponse: Response): Promise<T> {
    let enveloppe: PartnerApiResponse<T>;
    try {
      enveloppe = (await reponse.json()) as PartnerApiResponse<T>;
    } catch (erreur) {
      throw new DjomyProtocolError(endpoint, "corps JSON illisible.");
    }

    if (enveloppe.success === false) {
      throw new DjomyApiError(
        endpoint,
        reponse.status,
        enveloppe.error?.message ?? enveloppe.message ?? "échec signalé par Djomy",
        enveloppe.error,
      );
    }
    if (enveloppe.data === undefined || enveloppe.data === null) {
      throw new DjomyProtocolError(endpoint, "champ « data » absent de la réponse.");
    }
    return enveloppe.data;
  }

  private async lireErreur(
    endpoint: string,
    reponse: Response,
  ): Promise<DjomyApiError> {
    let enveloppe: PartnerApiResponse<unknown> | null = null;
    try {
      enveloppe = (await reponse.json()) as PartnerApiResponse<unknown>;
    } catch {
      // Corps non JSON : on s'en tient au code HTTP.
    }
    const message =
      enveloppe?.error?.message ??
      enveloppe?.message ??
      enveloppe?.errors?.join(", ") ??
      reponse.statusText ??
      "erreur inconnue";
    return new DjomyApiError(endpoint, reponse.status, message, enveloppe?.error);
  }

  private async attendreAvantRejeu(
    tentative: number,
    endpoint: string,
    cause: string,
  ): Promise<void> {
    const delai = 1000 * 2 ** (tentative - 1);
    this.journal("djomy.retry", { endpoint, tentative, cause, delai });
    await this.attendre(delai);
  }
}
