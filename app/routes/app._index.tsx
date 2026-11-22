import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Card,
  EmptyState,
  IndexTable,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { lireConfigAffichable } from "../lib/marchand/depot.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const [config, paiements] = await Promise.all([
    lireConfigAffichable(session.shop),
    prisma.djomyPayment.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return json({
    configure: Boolean(config),
    testMode: config?.testMode ?? true,
    paiements: paiements.map((p) => ({
      id: p.id,
      reference: p.merchantPaymentReference,
      montant: p.amount.toString(),
      devise: p.currency,
      statut: p.status,
      methode: p.paymentMethod,
      transaction: p.djomyTransactionId,
      creeLe: p.createdAt.toISOString(),
    })),
  });
}

const TONS: Record<string, "success" | "critical" | "attention" | "info"> = {
  SUCCESS: "success",
  CAPTURED: "success",
  FAILED: "critical",
  CANCELLED: "critical",
  ECART_MONTANT: "critical",
  PENDING: "attention",
  REDIRECTED: "attention",
  EN_ATTENTE_SAISIE: "info",
  CREATED: "info",
};

export default function TableauDeBord() {
  const { configure, testMode, paiements } = useLoaderData<typeof loader>();

  if (!configure) {
    return (
      <Page title="Paiements Djomy">
        <Card>
          <EmptyState
            heading="Configurez vos identifiants Djomy"
            action={{ content: "Ouvrir la configuration", url: "/app/settings" }}
            image=""
          >
            <p>
              Renseignez votre identifiant client et votre clé secrète pour
              commencer à encaisser en mobile money.
            </p>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title="Paiements Djomy"
      titleMetadata={testMode ? <Badge tone="attention">Mode test</Badge> : undefined}
      secondaryActions={[{ content: "Configuration", url: "/app/settings" }]}
    >
      <Layout>
        <Layout.Section>
          <Card padding="0">
            {paiements.length === 0 ? (
              <BlockStack gap="200" inlineAlign="center">
                <Text as="p" tone="subdued">
                  Aucun paiement pour le moment.
                </Text>
              </BlockStack>
            ) : (
              <IndexTable
                selectable={false}
                itemCount={paiements.length}
                resourceName={{ singular: "paiement", plural: "paiements" }}
                headings={[
                  { title: "Référence" },
                  { title: "Montant" },
                  { title: "Statut" },
                  { title: "Méthode" },
                  { title: "Date" },
                ]}
              >
                {paiements.map((paiement, index) => (
                  <IndexTable.Row id={paiement.id} key={paiement.id} position={index}>
                    <IndexTable.Cell>
                      <Link to={`/pay/${paiement.reference}/retour`}>
                        {paiement.reference}
                      </Link>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {paiement.montant} {paiement.devise}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={TONS[paiement.statut] ?? "info"}>
                        {paiement.statut}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{paiement.methode ?? "—"}</IndexTable.Cell>
                    <IndexTable.Cell>
                      {new Date(paiement.creeLe).toLocaleString("fr-FR")}
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
