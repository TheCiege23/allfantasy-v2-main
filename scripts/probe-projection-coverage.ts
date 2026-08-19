/**
 * F2.5 Projection coverage probe — READ-ONLY, non-prod only.
 * Usage: DATABASE_URL=<staging> npx tsx scripts/probe-projection-coverage.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({ log: [] })

void (async () => {
  const host = process.env.DATABASE_URL?.match(/@([^/]+)\//)?.[1] ?? 'unknown'
  console.log(`DB host: ${host}`)
  if (host.includes('ep-spring-tooth')) {
    console.error('HARD REFUSE: prod host detected — run against non-prod only')
    process.exit(1)
  }

  // FantasyProjection
  const total = await prisma.fantasyProjection.count()
  const fresh = await prisma.fantasyProjection.count({ where: { expiresAt: { gt: new Date() } } })
  const byScoringPreset = await prisma.fantasyProjection.groupBy({ by: ['scoringPresetId'], _count: { _all: true } })
  const bySource = await prisma.fantasyProjection.groupBy({ by: ['source'], _count: { _all: true } })
  const bySeason = await prisma.fantasyProjection.groupBy({ by: ['season'], _count: { _all: true } })
  const byWeek = await prisma.fantasyProjection.groupBy({ by: ['week'], _count: { _all: true } })
  const sample = await prisma.fantasyProjection.findFirst({
    orderBy: { fetchedAt: 'desc' },
    select: { playerId: true, sport: true, season: true, week: true, scoringPresetId: true, projectedPoints: true, source: true, fetchedAt: true, expiresAt: true },
  })

  console.log(`\n=== FantasyProjection ===`)
  console.log(`Total rows:                ${total}`)
  console.log(`Fresh (expiresAt > now):   ${fresh}`)
  console.log(`Stale:                     ${total - fresh}`)
  console.log(`By scoringPresetId:`)
  for (const r of byScoringPreset.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${r.scoringPresetId}: ${r._count._all}`)
  }
  console.log(`By source:`)
  for (const r of bySource.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${r.source}: ${r._count._all}`)
  }
  console.log(`By season:`)
  for (const r of bySeason) {
    console.log(`  ${r.season}: ${r._count._all}`)
  }
  console.log(`Top 5 weeks:`)
  for (const r of byWeek.sort((a, b) => b.week - a.week).slice(0, 5)) {
    console.log(`  week ${r.week}: ${r._count._all}`)
  }
  console.log(`Newest row:`, JSON.stringify(sample, null, 2))

  // AFProjectionSnapshot
  const afTotal = await prisma.aFProjectionSnapshot.count()
  const afFresh = await prisma.aFProjectionSnapshot.count({ where: { validUntil: { gt: new Date() } } })
  const afBySport = await prisma.aFProjectionSnapshot.groupBy({ by: ['sport'], _count: { _all: true } })
  const afBySeason = await prisma.aFProjectionSnapshot.groupBy({ by: ['season'], _count: { _all: true } })
  const afSample = await prisma.aFProjectionSnapshot.findFirst({
    orderBy: { computedAt: 'desc' },
    select: { playerId: true, sport: true, season: true, week: true, baselineProjection: true, afProjection: true, confidenceLevel: true, computedAt: true, validUntil: true },
  })

  console.log(`\n=== AFProjectionSnapshot ===`)
  console.log(`Total rows:                ${afTotal}`)
  console.log(`Fresh (validUntil > now):  ${afFresh}`)
  console.log(`By sport:`)
  for (const r of afBySport) {
    console.log(`  ${r.sport}: ${r._count._all}`)
  }
  console.log(`By season:`)
  for (const r of afBySeason) {
    console.log(`  ${r.season}: ${r._count._all}`)
  }
  console.log(`Newest row:`, JSON.stringify(afSample, null, 2))

  await prisma.$disconnect()
  process.exit(0)
})()
