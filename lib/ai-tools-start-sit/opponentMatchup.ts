import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveTeamPerformanceOpponent } from '@/lib/league-import/teamPerformanceOpponent'

const SLEEPER = 'https://api.sleeper.app/v1'

type SleeperMatchup = { roster_id?: number; matchup_id?: number; points?: number }

function sportToSleeperSlug(sport: string): string {
  const u = sport.toUpperCase()
  if (u === 'NCAAF') return 'nfl'
  if (u === 'NCAAB') return 'nba'
  return u.toLowerCase()
}

/**
 * Live Sleeper matchup + opponent label for any Sleeper league with a public league id.
 */
export async function fetchSleeperMatchupContext(args: {
  platformLeagueId: string
  week: number
  ownerSleeperId: string
  sport: string
}): Promise<{ opponentName: string | null; notes: string[] }> {
  const notes: string[] = []
  try {
    const [rostersRes, matchRes, usersRes] = await Promise.all([
      fetch(`${SLEEPER}/league/${encodeURIComponent(args.platformLeagueId)}/rosters`, { next: { revalidate: 30 } }),
      fetch(`${SLEEPER}/league/${encodeURIComponent(args.platformLeagueId)}/matchups/${args.week}`, {
        next: { revalidate: 30 },
      }),
      fetch(`${SLEEPER}/league/${encodeURIComponent(args.platformLeagueId)}/users`, { next: { revalidate: 120 } }),
    ])
    const rosters = rostersRes.ok ? ((await rostersRes.json()) as { roster_id?: number; owner_id?: string }[]) : []
    const matchups = matchRes.ok ? ((await matchRes.json()) as SleeperMatchup[]) : []
    const users = usersRes.ok
      ? ((await usersRes.json()) as {
          user_id?: string
          display_name?: string
          metadata?: { team_name?: string }
        }[])
      : []

    const mine = Array.isArray(rosters)
      ? rosters.find((r) => String(r.owner_id) === String(args.ownerSleeperId))
      : undefined
    const rid = mine?.roster_id
    if (rid == null) {
      notes.push('Could not resolve your Sleeper roster id for matchup lookup.')
      return { opponentName: null, notes }
    }

    const row = Array.isArray(matchups) ? matchups.find((m) => m.roster_id === rid) : undefined
    const mid = row?.matchup_id
    if (mid == null) {
      notes.push(`No matchup group for period ${args.week} (Sleeper ${sportToSleeperSlug(args.sport)}).`)
      return { opponentName: null, notes }
    }

    const opp = Array.isArray(matchups) ? matchups.find((m) => m.roster_id !== rid && m.matchup_id === mid) : undefined
    const oppRoster = opp ? rosters.find((r) => r.roster_id === opp.roster_id) : undefined
    const oppOwner = oppRoster?.owner_id
    const u = Array.isArray(users) ? users.find((x) => String(x.user_id) === String(oppOwner)) : undefined
    const name =
      u?.metadata?.team_name?.trim() ||
      u?.display_name?.trim() ||
      (oppOwner ? `Opponent (${String(oppOwner).slice(0, 8)}…)` : null)

    if (typeof row?.points === 'number' && typeof opp?.points === 'number') {
      notes.push(
        `Period ${args.week}: your team ${row.points.toFixed(1)} pts vs opponent ${opp.points.toFixed(1)} pts (if scored in Sleeper).`,
      )
    } else {
      notes.push(`Matchup id ${mid} — opponent roster ${opp?.roster_id ?? 'unknown'} (${sportToSleeperSlug(args.sport)}).`)
    }

    return { opponentName: name, notes }
  } catch {
    notes.push('Sleeper matchup fetch failed.')
    return { opponentName: null, notes }
  }
}

/**
 * Native DB: opponent string from team_performances + league-wide PA context (real team rows).
 */
export async function fetchNativeOpponentMatchup(args: {
  leagueId: string
  teamId: string
  season: number
  week: number
}): Promise<{ opponentLabel: string | null; matchupDifficultyNote: string | null; notes: string[] }> {
  const notes: string[] = []
  try {
    const perf = await prisma.teamPerformance.findUnique({
      where: {
        teamId_season_week: {
          teamId: args.teamId,
          season: args.season,
          week: args.week,
        },
      },
      select: { opponent: true, points: true },
    })
    if (!perf?.opponent) {
      notes.push('No matchup row in team_performances for this period.')
      return { opponentLabel: null, matchupDifficultyNote: null, notes }
    }

    /*
     * The PA ranking covers every CURRENT franchise. A vacant seat plays real matchups and
     * carries real points-against, so removing it would both shrink the denominator and drop a
     * legitimate opponent from the ordering.
     *
     * ⚠ AN EARLIER REVISION FILTERED `isOrphan` HERE. That flag marks canonical open slots, so
     * in a league with open seats it silently removed live opponents from the ranking. Excluding
     * a DEPARTED team is a different question and needs the lifecycle axis.
     *
     * `isOrphan` remains in the select only so the column is available to a future lifecycle
     * migration; nothing reads it here today.
     */
    const teams = await prisma.leagueTeam.findMany({
      where: { leagueId: args.leagueId },
      select: {
        id: true,
        teamName: true,
        pointsAgainst: true,
        pointsFor: true,
        wins: true,
        losses: true,
        isOrphan: true,
      },
    })
    if (teams.length < 2) {
      return { opponentLabel: perf.opponent, matchupDifficultyNote: null, notes }
    }

    const paSorted = [...teams].sort((a, b) => a.pointsAgainst - b.pointsAgainst)

    /*
     * 🛑 RESOLVE BY THE PRODUCER'S CONTRACT — `TeamPerformance.opponent` IS A `LeagueTeam.id`.
     *
     * This was a bidirectional substring match on `teamName`, which could never match the UUID
     * the importer actually stores, and whose `(t.teamName ?? '')` arm matched EVERY opponent
     * for any seat with an empty name. See `teamPerformanceOpponent.ts` for the measurement.
     * Resolved against the unfiltered array on purpose: a past week can name a departed team.
     */
    const { team: oppTeam, via } = resolveTeamPerformanceOpponent(perf.opponent, teams)
    if (!oppTeam) {
      notes.push(
        `Opponent "${perf.opponent}" in team_performances did not match any team in this league, so no matchup-difficulty note is offered.`,
      )
    } else if (via === 'legacy_name') {
      notes.push('Opponent resolved by name — this row predates the team-id opponent contract.')
    }

    let matchupDifficultyNote: string | null = null
    if (oppTeam) {
      /* -1 + 1 = 0 when the opponent is itself archived, and `rank > 0` below drops the note. */
      const rank = paSorted.findIndex((t) => t.id === oppTeam.id) + 1
      const n = teams.length
      if (rank > 0 && n > 1) {
        const pct = rank / n
        if (pct <= 0.33) {
          matchupDifficultyNote = `Opponent ${oppTeam.teamName ?? 'foe'} allows few points vs league (${rank}/${n} stingiest PA) — tougher offensive environment.`
        } else if (pct >= 0.67) {
          matchupDifficultyNote = `Opponent ${oppTeam.teamName ?? 'foe'} is softer vs league by PA (${rank}/${n}) — slightly friendlier counting stats if game stays competitive.`
        } else {
          matchupDifficultyNote = `Opponent ${oppTeam.teamName ?? 'foe'} is middle-of-pack in points allowed (${rank}/${n}).`
        }
      }
    }

    return { opponentLabel: perf.opponent, matchupDifficultyNote, notes }
  } catch {
    notes.push('Native matchup context load failed.')
    return { opponentLabel: null, matchupDifficultyNote: null, notes }
  }
}
