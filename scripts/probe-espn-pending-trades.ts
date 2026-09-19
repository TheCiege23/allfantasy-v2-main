/**
 * Can ESPN answer "show me my open trade offers"? READ-ONLY — there is no `--write`, and there is
 * nothing here that could write.
 *
 *   npx tsx scripts/probe-espn-pending-trades.ts 123456
 *   npx tsx scripts/probe-espn-pending-trades.ts https://fantasy.espn.com/football/league?leagueId=123456
 *   npx tsx scripts/probe-espn-pending-trades.ts 123456 --live
 *
 * 🛑 THIS PROBE ASKS A DIFFERENT QUESTION FROM ITS YAHOO SIBLING, AND THE DIFFERENCE IS THE POINT.
 * `probe-yahoo-pending-trades.ts` exercises a pending-offer path that EXISTS
 * (`fetchYahooPendingTrades` → `scanPendingYahooTrades`) and checks whether real data fits it.
 * ESPN has no such path — `lib/provider-trades/` holds a Sleeper scanner and a Yahoo scanner and
 * nothing else — so there is nothing to exercise. What can be established is whether the data
 * needed to build one is reachable at all, and that is what this reports.
 *
 * WHAT WOULD HAVE TO BE TRUE, and why none of it is safe to assume:
 *
 *   1. ESPN's feed would have to carry trades at all. `parseEspnTransactions` maps exactly ONE
 *      trade code (`messageTypeId` 244). Measured on production 2026-09-08: ESPN leagues held 39
 *      transaction rows — waiver/add/drop only — and ZERO trades, while Sleeper held 18,657. That
 *      is consistent with two very different worlds: these leagues genuinely traded nothing, or
 *      ESPN sends trades under codes we do not know.
 *   2. It would have to distinguish an OPEN offer from a completed one. The parser reads
 *      `topic.status`, defaulting to `processed`. Whether ESPN ever emits anything else here is
 *      unverified.
 *   3. The offer would have to name both sides. A pending offer that lists only the proposer is
 *      not gradeable.
 *
 * ⚠ IT DELIBERATELY DOES NOT GUESS CODES. There is no ESPN contract under `contracts/`, so a code
 * added from memory would silently MISLABEL real transactions — worse than dropping them, which is
 * the reasoning already written into `parseEspnTransactions`. This probe reports the unmapped
 * `messageTypeId` histogram verbatim and leaves the interpretation to a human with a live league.
 *
 * ⚠ `--live` CALLS ESPN with the stored connection for the league's owner. It reads the league's
 * `mTeam` view and its communication (activity) feed, and nothing else.
 *
 * ⚠ NO CREDENTIAL IS EVER PRINTED. The probe reports whether SWID and espn_s2 are present, never
 * what they contain.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const LIVE = process.argv.includes('--live')
const INPUT = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? ''

/** `https://fantasy.espn.com/football/league?leagueId=123456` -> `123456`. */
function leagueIdFrom(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const query = trimmed.match(/[?&]leagueId=(\d+)/i)
  if (query) return query[1]!
  const path = trimmed.match(/espn\.com\/.*?\/(\d{4,})/i)
  if (path) return path[1]!
  return /^\d+$/.test(trimmed) ? trimmed : null
}

/**
 * ESPN team ids are small integers scoped to the league — `1`, `2`, … — unlike Yahoo's full team
 * keys. A bare number is CORRECT here; the failure mode is the opposite one.
 */
function shapeOfTeamId(externalId: string): string {
  if (/^\d{1,3}$/.test(externalId)) return 'ESPN team id ✓'
  if (externalId.includes('.t.')) return 'a Yahoo team key ⚠ — wrong provider'
  return 'unrecognised ⚠'
}

async function main() {
  const espnId = leagueIdFrom(INPUT)
  if (!espnId) {
    console.error('Give an ESPN league id or a league URL.')
    process.exit(1)
  }
  console.log(`ESPN league id: ${espnId}${LIVE ? '  (live)' : '  (local checks only)'}`)

  const leagues = await prisma.league.findMany({
    where: {
      platform: { equals: 'espn', mode: 'insensitive' },
      OR: [{ platformLeagueId: espnId }, { platformLeagueId: { endsWith: espnId } }],
    },
    select: { id: true, name: true, season: true, platformLeagueId: true, userId: true },
  })

  if (leagues.length === 0) {
    console.log('\nNo ESPN league in the database matches that id.')
    console.log('Nothing is broken — this league has not been imported.')
    return
  }

  for (const league of leagues) {
    console.log(`\n── ${league.name ?? 'League'}  (${league.season ?? 'no season'})`)
    console.log(`   League.id           ${league.id}`)
    console.log(`   platformLeagueId    ${league.platformLeagueId}`)

    const teams = await prisma.leagueTeam.findMany({
      where: { leagueId: league.id },
      select: { externalId: true, teamName: true, claimedByUserId: true },
    })
    console.log(`   teams               ${teams.length}`)

    const shapes = new Map<string, number>()
    for (const t of teams) {
      const k = shapeOfTeamId(String(t.externalId))
      shapes.set(k, (shapes.get(k) ?? 0) + 1)
    }
    for (const [k, n] of shapes) console.log(`   externalId          ${n} × ${k}`)
    if (teams[0]) console.log(`   example externalId  ${teams[0].externalId}`)

    const claimed = teams.filter((t) => t.claimedByUserId)
    console.log(`   claimed teams       ${claimed.length} of ${teams.length}`)
    if (claimed.length === 0) {
      console.log('   ⚠ any future scan would refuse — it would not know whose offers to read')
    }

    const auth = await (prisma as any).leagueAuth
      .findUnique({
        where: { userId_platform: { userId: league.userId, platform: 'espn' } },
        select: { espnSwid: true, espnS2: true, updatedAt: true },
      })
      .catch(() => null)
    const hasBoth = Boolean(auth?.espnSwid && auth?.espnS2)
    console.log(
      `   ESPN connection     ${
        !auth
          ? 'MISSING — connect ESPN in League Sync'
          : hasBoth
            ? `SWID + espn_s2 present (updated ${auth.updatedAt?.toISOString?.() ?? 'unknown'})`
            : '⚠ INCOMPLETE — a private-league read needs BOTH SWID and espn_s2'
      }`,
    )

    if (!LIVE) continue
    if (!hasBoth) {
      console.log('   skipping the live call: no usable ESPN connection for this league owner.')
      continue
    }

    const season = Number(league.season)
    if (!Number.isFinite(season)) {
      console.log('   skipping the live call: the league row carries no numeric season.')
      continue
    }

    /*
     * `parseEspnTransactions` reports the codes it had to drop through `console.warn` and nowhere
     * else — it returns only the transactions it understood. Capturing the warning is the only way
     * to see the half of the feed that matters most here, so it is captured rather than guessed at.
     */
    const warnings: string[] = []
    const realWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(' '))
    }

    let activity: Awaited<ReturnType<typeof import('@/lib/league-import/espn/EspnLeagueFetchService').fetchEspnActivityForSync>>
    try {
      const { fetchEspnActivityForSync } = await import('@/lib/league-import/espn/EspnLeagueFetchService')
      activity = await fetchEspnActivityForSync(league.userId, league.platformLeagueId ?? espnId, season)
    } catch (err) {
      console.warn = realWarn
      console.log(`   live read           refused: ${err instanceof Error ? err.message : String(err)}`)
      continue
    } finally {
      console.warn = realWarn
    }

    console.log(`   activity feed       ${activity.transactionsFetched ? 'fetched' : 'NOT AVAILABLE for this season'}`)
    console.log(`   transactions        ${activity.transactions.length}`)

    const byType = new Map<string, number>()
    const byStatus = new Map<string, number>()
    for (const t of activity.transactions) {
      byType.set(t.type, (byType.get(t.type) ?? 0) + 1)
      byStatus.set(String(t.status), (byStatus.get(String(t.status)) ?? 0) + 1)
    }
    if (byType.size > 0) {
      console.log(`   by type             ${[...byType].map(([k, n]) => `${k}×${n}`).join(', ')}`)
      console.log(`   by status           ${[...byStatus].map(([k, n]) => `${k}×${n}`).join(', ')}`)
    }

    const trades = activity.transactions.filter((t) => t.type === 'trade')
    console.log(`   trades recognised   ${trades.length}`)
    for (const t of trades.slice(0, 10)) {
      const adds = Object.keys(t.adds ?? {}).length
      const drops = Object.keys(t.drops ?? {}).length
      console.log(
        `     ${t.transactionId}  status=${t.status}  teams=${t.teamIds.join(' ')}  adds=${adds} drops=${drops}` +
          `${t.teamIds.length < 2 ? '  ⚠ only one side named — not gradeable as an offer' : ''}`,
      )
    }

    const dropped = warnings.filter((w) => w.includes('[espn-activity]'))
    if (dropped.length > 0) {
      console.log(`   unmapped messages   ${dropped.join(' | ')}`)
      console.log('   ⚠ those codes are the lead. One of them may be a trade — or a pending one —')
      console.log('     and nothing here will guess which. Propose a trade in ESPN, leave it OPEN,')
      console.log('     re-run, and see which code appears that was not there before.')
    } else if (activity.transactionsFetched) {
      console.log('   unmapped messages   none — every message in this feed has a known code')
    }

    if (trades.length === 0 && dropped.length === 0 && activity.transactionsFetched) {
      console.log('\n   Verdict for this league: the feed is fully understood and carries no trades.')
      console.log('   That is a real answer. It does not yet prove ESPN cannot report a PENDING offer —')
      console.log('   run this again with one open in ESPN before concluding either way.')
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
