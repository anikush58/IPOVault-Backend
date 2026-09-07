-- CreateEnum
CREATE TYPE "AllotmentIdentifierType" AS ENUM ('PAN', 'APPLICATION_NUMBER', 'DP_CLIENT_ID');

-- CreateEnum
CREATE TYPE "AllotmentResultStatus" AS ENUM ('ALLOTTED', 'PARTIALLY_ALLOTTED', 'NOT_ALLOTTED', 'NOT_YET_AVAILABLE', 'APPLICATION_NOT_FOUND', 'INVALID_IDENTIFIER', 'IPO_NOT_FOUND', 'REGISTRAR_UNRESOLVED', 'REGISTRAR_UNSUPPORTED', 'UNSUPPORTED_IDENTIFIER', 'SOURCE_UNAVAILABLE', 'SOURCE_RESPONSE_INVALID', 'CAPTCHA_REQUIRED', 'RATE_LIMITED', 'CONFLICTING_RESULTS', 'TEMPORARY_ERROR', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AllotmentJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "allotment_check_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT,
    "ipo_id" UUID NOT NULL,
    "status" "AllotmentJobStatus" NOT NULL DEFAULT 'QUEUED',
    "total_checks" INTEGER NOT NULL DEFAULT 0,
    "processed_checks" INTEGER NOT NULL DEFAULT 0,
    "successful_checks" INTEGER NOT NULL DEFAULT 0,
    "failed_checks" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "allotment_check_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allotment_check_job_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "identifier_type" "AllotmentIdentifierType" NOT NULL,
    "identifier_hash" TEXT NOT NULL,
    "masked_id" TEXT NOT NULL,
    "status" "AllotmentResultStatus" NOT NULL DEFAULT 'UNKNOWN',
    "shares_applied" INTEGER,
    "shares_allotted" INTEGER,
    "latency_ms" INTEGER,
    "error_message" TEXT,
    "checked_at" TIMESTAMPTZ(6),

    CONSTRAINT "allotment_check_job_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_saved_pans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "pan_encrypted" TEXT NOT NULL,
    "pan_masked" TEXT NOT NULL,
    "pan_hash" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_saved_pans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "allotment_check_jobs_user_id_idx" ON "allotment_check_jobs"("user_id");
CREATE INDEX "allotment_check_jobs_ipo_id_idx" ON "allotment_check_jobs"("ipo_id");
CREATE INDEX "allotment_check_jobs_status_idx" ON "allotment_check_jobs"("status");

-- CreateIndex
CREATE INDEX "allotment_check_job_items_job_id_idx" ON "allotment_check_job_items"("job_id");
CREATE INDEX "allotment_check_job_items_identifier_hash_idx" ON "allotment_check_job_items"("identifier_hash");

-- CreateIndex
CREATE INDEX "user_saved_pans_user_id_idx" ON "user_saved_pans"("user_id");
CREATE INDEX "user_saved_pans_pan_hash_idx" ON "user_saved_pans"("pan_hash");

-- AddForeignKey
ALTER TABLE "allotment_check_jobs" ADD CONSTRAINT "allotment_check_jobs_ipo_id_fkey" FOREIGN KEY ("ipo_id") REFERENCES "ipos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allotment_check_job_items" ADD CONSTRAINT "allotment_check_job_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "allotment_check_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
