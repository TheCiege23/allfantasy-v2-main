import type {
  CanonicalLeagueRules,
  CanonicalLeagueRuntimeEvent,
  CanonicalLeagueRuntimeEventType,
} from '@/lib/league-runtime'
import { toCanonicalLeagueRuntimeEvent } from '@/lib/league-runtime'

export type ScheduleRuntimeValidationIssue = {
  code:
    | 'DIVISION_SCHEDULE_PRESENT'
    | 'ODD_TEAM_BYES_ASSIGNED'
    | 'REGULAR_SEASON_WEEKS_INVALID'
    | 'SCHEDULE_NOT_GENERATED'
    | 'TEAM_COUNT_TOO_LOW'
    | 'WEEK_MATCHUP_COUNT_INVALID'
    | 'WEEK_TEAM_DUPLICATE'
  severity: 'blocking' | 'warning' | 'info'
  message: string
  week?: number
  rosterId?: string
}

export type ScheduleRuntimeTeamInput = {
  rosterId: string
  displayName?: string | null
  ownerName?: string | null
  divisionId?: string | null
  divisionName?: string | null
}

export type ScheduleRuntimeMatchupInput = {
  id?: string | null
  week: number
  type?: string | null
  homeRosterId: string
  awayRosterId?: string | null
  homeScore?: number | null
  awayScore?: number | null
  status?: string | null
  isMedianMatchup?: boolean | null
}

export type CanonicalScheduleRuntimeMatchup = {
  id: string
  week: number
  slot: number
  type: 'regular' | 'bye'
  homeRosterId: string
  awayRosterId: string | null
  homeName: string
  awayName: string | null
  homeDivisionId: string | null
  awayDivisionId: string | null
  homeDivisionName: string | null
  awayDivisionName: string | null
  divisionGame: boolean
  bye: boolean
  repeatCycle: number
  sourceRound: number
  status: string
  locked: boolean
  homeScore: number | null
  awayScore: number | null
}

export type CanonicalScheduleRuntimeWeek = {
  week: number
  status: 'scheduled' | 'open' | 'completed' | 'locked'
  locked: boolean
  isCurrent: boolean
  matchups: CanonicalScheduleRuntimeMatchup[]
  byeRosterIds: string[]
}

export type CanonicalScheduleStanding = {
  rosterId: string
  displayName: string
  divisionId: string | null
  divisionName: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  winPct: number
  divisionWins: number
  divisionLosses: number
  divisionTies: number
  streak: string | null
  playoffSeed: number
  rankMovement: null
  byeWeeks: number[]
}

export type PlayoffQualificationSnapshot = {
  playoffTeamCount: number
  regularSeasonEndWeek: number
  playoffStartWeek: number | null
  qualificationLocked: boolean
  seeds: Array<{
    seed: number
    rosterId: string
    displayName: string
    record: string
    winPct: number
    pointsFor: number
  }>
  bubbleRosterIds: string[]
  tiebreakers: string[]
}

export type CanonicalScheduleRuntimeState = {
  leagueId: string
  rulesVersion: CanonicalLeagueRules['version']
  generatedAtIso: string
  season: number | null
  currentWeek: number
  status: string
  regularSeasonWeeks: number
  playoffStartWeek: number | null
  generated: boolean
  locked: boolean
  teams: ScheduleRuntimeTeamInput[]
  weeks: CanonicalScheduleRuntimeWeek[]
  standings: CanonicalScheduleStanding[]
  playoffQualificationSnapshot: PlayoffQualificationSnapshot
  validationIssues: ScheduleRuntimeValidationIssue[]
}

export type ScheduleRuntimeShapeOverrides = {
  totalWeeks?: number | null
  playoffStartWeek?: number | null
  regularSeasonWeeks?: number | null
}

type RoundSlot =
  | { type: 'regular'; home: ScheduleRuntimeTeamInput; away: ScheduleRuntimeTeamInput }
  | { type: 'bye'; team: ScheduleRuntimeTeamInput }

type BuildScheduleInput = {
  rules: CanonicalLeagueRules
  teams: ScheduleRuntimeTeamInput[]
  persistedMatchups?: ScheduleRuntimeMatchupInput[]
  currentWeek?: number | null
  status?: string | null
  now?: Date
} & ScheduleRuntimeShapeOverrides

const BYE_ID = '__BYE__'
const COMPLETED_STATUSES = new Set(['completed', 'final'])
const LOCKED_STATUSES = new Set(['completed', 'final', 'locked'])
const DEFAULT_REGULAR_SEASON_WEEKS = 14

function positiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value))
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return Math.max(0, parsed)
  }
  return null
}

function finiteScore(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function teamName(team: ScheduleRuntimeTeamInput): string {
  return team.displayName?.trim() || team.ownerName?.trim() || team.rosterId
}

function normalizedStatus(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase()
  return raw || 'scheduled'
}

function matchupCompleted(matchup: Pick<CanonicalScheduleRuntimeMatchup, 'status' | 'bye'>): boolean {
  return !matchup.bye && COMPLETED_STATUSES.has(normalizedStatus(matchup.status))
}

function resolveScheduleShape(
  rules: CanonicalLeagueRules,
  overrides: ScheduleRuntimeShapeOverrides = {},
): { regularSeasonWeeks: number; playoffStartWeek: number | null; issues: ScheduleRuntimeValidationIssue[] } {
  const configuredPlayoffStart =
    positiveInt(overrides.playoffStartWeek) ??
    positiveInt(rules.playoffs.startWeek) ??
    positiveInt(rules.schedule.playoffTransitionPoint)
  const configuredRegular =
    positiveInt(overrides.regularSeasonWeeks) ??
    positiveInt(rules.schedule.regularSeasonLength)
  const totalWeeks = positiveInt(overrides.totalWeeks)

  let regularSeasonWeeks =
    configuredRegular ??
    (configuredPlayoffStart != null
      ? Math.max(1, configuredPlayoffStart - 1)
      : totalWeeks ?? DEFAULT_REGULAR_SEASON_WEEKS)

  if (totalWeeks != null && configuredPlayoffStart != null) {
    regularSeasonWeeks = Math.min(totalWeeks, Math.max(1, configuredPlayoffStart - 1))
  }

  const issues: ScheduleRuntimeValidationIssue[] = []
  if (!Number.isFinite(regularSeasonWeeks) || regularSeasonWeeks < 1) {
    issues.push({
      code: 'REGULAR_SEASON_WEEKS_INVALID',
      severity: 'blocking',
      message: 'Regular season must have at least one week before a schedule can be generated.',
    })
    regularSeasonWeeks = DEFAULT_REGULAR_SEASON_WEEKS
  }

  return {
    regularSeasonWeeks,
    playoffStartWeek: configuredPlayoffStart ?? (regularSeasonWeeks > 0 ? regularSeasonWeeks + 1 : null),
    issues,
  }
}

function buildRoundRobinRounds(teams: ScheduleRuntimeTeamInput[]): RoundSlot[][] {
  const entries: Array<ScheduleRuntimeTeamInput & { rosterId: string }> = teams.map((team) => ({ ...team }))
  if (entries.length % 2 === 1) {
    entries.push({ rosterId: BYE_ID, displayName: 'Bye' })
  }

  const rounds: RoundSlot[][] = []
  let rotation = [...entries]
  const roundCount = Math.max(0, rotation.length - 1)

  for (let round = 0; round < roundCount; round += 1) {
    const slots: RoundSlot[] = []
    const half = rotation.length / 2
    for (let i = 0; i < half; i += 1) {
      const left = rotation[i]!
      const right = rotation[rotation.length - 1 - i]!
      if (left.rosterId === BYE_ID || right.rosterId === BYE_ID) {
        slots.push({ type: 'bye', team: left.rosterId === BYE_ID ? right : left })
        continue
      }
      const swapHome = (round + i) % 2 === 1
      slots.push({
        type: 'regular',
        home: swapHome ? right : left,
        away: swapHome ? left : right,
      })
    }
    rounds.push(slots)

    const fixed = rotation[0]!
    const moving = rotation.slice(1)
    rotation = [fixed, moving[moving.length - 1]!, ...moving.slice(0, moving.length - 1)]
  }

  return rounds
}

function divisionGame(slot: RoundSlot): boolean {
  if (slot.type !== 'regular') return false
  return Boolean(slot.home.divisionId && slot.home.divisionId === slot.away.divisionId)
}

function orderRoundsForDivisions(rounds: RoundSlot[][], teams: ScheduleRuntimeTeamInput[]): RoundSlot[][] {
  if (!teams.some((team) => Boolean(team.divisionId))) return rounds
  return rounds
    .map((slots, index) => ({
      slots,
      index,
      divisionGames: slots.filter(divisionGame).length,
    }))
    .sort((a, b) => b.divisionGames - a.divisionGames || a.index - b.index)
    .map((entry) => entry.slots)
}

export function generateCanonicalRegularSeasonSchedule(input: {
  rules: CanonicalLeagueRules
  teams: ScheduleRuntimeTeamInput[]
  now?: Date
} & ScheduleRuntimeShapeOverrides): {
  matchups: CanonicalScheduleRuntimeMatchup[]
  regularSeasonWeeks: number
  playoffStartWeek: number | null
  validationIssues: ScheduleRuntimeValidationIssue[]
} {
  const { regularSeasonWeeks, playoffStartWeek, issues } = resolveScheduleShape(input.rules, input)
  const teams = input.teams.filter((team) => team.rosterId && team.rosterId !== BYE_ID)
  const validationIssues = [...issues]

  if (teams.length < 2) {
    validationIssues.push({
      code: 'TEAM_COUNT_TOO_LOW',
      severity: 'blocking',
      message: 'At least two teams are required to generate a head-to-head schedule.',
    })
    return { matchups: [], regularSeasonWeeks, playoffStartWeek, validationIssues }
  }

  if (teams.length % 2 === 1) {
    validationIssues.push({
      code: 'ODD_TEAM_BYES_ASSIGNED',
      severity: 'info',
      message: 'Odd team count detected; one deterministic bye is assigned each week.',
    })
  }
  if (teams.some((team) => Boolean(team.divisionId))) {
    validationIssues.push({
      code: 'DIVISION_SCHEDULE_PRESENT',
      severity: 'info',
      message: 'Division pairings are prioritized before non-division repeats where the team count allows it.',
    })
  }

  const rounds = orderRoundsForDivisions(buildRoundRobinRounds(teams), teams)
  if (!rounds.length) {
    validationIssues.push({
      code: 'SCHEDULE_NOT_GENERATED',
      severity: 'blocking',
      message: 'Schedule could not be generated from the available teams.',
    })
    return { matchups: [], regularSeasonWeeks, playoffStartWeek, validationIssues }
  }

  const matchups: CanonicalScheduleRuntimeMatchup[] = []
  for (let week = 1; week <= regularSeasonWeeks; week += 1) {
    const roundIndex = (week - 1) % rounds.length
    const repeatCycle = Math.floor((week - 1) / rounds.length)
    const round = rounds[roundIndex]!
    round.forEach((slot, index) => {
      if (slot.type === 'bye') {
        matchups.push({
          id: `week-${week}-bye-${slot.team.rosterId}`,
          week,
          slot: index + 1,
          type: 'bye',
          homeRosterId: slot.team.rosterId,
          awayRosterId: null,
          homeName: teamName(slot.team),
          awayName: null,
          homeDivisionId: slot.team.divisionId ?? null,
          awayDivisionId: null,
          homeDivisionName: slot.team.divisionName ?? null,
          awayDivisionName: null,
          divisionGame: false,
          bye: true,
          repeatCycle,
          sourceRound: roundIndex + 1,
          status: 'scheduled',
          locked: false,
          homeScore: null,
          awayScore: null,
        })
        return
      }

      const home = repeatCycle % 2 === 1 ? slot.away : slot.home
      const away = repeatCycle % 2 === 1 ? slot.home : slot.away
      matchups.push({
        id: `week-${week}-matchup-${index + 1}-${home.rosterId}-${away.rosterId}`,
        week,
        slot: index + 1,
        type: 'regular',
        homeRosterId: home.rosterId,
        awayRosterId: away.rosterId,
        homeName: teamName(home),
        awayName: teamName(away),
        homeDivisionId: home.divisionId ?? null,
        awayDivisionId: away.divisionId ?? null,
        homeDivisionName: home.divisionName ?? null,
        awayDivisionName: away.divisionName ?? null,
        divisionGame: Boolean(home.divisionId && home.divisionId === away.divisionId),
        bye: false,
        repeatCycle,
        sourceRound: roundIndex + 1,
        status: 'scheduled',
        locked: false,
        homeScore: null,
        awayScore: null,
      })
    })
  }

  return { matchups, regularSeasonWeeks, playoffStartWeek, validationIssues }
}

function materializePersistedMatchups(
  teamsById: Map<string, ScheduleRuntimeTeamInput>,
  matchups: ScheduleRuntimeMatchupInput[],
  currentWeek: number,
): CanonicalScheduleRuntimeMatchup[] {
  const sorted = [...matchups].sort((a, b) => a.week - b.week || String(a.id ?? '').localeCompare(String(b.id ?? '')))
  const slotByWeek = new Map<number, number>()

  return sorted
    .filter((matchup) => !matchup.isMedianMatchup)
    .map((matchup) => {
      const slot = (slotByWeek.get(matchup.week) ?? 0) + 1
      slotByWeek.set(matchup.week, slot)
      const home = teamsById.get(matchup.homeRosterId) ?? { rosterId: matchup.homeRosterId }
      const away = matchup.awayRosterId ? teamsById.get(matchup.awayRosterId) ?? { rosterId: matchup.awayRosterId } : null
      const status = normalizedStatus(matchup.status)
      const bye = !away
      return {
        id: matchup.id ?? `week-${matchup.week}-matchup-${slot}-${matchup.homeRosterId}`,
        week: matchup.week,
        slot,
        type: bye ? 'bye' : 'regular',
        homeRosterId: matchup.homeRosterId,
        awayRosterId: matchup.awayRosterId ?? null,
        homeName: teamName(home),
        awayName: away ? teamName(away) : null,
        homeDivisionId: home.divisionId ?? null,
        awayDivisionId: away?.divisionId ?? null,
        homeDivisionName: home.divisionName ?? null,
        awayDivisionName: away?.divisionName ?? null,
        divisionGame: Boolean(away?.divisionId && home.divisionId && home.divisionId === away.divisionId),
        bye,
        repeatCycle: 0,
        sourceRound: matchup.week,
        status,
        locked: LOCKED_STATUSES.has(status) || matchup.week < currentWeek,
        homeScore: finiteScore(matchup.homeScore),
        awayScore: finiteScore(matchup.awayScore),
      } satisfies CanonicalScheduleRuntimeMatchup
    })
}

function buildWeeks(input: {
  matchups: CanonicalScheduleRuntimeMatchup[]
  regularSeasonWeeks: number
  currentWeek: number
  status: string
}): CanonicalScheduleRuntimeWeek[] {
  const weeks: CanonicalScheduleRuntimeWeek[] = []
  for (let week = 1; week <= input.regularSeasonWeeks; week += 1) {
    const matchups = input.matchups.filter((matchup) => matchup.week === week)
    const nonBye = matchups.filter((matchup) => !matchup.bye)
    const allCompleted = nonBye.length > 0 && nonBye.every(matchupCompleted)
    const locked = week < input.currentWeek || nonBye.every((matchup) => matchup.locked)
    const isCurrent = week === input.currentWeek
    const status =
      allCompleted ? 'completed' :
      locked ? 'locked' :
      isCurrent && input.status === 'active' ? 'open' :
      'scheduled'
    weeks.push({
      week,
      status,
      locked,
      isCurrent,
      matchups,
      byeRosterIds: matchups.filter((matchup) => matchup.bye).map((matchup) => matchup.homeRosterId),
    })
  }
  return weeks
}

function validateWeeks(
  teams: ScheduleRuntimeTeamInput[],
  weeks: CanonicalScheduleRuntimeWeek[],
): ScheduleRuntimeValidationIssue[] {
  const issues: ScheduleRuntimeValidationIssue[] = []
  const expectedTeamCount = teams.length
  for (const week of weeks) {
    if (week.matchups.length === 0) {
      issues.push({
        code: 'SCHEDULE_NOT_GENERATED',
        severity: 'warning',
        message: `Week ${week.week} has no scheduled matchups yet.`,
        week: week.week,
      })
      continue
    }

    const seen = new Set<string>()
    for (const matchup of week.matchups) {
      for (const rosterId of [matchup.homeRosterId, matchup.awayRosterId].filter((id): id is string => Boolean(id))) {
        if (seen.has(rosterId)) {
          issues.push({
            code: 'WEEK_TEAM_DUPLICATE',
            severity: 'blocking',
            message: `${rosterId} appears more than once in week ${week.week}.`,
            week: week.week,
            rosterId,
          })
        }
        seen.add(rosterId)
      }
    }
    if (seen.size !== expectedTeamCount) {
      issues.push({
        code: 'WEEK_MATCHUP_COUNT_INVALID',
        severity: 'blocking',
        message: `Week ${week.week} covers ${seen.size} teams; expected ${expectedTeamCount}.`,
        week: week.week,
      })
    }
  }
  return issues
}

function recordString(row: Pick<CanonicalScheduleStanding, 'wins' | 'losses' | 'ties'>): string {
  return row.ties > 0 ? `${row.wins}-${row.losses}-${row.ties}` : `${row.wins}-${row.losses}`
}

export function buildCanonicalScheduleStandings(input: {
  teams: ScheduleRuntimeTeamInput[]
  matchups: CanonicalScheduleRuntimeMatchup[]
}): CanonicalScheduleStanding[] {
  const standingsByRosterId = new Map<string, CanonicalScheduleStanding>()
  const outcomesByRosterId = new Map<string, Array<'W' | 'L' | 'T'>>()

  for (const team of input.teams) {
    standingsByRosterId.set(team.rosterId, {
      rosterId: team.rosterId,
      displayName: teamName(team),
      divisionId: team.divisionId ?? null,
      divisionName: team.divisionName ?? null,
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      winPct: 0,
      divisionWins: 0,
      divisionLosses: 0,
      divisionTies: 0,
      streak: null,
      playoffSeed: 0,
      rankMovement: null,
      byeWeeks: [],
    })
    outcomesByRosterId.set(team.rosterId, [])
  }

  const byWeek = [...input.matchups].sort((a, b) => a.week - b.week || a.slot - b.slot)
  for (const matchup of byWeek) {
    if (matchup.bye) {
      standingsByRosterId.get(matchup.homeRosterId)?.byeWeeks.push(matchup.week)
      continue
    }
    if (!matchupCompleted(matchup) || !matchup.awayRosterId) continue
    const home = standingsByRosterId.get(matchup.homeRosterId)
    const away = standingsByRosterId.get(matchup.awayRosterId)
    if (!home || !away) continue

    const homeScore = matchup.homeScore ?? 0
    const awayScore = matchup.awayScore ?? 0
    home.pointsFor = round1(home.pointsFor + homeScore)
    home.pointsAgainst = round1(home.pointsAgainst + awayScore)
    away.pointsFor = round1(away.pointsFor + awayScore)
    away.pointsAgainst = round1(away.pointsAgainst + homeScore)

    const divisionGame = Boolean(home.divisionId && home.divisionId === away.divisionId)
    if (homeScore > awayScore) {
      home.wins += 1
      away.losses += 1
      outcomesByRosterId.get(home.rosterId)?.push('W')
      outcomesByRosterId.get(away.rosterId)?.push('L')
      if (divisionGame) {
        home.divisionWins += 1
        away.divisionLosses += 1
      }
    } else if (awayScore > homeScore) {
      away.wins += 1
      home.losses += 1
      outcomesByRosterId.get(away.rosterId)?.push('W')
      outcomesByRosterId.get(home.rosterId)?.push('L')
      if (divisionGame) {
        away.divisionWins += 1
        home.divisionLosses += 1
      }
    } else {
      home.ties += 1
      away.ties += 1
      outcomesByRosterId.get(home.rosterId)?.push('T')
      outcomesByRosterId.get(away.rosterId)?.push('T')
      if (divisionGame) {
        home.divisionTies += 1
        away.divisionTies += 1
      }
    }
  }

  const rows = Array.from(standingsByRosterId.values())
  for (const row of rows) {
    const played = row.wins + row.losses + row.ties
    row.winPct = played > 0 ? round3((row.wins + row.ties * 0.5) / played) : 0
    const outcomes = outcomesByRosterId.get(row.rosterId) ?? []
    if (outcomes.length) {
      const last = outcomes[outcomes.length - 1]!
      let count = 0
      for (let i = outcomes.length - 1; i >= 0 && outcomes[i] === last; i -= 1) count += 1
      row.streak = `${last}${count}`
    }
  }

  return rows
    .sort((a, b) =>
      b.winPct - a.winPct ||
      b.wins - a.wins ||
      b.divisionWins - a.divisionWins ||
      b.pointsFor - a.pointsFor ||
      a.pointsAgainst - b.pointsAgainst ||
      a.displayName.localeCompare(b.displayName) ||
      a.rosterId.localeCompare(b.rosterId)
    )
    .map((row, index) => ({ ...row, playoffSeed: index + 1 }))
}

function buildPlayoffQualificationSnapshot(input: {
  rules: CanonicalLeagueRules
  standings: CanonicalScheduleStanding[]
  regularSeasonWeeks: number
  playoffStartWeek: number | null
  weeks: CanonicalScheduleRuntimeWeek[]
}): PlayoffQualificationSnapshot {
  const configured = positiveInt(input.rules.playoffs.teamCount)
  const playoffTeamCount = Math.max(0, Math.min(configured ?? Math.min(6, input.standings.length), input.standings.length))
  const completedWeeks = input.weeks.filter((week) => week.status === 'completed').length
  const seeds = input.standings.slice(0, playoffTeamCount).map((row) => ({
    seed: row.playoffSeed,
    rosterId: row.rosterId,
    displayName: row.displayName,
    record: recordString(row),
    winPct: row.winPct,
    pointsFor: row.pointsFor,
  }))
  const bubbleStart = Math.max(0, playoffTeamCount - 2)
  const bubbleEnd = Math.min(input.standings.length, playoffTeamCount + 2)
  return {
    playoffTeamCount,
    regularSeasonEndWeek: input.regularSeasonWeeks,
    playoffStartWeek: input.playoffStartWeek,
    qualificationLocked: completedWeeks >= input.regularSeasonWeeks,
    seeds,
    bubbleRosterIds: input.standings.slice(bubbleStart, bubbleEnd).map((row) => row.rosterId),
    tiebreakers: input.rules.playoffs.standingsTiebreakers ?? [],
  }
}

export function buildCanonicalScheduleRuntimeState(input: BuildScheduleInput): CanonicalScheduleRuntimeState {
  const currentWeek = Math.max(0, positiveInt(input.currentWeek) ?? 0)
  const status = normalizedStatus(input.status ?? input.rules.general.status ?? input.rules.general.lifecycleState ?? 'setup')
  const generated = Boolean(input.persistedMatchups?.length)
  const teams = input.teams.filter((team) => team.rosterId)
  const teamsById = new Map(teams.map((team) => [team.rosterId, team]))
  const generatedSchedule = generated
    ? null
    : generateCanonicalRegularSeasonSchedule({
        rules: input.rules,
        teams,
        totalWeeks: input.totalWeeks,
        playoffStartWeek: input.playoffStartWeek,
        regularSeasonWeeks: input.regularSeasonWeeks,
        now: input.now,
      })
  const resolvedShape = generatedSchedule
    ? { regularSeasonWeeks: generatedSchedule.regularSeasonWeeks, playoffStartWeek: generatedSchedule.playoffStartWeek, issues: [] as ScheduleRuntimeValidationIssue[] }
    : resolveScheduleShape(input.rules, input)
  const matchups = generatedSchedule
    ? generatedSchedule.matchups
    : materializePersistedMatchups(teamsById, input.persistedMatchups ?? [], Math.max(1, currentWeek || 1))
  const weeks = buildWeeks({
    matchups,
    regularSeasonWeeks: resolvedShape.regularSeasonWeeks,
    currentWeek: Math.max(1, currentWeek || 1),
    status,
  })
  const standings = buildCanonicalScheduleStandings({ teams, matchups })
  const validationIssues = [
    ...(generatedSchedule?.validationIssues ?? []),
    ...resolvedShape.issues,
    ...validateWeeks(teams, weeks),
  ]
  const playoffQualificationSnapshot = buildPlayoffQualificationSnapshot({
    rules: input.rules,
    standings,
    regularSeasonWeeks: resolvedShape.regularSeasonWeeks,
    playoffStartWeek: resolvedShape.playoffStartWeek,
    weeks,
  })

  return {
    leagueId: input.rules.leagueId,
    rulesVersion: input.rules.version,
    generatedAtIso: (input.now ?? new Date()).toISOString(),
    season: input.rules.general.season,
    currentWeek,
    status,
    regularSeasonWeeks: resolvedShape.regularSeasonWeeks,
    playoffStartWeek: resolvedShape.playoffStartWeek,
    generated: matchups.length > 0,
    locked: weeks.length > 0 && weeks.every((week) => week.locked || week.status === 'completed'),
    teams,
    weeks,
    standings,
    playoffQualificationSnapshot,
    validationIssues,
  }
}

export type ScheduleWeekTransitionInput = {
  state: CanonicalScheduleRuntimeState
  action: 'open_week' | 'complete_week' | 'advance_week' | 'lock_schedule'
  week?: number | null
  draftCompleted: boolean
  rosterReady: boolean
  commissionerOverride?: boolean
  actorUserId?: string | null
}

export type ScheduleWeekTransitionResult =
  | {
      ok: true
      action: ScheduleWeekTransitionInput['action']
      nextStatus: string
      currentWeek: number
      lockedWeeks: number[]
      events: CanonicalLeagueRuntimeEvent[]
    }
  | {
      ok: false
      code:
        | 'DRAFT_NOT_COMPLETE'
        | 'INCOMPLETE_WEEK'
        | 'INVALID_WEEK'
        | 'ROSTER_NOT_READY'
        | 'SCHEDULE_NOT_GENERATED'
      message: string
    }

function weekHasIncompleteMatchups(week: CanonicalScheduleRuntimeWeek | undefined): boolean {
  if (!week) return true
  return week.matchups.some((matchup) => !matchup.bye && !matchupCompleted(matchup))
}

export function planCanonicalScheduleWeekTransition(
  input: ScheduleWeekTransitionInput,
): ScheduleWeekTransitionResult {
  if (!input.state.generated) {
    return { ok: false, code: 'SCHEDULE_NOT_GENERATED', message: 'Generate the regular season schedule before opening weeks.' }
  }
  if (!input.draftCompleted && !input.commissionerOverride) {
    return { ok: false, code: 'DRAFT_NOT_COMPLETE', message: 'Draft must be complete before the regular season can open.' }
  }
  if (!input.rosterReady && !input.commissionerOverride) {
    return { ok: false, code: 'ROSTER_NOT_READY', message: 'Rosters must be ready before the regular season can open.' }
  }

  if (input.action === 'lock_schedule') {
    return {
      ok: true,
      action: input.action,
      nextStatus: input.state.status,
      currentWeek: input.state.currentWeek,
      lockedWeeks: input.state.weeks.map((week) => week.week),
      events: [
        buildScheduleRuntimeEvent({
          leagueId: input.state.leagueId,
          type: 'schedule.locked',
          actorUserId: input.actorUserId,
          payload: { currentWeek: input.state.currentWeek },
        }),
      ],
    }
  }

  const requestedWeek = Math.max(1, positiveInt(input.week) ?? input.state.currentWeek ?? 1)
  if (requestedWeek > input.state.regularSeasonWeeks) {
    return { ok: false, code: 'INVALID_WEEK', message: 'Requested week is outside the regular season.' }
  }
  const week = input.state.weeks.find((entry) => entry.week === requestedWeek)

  if ((input.action === 'complete_week' || input.action === 'advance_week') && weekHasIncompleteMatchups(week) && !input.commissionerOverride) {
    return {
      ok: false,
      code: 'INCOMPLETE_WEEK',
      message: 'All non-bye matchups must be finalized before completing the week.',
    }
  }

  if (input.action === 'open_week') {
    return {
      ok: true,
      action: input.action,
      nextStatus: 'active',
      currentWeek: requestedWeek,
      lockedWeeks: input.state.weeks.filter((entry) => entry.week < requestedWeek).map((entry) => entry.week),
      events: [
        buildScheduleRuntimeEvent({
          leagueId: input.state.leagueId,
          type: 'schedule.week.opened',
          actorUserId: input.actorUserId,
          payload: { week: requestedWeek },
        }),
      ],
    }
  }

  const nextWeek = input.action === 'advance_week'
    ? Math.min(input.state.regularSeasonWeeks, requestedWeek + 1)
    : requestedWeek
  const nextStatus =
    input.action === 'advance_week' && requestedWeek >= input.state.regularSeasonWeeks
      ? 'regular_season_complete'
      : 'active'

  return {
    ok: true,
    action: input.action,
    nextStatus,
    currentWeek: nextWeek,
    lockedWeeks: input.state.weeks.filter((entry) => entry.week <= requestedWeek).map((entry) => entry.week),
    events: [
      buildScheduleRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'schedule.week.completed',
        actorUserId: input.actorUserId,
        payload: { week: requestedWeek },
      }),
      buildScheduleRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'standings.recalculated',
        actorUserId: input.actorUserId,
        payload: { throughWeek: requestedWeek },
      }),
      ...(input.action === 'advance_week' && nextWeek > requestedWeek
        ? [
            buildScheduleRuntimeEvent({
              leagueId: input.state.leagueId,
              type: 'schedule.week.opened',
              actorUserId: input.actorUserId,
              payload: { week: nextWeek },
            }),
          ]
        : []),
    ],
  }
}

export function buildScheduleRuntimeEvent(input: {
  leagueId: string
  type: CanonicalLeagueRuntimeEventType | string
  occurredAt?: Date | string | null
  actorUserId?: string | null
  payload?: Record<string, unknown>
}): CanonicalLeagueRuntimeEvent {
  return toCanonicalLeagueRuntimeEvent({
    leagueId: input.leagueId,
    eventType: input.type,
    createdAt: input.occurredAt,
    actorUserId: input.actorUserId ?? null,
    payload: input.payload ?? {},
  })
}

export function buildScheduleGeneratedEvents(input: {
  state: CanonicalScheduleRuntimeState
  regenerated?: boolean
  actorUserId?: string | null
}): CanonicalLeagueRuntimeEvent[] {
  const events: CanonicalLeagueRuntimeEvent[] = [
    buildScheduleRuntimeEvent({
      leagueId: input.state.leagueId,
      type: input.regenerated ? 'schedule.regenerated' : 'schedule.generated',
      actorUserId: input.actorUserId,
      payload: {
        weeks: input.state.regularSeasonWeeks,
        matchups: input.state.weeks.reduce((sum, week) => sum + week.matchups.filter((matchup) => !matchup.bye).length, 0),
        byes: input.state.weeks.reduce((sum, week) => sum + week.byeRosterIds.length, 0),
      },
    }),
  ]

  const divisionIds = new Set<string>()
  for (const week of input.state.weeks) {
    for (const matchup of week.matchups) {
      events.push(
        buildScheduleRuntimeEvent({
          leagueId: input.state.leagueId,
          type: matchup.bye ? 'schedule.bye.assigned' : 'matchup.created',
          actorUserId: input.actorUserId,
          payload: matchup.bye
            ? { week: matchup.week, rosterId: matchup.homeRosterId }
            : {
                week: matchup.week,
                matchupId: matchup.id,
                homeRosterId: matchup.homeRosterId,
                awayRosterId: matchup.awayRosterId,
                divisionGame: matchup.divisionGame,
              },
        }),
      )
      for (const divisionId of [matchup.homeDivisionId, matchup.awayDivisionId]) {
        if (divisionId) divisionIds.add(divisionId)
      }
    }
  }

  for (const divisionId of divisionIds) {
    events.push(
      buildScheduleRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'division.assigned',
        actorUserId: input.actorUserId,
        payload: { divisionId },
      }),
    )
  }

  events.push(
    buildScheduleRuntimeEvent({
      leagueId: input.state.leagueId,
      type: 'playoffs.qualification_snapshot.updated',
      actorUserId: input.actorUserId,
      payload: {
        playoffTeamCount: input.state.playoffQualificationSnapshot.playoffTeamCount,
        regularSeasonEndWeek: input.state.playoffQualificationSnapshot.regularSeasonEndWeek,
      },
    }),
  )

  return events
}
