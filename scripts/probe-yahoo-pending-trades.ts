/**
 * First contact between the Yahoo inbox and a real Yahoo league. READ-ONLY —
 * there is no `--write`, and there is nothing this could write.
 *
 *   npx tsx scripts/probe-yahoo-pending-trades.ts 1361311
 *   npx tsx scripts/probe-yahoo-pending-trades.ts https://football.fantasysports.yahoo.com/f1/1361311/10
 *   npx tsx scripts/probe-yahoo-pending-trades.ts 1361311 --live
 *
 * WHY THIS EXISTS. The Yahoo pending-offer path ships with a caveat: the
 * endpoint, the auth context and the parser are the ones already in production
 * for imports, but the trade-leg rule and the pending-status filter are new and
 * were tested only against constructed fixtures. Three things could be true in
 * production and false in a fixture, and each fails quietly:
 *
 *   1. `League.platformLeagueId` might hold `1361311` rather than
 *      `nfl.l.1361311`. The fetch resolves either now, but this shows which it
 *      actually is.
 *   2. `LeagueTeam.externalId` must be the FULL team key (`nfl.l.1361311.t.10`)
 *      for the scan to match a trade to the viewer. If the importer stored a
 *      bare `10`, every offer silently belongs to nobody.
 *   3. Yahoo's own word for an open offer must be one this filters on. A status
 *      we do not recognise is treated as settled and never shown.
 *
 * ⚠ `--live` CALLS YAHOO with the stored connection for the league's owner. It
 * reads transactions and nothing else — Yahoo's API can accept and reject
 * trades, and none of that is reachable from here.
 *
 * ⚠ NO TOKEN IS EVER PRINTED. The probe reports whether a connection exists,
 * never what it contains.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const LIVE = process.argv.includes('--live')
const INPUT = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? ''

/** `https://football.fantasysports.yahoo.com/f1/1361311/10` -> `1361311`. */
function leagueIdFrom(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const url = trimmed.match(/fantasysports\.yahoo\.com\/f1\/(\d+)/i)
  if (url) return url[1]!
  const key = trimmed.match(/\.l\.(\d+)/)
  if (key) return key[1]!
  return /^\d+$/.test(trimmed) ? trimmed : null
}

function shapeOfTeamKey(externalId: string, leagueId: string): string {
  if (externalId.includes(`.l.${leagueId}.t.`)) return 'full team key ✓'
  if (externalId.includes('.t.')) return 'a team key for a DIFFERENT league ⚠'
  if (/^\d+$/.test(externalId)) return 'bare team number ⚠ — the scan will match nothing'
  return 'unrecognised ⚠'
}

async function main() {
  const yahooId = leagueIdFrom(INPUT)
  if (!yahooId) {
    console.error('Give a Yahoo league id, key, or league URL.')
    process.exit(1)
  }
  console.log(`Yahoo league id: ${yahooId}${LIVE ? '  (live)' : '  (local checks only)'}`)

  /*
   * Matched three ways because the importer accepts three shapes and we do not
   * yet know which one this league was stored under — that is half the point.
   */
  const leagues = await prisma.league.findMany({
    where: {
      platform: { equals: 'yahoo', mode: 'insensitive' },
      OR: [
        { platformLeagueId: yahooId },
        { platformLeagueId: { contains: `.l.${yahooId}` } },
        { platformLeagueId: { endsWith: yahooId } },
      ],
    },
    select: { id: true, name: true, season: true, platformLeagueId: true, userId: true },
  })

  if (leagues.length === 0) {
    console.log('\nNo Yahoo league in the database matches that id.')
    console.log('Nothing is wrong with the inbox — this league has not been imported.')
    return
  }

  for (const league of leagues) {
    console.log(`\n── ${league.name ?? 'League'}  (${league.season ?? 'no season'})`)
    console.log(`   League.id           ${league.id}`)
    console.log(`   platformLeagueId    ${league.platformLeagueId}`)
    console.log(
      `   stored as           ${
        league.platformLeagueId?.includes('.l.') ? 'a full league key' : 'a bare id (resolved at fetch time)'
      }`,
    )

    const teams = await prisma.leagueTeam.findMany({
      where: { leagueId: league.id },
      select: { externalId: true, teamName: true, claimedByUserId: true },
    })
    console.log(`   teams               ${teams.length}`)

    const shapes = new Map<string, number>()
    for (const t of teams) {
      const k = shapeOfTeamKey(String(t.externalId), yahooId)
      shapes.set(k, (shapes.get(k) ?? 0) + 1)
    }
    for (const [k, n] of shapes) console.log(`   externalId          ${n} × ${k}`)
    if (teams[0]) console.log(`   example externalId  ${teams[0].externalId}`)

    const claimed = teams.filter((t) => t.claimedByUserId)
    console.log(`   claimed teams       ${claimed.length} of ${teams.length}`)
    if (claimed.length === 0) {
      console.log('   ⚠ the scan refuses without a claimed team — it would not know whose offers to read')
    }

    const auth = await (prisma as any).leagueAuth
      .findUnique({
        where: { userId_platform: { userId: league.userId, platform: 'yahoo' } },
        select: { userId: true, updatedAt: true },
      })
      .catch(() => null)
    console.log(
      `   Yahoo connection    ${auth ? `present (updated ${auth.updatedAt?.toISOString?.() ?? 'unknown'})` : 'MISSING — connect Yahoo in League Sync'}`,
    )

    if (!LIVE) continue
    if (!auth) {
      console.log('   skipping the live call: no Yahoo connection for this league owner.')
      continue
    }

    const { fetchYahooPendingTrades } = await import('@/lib/league-import/yahoo/YahooLeagueFetchService')
    const result = await fetchYahooPendingTrades(league.userId, league.platformLeagueId ?? yahooId)

    if (!result.ok) {
      console.log(`   live read           refused: ${result.reason}`)
      continue
    }
    console.log(`   live read           ${result.trades.length} pending trade(s)`)
    for (const t of result.trades) {
      const adds = Object.keys(t.adds ?? {}).length
      const drops = Object.keys(t.drops ?? {}).length
      console.log(`     ${t.transactionId}  status=${t.status}  teams=${t.teamKeys.join(' ')}`)
      console.log(
        `       adds=${adds} drops=${drops}${
          adds === 0 && drops === 0
            ? '  ⚠ no movement recorded — the trade-leg rule did not fire on this payload'
            : ''
        }`,
      )
    }
    if (result.trades.length === 0) {
      console.log('   Nothing pending right now. That is a real answer, not a failure —')
      console.log('   propose a trade in Yahoo and run this again to see the rule fire.')
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
