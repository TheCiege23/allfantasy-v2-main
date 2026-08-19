import { prisma } from '@/lib/prisma'
import { getPlatformEvents, EVENT } from '@/lib/events'

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
      streakEvents: Array<'W' | 'L' | 'T'>
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

    const snapshot = matchup.lineupSnapshots
    const scoring =
      snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
        ? (snapshot as Record<string, unknown>).redraftScoring
        : null
    const isComplete =
      matchup.status === 'final' ||
      matchup.status === 'completed' ||
      (scoring && typeof scoring === 'object' && (scoring as Record<string, unknown>).isComplete === true)

    if (!isComplete) continue

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
      home.streakEvents.push('W')
      away.streakEvents.push('L')
    } else if (awayScore > homeScore) {
      away.wins += 1
      home.losses += 1
      away.streakEvents.push('W')
      home.streakEvents.push('L')
    } else {
      home.ties += 1
      away.ties += 1
      home.streakEvents.push('T')
      away.streakEvents.push('T')
    }

    matchupsCounted += 1
  }

  const ordered = [...rows.entries()].sort(([, a], [, b]) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if (a.losses !== b.losses) return a.losses - b.losses
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor
    return a.pointsAgainst - b.pointsAgainst
  })
  const seedByRoster = new Map(ordered.map(([rosterId], index) => [rosterId, index + 1]))

  for (const [rosterId, row] of rows.entries()) {
    const last = row.streakEvents[row.streakEvents.length - 1]
    let streak: string | null = null
    if (last) {
      let count = 0
      for (let i = row.streakEvents.length - 1; i >= 0; i--) {
        if (row.streakEvents[i] !== last) break
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
