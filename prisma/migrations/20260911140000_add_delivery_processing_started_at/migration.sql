-- AlterTable
ALTER TABLE "notification_deliveries" ADD COLUMN "processing_started_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "notification_deliveries_status_processing_started_at_idx" ON "notification_deliveries"("status", "processing_started_at");
