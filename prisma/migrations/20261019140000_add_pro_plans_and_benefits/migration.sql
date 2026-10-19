-- CreateTable
CREATE TABLE "pro_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "duration" TEXT NOT NULL,
    "duration_days" INTEGER,
    "price_inr" DECIMAL(10,2) NOT NULL,
    "comparison_price_inr" DECIMAL(10,2),
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_popular" BOOLEAN NOT NULL DEFAULT false,
    "badge" TEXT,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "pro_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pro_plan_benefits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pro_plan_benefits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pro_plans_code_key" ON "pro_plans"("code");

-- CreateIndex
CREATE INDEX "pro_plans_status_idx" ON "pro_plans"("status");

-- CreateIndex
CREATE INDEX "pro_plans_display_order_idx" ON "pro_plans"("display_order");

-- CreateIndex
CREATE INDEX "pro_plan_benefits_plan_id_display_order_idx" ON "pro_plan_benefits"("plan_id", "display_order");

-- AddForeignKey
ALTER TABLE "pro_plan_benefits" ADD CONSTRAINT "pro_plan_benefits_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "pro_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
