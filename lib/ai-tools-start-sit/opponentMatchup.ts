import 'server-only'

import { prisma } from '@/lib/prisma'
import { selectActiveTeams } from '@/lib/league-import/activeTeams'
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
     * 🛑 UNFILTERED QUERY, FILTERED CONSUMER — the two halves of this read disagree.
     *
     * `oppTeam` resolves `perf.opponent`, a string on a `TeamPerformance` row for a PAST week,
     * so it must be able to name a team that has since left the league. The PA ranking is the
     * opposite: it is a statement about the league AS IT STANDS, and an archived seat carrying a
     * frozen `pointsAgainst` both occupies a slot in the ordering and inflates the denominator.
     *
     * ⚠ `isOrphan` MUST BE IN THE SELECT. `isActiveTeam` reads `team.isOrphan !== true`, so a
     * `select` that omits the column makes every row read ACTIVE and `selectActiveTeams` a
     * silent no-op — a filter that cannot fail, which is the failure mode this batch exists for.
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
    const activeTeams = selectActiveTeams(teams)
    if (activeTeams.length < 2) {
      return { opponentLabel: perf.opponent, matchupDifficultyNote: null, notes }
    }

    const paSorted = [...activeTeams].sort((a, b) => a.pointsAgainst - b.pointsAgainst)

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
      const n = activeTeams.length
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
