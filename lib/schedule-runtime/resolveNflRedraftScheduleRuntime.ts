import { loadFantraxNativePresentation } from '@/lib/redraft/fantraxNativePresentation'
import { applyWeeklyWaiverPriorityReset } from '@/lib/waiver-wire/weekly-priority-reset'
import { assignExtraMatchupForWeek } from '@/lib/redraft/oddTeamExtraMatchup'
import { prisma } from '@/lib/prisma'
import { resolveCanonicalLeagueRules } from '@/lib/league-runtime'
import { resolveNflRedraftRosterRuntime } from '@/lib/roster-runtime/resolveNflRedraftRosterRuntime'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import { readMedianGameInPlayoffs } from '@/lib/redraft/medianGame'
import { generateNflRedraftPlayoffRuntimeBracket } from '@/lib/playoff-runtime'
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
import { runsStandardWeeklySeason } from '@/lib/season-week/standardSeasonScope'
import { lastWeekOfPlayoffRound } from '@/lib/playoff-runtime/playoffRoundWeeks'
import { logAction } from '@/server/services/auditService'
import {
  SCHEDULE_REGEN_CONFIRMATION_CODE,
  SCHEDULE_REGEN_CONFIRMATION_MESSAGE,
  firstRegenerableWeek,
  scheduleRegenerationLifecycleRefusal,
} from './scheduleRegeneration'

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
      sourceReadOnly?: boolean
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
      /** The first week written; every earlier week was kept as it was. */
      regeneratedFromWeek: number
      warnings: string[]
      state: CanonicalScheduleRuntimeState
      events: ReturnType<typeof buildScheduleGeneratedEvents>
    }
  | {
      ok: false
      code:
        | 'DRAFT_IN_PROGRESS'
        | 'LEAGUE_ARCHIVED'
        | 'LEAGUE_NOT_FOUND'
        | 'NOT_NFL_REDRAFT'
        | 'NO_REGENERABLE_WEEKS'
        | typeof SCHEDULE_REGEN_CONFIRMATION_CODE
        | 'ROSTERS_UNAVAILABLE'
        | 'SCHEDULE_ALREADY_EXISTS'
        | 'SEASON_NOT_FOUND'
        | 'VALIDATION_BLOCKED'
      | 'IMPORTED_SOURCE_READ_ONLY'
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
  lineupSnapshots?: unknown
}): ScheduleRuntimeMatchupInput {
  return {
    lineupSnapshots: row.lineupSnapshots,
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

/**
 * Injectable fact loaders, matching `DraftRuntimeDeps` on the draft resolver.
 *
 * 🛑 THIS SEAM IS ON THE READ ENTRY POINT ONLY, AND DELIBERATELY NOT ON
 * `generateNflRedraftScheduleForSeason` BELOW. That function takes the same ruleset and PERSISTS a
 * schedule derived from it. A stale ruleset on a read shows someone an old number for a minute; a
 * stale ruleset on a generate writes it into the database, where nothing afterwards reveals that
 * the schedule was built under settings the league had already changed. The write path keeps
 * calling `resolveCanonicalLeagueRules` directly, and should stay that way.
 */
export interface ScheduleRuntimeDeps {
  loadRules: (leagueId: string) => Promise<Awaited<ReturnType<typeof resolveCanonicalLeagueRules>>>
}

const defaultScheduleRuntimeDeps: ScheduleRuntimeDeps = {
  loadRules: (leagueId) => resolveCanonicalLeagueRules(leagueId),
}

export async function resolveNflRedraftScheduleRuntime(input: {
  leagueId?: string | null
  seasonId?: string | null
  now?: Date
}, deps: Partial<ScheduleRuntimeDeps> = {}): Promise<NflRedraftScheduleRuntimeResolved> {
  const season = await prisma.redraftSeason.findFirst({
    where: input.seasonId ? { id: input.seasonId } : { leagueId: input.leagueId ?? undefined },
    orderBy: input.seasonId ? undefined : { createdAt: 'desc' },
    include: {
      rosters: { orderBy: { id: 'asc' } },
      schedule: { orderBy: [{ week: 'asc' }, { id: 'asc' }] },
      league: { select: { medianGame: true, settings: true } },
    },
  })
  if (!season) return { ok: false, reason: 'season_not_found' }

  const loadRules = deps.loadRules ?? defaultScheduleRuntimeDeps.loadRules
  const rules = await loadRules(season.leagueId)
  if (!rules) return { ok: false, reason: 'league_not_found' }
  // Any season-capable sport running a standard weekly season — not only NFL redraft, which
  // left every keeper, dynasty and best-ball league (and every NHL/NCAAB one) on week 1 forever.
  // The reason code keeps its name for its consumers; it now means "format not covered".
  if (!runsStandardWeeklySeason(rules.general.sport, rules.general.format)) {
    return { ok: false, reason: 'not_nfl_redraft' }
  }
  if (!season.rosters.length) return { ok: false, reason: 'rosters_unavailable' }

  const teams = await buildTeamsForRedraftRosters(season.leagueId, season.rosters as RedraftRosterRow[])
  const imported = await loadFantraxNativePresentation(season, input.now)
  const state = buildCanonicalScheduleRuntimeState({
    rules,
    teams,
    persistedMatchups: imported ? imported.matchups : season.schedule.map(toScheduleMatchupInput),
    currentWeek: imported?.currentWeek ?? season.currentWeek,
    status: season.status,
    totalWeeks: season.totalWeeks,
    playoffStartWeek: imported?.playoffStartWeek ?? season.playoffStartWeek,
    regularSeasonWeeks: imported?.regularSeasonWeeks,
    now: input.now,
    // The same flags `updateStandings` reads: the league's current median setting over the season's copy.
    medianGame: !imported && Boolean(season.league?.medianGame ?? season.medianGame),
    medianInPlayoffs: readMedianGameInPlayoffs(season.league?.settings),
  })

  return {
    ok: true,
    rules,
    state,
    coverage: coverage(state),
    sourceReadOnly: Boolean(imported),
  }
}

async function hasLiveDraftSession(leagueId: string): Promise<boolean> {
  const live = await prisma.draftSession.findFirst({
    where: { leagueId, status: { in: ['in_progress', 'paused'] } },
    select: { id: true },
  })
  return Boolean(live)
}

/**
 * Would the final, as the league configures it (`championship_length`, weeks per round, playoff
 * team count), end after the season's last week? Regeneration never moves playoff weeks — it writes
 * regular-season weeks only, ending the week before `playoffStartWeek` — so this is reported as a
 * warning, not a refusal: the commissioner's fix is the playoff settings, not the schedule.
 */
function championshipWindowWarning(input: {
  rules: NonNullable<Awaited<ReturnType<typeof resolveCanonicalLeagueRules>>>
  playoffStartWeek: number | null
  totalWeeks: number
}): string | null {
  const teams = Number(input.rules.playoffs.teamCount ?? 0)
  const rounds = teams >= 2 ? Math.ceil(Math.log2(teams)) : 0
  if (rounds < 1 || !input.playoffStartWeek) return null
  const lastWeek = lastWeekOfPlayoffRound({
    playoffStartWeek: input.playoffStartWeek,
    roundNumber: rounds,
    weeksPerRound: input.rules.playoffs.weeksPerRound,
    finalRoundNumber: rounds,
    championshipLength: input.rules.playoffs.championshipLength,
  })
  if (lastWeek <= input.totalWeeks) return null
  return `The playoffs as configured end in week ${lastWeek}, past the season's last week (${input.totalWeeks}). Shorten the final or move the playoffs earlier.`
}

/**
 * Generate the regular-season schedule, or regenerate the weeks that have not started.
 *
 * Covers every league that runs the standard weekly season (`runsStandardWeeklySeason`) — the same
 * scope as the read path above. 🛑 IT WAS NFL-REDRAFT ONLY: a dynasty league (year 1 or a year-2+
 * season opened by `startDynastyNewSeason`) and every NBA/NHL/MLB league were refused with
 * `NOT_NFL_REDRAFT`, so their commissioners had no way to rebuild a schedule after a team was
 * added, divisions changed or the playoff start moved.
 *
 * Regeneration rules (see `scheduleRegeneration.ts`):
 *   - refused while a draft is live and on an archived league;
 *   - weeks up to the last started week are kept exactly; only later weeks are rewritten, from the
 *     same full-season rotation, so regenerating an unchanged league reproduces its schedule;
 *   - only regular-season weeks are written (through `playoffStartWeek - 1`, capped by
 *     `totalWeeks`); odd team counts get the deterministic bye, divisions are prioritised;
 *   - once a week has started it needs `confirmMidSeasonChange` (the scoring/roster editors' flag);
 *   - a regeneration writes a `schedule_regenerated` audit row and a league announcement.
 */
export async function generateNflRedraftScheduleForSeason(input: {
  seasonId: string
  regenerate?: boolean
  /** Legacy name for the mid-season confirmation. It no longer unlocks started weeks. */
  commissionerOverride?: boolean
  confirmMidSeasonChange?: boolean
  actorUserId?: string | null
  now?: Date
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
  if (!runsStandardWeeklySeason(rules.general.sport, rules.general.format)) {
    return { ok: false, code: 'NOT_NFL_REDRAFT', message: "This league's format schedules its own weeks; a head-to-head schedule can't be generated for it." }
  }
  if (season.rosters.length < 2) {
    return { ok: false, code: 'ROSTERS_UNAVAILABLE', message: 'At least two redraft rosters are required.' }
  }
  const replacing = season.schedule.length > 0
  if (replacing && !input.regenerate) {
    return { ok: false, code: 'SCHEDULE_ALREADY_EXISTS', message: 'Schedule already exists. Use regenerate to rebuild the weeks that have not started.' }
  }

  if (replacing) {
    const league = await prisma.league.findUnique({ where: { id: season.leagueId }, select: { lifecycleState: true } })
    const refusal = scheduleRegenerationLifecycleRefusal({
      lifecycleState: league?.lifecycleState ?? null,
      liveDraft: await hasLiveDraftSession(season.leagueId),
    })
    if (refusal) return { ok: false, code: refusal.code, message: refusal.message }
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

  const fromWeek = replacing
    ? firstRegenerableWeek({
        currentWeek: season.currentWeek,
        sport: season.sport,
        seasonYear: season.season,
        now: input.now ?? new Date(),
        persisted: season.schedule,
        regularSeasonWeeks: generated.regularSeasonWeeks,
      })
    : 1
  if (fromWeek > generated.regularSeasonWeeks) {
    return {
      ok: false,
      code: 'NO_REGENERABLE_WEEKS',
      message: 'Every regular-season week has already started, so there is nothing left to regenerate.',
    }
  }
  const midSeason = replacing && fromWeek > 1
  if (midSeason && !(input.confirmMidSeasonChange || input.commissionerOverride)) {
    return { ok: false, code: SCHEDULE_REGEN_CONFIRMATION_CODE, message: SCHEDULE_REGEN_CONFIRMATION_MESSAGE }
  }

  const regularMatchups = generated.matchups
    .filter((matchup) => matchup.week >= fromWeek)
    .map((matchup) => ({
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
    if (replacing) {
      // Every row at or after `fromWeek` belongs to a week that has not started (that is what
      // `fromWeek` means), including stale rows past a playoff start that moved earlier.
      await tx.redraftMatchup.deleteMany({ where: { seasonId: season.id, week: { gte: fromWeek } } })
    }
    if (regularMatchups.length > 0) {
      await tx.redraftMatchup.createMany({ data: regularMatchups })
    }
  })

  const resolved = await resolveNflRedraftScheduleRuntime({ seasonId: season.id })
  if (!resolved.ok) {
    return { ok: false, code: 'VALIDATION_BLOCKED', message: `Generated schedule could not be resolved: ${resolved.reason}` }
  }

  const warning = championshipWindowWarning({
    rules,
    playoffStartWeek: generated.playoffStartWeek,
    totalWeeks: season.totalWeeks,
  })

  if (replacing) {
    await recordScheduleRegeneration({
      leagueId: season.leagueId,
      seasonId: season.id,
      actorUserId: input.actorUserId ?? null,
      fromWeek,
      throughWeek: generated.regularSeasonWeeks,
      created: regularMatchups.length,
      midSeason,
    })
  }

  return {
    ok: true,
    seasonId: season.id,
    created: regularMatchups.length,
    regenerated: replacing,
    regeneratedFromWeek: fromWeek,
    warnings: warning ? [warning] : [],
    state: resolved.state,
    events: buildScheduleGeneratedEvents({
      state: resolved.state,
      regenerated: replacing,
      actorUserId: input.actorUserId,
    }),
  }
}

/**
 * The audit row and the league announcement for a regeneration — the pair the mid-season
 * scoring/roster editors write. Never throws: the schedule is already saved.
 */
async function recordScheduleRegeneration(args: {
  leagueId: string
  seasonId: string
  actorUserId: string | null
  fromWeek: number
  throughWeek: number
  created: number
  midSeason: boolean
}): Promise<void> {
  const metadata = {
    seasonId: args.seasonId,
    fromWeek: args.fromWeek,
    throughWeek: args.throughWeek,
    matchupsWritten: args.created,
    midSeason: args.midSeason,
    confirmed: args.midSeason,
  }
  await logAction({
    leagueId: args.leagueId,
    userId: args.actorUserId,
    actionType: 'schedule_regenerated',
    entityType: 'redraft_season',
    entityId: args.seasonId,
    metadata,
  }).catch(() => {})

  await import('@/lib/league-events/publisher')
    .then(({ publishLeagueFanoutEvent }) =>
      publishLeagueFanoutEvent({
        leagueId: args.leagueId,
        eventType: 'settings_changed',
        title: 'Schedule regenerated',
        message: args.midSeason
          ? `The commissioner regenerated the schedule from week ${args.fromWeek}. Weeks that already started are unchanged.`
          : 'The commissioner regenerated the league schedule. Check your upcoming matchups.',
        category: 'league_announcements',
        visibility: 'all_members',
        actorUserId: args.actorUserId,
        meta: metadata,
      }),
    )
    .catch(() => {})
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

  if (resolved.sourceReadOnly) return { ok: false, code: 'IMPORTED_SOURCE_READ_ONLY', message: 'Fantrax controls the scoring calendar for this imported league.' }

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

  // A new scoring week opened: a league on the weekly priority reset goes back to reverse standings
  // (lib/waiver-wire/weekly-priority-reset.ts — a no-op for rolling, and once per week). After the
  // standings above, so the order reflects the week just finished. Best-effort: the advance stands.
  if ((input.action === 'advance_week' || input.action === 'open_week') && transition.currentWeek > resolved.state.currentWeek) {
    await applyWeeklyWaiverPriorityReset({
      leagueId: resolved.state.leagueId,
      seasonId: input.seasonId,
      week: transition.currentWeek,
    }).catch((error) => {
      console.error('[schedule-runtime] weekly waiver priority reset failed', { seasonId: input.seasonId, error })
    })
    // An odd-team league on the extra matchup fixes this week's leftover-team opponent now, from the
    // week just finished (lib/redraft/oddTeamExtraMatchup.ts — idempotent, a no-op when it is off).
    await assignExtraMatchupForWeek({ seasonId: input.seasonId, week: transition.currentWeek }).catch((error) => {
      console.error('[schedule-runtime] extra matchup assignment failed', { seasonId: input.seasonId, error })
    })
  }

  // The commissioner already made the "regular season is over" call by
  // advancing past the final week (itself gated on every matchup being
  // finalized, above) — auto-generating the bracket here just removes a
  // second, redundant click for the default case. It is not locked, so a
  // commissioner can still `regenerate_bracket` before playoffs actually
  // begin if standings need correcting. Previously this transition fired and
  // nothing downstream ever read it: a season could sit at
  // `regular_season_complete` indefinitely with no bracket until someone
  // remembered to generate one by hand.
  if (transition.nextStatus === 'regular_season_complete' && resolved.state.status !== 'regular_season_complete') {
    try {
      await generateNflRedraftPlayoffRuntimeBracket({
        seasonId: input.seasonId,
        actorUserId: input.actorUserId,
      })
    } catch (error) {
      console.error('[schedule-runtime] auto playoff bracket generation failed', {
        seasonId: input.seasonId,
        error,
      })
    }
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
