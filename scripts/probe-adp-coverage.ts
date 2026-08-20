/**
 * F2.4 ADP/market-value coverage probe — READ-ONLY, non-prod only.
 * Usage: DATABASE_URL=<staging> npx tsx scripts/probe-adp-coverage.ts
 */
import { PrismaClient } from '@prisma/client'
import { assertNonProductionDbTarget } from './_db-target-identity'

const prisma = new PrismaClient({ log: [] })

void (async () => {
  assertNonProductionDbTarget({ script: 'probe-adp-coverage', action: 'reads coverage counts' })

  // AdpDataRecord counts
  const adpTotal = await prisma.adpDataRecord.count()
  const epoch = new Date(0)
  const adpFormats = await prisma.adpDataRecord.groupBy({ by: ['format', 'scoring'], _count: { _all: true } })
  const adpSources = await prisma.adpDataRecord.groupBy({ by: ['source'], _count: { _all: true } })
  const adpSeasons = await prisma.adpDataRecord.groupBy({ by: ['season'], _count: { _all: true } })
  const adpFreshCount = await prisma.adpDataRecord.count({ where: { createdAt: { gt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } } })

  console.log(`\n=== AdpDataRecord ===`)
  console.log(`Total rows:       ${adpTotal}`)
  console.log(`Fresh (<7 days):  ${adpFreshCount}`)
  console.log(`By format/scoring:`)
  for (const row of adpFormats.sort((a, b) => b._count._all - a._count._all).slice(0, 10)) {
    console.log(`  ${row.format} / ${row.scoring}: ${row._count._all}`)
  }
  console.log(`By source:`)
  for (const row of adpSources.sort((a, b) => b._count._all - a._count._all).slice(0, 6)) {
    console.log(`  ${row.source}: ${row._count._all}`)
  }
  console.log(`By season:`)
  for (const row of adpSeasons.sort((a, b) => b._count._all - a._count._all).slice(0, 4)) {
    console.log(`  ${row.season}: ${row._count._all}`)
  }

  // AllFantasyMarketPlayerValue counts
  const mvTotal = await prisma.allFantasyMarketPlayerValue.count()
  const mvPublished = await prisma.allFantasyMarketPlayerValue.count({ where: { published: true } })
  const mvConcepts = await prisma.allFantasyMarketPlayerValue.groupBy({ by: ['leagueConcept'], _count: { _all: true } })
  const mvDirections = await prisma.allFantasyMarketPlayerValue.groupBy({ by: ['direction'], _count: { _all: true } })

  console.log(`\n=== AllFantasyMarketPlayerValue ===`)
  console.log(`Total rows:      ${mvTotal}`)
  console.log(`Published:       ${mvPublished}`)
  console.log(`By leagueConcept:`)
  for (const row of mvConcepts) {
    console.log(`  ${row.leagueConcept}: ${row._count._all}`)
  }
  console.log(`By direction:`)
  for (const row of mvDirections) {
    console.log(`  ${row.direction}: ${row._count._all}`)
  }

  // Sample ADP row
  const adpSample = await prisma.adpDataRecord.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { playerId: true, adp: true, format: true, scoring: true, source: true, season: true, week: true, createdAt: true },
  })
  console.log(`\nNewest ADP row:`, JSON.stringify(adpSample, null, 2))

  await prisma.$disconnect()
  process.exit(0)
})()
