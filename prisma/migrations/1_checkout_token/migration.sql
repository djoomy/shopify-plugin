-- AlterTable
ALTER TABLE "DjomyPayment" ADD COLUMN     "shopifyCheckoutToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DjomyPayment_shopifyCheckoutToken_key" ON "DjomyPayment"("shopifyCheckoutToken");

