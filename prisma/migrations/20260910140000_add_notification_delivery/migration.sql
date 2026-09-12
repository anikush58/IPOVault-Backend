-- Phase 29.4: Add notification_deliveries table for delivery infrastructure
-- Creates DeliveryChannel and DeliveryStatus enums and notification_deliveries table.
-- Safe against existing notification data (no modification of notifications or notification_preferences tables).

-- Create DeliveryChannel enum
CREATE TYPE "DeliveryChannel" AS ENUM (
  'IN_APP',
  'PUSH',
  'EMAIL',
  'SMS'
);

-- Create DeliveryStatus enum
CREATE TYPE "DeliveryStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'DELIVERED',
  'FAILED'
);

-- Create notification_deliveries table
CREATE TABLE "notification_deliveries" (
  "id"                  UUID        NOT NULL DEFAULT gen_random_uuid(),
  "notification_id"     UUID        NOT NULL,
  "channel"             "DeliveryChannel"  NOT NULL,
  "status"              "DeliveryStatus"   NOT NULL DEFAULT 'PENDING',
  "attempt_count"       INTEGER     NOT NULL DEFAULT 0,
  "last_attempt_at"     TIMESTAMPTZ(6),
  "delivered_at"        TIMESTAMPTZ(6),
  "failure_reason"      TEXT,
  "provider_message_id" TEXT,
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- Foreign key to notifications with cascade delete
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_notification_id_fkey"
  FOREIGN KEY ("notification_id")
  REFERENCES "notifications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Logical uniqueness: one delivery record per (notification, channel)
CREATE UNIQUE INDEX "notification_deliveries_notification_id_channel_key"
  ON "notification_deliveries"("notification_id", "channel");

-- Query performance: look up deliveries by notificationId
CREATE INDEX "notification_deliveries_notification_id_idx"
  ON "notification_deliveries"("notification_id");

-- Query performance: look up by status for future batch processing
CREATE INDEX "notification_deliveries_status_idx"
  ON "notification_deliveries"("status");
