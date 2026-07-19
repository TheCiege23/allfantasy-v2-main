-- Per-admin API tokens, so a bearer-authenticated admin call carries an identity.
--
-- WHY THIS EXISTS
-- `requireAdminOrBearer()` (lib/adminAuth.ts) accepts a single shared `ADMIN_PASSWORD` and
-- returns `{ role: "admin" }` with no `id` and no `email`. A bearer call therefore proves only
-- that someone knew the shared secret -- there is no way to attribute an action to a person,
-- rotate one person's access, or revoke it without rotating the secret for every caller at once.
-- 23 routes currently authenticate this way.
--
-- This table stores per-person tokens instead. Authority is NOT stored on the token: it carries
-- an `ownerEmail`, and the owner is re-checked against the admin allowlist on every use, so a
-- token can never grant more than its owner currently has, and an owner losing admin access
-- effectively revokes their tokens without anyone remembering to.
--
-- SAFETY
-- Purely additive: one new table plus its indexes, IF NOT EXISTS throughout. Touches no existing
-- table, rewrites no data, drops nothing. The shared-secret path is deliberately left working --
-- it is removed in Phase 2, once the real automated callers have been migrated onto tokens.
--
-- KEY CHOICE
-- Only `tokenHash` is stored, never the raw token: sha256 hex, always 64 chars, UNIQUE so
-- verifying a presented token is one indexed lookup rather than fetching every row and comparing.
-- sha256 (not bcrypt) is correct here specifically because these are 256-bit random tokens, not
-- user-chosen passwords -- there is no dictionary to attack, and a per-request bcrypt cost would
-- be paid on every admin API call. `revokedAt` is nullable rather than a boolean so revocation
-- keeps its timestamp for the audit trail; the row is never deleted.
--
-- Column casing is camelCase-quoted to match `admin_audit_log` (the closest analogue) and the
-- Prisma model, which uses `@@map` for the table name but no per-field `@map`.

CREATE TABLE IF NOT EXISTS "admin_api_token" (
    "id" TEXT NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "ownerEmail" VARCHAR(320) NOT NULL,
    "ownerUserId" VARCHAR(64),
    "createdByEmail" VARCHAR(320),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByEmail" VARCHAR(320),

    CONSTRAINT "admin_api_token_pkey" PRIMARY KEY ("id")
);

-- One indexed lookup per presented token.
CREATE UNIQUE INDEX IF NOT EXISTS "admin_api_token_tokenHash_key" ON "admin_api_token"("tokenHash");

-- "show me this person's tokens" for the admin UI and for revoking a departing admin.
CREATE INDEX IF NOT EXISTS "admin_api_token_ownerEmail_idx" ON "admin_api_token"("ownerEmail");

-- Listing active vs revoked tokens.
CREATE INDEX IF NOT EXISTS "admin_api_token_revokedAt_idx" ON "admin_api_token"("revokedAt");
