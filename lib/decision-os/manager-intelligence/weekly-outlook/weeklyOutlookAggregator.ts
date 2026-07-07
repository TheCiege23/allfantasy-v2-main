/**
 * Decision OS Manager Intelligence Platform — Phase 3.
 *
 * Pure, deterministic Weekly Outlook aggregator. Given the current matchup facts
 * (+ reused lineup signals + current week), it returns the `ManagerWeeklyOutlookV1`
 * display contract. No I/O, no Prisma, no LLM, no recommendations — the same
 * inputs always yield the same outlook. Missing/uncertain data is reported
 * honestly as `null` / `'unknown'` / `'unavailable'`, never fabricated.
 */

import {
  MANAGER_WEEKLY_OUTLOOK_VERSION,
  type LineupReadiness,
  type ManagerWeeklyOutlookV1,
  type MatchupState,
  type ProjectedMargin,
  type SchedulePressure,
  type WeeklyOutlookAggregationInput,
  type WeeklyOutlookLineupInput,
  type WeeklyOutlookMatchupInput,
} from './types'

// A projected margin at or beyond this many points is "favored"/"underdog";
// anything strictly between is "close".
const FAVORED_MARGIN = 5
// This many unavailable starters (out + on-bye) in one week reads as "high" pressure.
const HIGH_PRESSURE_THRESHOLD = 2

function classifyMatchupState(matchup: WeeklyOutlookMatchupInput | null): MatchupState {
  if (!matchup || !matchup.hasMatchup) return 'unavailable'
  const s = String(matchup.status ?? '').trim().toLowerCase()
  if (/complete|final/.test(s)) return 'completed'
  if (/active|progress|live|in_play/.test(s)) return 'in_progress'
  return 'scheduled'
}

function classifyMargin(pointsFor: number | null, pointsAgainst: number | null): ProjectedMargin {
  if (pointsFor == null || pointsAgainst == null) return 'unknown'
  const diff = pointsFor - pointsAgainst
  if (diff >= FAVORED_MARGIN) return 'favored'
  if (diff <= -FAVORED_MARGIN) return 'underdog'
  return 'close'
}

function classifyReadiness(l: WeeklyOutlookLineupInput): LineupReadiness {
  if (!l.hasRoster) return 'unknown'
  if (l.starterCount === 0) return 'incomplete'
  if (l.injuredStarterCount > 0 || l.byeWeekStarterCount > 0 || l.questionableStarterCount > 0) return 'needs_attention'
  return 'ready'
}

function classifyPressure(l: WeeklyOutlookLineupInput): SchedulePressure {
  if (!l.hasRoster) return 'unknown'
  return l.injuredStarterCount + l.byeWeekStarterCount >= HIGH_PRESSURE_THRESHOLD ? 'high' : 'normal'
}

// ── summary + caveats (observational, no advice) ─────────────────────────────
function matchupSentence(state: MatchupState, week: number | null, margin: ProjectedMargin, opponentName: string | null): string {
  const noun = week != null ? `Your Week ${week} matchup` : 'Your matchup'
  const vs = opponentName ? ` against ${opponentName}` : ''
  switch (state) {
    case 'unavailable':
      return 'No matchup is scheduled for your team yet.'
    case 'completed':
      return `${noun}${vs} is complete.`
    case 'in_progress':
      return `${noun}${vs} is in progress.`
    case 'scheduled':
    default:
      if (margin === 'favored') return `${noun}${vs} projects as favored.`
      if (margin === 'close') return `${noun}${vs} projects as close.`
      if (margin === 'underdog') return `${noun}${vs} projects as an underdog.`
      return `${noun}${vs} is scheduled.`
  }
}

function lineupSentence(readiness: LineupReadiness): string {
  switch (readiness) {
    case 'ready':
      return 'Your lineup appears ready.'
    case 'needs_attention':
      return 'Your lineup needs attention.'
    case 'incomplete':
      return 'Your lineup appears incomplete.'
    case 'unknown':
    default:
      return ''
  }
}

function buildCaveats(args: {
  state: MatchupState
  projectionsMissing: boolean
  opponentMissing: boolean
  readiness: LineupReadiness
}): string[] {
  const caveats: string[] = []
  if (args.state === 'unavailable') {
    caveats.push('No matchup data is available for this week yet.')
  } else {
    if (args.projectionsMissing) caveats.push("Projected points aren't available for this matchup yet.")
    if (args.opponentMissing) caveats.push('This week has no head-to-head opponent (bye or median week).')
  }
  if (args.readiness === 'unknown') caveats.push("Roster data isn't available.")
  return caveats
}

/**
 * Aggregate the current week into the display-only Weekly Outlook contract.
 *
 * Returns `null` only when there is genuinely nothing to describe (no roster AND
 * no matchup) so consumers can render an honest empty state. When a roster
 * exists but the matchup/projections don't, it returns a populated contract
 * whose fields honestly read `'unavailable'` / `'unknown'` / `null`.
 */
export function aggregateWeeklyOutlook(
  input: WeeklyOutlookAggregationInput,
  now: Date = new Date(),
): ManagerWeeklyOutlookV1 | null {
  const { matchup, lineup, currentWeek } = input
  const state = classifyMatchupState(matchup)

  if (!lineup.hasRoster && state === 'unavailable') return null

  const week = matchup?.week ?? currentWeek ?? null
  const projectedPointsFor = state === 'unavailable' ? null : matchup?.userProjected ?? null
  const projectedPointsAgainst = state === 'unavailable' ? null : matchup?.opponentProjected ?? null
  const opponentName = state === 'unavailable' ? null : matchup?.opponentName ?? null

  const projectedMargin = classifyMargin(projectedPointsFor, projectedPointsAgainst)
  const lineupReadiness = classifyReadiness(lineup)
  const schedulePressure = classifyPressure(lineup)

  const summary = [matchupSentence(state, week, projectedMargin, opponentName), lineupSentence(lineupReadiness)]
    .filter(Boolean)
    .join(' ')

  const caveats = buildCaveats({
    state,
    projectionsMissing: state !== 'unavailable' && (projectedPointsFor == null || projectedPointsAgainst == null),
    opponentMissing: state !== 'unavailable' && opponentName == null,
    readiness: lineupReadiness,
  })

  return {
    version: MANAGER_WEEKLY_OUTLOOK_VERSION,
    derivedAt: now.toISOString(),
    week,
    matchupState: state,
    opponentName,
    projectedPointsFor: projectedPointsFor == null ? null : round1(projectedPointsFor),
    projectedPointsAgainst: projectedPointsAgainst == null ? null : round1(projectedPointsAgainst),
    projectedMargin,
    lineupReadiness,
    schedulePressure,
    summary,
    caveats,
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
