-- `domain_os_facts` — the Domain OS feed kernel's store.
--
-- ✅ ALREADY APPLIED TO PRODUCTION 2026-09-01, BY THE OWNER, AS RAW SQL.
-- Verified by effect via `information_schema.columns`: 10 columns, `facts` jsonb,
-- `confidence` double precision, `sampleSize` integer, `capturedAt` timestamp.
--
-- 🛑 SO THIS FILE IS A BACKFILL OF THE MIGRATION HISTORY, NOT A PENDING CHANGE — AND THAT MAKES
-- IT DIFFERENT FROM EVERY OTHER ENTRY IN THIS DIRECTORY.
--
-- The table was created by hand in a SQL console, not by `prisma migrate`. There is therefore
-- **no `_prisma_migrations` row for it**. That is the opposite of the seven Commissioner OS
-- migrations recorded in the README beside this file, which were applied *through* Prisma and so
-- match-and-skip on a later `migrate deploy`.
--
-- The consequence, stated plainly so nobody has to work it out under pressure:
--
--   * On PRODUCTION, a future `migrate deploy` will RUN this file — it has no record of it. Every
--     statement below is `IF NOT EXISTS`, so it is a no-op that succeeds and finally writes the
--     `_prisma_migrations` row. Self-healing by construction.
--   * On a FRESH environment, it creates the table, which is the entire reason this file exists.
--
-- ⚠ THE `IF NOT EXISTS` GUARDS ARE LOAD-BEARING, NOT DEFENSIVE HABIT. Without them, the first
-- `migrate deploy` against production fails, writes a `finished_at IS NULL` row, and every later
-- migration aborts with P3009 until someone resolves it by hand — the exact failure the README
-- beside this file exists to prevent.
--
-- ── WHY IT WAS MISSING FOR WEEKS, AND WHAT THAT COST ────────────────────────────────────────
--
-- `model DomainOsFacts` was added to `schema.prisma` by `f539b4016` ("Waiver OS and Trade OS, on
-- a kernel the three feeds share", #580) with no accompanying migration. Nothing failed loudly,
-- and the reason is the interesting part:
--
--   READS  `store.read` catches, returns null, and the feed derives live. Correct by design —
--          the kernel's own header promises it will never serve a stale fact, and a missing table
--          produces exactly that. No user ever received a wrong answer.
--   WRITES `store.write` caught P2021 and returned void, `safeWrite` caught again, and
--          `OsFeed.refresh` then returned the literal 'written'. `/api/cron/domain-os-refresh`
--          ran every 30 minutes reporting `written: N` for rows it never wrote.
--
-- ⚠ The Prisma DELEGATE exists whenever the model is in `schema.prisma` — measured, 24
-- `domainOsFacts` references in the generated client — so the `if (!delegate) return` guard in
-- `store.ts` never fired. The upsert ran, hit Postgres, and threw. "Client knows about a table the
-- database does not have" was the whole bug.
--
-- Fixed on the code side in the same change that staged this file: `OsStore.write` now returns
-- `boolean` and `refresh` reports a third outcome, `'write_failed'`. **That fix is required
-- independently of this migration** — creating the table fixes today; it does nothing about the
-- next permissions change or schema drift being reported as healthy work.
--
-- ── ⚠ THE UNIQUE INDEX IS LOAD-BEARING. DO NOT RUN THE CREATE TABLE WITHOUT IT. ─────────────
--
-- `store.ts` writes with `upsert({ where: { domain_kind_level_scopeKey: {...} } })`. Prisma
-- requires a matching unique constraint for a compound `where` like that, so a table created
-- WITHOUT this index leaves every write failing — the same silent no-op as having no table at
-- all, with a different error code and no new symptom to notice.
--
-- ── COST ────────────────────────────────────────────────────────────────────────────────────
--
-- `CREATE TABLE` on a table that does not exist is instantaneous and takes no lock anyone else is
-- waiting on. The indexes are created on an empty table.
--
-- ⚠ Deliberately NOT `CONCURRENTLY`, and for a stronger reason than the `leagues` migration in
-- this directory: `CONCURRENTLY` cannot run inside a transaction, Prisma Migrate wraps a
-- migration in one, so choosing it would make `migrate deploy` refuse the file outright. On a
-- table being created in the same statement block there is nothing to build concurrently anyway.

CREATE TABLE IF NOT EXISTS "domain_os_facts" (
  "id"         TEXT NOT NULL,
  -- 'lineup' | 'waiver' | 'trade' | 'draft' | 'league' | 'value' | 'projection' | 'import'
  -- VarChar(16) with room to spare: widening the OsDomain union is a TypeScript change only, and
  -- deliberately needs no migration. 'psychology' (10 chars) is the next planned member.
  "domain"     VARCHAR(16)  NOT NULL,
  -- Fact family within the domain, e.g. 'settings' | 'resource' | 'rosters' | 'assertions'.
  "kind"       VARCHAR(32)  NOT NULL,
  -- 'app' | 'league' | 'user' — widest to narrowest, so a resolver falls back UP the list.
  "level"      VARCHAR(8)   NOT NULL,
  -- How the fact is addressed WITHIN its level: a sport at app level, a league id at league
  -- level, a user+league pair at user level. Producer and consumer derive it identically.
  "scopeKey"   VARCHAR(128) NOT NULL,
  "sport"      VARCHAR(16)  NOT NULL,
  "facts"      JSONB        NOT NULL,
  -- ⚠ BOTH NULLABLE, AND NULL IS NOT ZERO. Null means "this producer does not express one".
  -- Zero-as-unknown is the defect that renders 85% of the devy board as a confident "worthless"
  -- (see lib/devy/devyValueBoard.ts) — an absence of data presented as a measured value.
  "confidence" DOUBLE PRECISION,
  "sampleSize" INTEGER,
  -- Expiry is enforced on READ against each source's own ttlMs, never by a sweeper. A sweeper
  -- that stops running would leave expired rows servable, which is the one failure this design
  -- refuses to have.
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domain_os_facts_pkey" PRIMARY KEY ("id")
);

-- 🛑 REQUIRED BY `store.ts`'s upsert. See the header — without this every write fails silently.
CREATE UNIQUE INDEX IF NOT EXISTS "domain_os_facts_domain_kind_level_scopeKey_key"
  ON "domain_os_facts" ("domain", "kind", "level", "scopeKey");

-- For pruning and for auditing feed age across the whole store.
CREATE INDEX IF NOT EXISTS "domain_os_facts_capturedAt_idx"
  ON "domain_os_facts" ("capturedAt");

-- For per-domain / per-level inspection: "what does Waiver OS hold at league level".
CREATE INDEX IF NOT EXISTS "domain_os_facts_domain_level_idx"
  ON "domain_os_facts" ("domain", "level");
