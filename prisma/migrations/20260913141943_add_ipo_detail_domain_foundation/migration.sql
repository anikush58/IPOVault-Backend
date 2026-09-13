-- CreateEnum
CREATE TYPE "OfferCategoryType" AS ENUM ('QIB', 'NII', 'NII_SMALL', 'NII_BIG', 'RETAIL', 'EMPLOYEE', 'SHAREHOLDER', 'OTHER');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('REGISTRAR', 'BRLM', 'CO_BRLM', 'SYNDICATE_MEMBER');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "about_description" TEXT,
ADD COLUMN     "contact_person" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "ipo_offer_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ipo_id" UUID NOT NULL,
    "category" "OfferCategoryType" NOT NULL,
    "allocation_pct" DECIMAL(5,2),
    "min_lots" INTEGER,
    "max_lots" INTEGER,
    "min_shares" INTEGER,
    "max_shares" INTEGER,
    "min_amount" DECIMAL(20,2),
    "max_amount" DECIMAL(20,2),
    "is_upi_eligible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipo_offer_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_financials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "fiscal_period" TEXT NOT NULL,
    "period_type" TEXT NOT NULL DEFAULT 'ANNUAL',
    "total_assets" DECIMAL(20,2),
    "total_revenue" DECIMAL(20,2),
    "pat" DECIMAL(20,2),
    "ebitda" DECIMAL(20,2),
    "net_worth" DECIMAL(20,2),
    "roe_percentage" DECIMAL(6,2),
    "roce_percentage" DECIMAL(6,2),
    "eps" DECIMAL(10,2),
    "pat_margin_percent" DECIMAL(6,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_financials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipo_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ipo_id" UUID NOT NULL,
    "role" "ParticipantRole" NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipo_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gmp_observations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ipo_id" UUID NOT NULL,
    "gmp_amount" DECIMAL(10,2) NOT NULL,
    "gmp_percentage" DECIMAL(6,2),
    "est_profit_per_lot" DECIMAL(12,2),
    "source_id" UUID,
    "source_reference" TEXT,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gmp_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_observations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ipo_id" UUID NOT NULL,
    "category" "OfferCategoryType" NOT NULL,
    "subscription_multiple" DECIMAL(10,4) NOT NULL,
    "shares_bid" DECIMAL(20,0),
    "shares_offered" DECIMAL(20,0),
    "source_id" UUID,
    "source_reference" TEXT,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ipo_offer_categories_ipo_id_idx" ON "ipo_offer_categories"("ipo_id");

-- CreateIndex
CREATE UNIQUE INDEX "ipo_offer_categories_ipo_id_category_key" ON "ipo_offer_categories"("ipo_id", "category");

-- CreateIndex
CREATE INDEX "company_financials_company_id_idx" ON "company_financials"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_financials_company_id_fiscal_period_period_type_key" ON "company_financials"("company_id", "fiscal_period", "period_type");

-- CreateIndex
CREATE INDEX "ipo_participants_ipo_id_role_idx" ON "ipo_participants"("ipo_id", "role");

-- CreateIndex
CREATE INDEX "gmp_observations_ipo_id_observed_at_idx" ON "gmp_observations"("ipo_id", "observed_at");

-- CreateIndex
CREATE INDEX "gmp_observations_source_id_observed_at_idx" ON "gmp_observations"("source_id", "observed_at");

-- CreateIndex
CREATE INDEX "subscription_observations_ipo_id_category_observed_at_idx" ON "subscription_observations"("ipo_id", "category", "observed_at");

-- CreateIndex
CREATE INDEX "subscription_observations_source_id_observed_at_idx" ON "subscription_observations"("source_id", "observed_at");

-- AddForeignKey
ALTER TABLE "ipo_offer_categories" ADD CONSTRAINT "ipo_offer_categories_ipo_id_fkey" FOREIGN KEY ("ipo_id") REFERENCES "ipos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_financials" ADD CONSTRAINT "company_financials_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipo_participants" ADD CONSTRAINT "ipo_participants_ipo_id_fkey" FOREIGN KEY ("ipo_id") REFERENCES "ipos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gmp_observations" ADD CONSTRAINT "gmp_observations_ipo_id_fkey" FOREIGN KEY ("ipo_id") REFERENCES "ipos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gmp_observations" ADD CONSTRAINT "gmp_observations_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_observations" ADD CONSTRAINT "subscription_observations_ipo_id_fkey" FOREIGN KEY ("ipo_id") REFERENCES "ipos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_observations" ADD CONSTRAINT "subscription_observations_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
