import { prisma } from '@/lib/prisma'
import { resolveCanonicalLeagueRules } from '@/lib/league-runtime'
import { resolveNflRedraftRosterRuntime } from '@/lib/roster-runtime/resolveNflRedraftRosterRuntime'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import {
  buildCanonicalScheduleRuntimeState,
  buildScheduleGeneratedEvents,
  buildScheduleRuntimeEvent,
  generateCanonicalRegularSeasonSchedule,
  planCanonicalScheduleWeekTransition,
  type CanonicalScheduleRuntimeState,
  type ScheduleRuntimeMatchupInput,
  type ScheduleRuntimeTeamInput,
} from './canonicalScheduleRuntime'

type RedraftRosterRow = {
  id: string
  ownerId: string
  ownerName: string
  teamName: string | null
}

type LeagueTeamDivisionRow = {
  id: string
  externalId: string
  ownerName: string
  teamName: string
  claimedByUserId: string | null
  platformUserId: string | null
  divisionId: string | null
  division: { id: string; name: string | null; tierLevel: number } | null
}

export type NflRedraftScheduleRuntimeCoverage = {
  teams: number
  scheduledWeeks: number
  matchups: number
  byeWeeks: number
  completedWeeks: number
  validationIssues: number
}

export type NflRedraftScheduleRuntimeResolved =
  | {
      ok: true
      rules: NonNullable<Awaited<ReturnType<typeof resolveCanonicalLeagueRules>>>
      state: CanonicalScheduleRuntimeState
      coverage: NflRedraftScheduleRuntimeCoverage
    }
  | {
      ok: false
      reason: 'league_not_found' | 'not_nfl_redraft' | 'season_not_found' | 'rosters_unavailable'
    }

export type PersistedScheduleGenerationResult =
  | {
      ok: true
      seasonId: string
      created: number
      regenerated: boolean
      state: CanonicalScheduleRuntimeState
      events: ReturnType<typeof buildScheduleGeneratedEvents>
    }
  | {
      ok: false
      code:
        | 'LEAGUE_NOT_FOUND'
        | 'NOT_NFL_REDRAFT'
        | 'PROTECTED_SCHEDULE'
        | 'ROSTERS_UNAVAILABLE'
        | 'SCHEDULE_ALREADY_EXISTS'
        | 'SEASON_NOT_FOUND'
        | 'VALIDATION_BLOCKED'
      message: string
    }

function coverage(state: CanonicalScheduleRuntimeState): NflRedraftScheduleRuntimeCoverage {
  return {
    teams: state.teams.length,
    scheduledWeeks: state.weeks.filter((week) => week.matchups.length > 0).length,
    matchups: state.weeks.reduce((sum, week) => sum + week.matchups.filter((matchup) => !matchup.bye).length, 0),
    byeWeeks: state.weeks.reduce((sum, week) => sum + week.byeRosterIds.length, 0),
    completedWeeks: state.weeks.filter((week) => week.status === 'completed').length,
    validationIssues: state.validationIssues.length,
  }
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function findLeagueTeamForRoster(
  roster: RedraftRosterRow,
  leagueTeams: LeagueTeamDivisionRow[],
): LeagueTeamDivisionRow | null {
  const candidates = new Set(
    [
      roster.ownerId,
      roster.ownerName,
      roster.teamName,
    ]
      .map(normalize)
      .filter(Boolean),
  )

  return leagueTeams.find((team) => {
    return [
      team.id,
      team.externalId,
      team.claimedByUserId,
      team.platformUserId,
      team.ownerName,
      team.teamName,
    ].some((value) => candidates.has(normalize(value)))
  }) ?? null
}

async function buildTeamsForRedraftRosters(leagueId: string, rosters: RedraftRosterRow[]): Promise<ScheduleRuntimeTeamInput[]> {
  const leagueTeams = await prisma.leagueTeam.findMany({
    where: { leagueId },
    select: {
      id: true,
      externalId: true,
      ownerName: true,
      teamName: true,
      claimedByUserId: true,
      platformUserId: true,
      divisionId: true,
      division: { select: { id: true, name: true, tierLevel: true } },
    },
  }) as LeagueTeamDivisionRow[]

  return rosters.map((roster) => {
    const team = findLeagueTeamForRoster(roster, leagueTeams)
    return {
      rosterId: roster.id,
      displayName: roster.teamName || roster.ownerName,
      ownerName: roster.ownerName,
      divisionId: team?.divisionId ?? null,
      divisionName: team?.division?.name ?? (team?.division ? `Division ${team.division.tierLevel}` : null),
    }
  })
}

function toScheduleMatchupInput(row: {
  id: string
  week: number
  type: string
  homeRosterId: string
  awayRosterId: string | null
  homeScore: number
  awayScore: number
  status: string
  isMedianMatchup: boolean
}): ScheduleRuntimeMatchupInput {
  return {
    id: row.id,
    week: row.week,
    type: row.type,
    homeRosterId: row.homeRosterId,
    awayRosterId: row.awayRosterId,
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    status: row.status,
    isMedianMatchup: row.isMedianMatchup,
  }
}

export async function resolveNflRedraftScheduleRuntime(input: {
  leagueId?: string | null
  seasonId?: string | null
  now?: Date
}): Promise<NflRedraftScheduleRuntimeResolved> {
  const season = await prisma.redraftSeason.findFirst({
    where: input.seasonId ? { id: input.seasonId } : { leagueId: input.leagueId ?? undefined },
    orderBy: input.seasonId ? undefined : { createdAt: 'desc' },
    include: {
      rosters: { orderBy: { id: 'asc' } },
      schedule: { orderBy: [{ week: 'asc' }, { id: 'asc' }] },
    },
  })
  if (!season) return { ok: false, reason: 'season_not_found' }

  const rules = await resolveCanonicalLeagueRules(season.leagueId)
  if (!rules) return { ok: false, reason: 'league_not_found' }
  if (String(rules.general.sport).toUpperCase() !== 'NFL' || normalize(rules.general.format) !== 'redraft') {
    return { ok: false, reason: 'not_nfl_redraft' }
  }
  if (!season.rosters.length) return { ok: false, reason: 'rosters_unavailable' }

  const teams = await buildTeamsForRedraftRosters(season.leagueId, season.rosters as RedraftRosterRow[])
  const state = buildCanonicalScheduleRuntimeState({
    rules,
    teams,
    persistedMatchups: season.schedule.map(toScheduleMatchupInput),
    currentWeek: season.currentWeek,
    status: season.status,
    totalWeeks: season.totalWeeks,
    playoffStartWeek: season.playoffStartWeek,
    now: input.now,
  })

  return {
    ok: true,
    rules,
    state,
    coverage: coverage(state),
  }
}

function hasProtectedScheduleRow(row: { status: string; week: number }, currentWeek: number): boolean {
  const status = normalize(row.status)
  return row.week < currentWeek || status === 'completed' || status === 'final' || status === 'locked'
}

export async function generateNflRedraftScheduleForSeason(input: {
  seasonId: string
  regenerate?: boolean
  commissionerOverride?: boolean
  actorUserId?: string | null
}): Promise<PersistedScheduleGenerationResult> {
  const season = await prisma.redraftSeason.findUnique({
    where: { id: input.seasonId },
    include: {
      rosters: { orderBy: { id: 'asc' } },
      schedule: { orderBy: [{ week: 'asc' }, { id: 'asc' }] },
    },
  })
  if (!season) return { ok: false, code: 'SEASON_NOT_FOUND', message: 'Redraft season not found.' }

  const rules = await resolveCanonicalLeagueRules(season.leagueId)
  if (!rules) return { ok: false, code: 'LEAGUE_NOT_FOUND', message: 'League rules could not be resolved.' }
  if (String(rules.general.sport).toUpperCase() !== 'NFL' || normalize(rules.general.format) !== 'redraft') {
    return { ok: false, code: 'NOT_NFL_REDRAFT', message: 'Schedule runtime is scoped to NFL redraft leagues.' }
  }
  if (season.rosters.length < 2) {
    return { ok: false, code: 'ROSTERS_UNAVAILABLE', message: 'At least two redraft rosters are required.' }
  }
  if (season.schedule.length > 0 && !input.regenerate) {
    return { ok: false, code: 'SCHEDULE_ALREADY_EXISTS', message: 'Schedule already exists. Use regenerate before scoring begins.' }
  }
  if (
    season.schedule.length > 0 &&
    season.schedule.some((row) => hasProtectedScheduleRow(row, season.currentWeek)) &&
    !input.commissionerOverride
  ) {
    return {
      ok: false,
      code: 'PROTECTED_SCHEDULE',
      message: 'Schedule has locked or scored weeks and cannot be regenerated without commissioner override.',
    }
  }

  const teams = await buildTeamsForRedraftRosters(season.leagueId, season.rosters as RedraftRosterRow[])
  const generated = generateCanonicalRegularSeasonSchedule({
    rules,
    teams,
    totalWeeks: season.totalWeeks,
    playoffStartWeek: season.playoffStartWeek,
  })
  if (generated.validationIssues.some((issue) => issue.severity === 'blocking')) {
    return {
      ok: false,
      code: 'VALIDATION_BLOCKED',
      message: generated.validationIssues.map((issue) => issue.message).join(' '),
    }
  }

  const regularMatchups = generated.matchups.map((matchup) => ({
    seasonId: season.id,
    leagueId: season.leagueId,
    week: matchup.week,
    type: 'regular',
    homeRosterId: matchup.homeRosterId,
    awayRosterId: matchup.awayRosterId,
    isMedianMatchup: false,
    status: 'scheduled',
  }))

  await prisma.$transaction(async (tx) => {
    if (season.schedule.length > 0 && input.regenerate) {
      await tx.redraftMatchup.deleteMany({ where: { seasonId: season.id } })
    }
    if (regularMatchups.length > 0) {
      await tx.redraftMatchup.createMany({ data: regularMatchups })
    }
  })

  const resolved = await resolveNflRedraftScheduleRuntime({ seasonId: season.id })
  if (!resolved.ok) {
    return { ok: false, code: 'VALIDATION_BLOCKED', message: `Generated schedule could not be resolved: ${resolved.reason}` }
  }

  return {
    ok: true,
    seasonId: season.id,
    created: regularMatchups.length,
    regenerated: Boolean(input.regenerate && season.schedule.length > 0),
    state: resolved.state,
    events: buildScheduleGeneratedEvents({
      state: resolved.state,
      regenerated: Boolean(input.regenerate && season.schedule.length > 0),
      actorUserId: input.actorUserId,
    }),
  }
}

export async function advanceNflRedraftScheduleWeek(input: {
  seasonId: string
  action: 'open_week' | 'complete_week' | 'advance_week' | 'lock_schedule'
  week?: number | null
  actorUserId?: string | null
  commissionerOverride?: boolean
}): Promise<
  | { ok: true; seasonId: string; status: string; currentWeek: number; events: ReturnType<typeof buildScheduleRuntimeEvent>[] }
  | { ok: false; code: string; message: string }
> {
  const resolved = await resolveNflRedraftScheduleRuntime({ seasonId: input.seasonId })
  if (!resolved.ok) return { ok: false, code: resolved.reason, message: 'Schedule runtime could not be resolved.' }

  const rosterRuntime = await resolveNflRedraftRosterRuntime({
    leagueId: resolved.state.leagueId,
    scoringWeek: input.week ?? resolved.state.currentWeek,
  }).catch(() => null)

  const transition = planCanonicalScheduleWeekTransition({
    state: resolved.state,
    action: input.action,
    week: input.week,
    actorUserId: input.actorUserId,
    commissionerOverride: input.commissionerOverride,
    draftCompleted: resolved.state.status !== 'setup' && resolved.state.currentWeek > 0,
    rosterReady: rosterRuntime?.ok ? rosterRuntime.coverage.teamsWithPlayers === rosterRuntime.coverage.teams : true,
  })
  if (!transition.ok) return { ok: false, code: transition.code, message: transition.message }

  await prisma.redraftSeason.update({
    where: { id: input.seasonId },
    data: {
      status: transition.nextStatus,
      currentWeek: transition.currentWeek,
    },
  })

  if (input.action === 'complete_week' || input.action === 'advance_week') {
    await updateStandings(input.seasonId, input.week ?? resolved.state.currentWeek)
  }

  if (input.commissionerOverride) {
    transition.events.push(
      buildScheduleRuntimeEvent({
        leagueId: resolved.state.leagueId,
        type: 'commissioner.schedule_override',
        actorUserId: input.actorUserId,
        payload: {
          seasonId: input.seasonId,
          action: input.action,
          week: input.week ?? resolved.state.currentWeek,
        },
      }),
    )
  }

  return {
    ok: true,
    seasonId: input.seasonId,
    status: transition.nextStatus,
    currentWeek: transition.currentWeek,
    events: transition.events,
  }
}
