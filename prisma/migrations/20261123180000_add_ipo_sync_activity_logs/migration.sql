-- CreateEnum
CREATE TYPE "SyncTriggerType" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "SyncItemAction" AS ENUM ('ADDED', 'UPDATED', 'FAILED');

-- CreateTable
CREATE TABLE "ipo_sync_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" TEXT NOT NULL DEFAULT 'IPOGURU',
    "trigger" "SyncTriggerType" NOT NULL,
    "slot" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "total_fetched" INTEGER NOT NULL,
    "inserted_count" INTEGER NOT NULL,
    "updated_count" INTEGER NOT NULL,
    "unchanged_count" INTEGER NOT NULL,
    "failed_count" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipo_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipo_sync_log_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "ipo_id" UUID,
    "ipo_name" TEXT NOT NULL,
    "external_slug" TEXT,
    "action" "SyncItemAction" NOT NULL,
    "changes" JSONB,
    "error_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipo_sync_log_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ipo_sync_runs_source_started_at_idx" ON "ipo_sync_runs"("source", "started_at" DESC);

-- CreateIndex
CREATE INDEX "ipo_sync_runs_trigger_started_at_idx" ON "ipo_sync_runs"("trigger", "started_at" DESC);

-- CreateIndex
CREATE INDEX "ipo_sync_runs_started_at_idx" ON "ipo_sync_runs"("started_at" DESC);

-- CreateIndex
CREATE INDEX "ipo_sync_log_items_run_id_action_idx" ON "ipo_sync_log_items"("run_id", "action");

-- CreateIndex
CREATE INDEX "ipo_sync_log_items_ipo_name_idx" ON "ipo_sync_log_items"("ipo_name");

-- CreateIndex
CREATE INDEX "ipo_sync_log_items_ipo_id_idx" ON "ipo_sync_log_items"("ipo_id");

-- AddForeignKey
ALTER TABLE "ipo_sync_log_items" ADD CONSTRAINT "ipo_sync_log_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ipo_sync_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
