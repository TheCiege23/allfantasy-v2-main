/**
 * F2.6 Weather coverage probe — READ-ONLY, non-prod only.
 * Usage: DATABASE_URL=<staging> npx tsx scripts/probe-weather-coverage.ts
 */
import { PrismaClient } from '@prisma/client'
import { assertNonProductionDbTarget } from './_db-target-identity'

const prisma = new PrismaClient({ log: [] })

void (async () => {
  assertNonProductionDbTarget({ script: 'probe-weather-coverage', action: 'reads coverage counts' })

  const db = (prisma as unknown as Record<string, unknown>)

  const wc = db['weatherCache'] as {
    count(args?: unknown): Promise<number>
    groupBy(args: unknown): Promise<Array<Record<string, unknown>>>
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>
  }

  const total = await wc.count()
  const fresh = await wc.count({ where: { expiresAt: { gt: new Date() } } })
  const bySport = await wc.groupBy({ by: ['sport'], _count: { _all: true } })
  const bySource = await wc.groupBy({ by: ['dataSource'], _count: { _all: true } })
  const samples = await wc.findMany({
    orderBy: { fetchedAt: 'desc' },
    take: 3,
    select: {
      cacheKey: true,
      sport: true,
      temperatureF: true,
      windSpeedMph: true,
      conditionLabel: true,
      isIndoor: true,
      isDome: true,
      roofClosed: true,
      fetchedAt: true,
      expiresAt: true,
      dataSource: true,
      eventId: true,
    },
  })

  console.log(`\n=== WeatherCache ===`)
  console.log(`Total rows:               ${total}`)
  console.log(`Fresh (expiresAt > now):  ${fresh}`)
  console.log(`By sport:                 ${JSON.stringify(bySport)}`)
  console.log(`By dataSource:            ${JSON.stringify(bySource)}`)
  console.log(`\nNewest 3 rows:`)
  for (const s of samples) {
    console.log(JSON.stringify(s, null, 2))
  }

  await prisma.$disconnect()
  process.exit(0)
})()
