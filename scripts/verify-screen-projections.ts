/**
 * Proves the My Team and Player Finder projection wiring against REAL rows.
 *
 * ⚠ A TYPECHECK CANNOT CATCH THE FAILURE MODE THIS GUARDS. Both screens compiled
 * perfectly while claiming "no weekly projection feed ingested" over a table
 * holding 994 rows — the types were right and the sentence was false. And the
 * Player Finder tile compiled while rendering nothing at all, because it took its
 * availability from one prop and its text from another. Only reading actual output
 * shows either.
 */
import { getMyTeamData } from '../lib/core-app/myTeam'
import { latestProjectionWeek } from '../lib/core-app/playerProjections'
import { getPlayerDetail, searchPlayers, playerRef } from '../lib/core-app/playerFinder'
import { loadSideProjections, winProbabilityFor } from '../lib/core-app/matchupProjections'
import { getPlayerImpact } from '../lib/core-app/playerImpact'
import { prisma } from '../lib/prisma'

async function main() {
  // Roster.platformUserId is non-nullable — no filter needed, and asking for
  // `not: null` is a runtime error rather than a no-op.
  /*
   * ⚠ SAMPLED FROM CLAIMED TEAMS, NOT FROM ROSTERS. My Team keys off
   * LeagueTeam.claimedByUserId, and most rosters belong to teams nobody has
   * claimed — sampling rosters blind hits those first and reports "unavailable"
   * for a screen that would never have been rendered in the first place.
   */
  const claimed = await prisma.leagueTeam.findMany({
    where: { claimedByUserId: { not: null } },
    select: { leagueId: true, platformUserId: true, externalId: true, claimedByUserId: true },
    take: 400,
  })
  const rosters = claimed.map((t) => ({ leagueId: t.leagueId, platformUserId: t.platformUserId }))

  let priced = 0
  let partial = 0
  let none = 0

  for (const r of rosters) {
    const team = claimed.find(
      (t) => t.leagueId === r.leagueId && t.platformUserId === r.platformUserId
    )
    if (!team?.claimedByUserId) continue

    const data = await getMyTeamData(r.leagueId, team.claimedByUserId)
    if (!data) continue

    if (!data.projections.available) {
      none++
      continue
    }
    const p = data.projections.data
    if (p.unprojected === 0) priced++
    else partial++
    if (p.unprojected > 0 || priced + partial <= 4) {
      console.log(
        `  my-team: ${p.total.toFixed(1)} pts · ${p.projected}/${p.projected + p.unprojected} starters · ${p.season} wk${p.week}`
      )
    }
  }

  console.log(`\nfully priced: ${priced} | partial: ${partial} | unavailable: ${none}`)

  console.log('\nplayer finder:')
  for (const name of ['Josh Allen', 'Bijan Robinson', 'Puka Nacua', 'Brock Bowers']) {
    const matches = await searchPlayers(name)
    const first = matches[0]
    if (!first) {
      console.log(`  ${name}: no match`)
      continue
    }
    const d = await getPlayerDetail(playerRef(first.sport, first.externalId), [])
    if (!d) {
      console.log(`  ${name}: no detail`)
      continue
    }
    // ⚠ THE IDENTITY ASSERTION IS THE POINT OF THIS LOOP, NOT THE NUMBERS. The
    // detail page used to return a different athlete than the one clicked.
    if (d.player.name !== first.name || d.player.sport !== first.sport) {
      console.log(`  ✗ ${name}: clicked ${first.name}(${first.sport}) but opened ${d.player.name}(${d.player.sport})`)
      continue
    }
    const proj = d.projection.available
      ? `${d.projection.data.points.toFixed(1)} pts (${d.projection.data.season} wk${d.projection.data.week})`
      : `— (${d.projection.reason})`
    const rank = d.positionRank.available
      ? `${d.positionRank.data.position}${d.positionRank.data.rank} of ${d.positionRank.data.outOf}`
      : `— (${d.positionRank.reason})`
    console.log(`  ${d.player.name}: proj ${proj} · rank ${rank}`)
  }

  /*
   * ⚠ MATCHUP IS EXERCISED AT THE WEEK THE FEED COVERS, NOT AT THE WEEK STORED ON
   * THE LEAGUE — AND THAT IS THE POINT OF RUNNING IT AT ALL. Production's
   * WeeklyMatchup rows are 2025 wk1/wk2 while the projection feed holds 2026 wk1,
   * so getMatchupData correctly refuses for every real league today. Testing only
   * through that path would mean the win-probability branch had never once been
   * observed producing a number, and a code path seen only refusing is a code path
   * nobody has verified.
   */
  console.log(`
matchup (positive control at the feed's own week):`)
  const withRosters = await prisma.league.findMany({
    where: { rosters: { some: {} } },
    select: { id: true, rosters: { select: { platformUserId: true }, take: 2 } },
    take: 40,
  })
  let matchupsPriced = 0
  for (const lg of withRosters) {
    if (lg.rosters.length < 2) continue
    const at = await latestProjectionWeek()
    if (!at) break
    const sides = await loadSideProjections({
      leagueId: lg.id,
      season: Number(at.season),
      week: at.week,
      yourPlatformUserId: lg.rosters[0].platformUserId,
      opponentPlatformUserId: lg.rosters[1].platformUserId,
    })
    if (!sides) continue
    const wp = winProbabilityFor(sides, { you: 0, opponent: 0 })
    if (!wp.available) continue
    matchupsPriced++
    console.log(
      `  ${sides.you.projectedRemaining} v ${sides.opponent.projectedRemaining} -> ${Math.round(wp.data.pWin * 100)}% ` +
        `margin ${wp.data.projectedMargin.toFixed(1)} (${wp.data.confidence})`
    )
    if (matchupsPriced >= 4) break
  }
  if (matchupsPriced === 0) console.log('  none — no league had two fully-projected lineups')

  /*
   * ⚠ THE GAME-DAY PATH IS ASSERTED ON THE THING THAT MAKES IT USEFUL: that the
   * SAME player is priced DIFFERENTLY in different leagues. If every league
   * returned the same number, the league-specific scoring would not be running
   * and nothing on screen would reveal it — the numbers would simply all be the
   * generic projection wearing a different label.
   */
  console.log(`
game-day impact (league-specific scoring):`)
  const claimedTeams = await prisma.leagueTeam.findMany({
    where: { claimedByUserId: { not: null } },
    select: { leagueId: true, platformUserId: true, externalId: true, claimedByUserId: true },
    take: 400,
  })
  const seenUsers = new Set<string>()
  let proven = 0
  for (const t of claimedTeams) {
    if (proven >= 2 || seenUsers.has(t.claimedByUserId!)) continue
    const cands = [t.platformUserId, t.externalId, t.claimedByUserId].filter(Boolean) as string[]
    const r = await prisma.roster.findFirst({
      where: { leagueId: t.leagueId, platformUserId: { in: cands } },
      select: { playerData: true },
    })
    const pd = (r?.playerData ?? {}) as Record<string, unknown>
    const starters = Array.isArray(pd.starters)
      ? (pd.starters as unknown[]).map(String).filter((x) => x !== '0' && !x.startsWith('name:'))
      : []
    if (!starters.length) continue
    seenUsers.add(t.claimedByUserId!)
    const impacts = await getPlayerImpact(starters[0], t.claimedByUserId!)
    const priced = impacts.filter((i) => i.afPoints.available)
    if (priced.length < 2) continue
    proven++
    const who = await prisma.sportsPlayer.findFirst({ where: { sleeperId: starters[0] }, select: { name: true } })
    const pts = priced.map((i) => (i.afPoints.available ? i.afPoints.data.points : 0))
    const distinct = new Set(pts).size
    console.log(
      `  ${who?.name ?? starters[0]}: ${pts.map((x) => x.toFixed(1)).join(' / ')} across ${priced.length} leagues ` +
        `-> ${distinct > 1 ? 'DIFFER (league scoring is live)' : 'IDENTICAL — league scoring is NOT being applied'}`
    )
    const withSwaps = impacts.filter((i) => i.replacements.available)
    withSwaps.slice(0, 2).forEach((i) => {
      const best = i.replacements.available ? i.replacements.data[0] : null
      if (best) console.log(`    best swap in ${i.leagueName.slice(0, 22)}: ${best.name} ${best.delta ?? '—'}`)
    })
  }
  if (proven === 0) console.log('  none — no player was priced in 2+ leagues')

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
