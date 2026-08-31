-- Commissioner OS · T-008 — non-tenant constraints.
--
-- 🛑 NOT APPLIED. Parked in migrations-pending/ so a routine `prisma migrate
--    deploy` cannot sweep it up. See prisma/migrations-pending/README.md.
--
-- ⚠ TWO OF THE THREE CONSTRAINTS T-008 SPECIFIES HAVE NO TARGET IN THIS REPO,
-- and a third is impossible as specified. Measured, not assumed:
--
--   Membership.teamId UNIQUE DEFERRABLE
--     `Membership` does not exist. The nearest analogues are RedraftLeagueMember
--     (@@unique([leagueId, userId])), Roster (@@unique([leagueId, platformUserId]))
--     and LeagueEntrySlot (@@unique([leagueId, slotNumber])) — all AllFantasy
--     tables carrying live data, all outside the Commissioner OS surface per
--     docs/commissioner-os/SCOPE.md. Converting one of their uniques to
--     DEFERRABLE means DROP + re-ADD on a populated production table, which is
--     not a Commissioner OS decision to make.
--
--   DraftPick live-slot / live-player partial uniques WHERE "supersededById" IS NULL
--     `DraftPick` exists; `supersededById` does not, anywhere in the schema
--     (grep: zero occurrences). There is no supersession concept in this
--     codebase — DraftPick carries a plain @@unique([sessionId, overall]),
--     which is the non-partial form the ticket is trying to replace. Writing
--     the partial index would require inventing the column and the model it
--     implies.
--
-- What IS in scope and real is below: PlatformGrant. It is the only model
-- Commissioner OS adds that is NOT tenant-scoped — T-008's exact remit, since
-- "anything with a tenant dimension" belongs to T-101.

-- ---------------------------------------------------------------------------
-- 0 · Ordering guard. Same reasoning as T-101 and T-007.
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(r, ', ' ORDER BY r) INTO missing
  FROM unnest(ARRAY['commish_migrate', 'commish_app', 'commish_platform', 'commish_purge']) AS r
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Commissioner OS T-008 blocked: roles not provisioned (missing: %). Land T-001 first.', missing;
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1 · One LIVE platform grant per (user, role)
--
-- WHY THIS IS A SECURITY CONSTRAINT AND NOT TIDINESS
-- PlatformGrant is how platform staff hold PLATFORM_ADMIN / PLATFORM_SUPPORT.
-- Revocation is `revokedAt IS NOT NULL`, not a delete. With duplicate live rows
-- for the same (userId, role), revoking "the" grant revokes ONE of them and the
-- person keeps the privilege — and the revocation UI shows success, because a
-- row was updated. Nothing anywhere reports that a second row still stands.
--
-- That is the privilege-escalation path CLAUDE.md warns about ("a column on a
-- broadly-writable table is a privilege-escalation path; a separate table with
-- its own write path is not") reappearing INSIDE the separate table, through
-- duplication rather than through the column.
--
-- WHY A PARTIAL INDEX AND NOT @@unique
-- A plain unique on (userId, role) would mean a revoked grant could never be
-- re-issued — the same reason TenantMember's uniqueness is partial (T-101).
-- Prisma's DSL cannot express `WHERE`, which is what puts this in T-008.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "PlatformGrant_userId_role_live_key"
  ON "PlatformGrant"("userId", "role")
  WHERE "revokedAt" IS NULL;

-- Revocation reads by (userId, revokedAt) — already indexed on the model. This
-- one additionally serves "does this person hold this role right now", which is
-- the authorization bootstrap question (TENANCY.md §3.6) and runs per request.

-- ---------------------------------------------------------------------------
-- 2 · A FINDING RECORDED HERE BECAUSE IT CHANGES WHAT T-008 CAN EVER DELIVER
--
-- 🛑 A PARTIAL UNIQUE AND A DEFERRABLE UNIQUE ARE MUTUALLY EXCLUSIVE IN
--    POSTGRES, AND T-008 ASKS FOR BOTH ON THE SAME KIND OF ROW.
--
-- `DEFERRABLE` is a property of a CONSTRAINT (ALTER TABLE … ADD CONSTRAINT …
-- UNIQUE), and a unique CONSTRAINT cannot carry a WHERE clause. Partial
-- uniqueness is only expressible as a unique INDEX (CREATE UNIQUE INDEX …
-- WHERE), and an index is not a constraint, so it cannot be deferred.
--
-- The collision is with invariant 4, not with anything incidental. Invariant 4
-- says every deletable model carries `deletedAt`, and that every uniqueness
-- rule on such a model must therefore be a partial index. T-008 then says
-- Membership's unique must be DEFERRABLE so an owner swap works inside one
-- transaction. If Membership is soft-deletable — and by invariant 4 it is —
-- those two requirements cannot both hold on the same key.
--
-- ⚠ STATED FROM THE POSTGRES DOCUMENTATION AND NOT YET MEASURED HERE. This
-- session has no non-production database to probe. `__tests__/commissioner-os/
-- constraints.spec.ts` contains a test that settles it empirically by trying to
-- create a deferrable partial unique and asserting the failure — run it before
-- treating this paragraph as fact.
--
-- If it holds, whoever owns the swap has three options, none free:
--   a) keep the partial index and make swaps two transactions, accepting a
--      window where neither team has an owner;
--   b) use a full DEFERRABLE constraint and give up soft-delete on that model,
--      so a removed member is genuinely gone;
--   c) route swaps through a single UPDATE … FROM that never produces an
--      intermediate duplicate, which needs no deferral at all.
--
-- (c) is the one worth trying first: it is the only one that gives up nothing,
-- and the constraint then never has to be deferrable. It is also the one a
-- ticket phrased as "make the constraint deferrable" steers you away from.
-- ---------------------------------------------------------------------------
