-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('DRHP', 'RHP', 'PROSPECTUS', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentParsingStatus" AS ENUM ('PENDING', 'PARSED', 'FAILED');

-- AlterTable
ALTER TABLE "ipos" ADD COLUMN     "publication_status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "ipo_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ipo_id" UUID,
    "document_type" "DocumentType" NOT NULL,
    "source_url" TEXT,
    "file_path" TEXT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "file_size_bytes" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'MANUAL_UPLOAD',
    "parsing_status" "DocumentParsingStatus" NOT NULL DEFAULT 'PENDING',
    "parser_version" TEXT,
    "extraction_data" JSONB,
    "error_message" TEXT,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipo_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipo_allotment_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ipo_id" UUID NOT NULL,
    "registrar" TEXT NOT NULL,
    "registrar_ipo_code" TEXT,
    "allotment_source_url" TEXT,
    "expected_allotment_date" DATE,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipo_allotment_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ipo_documents_ipo_id_idx" ON "ipo_documents"("ipo_id");

-- CreateIndex
CREATE UNIQUE INDEX "ipo_allotment_configs_ipo_id_key" ON "ipo_allotment_configs"("ipo_id");

-- CreateIndex
CREATE INDEX "ipos_publication_status_idx" ON "ipos"("publication_status");

-- AddForeignKey
ALTER TABLE "ipo_documents" ADD CONSTRAINT "ipo_documents_ipo_id_fkey" FOREIGN KEY ("ipo_id") REFERENCES "ipos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipo_allotment_configs" ADD CONSTRAINT "ipo_allotment_configs_ipo_id_fkey" FOREIGN KEY ("ipo_id") REFERENCES "ipos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
