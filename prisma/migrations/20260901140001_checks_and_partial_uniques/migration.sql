-- Partial unique indexes Prisma cannot express, plus CHECK constraints.

CREATE UNIQUE INDEX "ipo_source_identities_source_id_external_id_key"
ON "ipo_source_identities" ("source_id", "external_id")
WHERE "external_id" IS NOT NULL;

CREATE UNIQUE INDEX "discovery_records_source_id_external_id_content_hash_key"
ON "discovery_records" ("source_id", "external_id", "content_hash")
WHERE "external_id" IS NOT NULL;

CREATE UNIQUE INDEX "discovery_records_source_id_content_hash_null_external_id_key"
ON "discovery_records" ("source_id", "content_hash")
WHERE "external_id" IS NULL;

ALTER TABLE "ipos"
  ADD CONSTRAINT "ipos_lot_size_positive_chk"
    CHECK ("lot_size" IS NULL OR "lot_size" > 0),
  ADD CONSTRAINT "ipos_minimum_lots_positive_chk"
    CHECK ("minimum_lots" IS NULL OR "minimum_lots" > 0),
  ADD CONSTRAINT "ipos_price_band_order_chk"
    CHECK (
      "price_band_low" IS NULL
      OR "price_band_high" IS NULL
      OR "price_band_low" <= "price_band_high"
    ),
  ADD CONSTRAINT "ipos_price_band_low_positive_chk"
    CHECK ("price_band_low" IS NULL OR "price_band_low" > 0),
  ADD CONSTRAINT "ipos_price_band_high_positive_chk"
    CHECK ("price_band_high" IS NULL OR "price_band_high" > 0),
  ADD CONSTRAINT "ipos_issue_size_non_negative_chk"
    CHECK ("issue_size" IS NULL OR "issue_size" >= 0),
  ADD CONSTRAINT "ipos_fresh_issue_size_non_negative_chk"
    CHECK ("fresh_issue_size" IS NULL OR "fresh_issue_size" >= 0),
  ADD CONSTRAINT "ipos_ofs_size_non_negative_chk"
    CHECK ("ofs_size" IS NULL OR "ofs_size" >= 0),
  ADD CONSTRAINT "ipos_face_value_positive_chk"
    CHECK ("face_value" IS NULL OR "face_value" > 0);

ALTER TABLE "field_provenance"
  ADD CONSTRAINT "field_provenance_confidence_range_chk"
    CHECK ("confidence" >= 0 AND "confidence" <= 1);
