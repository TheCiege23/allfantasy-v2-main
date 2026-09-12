-- Commissioner OS · T-112 — an API key carries its own role.
--
-- 🛑 NOT APPLIED. Parked in migrations-pending/. Depends on T-101 (TenantApiKey
--    and the TenantRole enum).
--
-- WHY THE COLUMN EXISTS
-- T-112: "An API-key request has no `userId`. Either the matrix gains a scope
-- dimension or keys carry a `TenantRole` — decide and implement, because today
-- `scopes` is enforced by nothing."
--
-- The decision was BOTH, as an intersection — see lib/domain/apiActor.ts for
-- the argument. In short: the role answers "what may this principal do at all",
-- the scopes answer "what did the issuer delegate to this key", and a key must
-- exceed neither. Scopes alone leave a key able to outlive its issuer's
-- authority; a role alone leaves the `scopes` column enforced by nothing, which
-- is the state the ticket exists to fix.
--
-- ⚠ DEFAULT TENANT_SUPPORT, NOT TENANT_ADMIN.
-- TENANT_SUPPORT holds no write action anywhere in the T-104 matrix, so a key
-- issued before anyone thought about its authority is read-only. Backfilling
-- existing keys to ADMIN would silently grant write access to every key ever
-- issued — and there is no way to tell afterwards which ones were meant to have
-- it.
--
-- ⚠ NOT DERIVED FROM `createdBy`. Inheriting the issuer's role at creation goes
-- stale the moment that person is demoted or leaves, and the key keeps an
-- authority its owner no longer has. The column is explicit for that reason.

ALTER TABLE "TenantApiKey"
  ADD COLUMN "role" "TenantRole" NOT NULL DEFAULT 'TENANT_SUPPORT';

-- Deliberately NOT indexed. The role is read only after a key has already been
-- resolved by its unique prefix, so it is never a search key.

-- The bootstrap function must return it, or the verifier has no role to build
-- an actor context from. Replacing in place: the signature's return type
-- changes, so this is CREATE OR REPLACE with the new column appended LAST —
-- reordering existing columns would break any caller destructuring by position.
-- 🛑 DROP FIRST. `CREATE OR REPLACE FUNCTION` CANNOT ADD A COLUMN TO A
-- `RETURNS TABLE`. T-102 created this function returning four columns; this
-- version returns five (it adds `role`), and that is a RETURN TYPE CHANGE, which
-- REPLACE refuses outright:
--
--     ERROR: cannot change return type of existing function
--     HINT:  Use DROP FUNCTION app.resolve_api_key(text) first.
--
-- ⚠ THIS WAS NOT THEORETICAL AND IT WAS NOT CAUGHT BY REVIEW. The migration was
-- written with REPLACE alone and failed the first time it met a database — a
-- Neon branch, on 2026-08-31, which is the only reason it was cheap. On
-- production it would have aborted mid-migration and left a `finished_at IS NULL`
-- row in `_prisma_migrations`, and per prisma/migrations-pending/README.md every
-- later `migrate deploy` then dies with P3009 until a human resolves it by hand.
-- A migration that fails correctly still blocks everyone.
--
-- DROP is safe here: the function is SECURITY DEFINER and carries explicit
-- grants, and the REVOKE/GRANT pair below re-establishes them in this same
-- transaction. Dropping without re-granting would silently leave commish_app
-- unable to resolve an API key at all — which is why those two statements are
-- not optional tidy-up.
DROP FUNCTION IF EXISTS app.resolve_api_key(text);

CREATE OR REPLACE FUNCTION app.resolve_api_key(p_prefix text)
RETURNS TABLE (tenant_id text, key_id text, hash text, scopes text[], role "TenantRole")
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT "tenantId", id, hash, scopes, role
    FROM "TenantApiKey"
   WHERE prefix = p_prefix
     AND "revokedAt" IS NULL
     AND ("expiresAt" IS NULL OR "expiresAt" > now());
$$;

REVOKE ALL ON FUNCTION app.resolve_api_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_api_key(text) TO commish_app;
