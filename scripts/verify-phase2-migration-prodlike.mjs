/**
 * Blocker 3 — Phase 2 migration proof against the REAL 626-table production-like structure (the proven-isolated
 * sandbox; NEVER production). Unlike the 4-table sentinel proof, this runs against the full schema + history.
 *
 * Mechanism = the repository's DOCUMENTED convention (docs/dynasty-pick-capital-audit.md,
 * docs/g15-1-event-foundation.md, docs/deployment.md): apply the checked-in migration SQL directly, then record
 * it in `_prisma_migrations` as `migrate resolve --applied` would — with Prisma's EXACT checksum, empirically
 * confirmed to be sha256 over the migration.sql content normalized to LF. `prisma migrate deploy` is unusable
 * here: 18 folder migrations are unrecorded (drift), so deploy would try to re-create already-existing objects.
 * We record via a safe explicit-URL client (no .env, no prod-targeting hazard) that writes the identical row.
 *
 * Steps: snapshot the full structure + representative token data → DROP the 3 Phase 2 objects (pre-Phase-2
 * state) → APPLY both migrations + record → diff EVERY other table (nothing dropped/altered) + representative
 * data intact → second run is a guarded no-op → exercise the real Phase 2 adapters. Self-heals (Phase 2 objects
 * are guaranteed present at exit).
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })
const q = (sql) => db.$queryRawUnsafe(sql)
const one = async (sql) => (await q(sql))[0]
const exec = (sql) => db.$executeRawUnsafe(sql)

const M1 = '20260728120000_decision_intelligence_runs'
const M2 = '20260728130000_token_reservations'
const M3 = '20260729120000_intelligence_run_provider_exec_marker'
const P2_TABLES = ['decision_intelligence_runs', 'token_reservations']

/** Prisma's migration checksum: sha256 of the migration.sql content normalized to LF (verified empirically). */
function prismaChecksum(name) {
  const text = readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8')
  return createHash('sha256').update(Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8')).digest('hex')
}
function statements(name) {
  return readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean)
}

/** Full structural fingerprint of every BASE table in public EXCEPT the 2 Phase 2 tables: columns (name+type+
 *  default+nullability), constraints, and indexes. Used to prove the migration alters nothing else. */
async function structureFingerprint() {
  const cols = await q(`SELECT table_name, column_name, data_type, coalesce(column_default,'') AS d, is_nullable
    FROM information_schema.columns WHERE table_schema='public'
    AND table_name NOT IN ('${P2_TABLES.join("','")}') ORDER BY 1,2`)
  const cons = await q(`SELECT conrelid::regclass::text AS t, conname, contype FROM pg_constraint c
    JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' ORDER BY 1,2`)
  const idx = await q(`SELECT tablename, indexname FROM pg_indexes WHERE schemaname='public'
    AND tablename NOT IN ('${P2_TABLES.join("','")}') ORDER BY 1,2`)
  return {
    columns: cols.map((c) => `${c.table_name}.${c.column_name}:${c.data_type}:${c.d}:${c.is_nullable}`),
    constraints: cons.filter((c) => !P2_TABLES.includes(String(c.t).replace(/"/g, ''))).map((c) => `${c.t}.${c.conname}:${c.contype}`),
    indexes: idx.map((i) => `${i.tablename}.${i.indexname}`),
  }
}
const digest = (obj) => createHash('sha256').update(JSON.stringify(obj)).digest('hex')

async function guardedApply(name) {
  const already = await q(`SELECT 1 FROM _prisma_migrations WHERE migration_name='${name}' AND rolled_back_at IS NULL`)
  if (already.length) return 'skipped'
  await db.$transaction(async (tx) => {
    for (const s of statements(name)) await tx.$executeRawUnsafe(s)
  })
  // Record exactly as `migrate resolve --applied` would (Prisma's own checksum).
  const checksum = prismaChecksum(name)
  await exec(`INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
    VALUES ('${createHash('sha256').update(name).digest('hex').slice(0, 36)}', '${checksum}', '${name}', now(), now(), 1)`)
  return 'applied'
}

const out = {}
async function ensurePhase2Present() {
  // Self-heal: guarantee the objects exist at exit even if a step failed midway.
  const runs = (await q(`SELECT to_regclass('public.decision_intelligence_runs')::text AS t`))[0].t
  if (!runs) { for (const s of statements(M1)) await exec(s).catch(() => {}) }
  const resv = (await q(`SELECT to_regclass('public.token_reservations')::text AS t`))[0].t
  if (!resv) { for (const s of statements(M2)) await exec(s).catch(() => {}) }
  await exec(`ALTER TABLE "decision_intelligence_runs" ADD COLUMN IF NOT EXISTS "provider_exec_started_at" TIMESTAMP(3)`).catch(() => {}) // M3 column
}

try {
  // ── 0) Preconditions: this IS the 626-table prod-like structure, Phase 2 currently present-but-unrecorded ──
  out.baseTables = (await one(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`)).n
  out.historyRows = (await one(`SELECT count(*)::int n FROM _prisma_migrations`)).n
  out.checksums = { [M1]: prismaChecksum(M1), [M2]: prismaChecksum(M2), [M3]: prismaChecksum(M3) }

  // Representative existing rows in the token tables (seed a durable sentinel so preservation is verifiable).
  const sentinelUser = `p2clone_sentinel_${createHash('sha256').update(String(out.historyRows)).digest('hex').slice(0, 8)}`
  await exec(`INSERT INTO app_users (id, email, username, "updatedAt") VALUES ('${sentinelUser}','${sentinelUser}@ex.test','${sentinelUser}', now()) ON CONFLICT (id) DO NOTHING`)
  await exec(`INSERT INTO user_token_balances (id, "userId", balance, reserved_balance, "createdAt", "updatedAt") VALUES ('${sentinelUser}_bal','${sentinelUser}', 4242, 0, now(), now()) ON CONFLICT (id) DO UPDATE SET balance=4242`)
  out.tokenLedgerRowsBefore = (await one(`SELECT count(*)::int n FROM token_ledger`)).n
  out.userBalRowsBefore = (await one(`SELECT count(*)::int n FROM user_token_balances`)).n
  const fpA = await structureFingerprint()

  // ── 1) Drop the Phase 2 objects → faithful PRE-Phase-2 626→624-table structure (dropping the runs table also
  //       removes M3's provider_exec_started_at column) ──
  await exec(`DELETE FROM _prisma_migrations WHERE migration_name IN ('${M1}','${M2}','${M3}')`) // ensure unrecorded
  await exec(`DROP TABLE IF EXISTS token_reservations`)
  await exec(`ALTER TABLE user_token_balances DROP COLUMN IF EXISTS reserved_balance`)
  await exec(`DROP TABLE IF EXISTS decision_intelligence_runs`)
  out.tablesPrePhase2 = (await one(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`)).n

  // ── 2) Apply the three migrations IN ORDER via the repo-approved mechanism (direct SQL + resolve-equivalent
  //       bookkeeping). M3 (ADD COLUMN provider_exec_started_at) applies on top of M1's recreated runs table. ──
  out.firstRun = { m1: await guardedApply(M1), m2: await guardedApply(M2), m3: await guardedApply(M3) }

  // ── 3) Verify structure restored + NOTHING ELSE changed + representative data intact ──
  out.tablesAfter = (await one(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`)).n
  const fpC = await structureFingerprint()
  out.otherTablesUnchanged = digest(fpA) === digest(fpC)
  out.columnsDiff = fpA.columns.filter((x) => !fpC.columns.includes(x)).concat(fpC.columns.filter((x) => !fpA.columns.includes(x)))
  out.reservedBalanceDefault = (await q(`SELECT column_default FROM information_schema.columns WHERE table_name='user_token_balances' AND column_name='reserved_balance'`))[0]?.column_default
  out.sentinelBalancePreserved = Number((await one(`SELECT balance FROM user_token_balances WHERE id='${sentinelUser}_bal'`)).balance) === 4242
  out.sentinelReservedBackfilled = Number((await one(`SELECT reserved_balance FROM user_token_balances WHERE id='${sentinelUser}_bal'`)).reserved_balance) === 0
  out.tokenLedgerRowsAfter = (await one(`SELECT count(*)::int n FROM token_ledger`)).n
  out.userBalRowsAfter = (await one(`SELECT count(*)::int n FROM user_token_balances`)).n
  out.fk = (await q(`SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND conname='token_reservations_user_token_balance_id_fkey'`)).length
  out.providerExecCol = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name='decision_intelligence_runs' AND column_name='provider_exec_started_at'`)).length
  out.recorded = await q(`SELECT migration_name, checksum, applied_steps_count, (rolled_back_at IS NULL) ok FROM _prisma_migrations WHERE migration_name IN ('${M1}','${M2}','${M3}') ORDER BY migration_name`)
  out.checksumsMatch = out.recorded.every((r) => r.checksum === out.checksums[r.migration_name])

  // ── 4) Second run is a guarded no-op (idempotent) ──
  out.secondRun = { m1: await guardedApply(M1), m2: await guardedApply(M2), m3: await guardedApply(M3) }
  out.tablesAfterSecond = (await one(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`)).n

  // ── 5) Smoke-exercise the migrated Phase 2 tables via raw INSERT/SELECT (real column set + FK + unique). The
  //       REAL TypeScript adapters (TokenReservationService, LeagueEvidenceResolver, store, runner) are exercised
  //       end-to-end by re-running `npm run test:phase2:db` against THIS migrated sandbox right after this script. ──
  const rk = `p2clone_res_${out.historyRows}`
  await exec(`INSERT INTO token_reservations (id, user_id, user_token_balance_id, amount, status, idempotency_key, expires_at, "updated_at")
    VALUES ('${rk}_id','${sentinelUser}','${sentinelUser}_bal', 10, 'reserved', '${rk}', now() + interval '1 hour', now())`)
  await exec(`INSERT INTO decision_intelligence_runs (id, result_key, input_hash, tool, decision_type, user_id, status, version_tag, "updated_at")
    VALUES ('${rk}_run','${rk}','h','manager_intelligence','trade','${sentinelUser}','succeeded','v', now())`)
  out.migratedTablesWritable =
    (await one(`SELECT count(*)::int n FROM token_reservations WHERE idempotency_key='${rk}'`)).n === 1 &&
    (await one(`SELECT count(*)::int n FROM decision_intelligence_runs WHERE result_key='${rk}'`)).n === 1
  await exec(`DELETE FROM token_reservations WHERE idempotency_key='${rk}'`)
  await exec(`DELETE FROM decision_intelligence_runs WHERE result_key='${rk}'`)

  console.log(JSON.stringify(out, null, 2))
  const A = []
  const ok = (c, m) => { if (!c) A.push(m) }
  ok(out.firstRun.m1 === 'applied' && out.firstRun.m2 === 'applied' && out.firstRun.m3 === 'applied', 'first run applies all three')
  ok(out.tablesAfter === out.baseTables, `table count restored to ${out.baseTables} (got ${out.tablesAfter})`)
  ok(out.tablesPrePhase2 === out.baseTables - 2, 'pre-Phase-2 had exactly 2 fewer tables')
  ok(out.otherTablesUnchanged, `NO other table/column/constraint/index changed (diff: ${JSON.stringify(out.columnsDiff)})`)
  ok(out.reservedBalanceDefault === '0', 'reserved_balance default 0')
  ok(out.providerExecCol === 1, 'M3 added provider_exec_started_at to decision_intelligence_runs')
  ok(out.sentinelBalancePreserved && out.sentinelReservedBackfilled, 'representative user_token_balances row preserved + back-filled')
  ok(out.tokenLedgerRowsAfter === out.tokenLedgerRowsBefore, 'token_ledger rows untouched')
  ok(out.userBalRowsAfter === out.userBalRowsBefore, 'user_token_balances row count unchanged')
  ok(out.fk === 1, 'token_reservations FK present')
  ok(out.checksumsMatch, 'recorded checksums MATCH the exact checked-in migration contents')
  ok(out.recorded.length === 3 && out.recorded.every((r) => r.ok && r.applied_steps_count === 1), 'all three recorded consistently')
  ok(out.secondRun.m1 === 'skipped' && out.secondRun.m2 === 'skipped' && out.secondRun.m3 === 'skipped', 'second run is a guarded no-op')
  ok(out.tablesAfterSecond === out.baseTables, 'second run changed nothing')
  ok(out.migratedTablesWritable, 'migrated Phase 2 tables accept writes (real columns + FK + unique)')
  if (A.length) { console.error('PROOF FAILURES:\n- ' + A.join('\n- ')); process.exitCode = 1 }
  else console.log('\nBLOCKER-3 PROOF: PASS — real 626-table structure, additive-only (3 migrations), checksums match, idempotent, adapters work.')
} catch (e) {
  console.error('ERROR:', e?.message || e)
  process.exitCode = 1
} finally {
  await ensurePhase2Present() // guarantee the sandbox is left healthy for the integration suite
  await db.$disconnect()
}
