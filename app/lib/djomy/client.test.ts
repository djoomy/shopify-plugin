import { beforeEach, describe, expect, it, vi } from "vitest";
import { DjomyClient, type DjomyConfig } from "./client";
import { DjomyApiError, DjomyNetworkError, DjomyProtocolError } from "./errors";

const BASE = "https://sandbox-api.djomy.africa";

interface AppelEnregistre {
  url: string;
  methode: string;
  entetes: Record<string, string>;
  corps: unknown;
}

/** Fabrique un faux `fetch` renvoyant les réponses fournies, dans l'ordre. */
function fauxFetch(reponses: Array<() => Response | Promise<Response>>) {
  const appels: AppelEnregistre[] = [];
  let index = 0;

  const impl = (async (url: string, init: RequestInit = {}) => {
    appels.push({
      url,
      methode: init.method ?? "GET",
      entetes: (init.headers ?? {}) as Record<string, string>,
      corps: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const suivante = reponses[Math.min(index, reponses.length - 1)];
    index++;
    if (!suivante) throw new Error("Aucune réponse configurée");
    return suivante();
  }) as unknown as typeof fetch;

  return { impl, appels, nbAppels: () => index };
}

function json(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const REPONSE_AUTH = () =>
  json(
    {
      success: true,
      data: { accessToken: "jeton-abc", tokenType: "Bearer", expiresIn: 3600 },
    },
    201,
  );

const REPONSE_PAIEMENT = () =>
  json(
    {
      success: true,
      data: {
        transactionId: "123e4567-e89b-12d3-a456-426614174000",
        status: "CREATED",
        redirectUrl: "https://pay.djomy.africa/abc",
        merchantPaymentReference: "ORD-1001",
      },
    },
    201,
  );

function creerClient(
  reponses: Array<() => Response | Promise<Response>>,
  surcharge: Partial<DjomyConfig> = {},
) {
  const faux = fauxFetch(reponses);
  const attentes: number[] = [];
  let horloge = 1_000_000;

  const client = new DjomyClient({
    baseUrl: BASE,
    clientId: "djomy-merchant-001",
    clientSecret: "secret-test",
    fetchImpl: faux.impl,
    attendre: async (ms) => {
      attentes.push(ms);
    },
    maintenant: () => horloge,
    ...surcharge,
  });

  return {
    client,
    appels: faux.appels,
    attentes,
    avancerHorloge: (ms: number) => {
      horloge += ms;
    },
  };
}

const COMMANDE = {
  amount: 150000,
  countryCode: "GN",
  payerNumber: "00224623707722",
  merchantPaymentReference: "ORD-1001",
  returnUrl: "https://boutique.example/retour",
};

describe("construction", () => {
  it("refuse une configuration incomplète", () => {
    expect(() => new DjomyClient({ baseUrl: "", clientId: "a", clientSecret: "b" })).toThrow(
      /baseUrl/,
    );
    expect(
      () => new DjomyClient({ baseUrl: BASE, clientId: "", clientSecret: "b" }),
    ).toThrow(/clientId/);
    expect(
      () => new DjomyClient({ baseUrl: BASE, clientId: "a", clientSecret: "" }),
    ).toThrow(/clientSecret/);
  });

  it("normalise une baseUrl terminée par un slash", async () => {
    const { client, appels } = creerClient([REPONSE_AUTH], {
      baseUrl: `${BASE}/`,
    });
    await client.authenticate();
    expect(appels[0]?.url).toBe(`${BASE}/v1/auth`);
  });
});

describe("authenticate", () => {
  it("appelle POST /v1/auth avec l'en-tête X-API-KEY et un corps vide", async () => {
    const { client, appels } = creerClient([REPONSE_AUTH]);

    await expect(client.authenticate()).resolves.toBe("jeton-abc");

    expect(appels[0]?.methode).toBe("POST");
    expect(appels[0]?.url).toBe(`${BASE}/v1/auth`);
    expect(appels[0]?.entetes["X-API-KEY"]).toMatch(
      /^djomy-merchant-001:[0-9a-f]{64}$/,
    );
    expect(appels[0]?.corps).toEqual({});
  });

  it("n'envoie pas d'en-tête Authorization sur /v1/auth", async () => {
    const { client, appels } = creerClient([REPONSE_AUTH]);
    await client.authenticate();
    expect(appels[0]?.entetes.Authorization).toBeUndefined();
  });

  it("réutilise le jeton en cache tant qu'il est valide", async () => {
    const { client, appels } = creerClient([REPONSE_AUTH]);
    await client.authenticate();
    await client.authenticate();
    await client.authenticate();
    expect(appels).toHaveLength(1);
  });

  it("redemande un jeton une fois la marge d'expiration atteinte", async () => {
    const { client, appels, avancerHorloge } = creerClient([REPONSE_AUTH]);
    await client.authenticate();
    // expiresIn 3600 s, marge 60 s → le cache expire à 3540 s.
    avancerHorloge(3_541_000);
    await client.authenticate();
    expect(appels).toHaveLength(2);
  });

  it("ne lance qu'une seule authentification en cas d'appels concurrents", async () => {
    const { client, appels } = creerClient([REPONSE_AUTH]);
    await Promise.all([
      client.authenticate(),
      client.authenticate(),
      client.authenticate(),
    ]);
    expect(appels).toHaveLength(1);
  });

  it("signale une réponse sans accessToken plutôt que de renvoyer undefined", async () => {
    const { client } = creerClient([() => json({ success: true, data: {} }, 201)]);
    await expect(client.authenticate()).rejects.toThrow(DjomyProtocolError);
  });

  it("ne rejoue pas un 401 sur /v1/auth : les identifiants sont en cause", async () => {
    const { client, appels } = creerClient([
      () => json({ success: false, error: { message: "Identifiants invalides" } }, 401),
    ]);
    await expect(client.authenticate()).rejects.toThrow(DjomyApiError);
    expect(appels).toHaveLength(1);
  });
});

describe("createGatewayPayment", () => {
  it("envoie le Bearer et le X-API-KEY, et renvoie l'URL de redirection", async () => {
    const { client, appels } = creerClient([REPONSE_AUTH, REPONSE_PAIEMENT]);

    const paiement = await client.createGatewayPayment(COMMANDE);

    expect(paiement.redirectUrl).toBe("https://pay.djomy.africa/abc");
    expect(appels[1]?.url).toBe(`${BASE}/v1/payments/gateway`);
    expect(appels[1]?.entetes.Authorization).toBe("Bearer jeton-abc");
    expect(appels[1]?.entetes["X-API-KEY"]).toMatch(/^djomy-merchant-001:[0-9a-f]{64}$/);
    expect(appels[1]?.corps).toEqual(COMMANDE);
  });

  it("se ré-authentifie une fois sur 401 puis rejoue la requête", async () => {
    const { client, appels } = creerClient([
      REPONSE_AUTH,
      () => json({ success: false, error: { message: "jeton expiré" } }, 401),
      REPONSE_AUTH,
      REPONSE_PAIEMENT,
    ]);

    const paiement = await client.createGatewayPayment(COMMANDE);

    expect(paiement.transactionId).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(appels.map((a) => a.url)).toEqual([
      `${BASE}/v1/auth`,
      `${BASE}/v1/payments/gateway`,
      `${BASE}/v1/auth`,
      `${BASE}/v1/payments/gateway`,
    ]);
  });

  it("abandonne après une seule ré-authentification si le 401 persiste", async () => {
    const { client } = creerClient([
      REPONSE_AUTH,
      () => json({ success: false, error: { message: "refusé" } }, 401),
      REPONSE_AUTH,
      () => json({ success: false, error: { message: "refusé" } }, 401),
    ]);
    await expect(client.createGatewayPayment(COMMANDE)).rejects.toThrow(DjomyApiError);
  });

  it("ne rejoue jamais une création de paiement sur 429", async () => {
    // Djomy n'applique aucune idempotence sur merchantPaymentReference :
    // rejouer une création exposerait à un double débit.
    const { client, appels, attentes } = creerClient([
      REPONSE_AUTH,
      () => json({ success: false, error: { message: "trop de requêtes" } }, 429),
      REPONSE_PAIEMENT,
    ]);

    await expect(client.createGatewayPayment(COMMANDE)).rejects.toThrow(DjomyApiError);
    expect(appels).toHaveLength(2);
    expect(attentes).toEqual([]);
  });

  it("ne rejoue jamais une création de paiement sur 500", async () => {
    const { client, appels } = creerClient([
      REPONSE_AUTH,
      () => json({ success: false, error: { message: "boom" } }, 500),
    ]);

    await expect(client.createGatewayPayment(COMMANDE)).rejects.toThrow(DjomyApiError);
    expect(appels).toHaveLength(2);
  });

  it("ne rejoue jamais une création de paiement sur panne réseau", async () => {
    // Le paiement a peut-être été créé côté Djomy avant la coupure : rejouer
    // en créerait un second.
    const { client, appels } = creerClient([
      REPONSE_AUTH,
      () => {
        throw new TypeError("fetch failed");
      },
    ]);

    await expect(client.createGatewayPayment(COMMANDE)).rejects.toThrow(
      DjomyNetworkError,
    );
    expect(appels).toHaveLength(2);
  });

  it("ne rejoue jamais un 400 : le corps de la requête est en cause", async () => {
    const { client, appels } = creerClient([
      REPONSE_AUTH,
      () =>
        json(
          {
            success: false,
            error: { code: 400, message: "payerNumber invalide", fieldsErrors: ["payerNumber"] },
          },
          400,
        ),
    ]);

    await expect(client.createGatewayPayment(COMMANDE)).rejects.toMatchObject({
      name: "DjomyApiError",
      statusHttp: 400,
    });
    expect(appels).toHaveLength(2);
  });

  it("expose les détails d'erreur renvoyés par Djomy", async () => {
    const { client } = creerClient([
      REPONSE_AUTH,
      () =>
        json(
          { success: false, error: { code: 422, message: "montant trop faible" } },
          422,
        ),
    ]);

    await expect(client.createGatewayPayment(COMMANDE)).rejects.toThrow(
      /montant trop faible/,
    );
  });

  it("signale une réponse 2xx sans champ data", async () => {
    const { client } = creerClient([REPONSE_AUTH, () => json({ success: true }, 201)]);
    await expect(client.createGatewayPayment(COMMANDE)).rejects.toThrow(
      DjomyProtocolError,
    );
  });

  it("signale un corps 2xx non JSON", async () => {
    const { client } = creerClient([
      REPONSE_AUTH,
      () => new Response("<html>maintenance</html>", { status: 200 }),
    ]);
    await expect(client.createGatewayPayment(COMMANDE)).rejects.toThrow(
      DjomyProtocolError,
    );
  });

  it("traite success:false même sur un code HTTP 2xx", async () => {
    const { client } = creerClient([
      REPONSE_AUTH,
      () => json({ success: false, message: "paiement refusé", data: null }, 200),
    ]);
    await expect(client.createGatewayPayment(COMMANDE)).rejects.toThrow(
      /paiement refusé/,
    );
  });
});

describe("createDirectPayment", () => {
  it("poste sur /v1/payments avec la méthode choisie", async () => {
    const { client, appels } = creerClient([REPONSE_AUTH, REPONSE_PAIEMENT]);

    await client.createDirectPayment({
      paymentMethod: "OM",
      payerIdentifier: "00224623707722",
      amount: 150000,
      countryCode: "GN",
    });

    expect(appels[1]?.url).toBe(`${BASE}/v1/payments`);
    expect(appels[1]?.corps).toMatchObject({ paymentMethod: "OM" });
  });
});

describe("getPaymentStatus", () => {
  it("interroge /v1/payments/{id}/status en GET, sans corps", async () => {
    const { client, appels } = creerClient([
      REPONSE_AUTH,
      () => json({ success: true, data: { transactionId: "tx-1", status: "SUCCESS" } }),
    ]);

    const statut = await client.getPaymentStatus("tx-1");

    expect(statut.status).toBe("SUCCESS");
    expect(appels[1]?.methode).toBe("GET");
    expect(appels[1]?.url).toBe(`${BASE}/v1/payments/tx-1/status`);
    expect(appels[1]?.corps).toBeUndefined();
  });

  it("rejoue un 429 avec un backoff exponentiel", async () => {
    // Consulter un statut est sans effet de bord : le rejeu est sûr.
    const { client, attentes } = creerClient([
      REPONSE_AUTH,
      () => json({ success: false, error: { message: "trop de requêtes" } }, 429),
      () => json({ success: true, data: { transactionId: "tx-1", status: "SUCCESS" } }),
    ]);

    await expect(client.getPaymentStatus("tx-1")).resolves.toBeTruthy();
    expect(attentes).toEqual([1000]);
  });

  it("rejoue une erreur 500 puis abandonne au bout de 3 tentatives", async () => {
    const { client, attentes, appels } = creerClient([
      REPONSE_AUTH,
      () => json({ success: false, error: { message: "boom" } }, 500),
    ]);

    await expect(client.getPaymentStatus("tx-1")).rejects.toThrow(DjomyApiError);
    expect(attentes).toEqual([1000, 2000]);
    // 1 auth + 3 tentatives de lecture
    expect(appels).toHaveLength(4);
  });

  it("rejoue une panne réseau puis abandonne en DjomyNetworkError", async () => {
    const { client, attentes } = creerClient([
      REPONSE_AUTH,
      () => {
        throw new TypeError("fetch failed");
      },
    ]);

    await expect(client.getPaymentStatus("tx-1")).rejects.toThrow(DjomyNetworkError);
    expect(attentes).toEqual([1000, 2000]);
  });

  it("encode l'identifiant dans l'URL", async () => {
    const { client, appels } = creerClient([
      REPONSE_AUTH,
      () => json({ success: true, data: { transactionId: "a/b", status: "PENDING" } }),
    ]);
    await client.getPaymentStatus("a/b");
    expect(appels[1]?.url).toBe(`${BASE}/v1/payments/a%2Fb/status`);
  });
});

describe("confirmOtp", () => {
  it("poste le code sur l'endpoint de confirmation", async () => {
    const { client, appels } = creerClient([
      REPONSE_AUTH,
      () => json({ success: true, data: { transactionId: "tx-1", status: "SUCCESS" } }),
    ]);

    await client.confirmOtp("tx-1", "123456");

    expect(appels[1]?.url).toBe(`${BASE}/v1/payments/tx-1/confirmOTP`);
    expect(appels[1]?.corps).toEqual({ oneTimePin: "123456" });
  });
});

describe("journalisation", () => {
  it("ne divulgue ni secret, ni jeton, ni numéro complet", async () => {
    const lignes: Array<{ message: string; contexte?: Record<string, unknown> }> = [];
    const { client } = creerClient([REPONSE_AUTH, REPONSE_PAIEMENT], {
      journal: (message, contexte) => lignes.push({ message, contexte }),
    });

    await client.createGatewayPayment(COMMANDE);

    const tout = JSON.stringify(lignes);
    expect(tout).not.toContain("secret-test");
    expect(tout).not.toContain("jeton-abc");
    expect(tout).not.toContain("00224623707722");
    expect(tout).toContain("00224*******22");
  });
});

describe("délai maximal", () => {
  it("interrompt une requête qui dépasse le délai imparti", async () => {
    vi.useFakeTimers();
    try {
      const { client } = creerClient(
        [
          REPONSE_AUTH,
          (): Promise<Response> =>
            new Promise((_, rejeter) => {
              // Simule une requête qui ne répond jamais : seul l'abort la coupe.
              setTimeout(() => rejeter(new DOMException("Aborted", "AbortError")), 60_000);
            }),
        ],
        { timeoutMs: 100, maxTentatives: 1 },
      );

      const promesse = client.createGatewayPayment(COMMANDE).catch((e) => e);
      await vi.advanceTimersByTimeAsync(61_000);
      await expect(promesse).resolves.toBeInstanceOf(DjomyNetworkError);
    } finally {
      vi.useRealTimers();
    }
  });
});
