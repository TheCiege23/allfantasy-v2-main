import 'server-only'

import { prisma } from '@/lib/prisma'
import type { SupportedSport } from '@/lib/sport-scope'
import { CURRENT_FRANCHISES_INCLUDING_UNKNOWN } from '@/lib/league-import/teamLifecycle'
import { resolveTeamPerformanceOpponent } from '@/lib/league-import/teamPerformanceOpponent'

const SLEEPER = 'https://api.sleeper.app/v1'

export type MatchupOpponentResolutionSource = 'manual' | 'sleeper_matchup' | 'native_performance' | 'none'

export type ResolveMatchupOpponentResult = {
  opponentExternalId: string | null
  opponentName: string | null
  source: MatchupOpponentResolutionSource
  notes: string[]
}

type SleeperMatchup = { roster_id?: number; matchup_id?: number; points?: number }


async function resolveSleeperOpponent(args: {
  leagueId: string
  userId: string
  week: number
  platformLeagueId: string
  sport: SupportedSport
  myTeamExternalId: string | null
}): Promise<ResolveMatchupOpponentResult> {
  const notes: string[] = []
  try {
    let owner =
      (await prisma.userProfile.findUnique({ where: { userId: args.userId }, select: { sleeperUserId: true } }))
        ?.sleeperUserId?.trim() || args.userId

    if (args.myTeamExternalId) {
      const lt = await prisma.leagueTeam.findFirst({
        where: { leagueId: args.leagueId, externalId: args.myTeamExternalId },
        select: { platformUserId: true },
      })
      if (lt?.platformUserId) owner = lt.platformUserId
    }

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

    const mine = Array.isArray(rosters) ? rosters.find((r) => String(r.owner_id) === String(owner)) : undefined
    const rid = mine?.roster_id
    if (rid == null) {
      notes.push('Could not resolve your Sleeper roster for this league week.')
      return { opponentExternalId: null, opponentName: null, source: 'none', notes }
    }
    const row = Array.isArray(matchups) ? matchups.find((m) => m.roster_id === rid) : undefined
    const mid = row?.matchup_id
    if (mid == null) {
      notes.push('Sleeper matchups not available for this week yet.')
      return { opponentExternalId: null, opponentName: null, source: 'none', notes }
    }
    const opp = Array.isArray(matchups) ? matchups.find((m) => m.roster_id !== rid && m.matchup_id === mid) : undefined
    const oppRoster = opp ? rosters.find((r) => r.roster_id === opp.roster_id) : undefined
    const oppOwner = oppRoster?.owner_id
    const u = Array.isArray(users) ? users.find((x) => String(x.user_id) === String(oppOwner)) : undefined
    const name =
      u?.metadata?.team_name?.trim() ||
      u?.display_name?.trim() ||
      (oppOwner ? `Opponent (${String(oppOwner).slice(0, 8)}…)` : null)
    const oppRid = opp?.roster_id
    if (oppRid == null) {
      notes.push('Opponent roster not found in Sleeper matchups response.')
      return { opponentName: name, opponentExternalId: null, source: 'none', notes }
    }
    const externalId = String(oppRid)
    const lt = await prisma.leagueTeam.findFirst({
      where: { leagueId: args.leagueId, externalId },
      select: { externalId: true },
    })
    if (!lt) {
      notes.push('Opponent Sleeper roster id not yet linked in league_teams — sync may be pending.')
    }
    notes.push(`Sleeper ${args.sport} week ${args.week}: matched opponent roster ${externalId}.`)
    return { opponentExternalId: lt?.externalId ?? externalId, opponentName: name, source: 'sleeper_matchup', notes }
  } catch {
    notes.push('Sleeper opponent resolution failed.')
    return { opponentExternalId: null, opponentName: null, source: 'none', notes }
  }
}

async function resolveNativeOpponent(args: {
  leagueId: string
  userId: string
  season: number
  week: number
  myTeamExternalId: string | null
}): Promise<ResolveMatchupOpponentResult> {
  const notes: string[] = []
  try {
    let myTeam = await prisma.leagueTeam.findFirst({
      where: { leagueId: args.leagueId, claimedByUserId: args.userId },
      select: { id: true, externalId: true, teamName: true },
    })
    if (args.myTeamExternalId) {
      const alt = await prisma.leagueTeam.findFirst({
        where: { leagueId: args.leagueId, externalId: args.myTeamExternalId },
        select: { id: true, externalId: true, teamName: true },
      })
      if (alt) myTeam = alt
    }
    if (!myTeam) {
      notes.push('No league team row for user — cannot read native team_performances matchup.')
      return { opponentExternalId: null, opponentName: null, source: 'none', notes }
    }

    const perf = await prisma.teamPerformance.findUnique({
      where: {
        teamId_season_week: {
          teamId: myTeam.id,
          season: args.season,
          week: args.week,
        },
      },
      select: { opponent: true, points: true },
    })
    if (!perf?.opponent?.trim()) {
      notes.push('No opponent label in team_performances for this period — schedule sync may be pending.')
      return { opponentExternalId: null, opponentName: null, source: 'none', notes }
    }

    /* Resolving THIS WEEK's opponent — an archived team has no current matchup. */
    const teams = await prisma.leagueTeam.findMany({
      where: { ...CURRENT_FRANCHISES_INCLUDING_UNKNOWN, leagueId: args.leagueId },
      select: { id: true, externalId: true, teamName: true },
    })
    const label = perf.opponent.trim()
    /*
     * 🛑 `TeamPerformance.opponent` IS A `LeagueTeam.id`, NOT A NAME — this matched it by name.
     * The `fuzzyTeamMatch` helper this replaced (now deleted) normalised both sides and compared
     * names, which can never hit a UUID — so this path silently fell through to the "pick the
     * matching team" note on every real imported league. Shared resolver so the two readers of
     * this column cannot drift; see `teamPerformanceOpponent.ts`.
     */
    const { team: hit } = resolveTeamPerformanceOpponent(label, teams, {
      excludeTeamId: myTeam.id,
    })
    if (!hit) {
      notes.push(`Native matchup lists opponent as "${label}" — pick the matching team from the league list if needed.`)
      return { opponentExternalId: null, opponentName: label, source: 'none', notes }
    }

    notes.push(`Native period ${args.week}: opponent ${hit.teamName ?? hit.externalId} (team_performances).`)
    return {
      opponentExternalId: hit.externalId,
      opponentName: hit.teamName ?? label,
      source: 'native_performance',
      notes,
    }
  } catch {
    notes.push('Native opponent resolution failed.')
    return { opponentExternalId: null, opponentName: null, source: 'none', notes }
  }
}

/**
 * Resolves the head-to-head opponent's `league_teams.external_id` for projection pulls.
 * Sleeper: live matchups API (all sports with Sleeper league ids).
 * Native AF: `team_performances.opponent` matched to `league_teams.team_name`.
 */
export async function resolveMatchupOpponentExternal(args: {
  leagueId: string
  userId: string
  sport: SupportedSport
  week: number
  season: number
  platform: string
  platformLeagueId: string | null
  manualOpponentExternalId: string | null
  myTeamExternalId: string | null
}): Promise<ResolveMatchupOpponentResult> {
  const manual = args.manualOpponentExternalId?.trim()
  if (manual) {
    const row = await prisma.leagueTeam.findFirst({
      where: { leagueId: args.leagueId, externalId: manual },
      select: { externalId: true, teamName: true },
    })
    if (row) {
      return {
        opponentExternalId: row.externalId,
        opponentName: row.teamName ?? null,
        source: 'manual',
        notes: ['Opponent selected manually.'],
      }
    }
    return {
      opponentExternalId: manual,
      opponentName: null,
      source: 'manual',
      notes: ['Manual opponent id kept — team row may sync on next import.'],
    }
  }

  const plat = args.platform.toLowerCase()
  if (plat === 'sleeper' && args.platformLeagueId?.trim()) {
    return resolveSleeperOpponent({
      leagueId: args.leagueId,
      userId: args.userId,
      week: args.week,
      platformLeagueId: args.platformLeagueId.trim(),
      sport: args.sport,
      myTeamExternalId: args.myTeamExternalId,
    })
  }

  if (plat === 'allfantasy' || plat === 'af') {
    return resolveNativeOpponent({
      leagueId: args.leagueId,
      userId: args.userId,
      season: args.season,
      week: args.week,
      myTeamExternalId: args.myTeamExternalId,
    })
  }

  return {
    opponentExternalId: null,
    opponentName: null,
    source: 'none',
    notes: [
      'Automatic opponent resolution needs Sleeper (imported league id) or AllFantasy native schedule — choose opponent from the league list.',
    ],
  }
}
