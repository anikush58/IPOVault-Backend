-- CreateEnum
CREATE TYPE "UserAccessTier" AS ENUM ('NON_PRO', 'PRO');

-- CreateTable
CREATE TABLE "user_entitlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "tier" "UserAccessTier" NOT NULL DEFAULT 'NON_PRO',
    "granted_by" TEXT,
    "granted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_entitlement_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entitlement_id" UUID,
    "user_id" TEXT NOT NULL,
    "previous_tier" "UserAccessTier" NOT NULL,
    "new_tier" "UserAccessTier" NOT NULL,
    "changed_by" TEXT NOT NULL,
    "reason" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_entitlement_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_entitlements_user_id_key" ON "user_entitlements"("user_id");

-- CreateIndex
CREATE INDEX "user_entitlements_user_id_idx" ON "user_entitlements"("user_id");

-- CreateIndex
CREATE INDEX "user_entitlements_tier_idx" ON "user_entitlements"("tier");

-- CreateIndex
CREATE INDEX "user_entitlement_audit_logs_user_id_idx" ON "user_entitlement_audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "user_entitlement_audit_logs_created_at_idx" ON "user_entitlement_audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "user_entitlement_audit_logs" ADD CONSTRAINT "user_entitlement_audit_logs_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "user_entitlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
