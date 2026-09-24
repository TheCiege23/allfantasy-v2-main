import { prisma } from '@/lib/prisma'
import { getPlatformEvents, EVENT } from '@/lib/events'
import { computeWeeklyMedianResults, isMatchupComplete } from '@/lib/redraft/medianGame'

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
      streakEvents: [],
    })
  }

  const matchups = await prisma.redraftMatchup.findMany({
    where: { seasonId, week: { lte: week } },
    orderBy: [{ week: 'asc' }, { id: 'asc' }],
  })

  let matchupsCounted = 0
  for (const matchup of matchups) {
    if (!matchup.awayRosterId) continue

    if (!isMatchupComplete(matchup)) continue

    const home = rows.get(matchup.homeRosterId)
    const away = rows.get(matchup.awayRosterId)
    if (!home || !away) continue

    const homeScore = Number(matchup.homeScore ?? 0)
    const awayScore = Number(matchup.awayScore ?? 0)
    home.pointsFor += homeScore
    home.pointsAgainst += awayScore
    away.pointsFor += awayScore
    away.pointsAgainst += homeScore

    if (homeScore > awayScore) {
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
  try {
    const seasonRow = await prisma.redraftSeason.findUnique({
      where: { id: seasonId },
      select: { medianGame: true, league: { select: { medianGame: true } } },
    })
    medianGameOn = seasonRow?.league?.medianGame ?? seasonRow?.medianGame ?? false
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

  const ordered = [...rows.entries()].sort(([, a], [, b]) => {
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
