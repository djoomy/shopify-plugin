import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  ChoiceList,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { DjomyClient } from "../lib/djomy/client";
import { METHODES_PORTAIL, type MethodePortail } from "../lib/djomy/types";
import { paysSupportes } from "../lib/phone";
import {
  ConfigInvalideError,
  LIBELLES_METHODES,
  METHODES_PAR_DEFAUT,
  URL_SANDBOX,
  validerConfig,
} from "../lib/marchand/config";
import {
  enregistrerConfig,
  lireConfigAffichable,
  lireSecretExistant,
} from "../lib/marchand/depot.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const config = await lireConfigAffichable(session.shop);

  return json({
    shop: session.shop,
    config,
    urlWebhook: `${process.env.SHOPIFY_APP_URL ?? ""}/webhooks/djomy/${session.shop}`,
    methodes: METHODES_PORTAIL.map((code) => ({
      value: code,
      label: LIBELLES_METHODES[code],
    })),
    pays: paysSupportes().map((code) => ({ value: code, label: code })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const donnees = await request.formData();
  const intention = String(donnees.get("intention") ?? "enregistrer");

  const saisie = {
    clientId: donnees.get("clientId"),
    clientSecret: donnees.get("clientSecret"),
    baseUrl: donnees.get("baseUrl"),
    countryCode: donnees.get("countryCode"),
    methodesAutorisees: donnees.getAll("methodesAutorisees"),
    testMode: donnees.get("testMode"),
  };

  let config;
  try {
    config = validerConfig(saisie, await lireSecretExistant(session.shop));
  } catch (erreur) {
    if (erreur instanceof ConfigInvalideError) {
      return json({ statut: "invalide" as const, champs: erreur.champs }, { status: 400 });
    }
    throw erreur;
  }

  if (intention === "tester") {
    // Le test ne consulte que l'authentification : il n'engage aucun paiement.
    try {
      const client = new DjomyClient({
        baseUrl: config.baseUrl,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        maxTentatives: 1,
      });
      await client.authenticate(true);
      return json({ statut: "connexion-ok" as const });
    } catch (erreur) {
      return json({
        statut: "connexion-echec" as const,
        message: messageLisible(erreur),
      });
    }
  }

  await enregistrerConfig(session.shop, config);
  return json({ statut: "enregistre" as const });
}

function messageLisible(erreur: unknown): string {
  if (erreur && typeof erreur === "object" && "message" in erreur) {
    return String((erreur as Error).message);
  }
  return "Connexion à Djomy impossible.";
}

export default function Configuration() {
  const { config, methodes, pays, urlWebhook } = useLoaderData<typeof loader>();
  const resultat = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const enCours = navigation.state === "submitting";

  const [clientId, setClientId] = useState(config?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [methodesChoisies, setMethodesChoisies] = useState<string[]>(
    config?.methodesAutorisees ?? METHODES_PAR_DEFAUT,
  );
  const [testMode, setTestMode] = useState(config?.testMode ?? true);
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? URL_SANDBOX);
  const [countryCode, setCountryCode] = useState(config?.countryCode ?? "GN");

  const champs = resultat?.statut === "invalide" ? resultat.champs : {};

  /**
   * Polaris n'expose pas `name` sur ses boutons : l'intention est ajoutée au
   * moment de la soumission plutôt que portée par le bouton lui-même.
   */
  function soumettre(intention: "enregistrer" | "tester") {
    const donnees = new FormData();
    donnees.set("intention", intention);
    donnees.set("clientId", clientId);
    donnees.set("clientSecret", clientSecret);
    donnees.set("baseUrl", baseUrl);
    donnees.set("countryCode", countryCode);
    if (testMode) donnees.set("testMode", "true");
    for (const methode of methodesChoisies) {
      donnees.append("methodesAutorisees", methode);
    }
    submit(donnees, { method: "post" });
  }

  return (
    <Page title="Configuration Djomy">
      <Layout>
        <Layout.Section>
          {resultat?.statut === "enregistre" && (
            <Box paddingBlockEnd="400">
              <Banner tone="success" title="Configuration enregistrée" />
            </Box>
          )}
          {resultat?.statut === "connexion-ok" && (
            <Box paddingBlockEnd="400">
              <Banner tone="success" title="Connexion à Djomy établie">
                <p>Les identifiants sont valides. Vous pouvez enregistrer.</p>
              </Banner>
            </Box>
          )}
          {resultat?.statut === "connexion-echec" && (
            <Box paddingBlockEnd="400">
              <Banner tone="critical" title="Connexion à Djomy impossible">
                <p>{resultat.message}</p>
              </Banner>
            </Box>
          )}

          <Card>
            <Form method="post">
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Identifiants
                </Text>

                <TextField
                  label="Identifiant client (clientId)"
                  name="clientId"
                  autoComplete="off"
                  value={clientId}
                  onChange={setClientId}
                  error={champs.clientId}
                  helpText="Fourni dans l'espace développeur de votre compte marchand Djomy."
                />

                <TextField
                  label="Clé secrète (clientSecret)"
                  name="clientSecret"
                  type="password"
                  autoComplete="off"
                  value={clientSecret}
                  onChange={setClientSecret}
                  error={champs.clientSecret}
                  helpText={
                    config?.secretEnregistre
                      ? "Une clé est déjà enregistrée. Laissez vide pour la conserver."
                      : "La clé est chiffrée avant enregistrement et n'est jamais réaffichée."
                  }
                />

                <TextField
                  label="URL de l'API Djomy"
                  name="baseUrl"
                  autoComplete="off"
                  value={baseUrl}
                  onChange={setBaseUrl}
                  error={champs.baseUrl}
                  helpText="Bac à sable par défaut. L'URL de production est à obtenir auprès de Djomy."
                />

                <Select
                  label="Pays"
                  name="countryCode"
                  options={pays}
                  value={countryCode}
                  onChange={setCountryCode}
                  error={champs.countryCode}
                />

                <ChoiceList
                  allowMultiple
                  title="Méthodes proposées sur le portail Djomy"
                  name="methodesAutorisees"
                  choices={methodes}
                  selected={methodesChoisies}
                  onChange={setMethodesChoisies}
                  error={champs.methodesAutorisees}
                />
                {methodesChoisies.map((code) => (
                  <input
                    key={code}
                    type="hidden"
                    name="methodesAutorisees"
                    value={code}
                  />
                ))}

                <Checkbox
                  label="Mode test"
                  name="testMode"
                  checked={testMode}
                  onChange={setTestMode}
                  helpText="À décocher uniquement une fois la recette terminée."
                />
                {testMode && <input type="hidden" name="testMode" value="true" />}

                <InlineStack gap="300">
                  <Button
                    variant="primary"
                    loading={enCours}
                    onClick={() => soumettre("enregistrer")}
                  >
                    Enregistrer
                  </Button>
                  <Button loading={enCours} onClick={() => soumettre("tester")}>
                    Tester la connexion
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                URL de webhook
              </Text>
              <Text as="p" tone="subdued">
                Renseignez cette adresse dans l'espace développeur Djomy pour
                recevoir les changements de statut.
              </Text>
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <Text as="p" breakWord>
                  <code>{urlWebhook}</code>
                </Text>
              </Box>
              <InlineStack gap="200">
                <Text as="span">Version attendue :</Text>
                <Badge>V2</Badge>
              </InlineStack>
              <Text as="p" tone="subdued">
                Les payloads V1 restent acceptés.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
