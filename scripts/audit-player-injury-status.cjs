#!/usr/bin/env node
/**
 * READ-ONLY: is `SportsPlayerRecord.injuryStatus` actually populated?
 *
 * WHY THIS MATTERS: `crossLeaguePlayerPortfolio.ts:123` derives InjuryStatus
 * from the raw player status + availability category — NOT from the
 * `sportsInjury` table. So the 311 fresh Rolling Insights rows may never reach
 * `playerUrgency.ts`, which is the "OUT and still starting, N minutes to lock"
 * detection that is the whole point of the Player Command Center.
 *
 * Determines the wiring job before any code is written:
 *   populated + varied -> urgency has real data; job is reconciling two sources
 *   all null/one value -> urgency has been computing off nothing; the read port
 *                         IS the fix, and a bigger one than scoped
 *   sparse             -> both feeds partial; the port should merge them
 *
 * No writes.
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const sport = process.argv[2] || 'NFL'
  console.log(`\n=== SportsPlayerRecord.injuryStatus coverage — ${sport} ===\n`)

  const total = await prisma.sportsPlayerRecord.count({ where: { sport } })
  const withStatus = await prisma.sportsPlayerRecord.count({
    where: { sport, injuryStatus: { not: null } },
  })
  console.log(`players:            ${total}`)
  console.log(`with injuryStatus:  ${withStatus} (${total ? ((withStatus / total) * 100).toFixed(1) : 0}%)`)

  if (withStatus > 0) {
    const grouped = await prisma.sportsPlayerRecord.groupBy({
      by: ['injuryStatus'],
      where: { sport, injuryStatus: { not: null } },
      _count: { _all: true },
    })
    console.log('\n--- status vocabulary ---')
    for (const g of grouped.sort((a, b) => b._count._all - a._count._all).slice(0, 20)) {
      console.log(`  ${String(g.injuryStatus).padEnd(22)} ${g._count._all}`)
    }

    // Freshness: a populated-but-frozen column is the same trap as sportsInjury.
    const newest = await prisma.sportsPlayerRecord.findFirst({
      where: { sport, injuryStatus: { not: null } },
      orderBy: { lastUpdated: 'desc' },
      select: { lastUpdated: true, name: true, injuryStatus: true },
    })
    if (newest) {
      const h = (Date.now() - newest.lastUpdated.getTime()) / 3_600_000
      console.log(`\nnewest row with a status: ${h.toFixed(1)}h ago (${newest.name} = ${newest.injuryStatus})`)
    }
  }

  // Cross-check: do the two sources agree on who is hurt right now?
  const liveInjuries = await prisma.sportsInjury.count({
    where: { sport, expiresAt: { gt: new Date() } },
  })
  console.log(`\nlive sportsInjury rows (RI, unexpired): ${liveInjuries}`)

  console.log('\n--- verdict ---')
  if (withStatus === 0) {
    console.log('  injuryStatus is EMPTY -> urgency has been computing severity from nothing.')
    console.log('  Wiring the read port into the portfolio IS the fix.')
  } else if (withStatus < total * 0.02) {
    console.log('  injuryStatus is SPARSE -> partial feed; merge with sportsInjury via the port.')
  } else {
    console.log('  injuryStatus is POPULATED -> two sources exist; reconcile rather than replace.')
    console.log('  Check the vocabulary above against toInjuryStatus() RAW_STATUS_MAP.')
  }
}

main()
  .catch((e) => {
    console.error('audit failed:', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
