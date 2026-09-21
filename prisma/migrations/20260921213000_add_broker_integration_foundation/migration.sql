-- CreateEnum
CREATE TYPE "BrokerType" AS ENUM ('UPSTOX', 'DHAN', 'FYERS', 'ZERODHA', 'GROWW', 'MILLIONS', 'SAHI');

-- CreateEnum
CREATE TYPE "BrokerConnectionStatus" AS ENUM ('DISCONNECTED', 'PENDING', 'CONNECTED', 'EXPIRED', 'ERROR');

-- CreateEnum
CREATE TYPE "BrokerTradeSide" AS ENUM ('BUY', 'SELL');

-- AlterTable
ALTER TABLE "ipos" ADD COLUMN     "isin" TEXT,
ADD COLUMN     "nse_symbol" TEXT,
ADD COLUMN     "bse_symbol" TEXT;

-- CreateTable
CREATE TABLE "broker_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "broker" "BrokerType" NOT NULL,
    "account_name" TEXT,
    "client_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broker_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broker_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "broker_account_id" UUID NOT NULL,
    "status" "BrokerConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "connected_at" TIMESTAMPTZ(6),
    "last_sync_at" TIMESTAMPTZ(6),
    "last_error_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broker_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broker_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connection_id" UUID NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT,
    "token_type" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "scopes" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broker_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broker_instruments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "broker" "BrokerType" NOT NULL,
    "isin" TEXT NOT NULL,
    "exchange" "ExchangeListing" NOT NULL,
    "symbol" TEXT,
    "security_id" TEXT,
    "trading_symbol" TEXT,
    "ipo_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broker_instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broker_holdings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "broker_account_id" UUID NOT NULL,
    "instrument_id" UUID NOT NULL,
    "quantity" DECIMAL(20,4) NOT NULL,
    "average_price" DECIMAL(20,4),
    "last_price" DECIMAL(20,4),
    "current_value" DECIMAL(20,4),
    "unrealized_pnl" DECIMAL(20,4),
    "as_of" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broker_holdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broker_trades" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "broker_account_id" UUID NOT NULL,
    "instrument_id" UUID NOT NULL,
    "broker_trade_id" TEXT NOT NULL,
    "side" "BrokerTradeSide" NOT NULL,
    "quantity" DECIMAL(20,4) NOT NULL,
    "price" DECIMAL(20,4) NOT NULL,
    "traded_at" TIMESTAMPTZ(6) NOT NULL,
    "raw_reference" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broker_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipo_investments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "broker_account_id" UUID NOT NULL,
    "ipo_id" UUID NOT NULL,
    "allotted_quantity" DECIMAL(20,4) NOT NULL,
    "allotment_price" DECIMAL(20,4) NOT NULL,
    "allotment_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipo_investments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "broker_accounts_user_id_idx" ON "broker_accounts"("user_id");

-- CreateIndex
CREATE INDEX "broker_accounts_user_id_profile_id_idx" ON "broker_accounts"("user_id", "profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "broker_accounts_user_id_profile_id_broker_key" ON "broker_accounts"("user_id", "profile_id", "broker");

-- CreateIndex
CREATE UNIQUE INDEX "broker_connections_broker_account_id_key" ON "broker_connections"("broker_account_id");

-- CreateIndex
CREATE INDEX "broker_connections_status_idx" ON "broker_connections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "broker_tokens_connection_id_key" ON "broker_tokens"("connection_id");

-- CreateIndex
CREATE INDEX "broker_instruments_isin_idx" ON "broker_instruments"("isin");

-- CreateIndex
CREATE INDEX "broker_instruments_ipo_id_idx" ON "broker_instruments"("ipo_id");

-- CreateIndex
CREATE UNIQUE INDEX "broker_instruments_broker_isin_exchange_key" ON "broker_instruments"("broker", "isin", "exchange");

-- CreateIndex
CREATE INDEX "broker_holdings_broker_account_id_idx" ON "broker_holdings"("broker_account_id");

-- CreateIndex
CREATE INDEX "broker_holdings_instrument_id_idx" ON "broker_holdings"("instrument_id");

-- CreateIndex
CREATE UNIQUE INDEX "broker_holdings_broker_account_id_instrument_id_key" ON "broker_holdings"("broker_account_id", "instrument_id");

-- CreateIndex
CREATE INDEX "broker_trades_broker_account_id_traded_at_idx" ON "broker_trades"("broker_account_id", "traded_at");

-- CreateIndex
CREATE INDEX "broker_trades_instrument_id_traded_at_idx" ON "broker_trades"("instrument_id", "traded_at");

-- CreateIndex
CREATE INDEX "broker_trades_instrument_id_side_idx" ON "broker_trades"("instrument_id", "side");

-- CreateIndex
CREATE UNIQUE INDEX "broker_trades_broker_account_id_broker_trade_id_key" ON "broker_trades"("broker_account_id", "broker_trade_id");

-- CreateIndex
CREATE INDEX "ipo_investments_ipo_id_idx" ON "ipo_investments"("ipo_id");

-- CreateIndex
CREATE INDEX "ipo_investments_broker_account_id_idx" ON "ipo_investments"("broker_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "ipo_investments_broker_account_id_ipo_id_key" ON "ipo_investments"("broker_account_id", "ipo_id");

-- CreateIndex
CREATE INDEX "ipos_isin_idx" ON "ipos"("isin");

-- AddForeignKey
ALTER TABLE "broker_connections" ADD CONSTRAINT "broker_connections_broker_account_id_fkey" FOREIGN KEY ("broker_account_id") REFERENCES "broker_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_tokens" ADD CONSTRAINT "broker_tokens_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "broker_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_instruments" ADD CONSTRAINT "broker_instruments_ipo_id_fkey" FOREIGN KEY ("ipo_id") REFERENCES "ipos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_holdings" ADD CONSTRAINT "broker_holdings_broker_account_id_fkey" FOREIGN KEY ("broker_account_id") REFERENCES "broker_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_holdings" ADD CONSTRAINT "broker_holdings_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "broker_instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_trades" ADD CONSTRAINT "broker_trades_broker_account_id_fkey" FOREIGN KEY ("broker_account_id") REFERENCES "broker_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker_trades" ADD CONSTRAINT "broker_trades_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "broker_instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipo_investments" ADD CONSTRAINT "ipo_investments_broker_account_id_fkey" FOREIGN KEY ("broker_account_id") REFERENCES "broker_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ipo_investments" ADD CONSTRAINT "ipo_investments_ipo_id_fkey" FOREIGN KEY ("ipo_id") REFERENCES "ipos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
