-- CreateTable
CREATE TABLE "consumed_deletion_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jti_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumed_deletion_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consumed_deletion_tokens_jti_hash_key" ON "consumed_deletion_tokens"("jti_hash");

-- CreateIndex
CREATE INDEX "consumed_deletion_tokens_expires_at_idx" ON "consumed_deletion_tokens"("expires_at");
