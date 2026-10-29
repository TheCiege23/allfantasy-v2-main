import { accumulateTeamTotals, rankRotisserieTeams, type TeamStatTotals } from '@/lib/category-scoring'
import { resolveLeagueCategories } from '@/lib/category-scoring/leagueScoringType'
import { isPointsOnlySeeding, resolveConfiguredPlayoffSeedingRule } from '@/lib/playoff-defaults/seedingRule'
import { prisma } from '@/lib/prisma'
import { getPlatformEvents, EVENT } from '@/lib/events'
import { byeWeekMedianCredits, computeWeeklyMedianResults, isMatchupComplete, medianEligibleRows, readMedianGameInPlayoffs } from '@/lib/redraft/medianGame'
import { extraMatchupResults } from '@/lib/redraft/oddTeamExtraMatchupRules'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { readTiebreakerOrder, type TiebreakerKey } from '@/lib/standings/tiebreakerOrder'
import { rankNflRedraftTeamsByTiebreakers } from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'

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

  // The extra matchup an odd-team league plays instead of the bye (lib/redraft/oddTeamExtraMatchupRules.ts).
  // Recorded on the leftover team's bye row; it counts for the leftover team, and for the chosen
  // team too only when the week was fixed under "both count". Points weeks only (a pick is never
  // fixed for any other scoring, and a bye row is scored only on points). PF/PA move for
  // the leftover team alone — the chosen team's points that week are already counted in its own game.
  for (const extra of extraMatchupResults(matchups)) {
    const leftover = rows.get(extra.leftoverRosterId)
    const opponent = rows.get(extra.opponentRosterId)
    if (!leftover || !opponent) continue
    leftover.pointsFor += extra.leftoverScore
    leftover.pointsAgainst += extra.opponentScore
    const flipped = extra.outcome === 'W' ? 'L' : extra.outcome === 'L' ? 'W' : 'T'
    const tally = (row: typeof leftover, result: 'W' | 'L' | 'T') => {
      if (result === 'W') row.wins += 1
      else if (result === 'L') row.losses += 1
      else row.ties += 1
      row.streakEvents.push({ week: extra.week, result })
    }
    tally(leftover, extra.outcome)
    if (extra.scoring === 'both') tally(opponent, flipped)
    matchupsCounted += 1
  }

  // League median: a second game each week against the week's median score. The commissioner's
  // current `League.medianGame` wins over the season's copy, which is taken once at the draft.
  // A failed read of the flag means "no median this pass", never "no standings".
  // ⚠ PLAYOFF WEEKS ARE WIN OR GO HOME. Unless the commissioner turned on
  // `settings.median_game_in_playoffs`, no week on or after the playoff start (and no week holding a
  // non-regular game) gets a median result — see `medianEligibleRows`.
  let medianGameOn = false
  let medianInPlayoffs = false
  let playoffStartWeek: number | null = null
  let pointsOnlySeeding = false
  let bracketExists = false
  let customTiebreakers: TiebreakerKey[] | null = null
  let coinSeed = ''
  let pointsScoring = false
  try {
    const seasonRow = await prisma.redraftSeason.findUnique({
      where: { id: seasonId },
      select: {
        leagueId: true,
        season: true,
        medianGame: true,
        playoffStartWeek: true,
        playoffBracket: { select: { id: true } },
        league: { select: { medianGame: true, settings: true, playoffSeedingRule: true, platform: true } },
      },
    })
    medianGameOn = seasonRow?.league?.medianGame ?? seasonRow?.medianGame ?? false
    medianInPlayoffs = readMedianGameInPlayoffs(seasonRow?.league?.settings)
    playoffStartWeek = seasonRow?.playoffStartWeek ?? null
    bracketExists = Boolean(seasonRow?.playoffBracket)
    pointsOnlySeeding = isPointsOnlySeeding(resolveConfiguredPlayoffSeedingRule(seasonRow?.league ?? {}))
    // The commissioner's tiebreaker order (lib/standings/tiebreakerOrder.ts), AllFantasy-run leagues only —
    // the standings board reads it under the same gate, and an imported league follows its platform.
    customTiebreakers = seasonRow?.league && isNativePlatform(seasonRow.league.platform) ? readTiebreakerOrder(seasonRow.league.settings) : null
    coinSeed = `${seasonRow?.leagueId ?? ''}:${seasonRow?.season ?? ''}`
    const mode = (seasonRow?.league?.settings as Record<string, unknown> | null | undefined)?.scoring_mode
    pointsScoring = seasonRow != null && (mode == null || mode === 'points')
  } catch {
    medianGameOn = false
  }

  // A plain bye (no extra matchup) is credited the week's median team score as points for — see
  // `byeWeekMedianCredits`. Points leagues only: a category or roto week has no comparable team score.
  if (pointsScoring) {
    for (const credit of byeWeekMedianCredits(matchups, { playoffStartWeek })) {
      const row = rows.get(credit.rosterId)
      if (row) row.pointsFor += credit.median
    }
  }
  if (medianGameOn) {
    for (const weekResult of computeWeeklyMedianResults(medianEligibleRows(matchups, { playoffStartWeek, medianInPlayoffs }))) {
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
  }
  // Keep each roster's events in week order (stable: within a week the H2H game, then the extra
  // matchup, then the median).
  for (const row of rows.values()) row.streakEvents.sort((a, b) => a.week - b.week)

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
    const categories=resolveLeagueCategories(settings, settings?.category_preset_id ?? settings?.scoringSettings?.categoryPresetId)
    if(!categories) throw new Error('Rotisserie category preset is missing.')
    const ranked=rankRotisserieTeams([...rows.keys()].map(id=>({id,stats:accumulateTeamTotals(rotoStats.get(id)??[])})),categories)
    for(const [id,value] of ranked) rows.get(id)!.pointsFor=value.total
  }
  // The commissioner's own order, after record, ranked exactly as the bracket seeds it
  // (canonicalNflRedraftPlayoffRuntime `rankTeams`). Points-only seeding and roto ignore it, as the
  // bracket does. With no order chosen the comparator below is unchanged.
  const customRank =
    customTiebreakers && !pointsOnlySeeding && !rotoStats.size
      ? new Map(
          rankNflRedraftTeamsByTiebreakers({
            teams: [...rows.entries()].map(([rosterId, r]) => ({
              rosterId,
              wins: r.wins,
              losses: r.losses,
              ties: r.ties,
              pointsFor: Math.round(r.pointsFor * 100) / 100,
              pointsAgainst: Math.round(r.pointsAgainst * 100) / 100,
            })),
            tiebreakers: customTiebreakers,
            regularSeasonMatchups: matchups.map((m) => ({
              week: m.week,
              type: m.type,
              homeRosterId: m.homeRosterId,
              awayRosterId: m.awayRosterId,
              homeScore: m.homeScore,
              awayScore: m.awayScore,
              status: m.status,
              isMedianMatchup: m.isMedianMatchup,
            })),
            regularSeasonEndWeek: playoffStartWeek != null && playoffStartWeek > 1 ? playoffStartWeek - 1 : null,
            coinSeed,
          }).map((rosterId, index) => [rosterId, index]),
        )
      : null
  const ordered = [...rows.entries()].sort(([aId, a], [bId, b]) => {
    if (pointsOnlySeeding || rotoStats.size) return b.pointsFor - a.pointsFor || aId.localeCompare(bId)
    if (customRank) return (customRank.get(aId) ?? 0) - (customRank.get(bId) ?? 0)
    // Win percentage first, ties as half a win. An odd-team league plays unequal numbers of games
    // (a bye week, or a week with an extra game), and counting wins would rank a team ahead for
    // having played more — the playoff seeding (`win_pct` first) and the schedule standings already
    // rank this way, so the stored seed now agrees with them.
    //
    // 🛑 THEN POINTS FOR — NOT WINS. Equal win percentage over the same games means equal wins + ties/2,
    // so a wins key only ever separates teams by how many TIES they have: 14-29-3 went ahead of
    // 11-26-9 on 61 fewer points, while the bracket (`win_pct`, then `points_for`, the league default)
    // seeded them the other way. Measured on a simulated 11-team MLB season, where integer scoring
    // makes ties common (__tests__/redraft/full-season-mlb-redraft.test.ts).
    const pct = (r: typeof a) => (r.wins + .5*r.ties) / Math.max(1,r.wins+r.losses+r.ties)
    if (pct(a) !== pct(b)) return pct(b)-pct(a)
    // Then points for, as every sport's default tiebreakers and the bracket seeding have it
    // (DEFAULT_TIEBREAKERS, canonicalNflRedraftPlayoffRuntime `normalizeTiebreakers`).
    // 🛑 WINS, THEN LOSSES, USED TO COME FIRST, which brought back the rule the comment above retires:
    // at an equal win % the team that had played more ranked ahead. 8-9 sat above 7-8-2 with more
    // points (a league-median tie, or an odd-team bye), while the bracket seeded the other way.
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor
    return a.pointsAgainst - b.pointsAgainst
  })
  const seedByRoster = new Map(ordered.map(([rosterId], index) => [rosterId, index + 1]))
  const seedsFrozen = playoffSeedsFrozen({
    week,
    playoffStartWeek,
    bracketExists,
    roto: categorySettings?.scoring_mode === 'roto' || rotoStats.size > 0,
  })

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
        ...(seedsFrozen ? {} : { playoffSeed: seedByRoster.get(rosterId) ?? null }),
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
 * Whether this recompute must leave `RedraftRoster.playoffSeed` alone. W-L, points and streaks still
 * update; only the seed column is held.
 *
 * 🛑 ONCE THE PLAYOFFS START THE SEEDS ARE SETTLED. The bracket generator writes each qualifier's seed
 * (and null for everyone else), and reseeding reads those roster seeds back
 * (lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime.ts). A recompute that rewrote them from the
 * whole-season order would hand a seed to an eliminated team and reshuffle the field mid-bracket.
 * Frozen when a bracket exists for the season, or when the week being recomputed is on or after
 * `playoffStartWeek`.
 *
 * ⚠ ROTO KEEPS ITS RANK. A rotisserie season stores its category rank in this column all season and has
 * no playoff weeks (its `playoffStartWeek` is past the last week), so only a bracket freezes it there —
 * an older roto season with a real-looking start week must not stop ranking mid-season.
 */
export function playoffSeedsFrozen(input: {
  week: number
  playoffStartWeek: number | null
  bracketExists: boolean
  roto: boolean
}): boolean {
  if (input.bracketExists) return true
  if (input.roto) return false
  return input.playoffStartWeek != null && input.playoffStartWeek > 0 && input.week >= input.playoffStartWeek
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
