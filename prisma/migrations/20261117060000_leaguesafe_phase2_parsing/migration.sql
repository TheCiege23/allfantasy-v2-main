-- Additive metadata only. No backfill, capture changes, member matching, or ledger writes.
ALTER TABLE "LeagueSafeRawEmail"
  ADD COLUMN "parsedPayload" JSONB,
  ADD COLUMN "parserVersion" VARCHAR(64),
  ADD COLUMN "parseAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "parseError" VARCHAR(64),
  ADD COLUMN "parseDedupeKey" VARCHAR(100);

CREATE INDEX "LeagueSafeRawEmail_parseDedupeKey_idx" ON "LeagueSafeRawEmail"("parseDedupeKey");

-- Untouched historical rows retain all-null metadata. Rejected messages cannot carry parse results.
ALTER TABLE "LeagueSafeRawEmail" ADD CONSTRAINT "LeagueSafeRawEmail_parse_metadata_check" CHECK (
  ("parserVersion" IS NULL AND "parseAttemptedAt" IS NULL AND "parsedPayload" IS NULL
    AND "parseError" IS NULL AND "parseDedupeKey" IS NULL)
  OR (
    "parserVersion" IS NOT NULL AND length(trim("parserVersion")) > 0 AND "parseAttemptedAt" IS NOT NULL
    AND (
      ("processingStatus" = 'parsed' AND "parsedPayload" IS NOT NULL AND jsonb_typeof("parsedPayload") = 'object'
        AND "parseError" IS NULL AND "parseDedupeKey" IS NOT NULL
        AND "parseDedupeKey" ~ '^leaguesafe:(message|transaction):[a-f0-9]{64}$')
      OR ("processingStatus" = 'unparseable' AND "parsedPayload" IS NULL AND "parseDedupeKey" IS NULL
        AND "parseError" IS NOT NULL AND "parseError" IN ('unknown_or_invalid_template', 'authentication_policy_failed'))
    )
  )
);
