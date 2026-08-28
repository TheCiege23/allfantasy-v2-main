/**
 * Exercise the REDRAFT IDP ceiling end to end, against a throwaway league.
 *
 * ⚠ WHY THIS EXISTS. `IDP_CEILING_REDRAFT` was set to 5300 deliberately, but it is unreachable in
 * production: every IDP league there is dynasty, so `isDynasty` is always true at both call sites
 * and the redraft curve is never consulted. A constant that nothing executes is a constant nobody
 * has tested. This runs the real valuation down the redraft path so the first league to need it
 * is not also the first thing to try it.
 *
 * ⚠ WRITES GO ONLY TO THE TEST DATABASE. Two clients, two explicit URLs, and the write client is
 * refused unless its host is the known-safe one. Production is opened READ-ONLY, purely to copy
 * real defenders and their game lines — synthetic stat lines would prove the arithmetic works and
 * nothing about whether the curve ranks real players sensibly.
 */

import { PrismaClient } from '@prisma/client'

import { loadLeagueIdpVorp } from '@/lib/idp-projections/leagueIdpVorp'
import { idpTierValueCeiling } from '@/lib/idp-kicker-values'

const PROD_URL = process.env.AF_PROD_URL ?? ''
const TEST_URL = process.env.AF_TEST_URL ?? ''
const APPLY = process.argv.includes('--write')

/** The test branch. Anything else and this refuses to write. */
const SAFE_HOST = 'ep-muddy-leaf'

const LEAGUE_ID = 'throwaway-redraft-idp-ceiling'
const SEASON = 2025
const DEFENDER_COUNT = 220

/** A conventional IDP redraft lineup: 11 offence-ish slots plus real defensive starters. */
const ROSTER_POSITIONS = [
  'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K',
  'DL', 'DL', 'LB', 'LB', 'LB', 'DB', 'DB', 'IDP_FLEX',
  'BN', 'BN', 'BN', 'BN', 'BN', 'BN',
]

const SCORING = {
  tkl_solo: 1, tkl_ast: 0.5, sack: 4, int: 6,
  ff: 4, fum_rec: 4, pass_def: 1.5, def_td: 6, tkl_loss: 1,
}

async function main() {
  if (!PROD_URL || !TEST_URL) {
    console.error('Set AF_PROD_URL (read-only source) and AF_TEST_URL (write target).')
    process.exit(1)
  }
  if (!TEST_URL.includes(SAFE_HOST)) {
    console.error(`REFUSED: AF_TEST_URL does not point at ${SAFE_HOST}. This script only writes to the test branch.`)
    process.exit(1)
  }
  if (PROD_URL.includes(SAFE_HOST)) {
    console.error('REFUSED: AF_PROD_URL looks like the test branch; the read source and write target must differ.')
    process.exit(1)
  }

  const prod = new PrismaClient({ datasources: { db: { url: PROD_URL } } })
  const test = new PrismaClient({ datasources: { db: { url: TEST_URL } } })

  // ---- real defenders, from production, read-only -------------------------------------------
  const IDP_POS = /^(DL|LB|DB|DE|DT|CB|S|SS|FS|NT|OLB|ILB|MLB|EDGE)$/i
  const players = (
    await prod.sportsPlayer.findMany({
      where: { sport: 'NFL', source: 'sleeper', sleeperId: { not: null } },
      select: { sleeperId: true, name: true, position: true, team: true },
    })
  ).filter((p) => IDP_POS.test(String(p.position ?? '')))

  const ids = players.map((p) => p.sleeperId as string)
  const games = await prod.playerGameStat.findMany({
    where: { sportType: 'NFL', season: SEASON, playerId: { in: ids } },
    select: {
      playerId: true, season: true, weekOrRound: true, normalizedStatMap: true,
      sportType: true, opponent: true,
      /*
       * The full REQUIRED set on PlayerGameStat, read from the schema rather than discovered one
       * failure at a time: playerId, gameId, season, weekOrRound, statPayload, normalizedStatMap,
       * sportType. Omitting `gameId` made every create fail, and the swallowed error reported
       * 3,427 rows "seeded" into an empty table.
       */
      gameId: true,
      statPayload: true,
    },
  })

  // Keep only defenders with real history, so the ranking is not mostly refusals.
  const byPlayer = new Map<string, typeof games>()
  for (const g of games) {
    const a = byPlayer.get(g.playerId) ?? []
    a.push(g)
    byPlayer.set(g.playerId, a)
  }
  const withHistory = [...byPlayer.entries()].filter(([, g]) => g.length >= 4).slice(0, DEFENDER_COUNT)
  const rosterPlayerIds = withHistory.map(([id]) => id)
  console.log(`defenders with >=4 game lines in ${SEASON}: ${byPlayer.size}; using ${rosterPlayerIds.length}`)

  if (!APPLY) {
    console.log('\nDRY RUN — pass --write to seed the test database and run the valuation.')
    await prod.$disconnect()
    await test.$disconnect()
    return
  }

  // ---- seed the throwaway league into the TEST database ---------------------------------------
  await test.playerGameStat.deleteMany({ where: { season: SEASON, playerId: { in: rosterPlayerIds } } })
  /*
   * ⚠ NO PER-ROW `.catch`, AND THE COUNT IS VERIFIED FROM THE TABLE.
   * The first version swallowed each create and incremented a counter, so it reported "seeded
   * 3427 game lines" into a table that received ZERO — every insert was failing on a missing
   * required `gameId`. The valuation then said `no_projection_history`, which read as a
   * projection problem rather than a seeding one. A count of attempts is not a count of rows.
   */
  const rowsToSeed = withHistory.flatMap(([, rows]) => rows)
  await test.playerGameStat.createMany({
    data: rowsToSeed.map((r) => ({
      gameId: r.gameId,
      statPayload: (r.statPayload ?? {}) as never,
      playerId: r.playerId,
      sportType: r.sportType,
      season: r.season,
      weekOrRound: r.weekOrRound,
      opponent: r.opponent ?? null,
      normalizedStatMap: (r.normalizedStatMap ?? {}) as never,
    })),
    skipDuplicates: true,
  })
  const seeded = await test.playerGameStat.count({ where: { season: SEASON, playerId: { in: rosterPlayerIds } } })
  console.log(`attempted ${rowsToSeed.length} game lines; ${seeded} are actually in the test database`)
  if (seeded === 0) {
    console.error('REFUSED to continue: nothing was seeded, so any valuation result below would be meaningless.')
    await prod.$disconnect(); await test.$disconnect(); process.exit(1)
  }

  /*
   * `League.userId` carries a foreign key (leagues_userId_fkey), so a made-up id is rejected with
   * P2003. Borrow any existing user in the test branch rather than inventing one — creating a User
   * would drag in its own constraints for no benefit.
   */
  const anyUser = await test.appUser.findFirst({ select: { id: true } })
  if (!anyUser) {
    console.error('REFUSED: the test database has no User row to attach a throwaway league to.')
    await prod.$disconnect(); await test.$disconnect(); process.exit(1)
  }
  await test.league.deleteMany({ where: { id: LEAGUE_ID } }).catch(() => {})
  await test.league.create({
    data: {
      id: LEAGUE_ID,
      name: 'Throwaway Redraft IDP (ceiling exercise)',
      sport: 'NFL',
      season: SEASON,
      platform: 'manual',
      platformLeagueId: LEAGUE_ID,
      userId: anyUser.id,
      leagueType: 'redraft',
      isDynasty: false,
      leagueSize: 12,
      settings: { roster_positions: ROSTER_POSITIONS, scoring_settings: SCORING },
    } as never,
  }).catch((e: unknown) => {
    /*
     * ⚠ SWALLOWING THIS COST A WHOLE RUN. The first attempt logged a truncated warning and
     * carried on, so the valuation reported `no_scoring_settings` and looked like a valuation
     * problem — when the real cause was a foreign key on `League.userId` rejecting a made-up
     * user. A seeding failure must stop the run, not colour the result.
     */
    const err = e as { code?: string; meta?: unknown; message?: string }
    console.error('league create FAILED:', err.code ?? '', JSON.stringify(err.meta ?? {}))
    process.exit(1)
  })

  // ---- run the SAME valuation both ways --------------------------------------------------------
  const common = { prisma: test, leagueId: LEAGUE_ID, rosterPositions: ROSTER_POSITIONS, rosterPlayerIds, numTeams: 12 }
  const redraft = await loadLeagueIdpVorp({ ...common, isDynasty: false })
  const dynasty = await loadLeagueIdpVorp({ ...common, isDynasty: true })

  const report = (label: string, r: typeof redraft, ceiling: number) => {
    console.log(`\n=== ${label} (ceiling ${ceiling}) ===`)
    console.log(`  skipped: ${r.skipped ?? 'none'}`)
    console.log(`  coverage: defenders ${r.coverage.defenders}, projected ${r.coverage.projected}, priced ${r.coverage.priced}`)
    const vals = [...r.valueBySleeperId.entries()].sort((a, b) => b[1] - a[1])
    console.log(`  priced players: ${vals.length}`)
    for (const [id, v] of vals.slice(0, 5)) {
      const p = players.find((x) => x.sleeperId === id)
      const proj = r.projectionBySleeperId.get(id)
      console.log(`    ${String(v).padStart(5)}  ${(p?.name ?? id).padEnd(22)} ${p?.position ?? '?'}  proj ${proj ?? '-'}`)
    }
    if (vals.length) console.log(`  top ${vals[0][1]} / median ${vals[Math.floor(vals.length / 2)][1]} / floor ${vals[vals.length - 1][1]}`)
    return vals
  }

  const r = report('REDRAFT', redraft, idpTierValueCeiling(false))
  const d = report('DYNASTY', dynasty, idpTierValueCeiling(true))

  console.log('\n=== does the redraft path actually differ? ===')
  console.log(`  top value    redraft ${r[0]?.[1] ?? '-'}  vs dynasty ${d[0]?.[1] ?? '-'}`)
  if (r.length === 0 || d.length === 0) {
    console.log('  NOTHING PRICED — the comparison below would be vacuously true, so it is skipped.')
  } else {
    /*
     * ⚠ THE CEILING IS NOT A PURE SCALE FACTOR, AND SAYING SO WOULD BE WRONG.
     * Rank 1 lands exactly on the ceiling in both, so the top-value ratio equals the ceiling
     * ratio. Below that the two diverge much faster, because `MARKET_DECAY_REDRAFT` is steeper
     * than the dynasty curve by design — "no future value holding the bottom up". Measured on
     * this run: medians 167 vs 411, floors 117 vs 165, against a top-value ratio of 0.964.
     * Ranking ORDER is identical, because both price the same projections.
     */
    const sameOrder = r.length === d.length && r.every((x, i) => d[i] && d[i][0] === x[0])
    console.log(`  same ranking order: ${sameOrder}  (expected true — both price the same projections)`)
    const mid = (a: typeof r) => a[Math.floor(a.length / 2)][1]
    console.log(`  median   redraft ${mid(r)} vs dynasty ${mid(d)}  — the curves diverge BELOW the top`)
    const ratio = d[0][1] ? (r[0][1] / d[0][1]) : 0
    console.log(`  redraft/dynasty top-value ratio: ${ratio.toFixed(3)}  (ceilings imply ${(5300 / 5500).toFixed(3)})`)
  }

  await prod.$disconnect()
  await test.$disconnect()
}

void main()
