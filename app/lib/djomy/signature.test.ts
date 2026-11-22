import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { apiKeyHeader, signPayload, verifyWebhookSignature } from "./signature";

const CLIENT_ID = "djomy-merchant-001";
const CLIENT_SECRET = "s3cr3t-de-test";

describe("signPayload", () => {
  it("produit un HMAC-SHA256 hexadécimal de 64 caractères", () => {
    expect(signPayload(CLIENT_ID, CLIENT_SECRET)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("signe le message avec le secret comme clé, conformément à la doc Djomy", () => {
    const attendu = createHmac("sha256", CLIENT_SECRET)
      .update(CLIENT_ID, "utf8")
      .digest("hex");
    expect(signPayload(CLIENT_ID, CLIENT_SECRET)).toBe(attendu);
  });

  it("est déterministe", () => {
    expect(signPayload(CLIENT_ID, CLIENT_SECRET)).toBe(
      signPayload(CLIENT_ID, CLIENT_SECRET),
    );
  });

  it("change si le message change", () => {
    expect(signPayload("client-a", CLIENT_SECRET)).not.toBe(
      signPayload("client-b", CLIENT_SECRET),
    );
  });

  it("change si le secret change", () => {
    expect(signPayload(CLIENT_ID, "secret-a")).not.toBe(
      signPayload(CLIENT_ID, "secret-b"),
    );
  });

  it("gère les caractères non ASCII sans corrompre l'encodage", () => {
    expect(signPayload("réf-péage-☕", CLIENT_SECRET)).toBe(
      createHmac("sha256", CLIENT_SECRET).update("réf-péage-☕", "utf8").digest("hex"),
    );
  });
});

describe("apiKeyHeader", () => {
  it("construit l'en-tête au format <clientId>:<signature>", () => {
    expect(apiKeyHeader(CLIENT_ID, CLIENT_SECRET)).toBe(
      `${CLIENT_ID}:${signPayload(CLIENT_ID, CLIENT_SECRET)}`,
    );
  });

  it("respecte le motif documenté par Djomy", () => {
    expect(apiKeyHeader(CLIENT_ID, CLIENT_SECRET)).toMatch(
      /^djomy-merchant-001:[0-9a-f]{64}$/,
    );
  });

  it("refuse un clientId vide", () => {
    expect(() => apiKeyHeader("", CLIENT_SECRET)).toThrow(/clientId/i);
  });

  it("refuse un clientSecret vide", () => {
    expect(() => apiKeyHeader(CLIENT_ID, "")).toThrow(/clientSecret/i);
  });
});

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({
    eventType: "payment.success",
    eventId: "8bfd5709-737c-4254-99a7-57a3d630b349",
  });

  it("accepte une signature valide préfixée v1:", () => {
    const header = `v1:${signPayload(body, CLIENT_SECRET)}`;
    expect(verifyWebhookSignature(body, header, CLIENT_SECRET)).toBe(true);
  });

  it("accepte une signature valide sans préfixe de version", () => {
    const header = signPayload(body, CLIENT_SECRET);
    expect(verifyWebhookSignature(body, header, CLIENT_SECRET)).toBe(true);
  });

  it("tolère les espaces autour de l'en-tête", () => {
    const header = `  v1:${signPayload(body, CLIENT_SECRET)}  `;
    expect(verifyWebhookSignature(body, header, CLIENT_SECRET)).toBe(true);
  });

  it("ignore la casse de la signature hexadécimale", () => {
    const header = `v1:${signPayload(body, CLIENT_SECRET).toUpperCase()}`;
    expect(verifyWebhookSignature(body, header, CLIENT_SECRET)).toBe(true);
  });

  it("rejette une signature calculée avec un autre secret", () => {
    const header = `v1:${signPayload(body, "mauvais-secret")}`;
    expect(verifyWebhookSignature(body, header, CLIENT_SECRET)).toBe(false);
  });

  it("rejette un corps altéré, même d'un seul caractère", () => {
    const header = `v1:${signPayload(body, CLIENT_SECRET)}`;
    const altere = body.replace("payment.success", "payment.succesS");
    expect(verifyWebhookSignature(altere, header, CLIENT_SECRET)).toBe(false);
  });

  it("rejette un en-tête absent", () => {
    expect(verifyWebhookSignature(body, null, CLIENT_SECRET)).toBe(false);
  });

  it("rejette un en-tête vide", () => {
    expect(verifyWebhookSignature(body, "", CLIENT_SECRET)).toBe(false);
  });

  it("rejette un en-tête réduit au préfixe de version", () => {
    expect(verifyWebhookSignature(body, "v1:", CLIENT_SECRET)).toBe(false);
  });

  it("rejette une signature de longueur différente sans lever d'exception", () => {
    expect(verifyWebhookSignature(body, "v1:deadbeef", CLIENT_SECRET)).toBe(false);
  });

  it("rejette une signature non hexadécimale sans lever d'exception", () => {
    expect(verifyWebhookSignature(body, "v1:pas-de-l-hexa!!", CLIENT_SECRET)).toBe(
      false,
    );
  });

  it("rejette quand le secret est vide plutôt que d'accepter aveuglément", () => {
    const header = `v1:${signPayload(body, "")}`;
    expect(verifyWebhookSignature(body, header, "")).toBe(false);
  });
});
