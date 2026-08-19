/**
 * F2.3 injury/status coverage probe — READ-ONLY, non-prod only.
 * Usage: DATABASE_URL=<staging> npx tsx scripts/probe-injury-coverage.ts
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

  const total = await prisma.sportsPlayer.count()
  const withStatus = await prisma.sportsPlayer.count({ where: { status: { not: null } } })
  // Prisma 5.22 doesn't support null checks on DateTime fields in WHERE — use GT from epoch instead
  const epoch = new Date(0)
  const withExpiry = await prisma.sportsPlayer.count({ where: { expiresAt: { gt: epoch } } })
  const withFetchedAt = await prisma.sportsPlayer.count({ where: { fetchedAt: { gt: epoch } } })

  console.log(`SportsPlayer total:   ${total}`)
  console.log(`with status:          ${withStatus}`)
  console.log(`with expiresAt:       ${withExpiry}`)
  console.log(`with fetchedAt:       ${withFetchedAt}`)

  const sample = await prisma.sportsPlayer.findMany({
    where: { status: { not: null } },
    take: 3,
    select: { externalId: true, sleeperId: true, status: true, source: true, fetchedAt: true, expiresAt: true },
  })
  console.log('sample:', JSON.stringify(sample, null, 2))

  await prisma.$disconnect()
  process.exit(0)
})()
