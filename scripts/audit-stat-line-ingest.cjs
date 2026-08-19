#!/usr/bin/env node
/**
 * READ-ONLY: did the Phase 1 stat-line ingest actually land, and do its rows JOIN?
 *
 * The failure this checks for is the one production already measured once:
 * rows that exist but join to nothing (fantasyProjection's 43 orphan fixtures).
 * A row count alone proves nothing — the join-back rate is the real signal.
 *
 * Usage: node scripts/audit-stat-line-ingest.cjs [NFL]
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const sport = process.argv[2] || 'NFL'
  console.log(`\n=== fantasy_stat_lines ingest health — ${sport} ===\n`)

  const total = await prisma.fantasyStatLine.count({ where: { sport } })
  console.log(`rows (all sources): ${total}`)
  if (total === 0) {
    console.log('\nEMPTY — the ingest has not run or wrote nothing.')
    console.log('Run: curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/import-stat-lines')
    return
  }

  const bySource = await prisma.fantasyStatLine.groupBy({
    by: ['source', 'season'],
    where: { sport },
    _count: { _all: true },
    _max: { fetchedAt: true },
  })
  console.log('\n--- by source/season ---')
  for (const g of bySource) {
    const h = g._max.fetchedAt ? ((Date.now() - g._max.fetchedAt.getTime()) / 3_600_000).toFixed(1) : '?'
    console.log(`  ${g.source.padEnd(18)} ${String(g.season).padEnd(6)} ${String(g._count._all).padEnd(6)} newest ${h}h ago`)
  }

  // THE join check: sample 200 rows, resolve playerId against PlayerIdentityMap.
  const sample = await prisma.fantasyStatLine.findMany({
    where: { sport, source: 'rolling_insights' },
    select: { playerId: true },
    take: 200,
  })
  if (sample.length > 0) {
    const ids = [...new Set(sample.map((r) => r.playerId))]
    const found = await prisma.playerIdentityMap.count({ where: { id: { in: ids } } })
    const rate = ((found / ids.length) * 100).toFixed(1)
    console.log(`\njoin-back to PlayerIdentityMap: ${found}/${ids.length} sampled ids (${rate}%)`)
    console.log(rate === '100.0'
      ? '  PASS — every stat line keys to a real canonical player.'
      : '  FAIL — orphan ids present; the ID-namespace guard is not holding.')
  }

  // Component coverage: do offensive skill positions actually carry volume?
  const withStats = await prisma.fantasyStatLine.findMany({
    where: { sport, source: 'rolling_insights' },
    select: { stats: true },
    take: 500,
  })
  const keyUnion = new Set()
  let offensiveRows = 0
  for (const r of withStats) {
    const reg = r.stats && r.stats.regular_season
    if (reg && typeof reg === 'object') {
      for (const k of Object.keys(reg)) keyUnion.add(k)
      if ('passing_yards' in reg || 'rushing_yards' in reg || 'receiving_yards' in reg) offensiveRows++
    }
  }
  console.log(`\ncomponent key union (${keyUnion.size} keys across ${withStats.length} sampled rows):`)
  console.log('  ' + [...keyUnion].sort().join(', ').slice(0, 900))
  console.log(`rows with offensive volume components: ${offensiveRows}/${withStats.length}`)
  console.log('  (Phase 2 gate: if offensive volume is absent, there is no basis for QB/RB/WR/TE projections)')
}

main()
  .catch((e) => {
    console.error('audit failed:', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
