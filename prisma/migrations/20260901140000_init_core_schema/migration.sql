-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MarketSegment" AS ENUM ('MAINBOARD', 'SME');

-- CreateEnum
CREATE TYPE "ExchangeListing" AS ENUM ('NSE', 'BSE', 'BOTH');

-- CreateEnum
CREATE TYPE "IpoStatus" AS ENUM ('DRAFT', 'UPCOMING', 'OPEN', 'CLOSED', 'ALLOTMENT_PENDING', 'ALLOTMENT_COMPLETED', 'LISTING_PENDING', 'LISTED', 'WITHDRAWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LifecycleEventType" AS ENUM ('DRHP', 'RHP', 'ANCHOR', 'OPEN', 'CLOSE', 'BASIS_OF_ALLOTMENT', 'REFUND_INITIATION', 'DEMAT_CREDIT', 'LISTING');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('OFFICIAL_FILING', 'EXCHANGE', 'REGISTRAR', 'COMPANY', 'SECONDARY', 'MARKET_SIGNAL');

-- CreateEnum
CREATE TYPE "SourceHealthStatus" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'FAILING', 'DISABLED');

-- CreateEnum
CREATE TYPE "DiscoveryStatus" AS ENUM ('NEW', 'PROCESSING', 'MATCHED', 'CREATED', 'DUPLICATE', 'REJECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "ProvenanceEntityType" AS ENUM ('COMPANY', 'IPO');

-- CreateEnum
CREATE TYPE "IpoChangeType" AS ENUM ('PRICE_BAND_CHANGED', 'LOT_SIZE_CHANGED', 'OPEN_DATE_CHANGED', 'CLOSE_DATE_CHANGED', 'LISTING_DATE_CHANGED', 'STATUS_CHANGED', 'ISSUE_SIZE_CHANGED', 'FIELD_CHANGED');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legal_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "cin" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "sector" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "market_segment" "MarketSegment" NOT NULL,
    "exchange" "ExchangeListing" NOT NULL,
    "status" "IpoStatus" NOT NULL DEFAULT 'DRAFT',
    "symbol" TEXT,
    "issue_size" DECIMAL(20,2),
    "fresh_issue_size" DECIMAL(20,2),
    "ofs_size" DECIMAL(20,2),
    "face_value" DECIMAL(20,2),
    "price_band_low" DECIMAL(20,2),
    "price_band_high" DECIMAL(20,2),
    "lot_size" INTEGER,
    "minimum_lots" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipo_lifecycle_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ipo_id" UUID NOT NULL,
    "event_type" "LifecycleEventType" NOT NULL,
    "event_date" DATE NOT NULL,
    "source_id" UUID,
    "source_reference" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipo_lifecycle_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source_type" "SourceType" NOT NULL,
    "base_url" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "parser_type" TEXT,
    "parser_version" TEXT,
    "rate_limit_policy" JSONB,
    "authentication_required" BOOLEAN NOT NULL DEFAULT false,
    "health_status" "SourceHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "last_success_at" TIMESTAMPTZ(6),
    "last_failure_at" TIMESTAMPTZ(6),
    "last_checked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipo_source_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ipo_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "external_id" TEXT,
    "symbol" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipo_source_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_id" UUID NOT NULL,
    "external_id" TEXT,
    "source_reference" TEXT,
    "company_name" TEXT,
    "raw_payload" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "discovered_at" TIMESTAMPTZ(6) NOT NULL,
    "processed_at" TIMESTAMPTZ(6),
    "status" "DiscoveryStatus" NOT NULL DEFAULT 'NEW',
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_provenance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_type" "ProvenanceEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "field_name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "source_reference" TEXT,
    "retrieved_at" TIMESTAMPTZ(6) NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL DEFAULT 1.000,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_provenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipo_change_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ipo_id" UUID NOT NULL,
    "field_name" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "source_id" UUID,
    "source_reference" TEXT,
    "detected_at" TIMESTAMPTZ(6) NOT NULL,
    "change_type" "IpoChangeType" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipo_change_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_cin_key" ON "companies"("cin");

-- CreateIndex
CREATE INDEX "ipos_company_id_idx" ON "ipos"("company_id");

-- CreateIndex
CREATE INDEX "ipos_status_idx" ON "ipos"("status");

-- CreateIndex
CREATE INDEX "ipos_symbol_idx" ON "ipos"("symbol");

-- CreateIndex
CREATE INDEX "ipo_lifecycle_events_event_type_event_date_idx" ON "ipo_lifecycle_events"("event_type", "event_date");

-- CreateIndex
CREATE UNIQUE INDEX "ipo_lifecycle_events_ipo_id_event_type_key" ON "ipo_lifecycle_events"("ipo_id", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "sources_code_key" ON "sources"("code");

-- CreateIndex
CREATE INDEX "sources_enabled_idx" ON "sources"("enabled");

-- CreateIndex
CREATE INDEX "sources_source_type_idx" ON "sources"("source_type");

-- CreateIndex
CREATE UNIQUE INDEX "ipo_source_identities_ipo_id_source_id_key" ON "ipo_source_identities"("ipo_id", "source_id");

-- CreateIndex
CREATE INDEX "discovery_records_status_idx" ON "discovery_records"("status");

-- CreateIndex
CREATE INDEX "discovery_records_source_id_external_id_idx" ON "discovery_records"("source_id", "external_id");

-- CreateIndex
CREATE INDEX "discovery_records_content_hash_idx" ON "discovery_records"("content_hash");

-- CreateIndex
CREATE INDEX "field_provenance_entity_type_entity_id_field_name_idx" ON "field_provenance"("entity_type", "entity_id", "field_name");

-- CreateIndex
CREATE INDEX "field_provenance_source_id_retrieved_at_idx" ON "field_provenance"("source_id", "retrieved_at");

-- CreateIndex
CREATE INDEX "ipo_change_events_ipo_id_detected_at_idx" ON "ipo_change_events"("ipo_id", "detected_at");

-- AddForeignKey
ALTER TABLE "ipos" ADD CONSTRAINT "ipos_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipo_lifecycle_events" ADD CONSTRAINT "ipo_lifecycle_events_ipo_id_fkey" FOREIGN KEY ("ipo_id") REFERENCES "ipos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipo_lifecycle_events" ADD CONSTRAINT "ipo_lifecycle_events_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipo_source_identities" ADD CONSTRAINT "ipo_source_identities_ipo_id_fkey" FOREIGN KEY ("ipo_id") REFERENCES "ipos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipo_source_identities" ADD CONSTRAINT "ipo_source_identities_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_records" ADD CONSTRAINT "discovery_records_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_provenance" ADD CONSTRAINT "field_provenance_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipo_change_events" ADD CONSTRAINT "ipo_change_events_ipo_id_fkey" FOREIGN KEY ("ipo_id") REFERENCES "ipos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipo_change_events" ADD CONSTRAINT "ipo_change_events_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
