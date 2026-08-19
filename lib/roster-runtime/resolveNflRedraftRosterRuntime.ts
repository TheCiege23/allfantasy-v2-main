import { prisma } from '@/lib/prisma'
import { resolveCanonicalLeagueRules } from '@/lib/league-runtime'
import {
  buildCanonicalRosterRuntimeState,
  type CanonicalRosterRuntimeState,
  type CanonicalRosterRuntimeTeamInput,
} from './canonicalRosterRuntime'

export type NflRedraftRosterRuntimeCoverage = {
  teams: number
  teamsWithPlayers: number
  teamsWithValidLineups: number
  lockedPlayers: number
  blockingIssues: number
}

export type NflRedraftRosterRuntimeResolved =
  | {
      ok: true
      rules: NonNullable<Awaited<ReturnType<typeof resolveCanonicalLeagueRules>>>
      state: CanonicalRosterRuntimeState
      coverage: NflRedraftRosterRuntimeCoverage
    }
  | {
      ok: false
      reason: 'league_not_found' | 'not_nfl_redraft' | 'rosters_unavailable'
}

function coverage(state: CanonicalRosterRuntimeState): NflRedraftRosterRuntimeCoverage {
  return {
    teams: state.teams.length,
    teamsWithPlayers: state.teams.filter((team) => team.totalRosterSize > 0).length,
    teamsWithValidLineups: state.teams.filter((team) => team.validation.ok).length,
    lockedPlayers: state.teams.reduce((sum, team) => sum + team.lockedPlayerIds.length, 0),
    blockingIssues: state.teams.reduce(
      (sum, team) => sum + team.validation.issues.filter((issue) => issue.severity === 'blocking').length,
      0,
    ),
  }
}

export async function resolveNflRedraftRosterRuntime(input: {
  leagueId: string
  rosterId?: string | null
  now?: Date
  scoringWeek?: number | null
}): Promise<NflRedraftRosterRuntimeResolved> {
  const rules = await resolveCanonicalLeagueRules(input.leagueId)
  if (!rules) return { ok: false, reason: 'league_not_found' }
  if (rules.general.sport !== 'NFL' || rules.general.format !== 'redraft') {
    return { ok: false, reason: 'not_nfl_redraft' }
  }

  const rosters = await prisma.roster.findMany({
    where: {
      leagueId: input.leagueId,
      ...(input.rosterId ? { id: input.rosterId } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      platformUserId: true,
      playerData: true,
      settings: true,
    },
  })
  if (!rosters.length) return { ok: false, reason: 'rosters_unavailable' }

  const teams: CanonicalRosterRuntimeTeamInput[] = rosters.map((roster, index) => {
    const settings =
      roster.settings && typeof roster.settings === 'object' && !Array.isArray(roster.settings)
        ? (roster.settings as Record<string, unknown>)
        : {}
    const displayName =
      typeof settings.teamName === 'string'
        ? settings.teamName
        : typeof settings.displayName === 'string'
          ? settings.displayName
          : `Team ${index + 1}`
    return {
      rosterId: roster.id,
      platformUserId: roster.platformUserId,
      displayName,
      playerData: roster.playerData,
    }
  })

  const state = buildCanonicalRosterRuntimeState({
    rules,
    teams,
    now: input.now,
    scoringWeek: input.scoringWeek,
  })

  return {
    ok: true,
    rules,
    state,
    coverage: coverage(state),
  }
}
