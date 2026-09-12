-- ImportRunAttempt: one row per import ATTEMPT, alongside the logical ImportRun.
--
-- P1 item 7 of the six-provider import audit: "Keep individual import-attempt
-- history instead of overwriting the latest logical ImportRun."
--
-- 🛑 NOT APPLIED. This file lives in `migrations-pending/`, which is deliberately
-- outside the deploy path — see that directory's README. Moving it into
-- `prisma/migrations/` is the authorised act and belongs to the repo owner.
--
-- ── WHAT IS LOST TODAY ──────────────────────────────────────────────────────
--
-- A forced re-import REUSES the `import_runs` row rather than inserting a new one:
--
--     await prisma.importRun.update({ where: { idempotencyKey }, data: {
--       status: 'running', completedAt: null, error: null,
--       rawPayloadHash: ..., canonicalSummary: ... } })
--
-- That reuse is deliberate and correct — `idempotencyKey` is unique so a fresh
-- insert would collide; deleting the row would throw away the audit trail the
-- table exists for; and salting the key would leave an unbounded set of
-- near-duplicate rows. `importPersistenceService` says so in those words.
--
-- The cost is that each re-run OVERWRITES the previous attempt's status, error,
-- payload hash and summary. A league that failed twice and then succeeded looks,
-- forever after, like a league that succeeded once. There is no way to answer
-- "how many times did this import fail, and with what error" from the schema.
--
-- ── WHY A CHILD TABLE RATHER THAN DROPPING THE UNIQUE KEY ───────────────────
--
-- The alternative considered was dropping `import_runs.idempotencyKey`'s UNIQUE
-- constraint and inserting one row per attempt. That is simpler and it is the
-- wrong trade:
--
--   * the unique key is what converts a double-submit into a clean
--     `ImportRunInFlightError` instead of an unhandled 500 (Sentry
--     ALLFANTASY-V2-MAIN-K). Removing it gives that protection away.
--   * `import_warnings`, `import_review_tasks` and `external_entity_mappings`
--     all hang off `runId`. With one row per attempt, "the warnings for this
--     import" stops being answerable without picking an attempt first.
--   * the logical import is a real entity that readers already join to. Splitting
--     it into N rows changes what every existing consumer means by "a run".
--
-- So `import_runs` keeps its identity and its unique key, and the per-attempt
-- detail moves into a child table. Nothing existing changes shape.
--
-- ── SAFE TO APPLY AHEAD OF THE CODE ─────────────────────────────────────────
--
-- ⚠ This is additive only: one new table, one FK, two indexes. It creates no
-- column on an existing table, drops nothing and rewrites nothing, so currently
-- deployed code cannot observe it. That is the opposite of the direction this
-- repo warns about — a generated client that knows about a table production
-- LACKS raises P2021, so code must never ship first.
--
-- RECOMMENDED ORDER, matching the `weekly_matchup_roster_id_text` precedent:
--   1. apply this SQL
--   2. add the model to `schema.prisma` and regenerate
--   3. ship the writer
--
-- ⚠ AND `attemptNumber` IS NOT DERIVED FROM A COUNT AT WRITE TIME. Two concurrent
-- writes both reading `count + 1` produce two attempt 3s, which is the same class
-- of race `idempotencyKey` exists to prevent one level up. The unique constraint
-- below makes that collision a write error rather than silent duplication; the
-- writer is expected to allocate the number inside the same transaction that
-- inserts the row.

CREATE TABLE "import_run_attempts" (
    "id"               TEXT NOT NULL,
    "runId"            TEXT NOT NULL,
    -- 1-based, scoped to the run. See the note above about allocating it.
    "attemptNumber"    INTEGER NOT NULL,
    "status"           VARCHAR(24) NOT NULL DEFAULT 'running',
    "rawPayloadHash"   VARCHAR(64),
    "canonicalSummary" JSONB,
    "error"            TEXT,
    "startedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"      TIMESTAMP(3),

    CONSTRAINT "import_run_attempts_pkey" PRIMARY KEY ("id")
);

-- Cascade: an attempt has no meaning without its run, and `import_runs` rows are
-- themselves deleted only by the failed-retry path, which should take its
-- attempts with it.
ALTER TABLE "import_run_attempts"
    ADD CONSTRAINT "import_run_attempts_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The ordering read: "show me this import's attempts, newest first".
CREATE INDEX "import_run_attempts_runId_startedAt_idx"
    ON "import_run_attempts"("runId", "startedAt");

-- ⚠ MAKES A DUPLICATE ATTEMPT NUMBER A WRITE ERROR rather than silent history
-- corruption. Without it, a race produces two rows both claiming to be attempt 3
-- and neither is wrong-looking.
CREATE UNIQUE INDEX "import_run_attempts_runId_attemptNumber_key"
    ON "import_run_attempts"("runId", "attemptNumber");
