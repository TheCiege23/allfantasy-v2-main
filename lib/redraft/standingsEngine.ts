import { accumulateTeamTotals, getCategoryPresetDefinitions, rankRotisserieTeams, type TeamStatTotals } from '@/lib/category-scoring'
import { isPointsOnlySeeding, resolveConfiguredPlayoffSeedingRule } from '@/lib/playoff-defaults/seedingRule'
import { prisma } from '@/lib/prisma'
import { getPlatformEvents, EVENT } from '@/lib/events'
import { computeWeeklyMedianResults, isMatchupComplete } from '@/lib/redraft/medianGame'
import { isNativePlatform } from '@/lib/dashboard/platform-label'

/**
 * Recompute standings from matchup scores already written from PlayerWeeklyScore.
 * Matchups with missing starter scores are skipped so unavailable cache/provider
 * data never becomes a fake 0-0 result.
 */
export async function updateStandings(
  seasonId: string,
  week: number,
): Promise<{ seasonId: string; week: number; rostersUpdated: number; matchupsCounted: number }> {
  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId },
    select: { id: true },
  })

  const rows = new Map<
    string,
    {
      wins: number
      losses: number
      ties: number
      pointsFor: number
      pointsAgainst: number
      categoryWinsFor: number
      categoryLossesFor: number
      categoryTiesFor: number
      /** In week order; within a week the head-to-head game comes before the median game. */
      streakEvents: Array<{ week: number; result: 'W' | 'L' | 'T' }>
    }
  >()

  for (const roster of rosters) {
    rows.set(roster.id, {
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      categoryWinsFor: 0,categoryLossesFor: 0,categoryTiesFor: 0,
      streakEvents: [],
    })
  }

  const matchups = await prisma.redraftMatchup.findMany({
    where: { seasonId, week: { lte: week } },
    orderBy: [{ week: 'asc' }, { id: 'asc' }],
  })

  const rotoStats = new Map<string, TeamStatTotals[]>()
  const seenRotoPeriods = new Set<string>()
  let matchupsCounted = 0
  for (const matchup of matchups) {
    if (!matchup.awayRosterId) continue

    if (!isMatchupComplete(matchup)) continue

    const home = rows.get(matchup.homeRosterId)
    const away = rows.get(matchup.awayRosterId)
    if (!home || !away) continue

    const homeScore = Number(matchup.homeScore ?? 0)
    const awayScore = Number(matchup.awayScore ?? 0)
    const scoringSnapshot = matchup.lineupSnapshots as Record<string, any> | null
    if(scoringSnapshot?.categoryRecordMode === 'roto') {
      for(const [id,side] of [[matchup.homeRosterId,'home'],[matchup.awayRosterId,'away']] as const) {
        const key=`${id}:${matchup.week}`
        if(!seenRotoPeriods.has(key)) {
          const stats=scoringSnapshot.redraftScoring?.[side]?.statTotals
          if(!stats) throw new Error('Rotisserie period is missing team stat components.')
          rotoStats.set(id,[...(rotoStats.get(id)??[]),stats])
          seenRotoPeriods.add(key)
        }
      }
      matchupsCounted++; continue
    }
    home.pointsFor += homeScore
    home.pointsAgainst += awayScore
    away.pointsFor += awayScore
    away.pointsAgainst += homeScore

    const snapshot = matchup.lineupSnapshots as Record<string, any> | null
    const categoryResult = snapshot?.categoryMatchup
    if(categoryResult) {
      home.categoryWinsFor+=categoryResult.aWins; home.categoryLossesFor+=categoryResult.bWins; home.categoryTiesFor+=categoryResult.ties
      away.categoryWinsFor+=categoryResult.bWins; away.categoryLossesFor+=categoryResult.aWins; away.categoryTiesFor+=categoryResult.ties
    }
    if (categoryResult && snapshot?.categoryRecordMode === 'each') {
      home.wins += categoryResult.aWins; home.losses += categoryResult.bWins; home.ties += categoryResult.ties
      away.wins += categoryResult.bWins; away.losses += categoryResult.aWins; away.ties += categoryResult.ties
      const result = homeScore > awayScore ? 'W' : homeScore < awayScore ? 'L' : 'T'
      home.streakEvents.push({week:matchup.week,result})
      away.streakEvents.push({week:matchup.week,result:result === 'W' ? 'L' : result === 'L' ? 'W' : 'T'})
    } else if (homeScore > awayScore) {
      home.wins += 1
      away.losses += 1
      home.streakEvents.push({ week: matchup.week, result: 'W' })
      away.streakEvents.push({ week: matchup.week, result: 'L' })
    } else if (awayScore > homeScore) {
      away.wins += 1
      home.losses += 1
      away.streakEvents.push({ week: matchup.week, result: 'W' })
      home.streakEvents.push({ week: matchup.week, result: 'L' })
    } else {
      home.ties += 1
      away.ties += 1
      home.streakEvents.push({ week: matchup.week, result: 'T' })
      away.streakEvents.push({ week: matchup.week, result: 'T' })
    }

    matchupsCounted += 1
  }

  // League median: a second game each week against the week's median score. The commissioner's
  // current `League.medianGame` wins over the season's copy, which is taken once at the draft.
  // A failed read of the flag means "no median this pass", never "no standings".
  let medianGameOn = false
  let pointsOnlySeeding = false
  try {
    const seasonRow = await prisma.redraftSeason.findUnique({
      where: { id: seasonId },
      select: { medianGame: true, league: { select: { medianGame: true, settings: true, playoffSeedingRule: true } } },
    })
    medianGameOn = seasonRow?.league?.medianGame ?? seasonRow?.medianGame ?? false
    pointsOnlySeeding = isPointsOnlySeeding(resolveConfiguredPlayoffSeedingRule(seasonRow?.league ?? {}))
  } catch {
    medianGameOn = false
  }
  if (medianGameOn) {
    for (const weekResult of computeWeeklyMedianResults(matchups)) {
      for (const [rosterId, outcome] of weekResult.outcomes) {
        const row = rows.get(rosterId)
        if (!row) continue
        if (outcome === 'W') row.wins += 1
        else if (outcome === 'L') row.losses += 1
        else row.ties += 1
        row.streakEvents.push({ week: weekResult.week, result: outcome })
      }
      await prisma.redraftMatchup.updateMany({
        where: { seasonId, week: weekResult.week },
        data: { medianScore: weekResult.median },
      })
    }
    // Keep each roster's events in week order (stable: H2H stays ahead of that week's median).
    for (const row of rows.values()) row.streakEvents.sort((a, b) => a.week - b.week)
  }

  const categorySeasonRow = await prisma.redraftSeason.findUnique({where:{id:seasonId},include:{league:{select:{settings:true}}}})
  const categorySettings = categorySeasonRow?.league?.settings as Record<string,any> | null
  if(categorySettings?.scoring_mode === 'roto' && categorySeasonRow) {
    const genericRosters=await prisma.roster.findMany({where:{leagueId:categorySeasonRow.leagueId},select:{id:true,redraftRosterId:true}})
    const nativeId=new Map(genericRosters.map(r=>[r.id,r.redraftRosterId]))
    const periods=await prisma.teamWeekResult.findMany({where:{leagueId:categorySeasonRow.leagueId,season:categorySeasonRow.season,week:{lte:week},status:'final'}})
    rotoStats.clear()
    for(const period of periods) {
      const id=nativeId.get(period.rosterId); const stats=(period.categoryBreakdown as Record<string,any> | null)?.teamStats
      if(id && stats) rotoStats.set(id,[...(rotoStats.get(id)??[]),stats])
    }
  }
  if(rotoStats.size) {
    const season = await prisma.redraftSeason.findUnique({where:{id:seasonId},include:{league:{select:{settings:true}}}})
    const settings=season?.league?.settings as Record<string,any> | null
    const categories=getCategoryPresetDefinitions(settings?.category_preset_id ?? settings?.scoringSettings?.categoryPresetId)
    if(!categories) throw new Error('Rotisserie category preset is missing.')
    const ranked=rankRotisserieTeams([...rows.keys()].map(id=>({id,stats:accumulateTeamTotals(rotoStats.get(id)??[])})),categories)
    for(const [id,value] of ranked) rows.get(id)!.pointsFor=value.total
  }
  const ordered = [...rows.entries()].sort(([aId, a], [bId, b]) => {
    if (pointsOnlySeeding || rotoStats.size) return b.pointsFor - a.pointsFor || aId.localeCompare(bId)
    const categorySeason = matchups.some(m => (m.lineupSnapshots as any)?.categoryRecordMode === 'each')
    if (categorySeason) {
      const pct = (r: typeof a) => (r.wins + .5*r.ties) / Math.max(1,r.wins+r.losses+r.ties)
      if (pct(a) !== pct(b)) return pct(b)-pct(a)
    }
    if (b.wins !== a.wins) return b.wins - a.wins
    if (a.losses !== b.losses) return a.losses - b.losses
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor
    return a.pointsAgainst - b.pointsAgainst
  })
  const seedByRoster = new Map(ordered.map(([rosterId], index) => [rosterId, index + 1]))

  for (const [rosterId, row] of rows.entries()) {
    const results = row.streakEvents.map((e) => e.result)
    const last = results[results.length - 1]
    let streak: string | null = null
    if (last) {
      let count = 0
      for (let i = results.length - 1; i >= 0; i--) {
        if (results[i] !== last) break
        count += 1
      }
      streak = `${last}${count}`
    }

    await prisma.redraftRoster.update({
      where: { id: rosterId },
      data: {
        wins: row.wins,
        losses: row.losses,
        ties: row.ties,
        pointsFor: Math.round(row.pointsFor * 100) / 100,
        pointsAgainst: Math.round(row.pointsAgainst * 100) / 100,
        streak,
        playoffSeed: seedByRoster.get(rosterId) ?? null,
      },
    })
  }

  await mirrorNativeLeagueTeamRecords(seasonId, rows, seedByRoster)

  // G15.2 — publish (best-effort, never throws). Logs each standings recompute;
  // player-level granularity is carried by competition.score.updated (wired later).
  await getPlatformEvents().emit(EVENT.STANDINGS_UPDATED, {
    seasonId,
    period: { kind: 'week', index: week },
    actor: { type: 'system' },
    source: 'engine:standings',
    subjects: [{ kind: 'season', id: seasonId }],
    payload: { seasonId, changedRosterCount: rows.size },
  })

  return { seasonId, week, rostersUpdated: rows.size, matchupsCounted }
}

/**
 * Copy each native team's record onto its `LeagueTeam` row — the row the league page, its standings
 * sidebar and the league cards read.
 *
 * 🛑 A NATIVE LEAGUE SHOWED EVERY TEAM AT 0-0 ALL SEASON. The season engine writes records to
 * `RedraftRoster` only; `LeagueTeam.wins/losses/pointsFor` is written by the import paths and by
 * nothing native. Measured 2026-09-25 on a simulated 10-team season: 14 weeks played, 70-70 and
 * 13,786 points on the redraft rosters, 0-0 and 0.0 on every team the league page showed.
 *
 * The link is the one the rest of the native stack uses: `LeagueTeam.externalId` is the generic
 * `Roster.id`, and that roster's `platformUserId` is the season roster's `ownerId` (10 of 10
 * matched on that season). Imports are left alone — their provider sync owns these columns.
 * Best-effort like the event above it: a failure here must never cost the standings themselves.
 */
async function mirrorNativeLeagueTeamRecords(
  seasonId: string,
  rows: Map<string, { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number; categoryWinsFor?:number;categoryLossesFor?:number;categoryTiesFor?:number }>,
  seedByRoster: Map<string, number>,
): Promise<void> {
  try {
    const season = await prisma.redraftSeason.findUnique({ where: { id: seasonId }, select: { leagueId: true, season:true } })
    if (!season) return
    const league = await prisma.league.findFirst({ where: { id: season.leagueId }, select: { platform: true, settings:true } })
    if (!league || !isNativePlatform(league.platform)) return

    const seasonRosters = await prisma.redraftRoster.findMany({ where: { seasonId }, select: { id: true, ownerId: true } })
    const leagueRosters = await prisma.roster.findMany({
      where: { leagueId: season.leagueId, platformUserId: { in: seasonRosters.map((r) => r.ownerId) } },
      select: { id: true, platformUserId: true },
    })
    const rosterIdByOwner = new Map(leagueRosters.map((r) => [r.platformUserId, r.id]))

    for (const sr of seasonRosters) {
      const row = rows.get(sr.id)
      const externalId = rosterIdByOwner.get(sr.ownerId)
      if (!row || !externalId) continue
      const mode=(league.settings as Record<string,unknown> | null)?.scoring_mode
      if(mode === 'h2h_category' || mode === 'roto') {
        const record={wins:row.wins,losses:row.losses,ties:row.ties,pointsFor:row.pointsFor,pointsAgainst:row.pointsAgainst,rank:seedByRoster.get(sr.id)??null,categoryWinsFor:row.categoryWinsFor??0,categoryLossesFor:row.categoryLossesFor??0,categoryTiesFor:row.categoryTiesFor??0}
        await prisma.fantasyStanding.upsert({where:{leagueId_season_rosterId:{leagueId:season.leagueId,season:season.season,rosterId:externalId}},create:{leagueId:season.leagueId,season:season.season,rosterId:externalId,...record},update:record})
      }
      await prisma.leagueTeam.updateMany({
        where: { leagueId: season.leagueId, externalId },
        data: {
          wins: row.wins,
          losses: row.losses,
          ties: row.ties,
          pointsFor: Math.round(row.pointsFor * 100) / 100,
          pointsAgainst: Math.round(row.pointsAgainst * 100) / 100,
          currentRank: seedByRoster.get(sr.id) ?? null,
        },
      })
    }
  } catch (error) {
    console.warn('[standings] league team record mirror failed', {
      seasonId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
