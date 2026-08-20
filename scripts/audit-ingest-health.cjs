#!/usr/bin/env node
/**
 * READ-ONLY ingest health report for every domain a Rolling-Insights-backed cron
 * should be filling.
 *
 * WHY: `import-projections` returned ok:true daily for a month while writing zero
 * rows, and nothing surfaced it. Every sibling cron shares that risk profile.
 * Before building the AF projection engine (Phase 1 of
 * AF_PROJECTIONS_ENGINE_BRIEF.md) we need to know which upstream domains are
 * actually populated — the engine consumes player stats, depth charts, injuries
 * and schedule, so a silent failure in any of them poisons it from day one.
 *
 * Reads counts and the newest timestamp per table. No writes.
 *
 * STALENESS is judged against each domain's own cron cadence (vercel.json), not
 * a single global threshold — `import-schedules` runs weekly, `import-scores`
 * every 2 minutes.
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

/**
 * model         Prisma delegate name
 * dateField     the freshness column
 * cron          the vercel.json job expected to advance it
 * maxAgeHours   how old is acceptable before it counts as stale
 * feeds         what breaks downstream when this is empty
 */
const DOMAINS = [
  { model: 'sportsPlayerRecord', dateField: 'lastUpdated', cron: 'import-players (0 */6 * * *)', maxAgeHours: 12, feeds: 'player identity, positions, headshots' },
  { model: 'player', dateField: 'updatedAt', cron: 'players sync', maxAgeHours: 24 * 14, feeds: 'canonical identity resolution' },
  { model: 'sportsInjury', dateField: 'fetchedAt', cron: 'import-injuries (*/15 * * * *)', maxAgeHours: 2, feeds: 'urgency, availability, Player Command Center' },
  { model: 'injuryReportRecord', dateField: 'reportDate', cron: 'import-injuries', maxAgeHours: 24 * 3, feeds: 'injury detail' },
  { model: 'sportsGame', dateField: 'fetchedAt', cron: 'import-schedules / import-scores', maxAgeHours: 24 * 8, feeds: 'time-to-lock, opponent, bye detection' },
  { model: 'gameSchedule', dateField: 'fetchedAt', cron: 'import-schedules (0 3 * * 1)', maxAgeHours: 24 * 8, feeds: 'schedule world state' },
  { model: 'fantasyScheduleGame', dateField: 'fetchedAt', cron: 'import-schedules', maxAgeHours: 24 * 8, feeds: 'schedule world state' },
  { model: 'fantasyStatLine', dateField: 'fetchedAt', cron: 'import-season-stats / import-player-game-stats', maxAgeHours: 24 * 2, feeds: 'PROJECTION BASE — usage/production' },
  { model: 'fantasyProjection', dateField: 'fetchedAt', cron: 'import-projections (0 11 * * *)', maxAgeHours: 24 * 2, feeds: 'Player Command Center, replacement options, Draft VORP' },
  { model: 'aFProjectionSnapshot', dateField: 'computedAt', cron: '(none yet — Phase 2)', maxAgeHours: 24 * 2, feeds: 'AF projection engine output' },
  { model: 'sportsDataCache', dateField: 'createdAt', cron: 'various (api-chain cache)', maxAgeHours: 24, feeds: 'chain cache' },
]

function ageHours(d) {
  return d ? (Date.now() - new Date(d).getTime()) / 3_600_000 : null
}

function fmtAge(h) {
  if (h == null) return 'never'
  if (h < 1) return `${Math.round(h * 60)}m ago`
  if (h < 48) return `${h.toFixed(1)}h ago`
  return `${(h / 24).toFixed(1)}d ago`
}

async function main() {
  console.log('\n=== Production ingest health ===')
  console.log('(empty or stale => that cron is silently failing, like import-projections was)\n')

  const rows = []
  for (const d of DOMAINS) {
    const delegate = prisma[d.model]
    if (!delegate || typeof delegate.count !== 'function') {
      rows.push({ ...d, status: 'NO SUCH MODEL', count: null, age: null })
      continue
    }
    let count = null
    let latest = null
    try {
      count = await delegate.count()
      if (count > 0) {
        const newest = await delegate.findFirst({
          orderBy: { [d.dateField]: 'desc' },
          select: { [d.dateField]: true },
        })
        latest = newest ? newest[d.dateField] : null
      }
    } catch (e) {
      rows.push({ ...d, status: `ERROR: ${String(e.message).slice(0, 60)}`, count, age: null })
      continue
    }
    const h = ageHours(latest)
    const status =
      count === 0 ? 'EMPTY' : h == null ? 'NO DATE' : h > d.maxAgeHours ? 'STALE' : 'OK'
    rows.push({ ...d, status, count, age: h })
  }

  const pad = (s, n) => String(s).padEnd(n)
  console.log(
    `${pad('STATUS', 8)}${pad('TABLE', 26)}${pad('ROWS', 10)}${pad('NEWEST', 12)}CRON`,
  )
  console.log('-'.repeat(110))
  for (const r of rows) {
    console.log(
      `${pad(r.status, 8)}${pad(r.model, 26)}${pad(r.count ?? '-', 10)}${pad(fmtAge(r.age), 12)}${r.cron}`,
    )
  }

  const bad = rows.filter((r) => r.status === 'EMPTY' || r.status === 'STALE')
  if (bad.length) {
    console.log(`\n--- ${bad.length} domain(s) need attention ---`)
    for (const r of bad) {
      console.log(`\n  ${r.status}: ${r.model}`)
      console.log(`    cron:  ${r.cron}`)
      console.log(`    feeds: ${r.feeds}`)
    }
    console.log('\nEach of these is a candidate for the same silent-success failure:')
    console.log('provider returns nothing -> cron writes 0 rows -> returns ok:true -> no alert.')
  } else {
    console.log('\nAll domains populated and fresh.')
  }

  // The projection engine specifically needs these four.
  const need = ['fantasyStatLine', 'sportsGame', 'sportsInjury', 'sportsPlayerRecord']
  const blocked = rows.filter((r) => need.includes(r.model) && r.status !== 'OK')
  console.log('\n--- Phase 1 readiness (AF projection engine inputs) ---')
  if (blocked.length === 0) {
    console.log('  All four inputs are populated and fresh. Phase 1 can proceed.')
  } else {
    for (const r of blocked) console.log(`  BLOCKED: ${r.model} is ${r.status} — ${r.feeds}`)
    console.log('\n  Repair these before building the engine, or it computes from nothing.')
  }
}

main()
  .catch((e) => {
    console.error('audit failed:', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
