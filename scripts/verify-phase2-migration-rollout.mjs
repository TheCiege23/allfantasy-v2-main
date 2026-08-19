/**
 * Issue 4 — safe migration rollout PROOF. Models the exact production runbook (guarded direct-SQL apply +
 * `_prisma_migrations` bookkeeping) against a DISPOSABLE schema `p2rb` on the isolated sandbox (never prod).
 * The schema is seeded with sentinel "externally-managed" tables + a pre-Phase-2 `user_token_balances` row,
 * then the two Phase 2 migrations are applied via the guarded mechanism, TWICE, and the schema is dropped.
 *
 * Proves: additive-only (sentinels + balances intact), both migrations recorded consistently, second run is a
 * no-op (idempotent via the _prisma_migrations preflight guard), zero DROP/ALTER of the sentinel tables.
 */
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const SCHEMA = 'p2rb'
const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })
const exec = (sql) => db.$executeRawUnsafe(sql)
const q = (sql) => db.$queryRawUnsafe(sql)
const one = async (sql) => (await q(sql))[0]

// Schema-qualify the three real table tokens so we never depend on search_path across a pooled connection.
// Index/constraint identifiers are longer tokens and never equal these exact quoted strings, so they are safe.
const QUALIFY = ['decision_intelligence_runs', 'token_reservations', 'user_token_balances']
function qualify(sql) {
  let out = sql
  for (const t of QUALIFY) out = out.split(`"${t}"`).join(`"${SCHEMA}"."${t}"`)
  return out
}
function statements(migrationName) {
  const raw = readFileSync(`prisma/migrations/${migrationName}/migration.sql`, 'utf8')
  return qualify(raw)
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean)
}

// The production-approved mechanism: preflight the bookkeeping table; skip if already applied; else run the
// whole migration in ONE transaction and record it. Returns 'applied' | 'skipped'.
async function guardedApply(migrationName) {
  const already = await q(
    `SELECT 1 FROM "${SCHEMA}"."_prisma_migrations" WHERE migration_name='${migrationName}' AND rolled_back_at IS NULL`,
  )
  if (already.length) return 'skipped'
  const stmts = statements(migrationName)
  await db.$transaction(async (tx) => {
    for (const s of stmts) await tx.$executeRawUnsafe(s)
    await tx.$executeRawUnsafe(
      `INSERT INTO "${SCHEMA}"."_prisma_migrations"(id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, 'proof', '${migrationName}', now(), now(), 1)`,
    )
  })
  return 'applied'
}

const M1 = '20260728120000_decision_intelligence_runs'
const M2 = '20260728130000_token_reservations'
const results = {}
try {
  // ── Fresh disposable schema + a Prisma-shaped bookkeeping table ──
  await exec(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
  await exec(`CREATE SCHEMA "${SCHEMA}"`)
  await exec(`CREATE TABLE "${SCHEMA}"."_prisma_migrations"(
    id text PRIMARY KEY, checksum text NOT NULL, migration_name text NOT NULL,
    started_at timestamptz, finished_at timestamptz, applied_steps_count int NOT NULL DEFAULT 0,
    rolled_back_at timestamptz, logs text)`)

  // ── Seed pre-Phase-2 state: the one existing table the migration alters + sentinel "externally-managed" ──
  await exec(`CREATE TABLE "${SCHEMA}"."user_token_balances"(
    id text PRIMARY KEY, "userId" text NOT NULL, balance int NOT NULL DEFAULT 0)`)
  await exec(`INSERT INTO "${SCHEMA}"."user_token_balances"(id,"userId",balance) VALUES ('ub1','u1',137)`)
  await exec(`CREATE TABLE "${SCHEMA}"."sentinel_players"(id int PRIMARY KEY, name text)`)
  await exec(`INSERT INTO "${SCHEMA}"."sentinel_players" VALUES (1,'keep-me'),(2,'keep-me-too')`)
  await exec(`CREATE TABLE "${SCHEMA}"."sentinel_leagues"(id int PRIMARY KEY, sport text)`)
  await exec(`INSERT INTO "${SCHEMA}"."sentinel_leagues" VALUES (10,'NFL')`)

  const before = {
    tables: (await one(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='${SCHEMA}' AND table_type='BASE TABLE'`)).n,
    sentinelPlayers: (await one(`SELECT count(*)::int n FROM "${SCHEMA}"."sentinel_players"`)).n,
    sentinelLeagues: (await one(`SELECT count(*)::int n FROM "${SCHEMA}"."sentinel_leagues"`)).n,
    balanceRow: (await one(`SELECT balance FROM "${SCHEMA}"."user_token_balances" WHERE id='ub1'`)).balance,
    ubtCols: (await one(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='${SCHEMA}' AND table_name='user_token_balances'`)).n,
  }
  results.before = before

  // ── FIRST rollout (both migrations) ──
  results.firstRun = { m1: await guardedApply(M1), m2: await guardedApply(M2) }

  const after = {
    tables: (await one(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='${SCHEMA}' AND table_type='BASE TABLE'`)).n,
    newTables: (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='${SCHEMA}' AND table_name IN ('decision_intelligence_runs','token_reservations') ORDER BY 1`)).map((r) => r.table_name),
    reservedBalanceCol: (await q(`SELECT column_default FROM information_schema.columns WHERE table_schema='${SCHEMA}' AND table_name='user_token_balances' AND column_name='reserved_balance'`)),
    reservedBalanceOnExistingRow: (await one(`SELECT reserved_balance FROM "${SCHEMA}"."user_token_balances" WHERE id='ub1'`)).reserved_balance,
    // sentinel + balance intact?
    sentinelPlayers: (await one(`SELECT count(*)::int n FROM "${SCHEMA}"."sentinel_players"`)).n,
    sentinelLeagues: (await one(`SELECT count(*)::int n FROM "${SCHEMA}"."sentinel_leagues"`)).n,
    balanceRow: (await one(`SELECT balance FROM "${SCHEMA}"."user_token_balances" WHERE id='ub1'`)).balance,
    // new constraints present?
    fk: (await q(`SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='${SCHEMA}' AND conname='token_reservations_user_token_balance_id_fkey'`)).length,
    uniqIdem: (await q(`SELECT indexname FROM pg_indexes WHERE schemaname='${SCHEMA}' AND indexname='token_reservations_idempotency_key_key'`)).length,
    indexes: (await one(`SELECT count(*)::int n FROM pg_indexes WHERE schemaname='${SCHEMA}' AND (tablename='decision_intelligence_runs' OR tablename='token_reservations')`)).n,
  }
  results.after = after

  // ── SECOND rollout — must be a guarded no-op (idempotent) ──
  const preTablesBeforeSecond = after.tables
  results.secondRun = { m1: await guardedApply(M1), m2: await guardedApply(M2) }
  results.idempotent = {
    tablesUnchanged: (await one(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='${SCHEMA}' AND table_type='BASE TABLE'`)).n === preTablesBeforeSecond,
    migrationRows: (await q(`SELECT migration_name, applied_steps_count, (rolled_back_at IS NULL) ok FROM "${SCHEMA}"."_prisma_migrations" WHERE migration_name LIKE '20260728%' ORDER BY migration_name`)),
  }

  console.log(JSON.stringify(results, null, 2))

  // ── Assertions (throw on any violation so exit code reflects the proof) ──
  const A = []
  const ok = (c, m) => { if (!c) A.push(m) }
  ok(results.firstRun.m1 === 'applied' && results.firstRun.m2 === 'applied', 'first run should apply both')
  ok(after.newTables.length === 2, 'both new tables created')
  ok(after.reservedBalanceCol.length === 1, 'reserved_balance column added')
  ok(Number(after.reservedBalanceOnExistingRow) === 0, 'existing row back-filled reserved_balance=0 (data preserved)')
  ok(after.sentinelPlayers === before.sentinelPlayers && after.sentinelLeagues === before.sentinelLeagues, 'sentinel tables untouched (row counts)')
  ok(Number(after.balanceRow) === Number(before.balanceRow), 'user_token_balances.balance preserved')
  ok(after.fk === 1 && after.uniqIdem === 1, 'FK + unique idempotency index present')
  ok(after.tables === before.tables + 2, 'exactly +2 tables (additive only)')
  ok(results.secondRun.m1 === 'skipped' && results.secondRun.m2 === 'skipped', 'second run must be a guarded no-op')
  ok(results.idempotent.tablesUnchanged, 'second run changed nothing')
  ok(results.idempotent.migrationRows.length === 2 && results.idempotent.migrationRows.every((r) => r.ok && r.applied_steps_count === 1), 'both migrations recorded consistently')
  if (A.length) { console.error('PROOF FAILURES:\n- ' + A.join('\n- ')); process.exitCode = 1 }
  else console.log('\nISSUE-4 PROOF: PASS — additive-only, recorded, idempotent, sentinels + balances intact.')
} finally {
  await exec(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`).catch(() => {})
  await db.$disconnect()
}
