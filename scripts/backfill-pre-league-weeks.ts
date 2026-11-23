/**
 * Load the weeks a late-starting league missed (lib/redraft/preLeagueWeeks.ts) for a season that was
 * drafted before that existed, or whose draft-time load failed.
 *
 *   npx tsx scripts/backfill-pre-league-weeks.ts --season=<redraftSeasonId>
 *
 * The first league week defaults to the earliest week the season already has matchups for; pass
 * --first-week=<n> to override. Idempotent: weeks that already have matchups are left alone.
 *
 * ⚠ It writes to whatever DATABASE_URL resolves to — and with none exported, Prisma loads `.env`,
 * which is production in this repo (CLAUDE.md, "A local-looking test is not a local test").
 */
import { prisma } from '@/lib/prisma'
import { backfillPreLeagueWeeks } from '@/lib/redraft/preLeagueWeeks'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3).trim() || undefined : undefined
}

async function main() {
  const seasonId = arg('season')
  if (!seasonId) throw new Error('--season=<redraftSeasonId> is required')

  let firstWeek = Number(arg('first-week'))
  if (!Number.isInteger(firstWeek) || firstWeek < 1) {
    const earliest = await prisma.redraftMatchup.findFirst({
      where: { seasonId, type: { not: 'pre_league' } },
      orderBy: { week: 'asc' },
      select: { week: true },
    })
    if (!earliest) throw new Error(`season ${seasonId} has no schedule to start from`)
    firstWeek = earliest.week
  }

  console.log(`season ${seasonId}: loading weeks 1..${firstWeek - 1}`)
  const result = await backfillPreLeagueWeeks({ seasonId, firstLeagueWeek: firstWeek })
  console.log(JSON.stringify(result, null, 2))
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
