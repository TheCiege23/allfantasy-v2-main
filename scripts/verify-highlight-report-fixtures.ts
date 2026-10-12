/** PostgreSQL semantic check using SELECT-only fixture CTEs that shadow both real tables.
 * Run: railway run --project <id> --environment <id> --service <web-id> -- node --import tsx scripts/verify-highlight-report-fixtures.ts
 * No application rows are read or written; the transaction is READ ONLY with a 15s statement timeout.
 */
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { getHighlightReport } from '../lib/analytics/highlightReport'
import { HIGHLIGHTS } from '../lib/analytics/highlights'
const now = new Date('2026-10-12T12:00:00Z')
const literal = (s: string) => "'" + s.replaceAll("'", "''") + "'"
const events: string[] = []
let nextId = 1
function add(user: string | null, time: string, event = HIGHLIGHTS.VIEW, viewId?: string, tool = 'af_product', status = 'clips') {
  const id = viewId ?? '12345678-1234-4234-8234-' + String(nextId++).padStart(12, '0')
  const meta = event === HIGHLIGHTS.VIEW ? { surface: 'my_team', viewId: id, status, clipCount: status === 'clips' ? 1 : 0, visibility: 'header' } : { surface: 'my_team', viewId: id, kind: 'play' }
  events.push(`(${literal(event)}, ${user === null ? 'NULL' : literal(user)}, ${literal(JSON.stringify(meta))}::jsonb, ${literal(time)}::timestamp, ${literal(tool)})`)
  return id
}
for (const u of ['a','b','c','d','f','g','h']) add(u, '2026-10-04 12:00:00')
const a = add('a', '2026-10-09 00:30:00') // Thursday ET, despite Friday UTC.
add('a', '2026-10-09 00:30:00', HIGHLIGHTS.VIEW, a) // Duplicate delivery.
add('a', '2026-10-09 00:30:01', HIGHLIGHTS.LOAD, a)
add('a', '2026-10-09 00:30:02', HIGHLIGHTS.READY, a)
add('a', '2026-10-09 00:30:03', HIGHLIGHTS.READY, a)
add('b', '2026-10-05 01:00:00', HIGHLIGHTS.VIEW, undefined, 'af_product', 'empty') // Same Sunday ET.
add('c', '2026-10-09 05:00:00') // Friday; only postponed NFL / active NBA game.
add('d', '2026-10-12 11:00:00') // More than seven days after first exposure.
add('e', '2026-10-10 12:00:00'); add('e', '2026-10-11 18:00:00') // Immature cohort, even though it returned.
add('f', '2026-10-06 18:00:00') // Cancelled Tuesday.
add('g', '2026-10-05 20:00:00'); add('h', '2026-10-08 20:00:00') // Monday and Thursday qualify.
add(null, '2026-10-04 12:00:00'); add('wrong-tool', '2026-10-04 12:00:00', HIGHLIGHTS.VIEW, undefined, 'other')
add('orphan-action', '2026-10-04 12:00:00', HIGHLIGHTS.LOAD)
const fixtures = `WITH "AnalyticsEvent"("event","userId","meta","createdAt","toolKey") AS (VALUES ${events.join(',')}),
  "SportsGame"("sport","startTime","status") AS (VALUES
    ('NFL','2026-10-04 17:00:00'::timestamp,'final'), ('NFL','2026-10-05 23:00:00'::timestamp,'final'),
    ('NFL','2026-10-08 23:00:00'::timestamp,'final'), ('NFL','2026-10-11 17:00:00'::timestamp,'final'),
    ('NFL','2026-10-06 17:00:00'::timestamp,'cancelled'), ('NFL','2026-10-09 17:00:00'::timestamp,'postponed'),
    ('NBA','2026-10-09 17:00:00'::timestamp,'final')),
`
async function main() {
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    await tx.$executeRawUnsafe('SET LOCAL statement_timeout = 15000')
    const db = { $queryRaw: (sql: Prisma.Sql) => tx.$queryRawUnsafe(fixtures + sql.text.trim().replace(/^WITH\s+/, ''), ...sql.values) } as Pick<typeof prisma, '$queryRaw'>
    const report = await getHighlightReport(now, db)
    assert.deepEqual(report.returns, { cohort: 8, matured: 7, pending: 1, returned: 3, scheduledDays: 4, rate: 3/7, status: 'measured' })
    const team = report.surfaces.find(s => s.surface === 'my_team')!
    assert.equal(team.views, 16); assert.equal(team.users, 8); assert.equal(team.empty, 1)
    assert.equal(team.withClips, 15); assert.equal(team.loadViews, 1); assert.equal(team.readyViews, 1)
    assert.equal(team.availabilityRate, 15/16)
    console.log('PostgreSQL fixture checks passed: deduplication, auth population, ET midnight, weekdays, mature cohorts, seven-day bounds, cancelled/postponed games.')
  }, { timeout: 20000, maxWait: 5000 })
}
main().catch(() => { console.error('Read-only highlight report fixture check failed'); process.exitCode = 1 }).finally(() => prisma.$disconnect())
