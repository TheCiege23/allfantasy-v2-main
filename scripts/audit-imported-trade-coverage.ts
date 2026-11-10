/** Read-only aggregate coverage for saved Yahoo, ESPN and Fantrax Soccer leagues. */
import { prisma } from '@/lib/prisma'
import { loadImportedTradeIdentityCoverage } from '@/lib/decision-os/trade/sportPointsContext'

async function main() {
  const leagues = await prisma.league.findMany({
    where: {
      OR: [
        { platform: 'espn', sport: { in: ['NBA', 'NHL', 'MLB', 'NCAAF'] } },
        { platform: 'yahoo', sport: { in: ['NBA', 'NHL', 'MLB'] } },
        { platform: 'fantrax', sport: 'SOCCER' },
      ],
    },
    orderBy: { id: 'asc' }, take: 101,
    select: { id: true, sport: true, platform: true },
  })
  const summary = new Map<string, { leagues: number; rostered: number; linked: number }>()
  for (const league of leagues.slice(0, 100)) {
    const key = league.platform + '/' + league.sport
    const row = summary.get(key) ?? { leagues: 0, rostered: 0, linked: 0 }
    const coverage = await loadImportedTradeIdentityCoverage(league)
    summary.set(key, { leagues: row.leagues + 1, rostered: row.rostered + coverage.rostered, linked: row.linked + coverage.linked })
  }
  console.log(JSON.stringify({ coverage: Object.fromEntries(summary), truncated: leagues.length > 100 }))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : 'Coverage audit failed.')
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
