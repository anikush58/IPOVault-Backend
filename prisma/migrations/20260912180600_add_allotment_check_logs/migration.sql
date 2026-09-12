-- CreateTable
CREATE TABLE "allotment_check_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ipo_id" UUID NOT NULL,
    "source_id" UUID,
    "identifier_type" "AllotmentIdentifierType" NOT NULL,
    "identifier_hash" TEXT NOT NULL,
    "masked_id" TEXT NOT NULL,
    "status" "AllotmentResultStatus" NOT NULL,
    "shares_applied" INTEGER,
    "shares_allotted" INTEGER,
    "latency_ms" INTEGER,
    "error_message" TEXT,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allotment_check_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "allotment_check_logs_ipo_id_identifier_hash_idx" ON "allotment_check_logs"("ipo_id", "identifier_hash");

-- CreateIndex
CREATE INDEX "allotment_check_logs_checked_at_idx" ON "allotment_check_logs"("checked_at");

-- AddForeignKey
ALTER TABLE "allotment_check_logs" ADD CONSTRAINT "allotment_check_logs_ipo_id_fkey" FOREIGN KEY ("ipo_id") REFERENCES "ipos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allotment_check_logs" ADD CONSTRAINT "allotment_check_logs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
