-- Additive, re-runnable. Private server-side receipt and billing recovery state.
CREATE TABLE IF NOT EXISTS "chimmy_request_receipts" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "owner_token" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "expires_at" TIMESTAMPTZ NOT NULL,
  "response" JSONB,
  "http_status" INTEGER,
  "bill_kind" TEXT,
  "bill_state" TEXT,
  "allowance_endpoint" TEXT,
  "window_start" TIMESTAMPTZ,
  "window_end" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "chimmy_receipts_user_created" ON "chimmy_request_receipts" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "chimmy_receipts_recovery" ON "chimmy_request_receipts" ("status", "expires_at");
ALTER TABLE "chimmy_request_receipts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "chimmy_request_receipts" FROM PUBLIC;
-- Optional Supabase roles (Neon and ordinary Postgres need no client-role assumptions).
DO $$
DECLARE client_role TEXT;
BEGIN
  FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON "chimmy_request_receipts" FROM %I', client_role);
  END LOOP;
END
$$;
