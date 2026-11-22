#!/usr/bin/env node
/**
 * Serveur de capture des webhooks Djomy.
 *
 * Objectif : lever le point D8 — quelle chaîne exacte Djomy signe-t-il pour
 * produire l'en-tête `X-Webhook-Signature` ?
 *
 * Le serveur enregistre la requête brute, puis confronte la signature reçue à
 * une série d'hypothèses. Celle qui correspond nous donne la règle.
 *
 * Usage : node verification/capture-webhook.mjs [port]
 */

import { createHmac, createHash } from "node:crypto";
import { createServer } from "node:http";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const DOSSIER = join(ICI, "captures");
const PORT = Number(process.argv[2] ?? 3000);

try {
  process.loadEnvFile(join(ICI, "..", ".env"));
} catch {
  // .env absent : on se rabat sur l'environnement du processus.
}

const CLIENT_ID = process.env.DJOMY_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.DJOMY_CLIENT_SECRET ?? "";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("DJOMY_CLIENT_ID et DJOMY_CLIENT_SECRET sont requis.");
  process.exit(1);
}

mkdirSync(DOSSIER, { recursive: true });

const hmacHex = (message, cle) =>
  createHmac("sha256", cle).update(message, "utf8").digest("hex");
const hmacB64 = (message, cle) =>
  createHmac("sha256", cle).update(message, "utf8").digest("base64");

/**
 * Hypothèses sur la chaîne signée et l'encodage.
 * L'implémentation actuelle retient « corps brut, clé = clientSecret, hex ».
 */
function hypotheses(corpsBrut, entetes) {
  const timestamp = entetes["x-webhook-timestamp"] ?? "";
  let eventId = "";
  let eventType = "";
  let reserialise = "";

  try {
    const objet = JSON.parse(corpsBrut);
    eventId = objet.eventId ?? "";
    eventType = objet.eventType ?? "";
    reserialise = JSON.stringify(objet);
  } catch {
    // Corps non JSON : les hypothèses qui en dépendent resteront vides.
  }

  return [
    ["corps brut, clé=clientSecret, hex  ← implémentation actuelle", hmacHex(corpsBrut, CLIENT_SECRET)],
    ["corps brut, clé=clientSecret, base64", hmacB64(corpsBrut, CLIENT_SECRET)],
    ["corps brut, clé=clientId, hex", hmacHex(corpsBrut, CLIENT_ID)],
    ["clientId+corps, clé=clientSecret, hex", hmacHex(CLIENT_ID + corpsBrut, CLIENT_SECRET)],
    ["corps re-sérialisé, clé=clientSecret, hex", reserialise ? hmacHex(reserialise, CLIENT_SECRET) : ""],
    ["timestamp+corps, clé=clientSecret, hex", timestamp ? hmacHex(timestamp + corpsBrut, CLIENT_SECRET) : ""],
    ["timestamp.corps, clé=clientSecret, hex", timestamp ? hmacHex(`${timestamp}.${corpsBrut}`, CLIENT_SECRET) : ""],
    ["eventId, clé=clientSecret, hex", eventId ? hmacHex(eventId, CLIENT_SECRET) : ""],
    ["eventId+corps, clé=clientSecret, hex", eventId ? hmacHex(eventId + corpsBrut, CLIENT_SECRET) : ""],
    ["eventType, clé=clientSecret, hex", eventType ? hmacHex(eventType, CLIENT_SECRET) : ""],
    ["clientId, clé=clientSecret, hex (comme X-API-KEY)", hmacHex(CLIENT_ID, CLIENT_SECRET)],
    ["sha256(corps+clientSecret)", createHash("sha256").update(corpsBrut + CLIENT_SECRET, "utf8").digest("hex")],
    ["sha256(clientSecret+corps)", createHash("sha256").update(CLIENT_SECRET + corpsBrut, "utf8").digest("hex")],
  ];
}

let compteur = 0;

const serveur = createServer((requete, reponse) => {
  const morceaux = [];
  requete.on("data", (m) => morceaux.push(m));

  requete.on("end", () => {
    const corpsBrut = Buffer.concat(morceaux).toString("utf8");
    const entetes = requete.headers;

    if (requete.method !== "POST") {
      reponse.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      reponse.end(
        "Serveur de capture des webhooks Djomy.\n" +
          "En attente d'une requête POST sur cette adresse.\n",
      );
      return;
    }

    compteur++;
    const horodatage = new Date().toISOString();
    const nom = join(DOSSIER, `webhook-${compteur}-${Date.now()}.json`);

    const signatureBrute =
      entetes["x-webhook-signature"] ?? entetes["X-Webhook-Signature"] ?? null;
    const signatureRecue = signatureBrute
      ? String(signatureBrute).trim().split(":").pop().trim().toLowerCase()
      : null;

    const essais = hypotheses(corpsBrut, entetes);
    const correspondance = signatureRecue
      ? essais.find(([, valeur]) => valeur && valeur.toLowerCase() === signatureRecue)
      : null;

    console.log(`\n${"═".repeat(78)}`);
    console.log(`WEBHOOK #${compteur} — ${horodatage}`);
    console.log("═".repeat(78));
    console.log(`\nURL      : ${requete.url}`);
    console.log("\nEN-TÊTES :");
    for (const [cle, valeur] of Object.entries(entetes)) {
      console.log(`  ${cle}: ${valeur}`);
    }

    console.log("\nCORPS BRUT :");
    console.log(corpsBrut);

    console.log("\nSIGNATURE :");
    console.log(`  en-tête reçu : ${signatureBrute ?? "(absent)"}`);
    console.log(`  partie signature : ${signatureRecue ?? "(absente)"}`);

    console.log("\nHYPOTHÈSES TESTÉES :");
    for (const [libelle, valeur] of essais) {
      if (!valeur) {
        console.log(`  ·  ${libelle} : (non applicable)`);
        continue;
      }
      const ok = signatureRecue && valeur.toLowerCase() === signatureRecue;
      console.log(`  ${ok ? "✅" : "  "} ${libelle}`);
      console.log(`     ${valeur.slice(0, 64)}`);
    }

    console.log("\nCONCLUSION :");
    if (correspondance) {
      console.log(`  ✅ Formule identifiée : ${correspondance[0]}`);
    } else if (!signatureRecue) {
      console.log("  ⚠ Aucune signature dans les en-têtes. Vérifier le nom de l'en-tête.");
    } else {
      console.log("  ❌ Aucune hypothèse ne correspond. Transmettre cette capture à Djomy.");
    }

    writeFileSync(
      nom,
      JSON.stringify(
        {
          horodatage,
          url: requete.url,
          methode: requete.method,
          entetes,
          corpsBrut,
          signatureRecue,
          formuleIdentifiee: correspondance ? correspondance[0] : null,
          hypotheses: essais.map(([libelle, valeur]) => ({ libelle, valeur })),
        },
        null,
        2,
      ),
    );
    console.log(`\n  Capture enregistrée : ${nom}`);

    appendFileSync(
      join(DOSSIER, "journal.txt"),
      `${horodatage} · #${compteur} · ${correspondance ? correspondance[0] : "NON IDENTIFIÉE"}\n`,
    );

    // Toujours répondre 200 : Djomy ne doit pas réémettre pendant le diagnostic.
    reponse.writeHead(200, { "Content-Type": "application/json" });
    reponse.end(JSON.stringify({ recu: true }));
  });
});

serveur.listen(PORT, () => {
  console.log("═".repeat(78));
  console.log("  Serveur de capture des webhooks Djomy");
  console.log("═".repeat(78));
  console.log(`  Port         : ${PORT}`);
  console.log(`  Client Djomy : ${CLIENT_ID}`);
  console.log(`  Captures     : ${DOSSIER}`);
  console.log("\n  En attente d'un webhook. Ctrl+C pour arrêter.\n");
});
