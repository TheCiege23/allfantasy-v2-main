/**
 * G15 — read-only event/intelligence status reporter.
 *
 * Reports table existence, outbox claim columns, event/outbox counts (incl. dead-letter),
 * last relay activity, read-model snapshot counts, and recorded migration history for a DB.
 * READ-ONLY: only SELECT / to_regclass / information_schema queries — no writes.
 *
 * Usage:
 *   AF_STATUS_URL=<db-url> node scripts/g15-prod-status.cjs
 *   (falls back to DATABASE_URL if AF_STATUS_URL is unset)
 */
const { PrismaClient } = require('@prisma/client')

const url = process.env.AF_STATUS_URL || process.env.DATABASE_URL
if (!url) {
  console.error('No AF_STATUS_URL / DATABASE_URL set.')
  process.exit(1)
}
const prisma = new PrismaClient({ datasources: { db: { url } } })
const q = (sql) => prisma.$queryRawUnsafe(sql)
const num = (v) => (typeof v === 'bigint' ? Number(v) : v)

async function tableExists(t) {
  const r = await q(`select to_regclass('public.${t}')::text as t`)
  return r[0].t !== null
}
async function colExists(t, c) {
  const r = await q(`select 1 as x from information_schema.columns where table_name='${t}' and column_name='${c}' limit 1`)
  return r.length > 0
}
async function count(t, where = '') {
  const r = await q(`select count(*)::int as c from public."${t}" ${where}`)
  return num(r[0].c)
}

const EXPECTED_TABLES = [
  'domain_events',
  'event_outbox',
  'event_audit_feed',
  'intelligence_projection_checkpoint',
  'intelligence_league_snapshot',
  'intelligence_manager_snapshot',
  'intelligence_processed_event',
]
const G15_MIGRATIONS = [
  '20260627010000_add_event_foundation',
  '20260627020000_add_event_projections',
  '20260627030000_add_outbox_claim',
  '20260627040000_add_intelligence_read_models',
]

;(async () => {
  let host = '(unparsable)'
  try {
    host = new URL(url.replace(/^postgres(ql)?:\/\//, 'http://')).host
  } catch {
    /* ignore */
  }

  const report = { host, generatedAt: new Date().toISOString(), tables: {}, columns: {}, counts: {}, relay: {}, migrations: {} }

  for (const t of EXPECTED_TABLES) report.tables[t] = await tableExists(t)

  if (report.tables.event_outbox) {
    report.columns.event_outbox = {
      claimedBy: await colExists('event_outbox', 'claimedBy'),
      claimedAt: await colExists('event_outbox', 'claimedAt'),
    }
    const byStatus = await q(`select status, count(*)::int as c from public."event_outbox" group by status`)
    report.relay.outboxByStatus = Object.fromEntries(byStatus.map((r) => [r.status, num(r.c)]))
    report.relay.deadLettered = report.relay.outboxByStatus.dead ?? 0
    const last = await q(`select max("dispatchedAt") as last from public."event_outbox" where status='dispatched'`)
    report.relay.lastDispatchedAt = last[0].last ?? null
  }

  if (report.tables.domain_events) report.counts.domainEvents = await count('domain_events')
  if (report.tables.event_audit_feed) report.counts.auditFeed = await count('event_audit_feed')
  if (report.tables.intelligence_league_snapshot) report.counts.leagueSnapshots = await count('intelligence_league_snapshot')
  if (report.tables.intelligence_manager_snapshot) report.counts.managerSnapshots = await count('intelligence_manager_snapshot')
  if (report.tables.intelligence_processed_event) report.counts.processedEvents = await count('intelligence_processed_event')

  if (await tableExists('_prisma_migrations')) {
    const recorded = await q(
      `select migration_name from public."_prisma_migrations" where migration_name = any(array[${G15_MIGRATIONS.map((m) => `'${m}'`).join(',')}]) order by migration_name`,
    )
    const set = new Set(recorded.map((r) => r.migration_name))
    report.migrations.recorded = G15_MIGRATIONS.filter((m) => set.has(m))
    report.migrations.missingFromHistory = G15_MIGRATIONS.filter((m) => !set.has(m))
  } else {
    report.migrations = '(_prisma_migrations table not found — migrations not tracked here)'
  }

  report.allTablesPresent = EXPECTED_TABLES.every((t) => report.tables[t])
  console.log(JSON.stringify(report, null, 2))
  await prisma.$disconnect()
})().catch((e) => {
  console.error('ERR', e.message)
  process.exit(1)
})
