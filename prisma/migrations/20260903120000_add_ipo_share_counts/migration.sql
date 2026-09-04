-- Canonical share quantities are a different dimension from INR issue amounts.
-- Do not write NSE list-feed share counts into issue_size / fresh_issue_size / ofs_size.

ALTER TABLE "ipos"
  ADD COLUMN "issue_share_count" DECIMAL(20,0),
  ADD COLUMN "fresh_issue_share_count" DECIMAL(20,0),
  ADD COLUMN "ofs_share_count" DECIMAL(20,0);

ALTER TABLE "ipos"
  ADD CONSTRAINT "ipos_issue_share_count_non_negative_chk"
    CHECK ("issue_share_count" IS NULL OR "issue_share_count" >= 0),
  ADD CONSTRAINT "ipos_fresh_issue_share_count_non_negative_chk"
    CHECK ("fresh_issue_share_count" IS NULL OR "fresh_issue_share_count" >= 0),
  ADD CONSTRAINT "ipos_ofs_share_count_non_negative_chk"
    CHECK ("ofs_share_count" IS NULL OR "ofs_share_count" >= 0);
