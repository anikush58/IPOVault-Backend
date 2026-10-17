-- AlterTable
ALTER TABLE "consumed_deletion_tokens"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "user_id" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "last_error" TEXT,
  ADD COLUMN "completed_at" TIMESTAMPTZ(6),
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "consumed_deletion_tokens_status_idx" ON "consumed_deletion_tokens"("status");
