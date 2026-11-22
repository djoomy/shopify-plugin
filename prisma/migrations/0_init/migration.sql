-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DjomyCredential" (
    "shop" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretChiffre" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL DEFAULT 'https://sandbox-api.djomy.africa',
    "countryCode" TEXT NOT NULL DEFAULT 'GN',
    "methodesAutorisees" TEXT NOT NULL DEFAULT 'OM,MOMO,KULU,CARD',
    "testMode" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DjomyCredential_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "DjomyPayment" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "shopifyOrderId" TEXT,
    "shopifySessionGid" TEXT,
    "merchantPaymentReference" TEXT NOT NULL,
    "djomyTransactionId" TEXT,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "djomyCurrency" TEXT NOT NULL,
    "paymentMethod" TEXT,
    "payerNumberChiffre" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "lastEventId" TEXT,
    "redirectUrl" TEXT,
    "echecRaison" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DjomyPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DjomyWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "paiementId" TEXT,
    "corpsBrut" TEXT NOT NULL,
    "traiteA" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DjomyWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DjomyPayment_shopifySessionGid_key" ON "DjomyPayment"("shopifySessionGid");

-- CreateIndex
CREATE UNIQUE INDEX "DjomyPayment_merchantPaymentReference_key" ON "DjomyPayment"("merchantPaymentReference");

-- CreateIndex
CREATE UNIQUE INDEX "DjomyPayment_djomyTransactionId_key" ON "DjomyPayment"("djomyTransactionId");

-- CreateIndex
CREATE INDEX "DjomyPayment_shop_status_idx" ON "DjomyPayment"("shop", "status");

-- CreateIndex
CREATE INDEX "DjomyPayment_shop_createdAt_idx" ON "DjomyPayment"("shop", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DjomyWebhookEvent_eventId_key" ON "DjomyWebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "DjomyWebhookEvent_eventType_createdAt_idx" ON "DjomyWebhookEvent"("eventType", "createdAt");

-- AddForeignKey
ALTER TABLE "DjomyWebhookEvent" ADD CONSTRAINT "DjomyWebhookEvent_paiementId_fkey" FOREIGN KEY ("paiementId") REFERENCES "DjomyPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

