import { describe, expect, it } from 'vitest'
import {
  PERIOD_NOT_SCHEDULED_GAP,
  SCHEDULE_UNAVAILABLE_GAP,
  resolveWindowDecision,
} from '@/lib/decision-os/value-v2/windowDecision'
import { resolveScheduledPeriods, scheduledLookback } from '@/lib/decision-os/value-v2/periodCalendar'
import type { WindowFactsPort } from '@/lib/decision-os/value-v2/windowFacts'

/**
 * Integration between the period calendar and the window resolver.
 *
 * The resolver used to pick its lookback with `week - 1, week - 2` arithmetic, which assumes
 * every integer below the current week is a period of this league's season. These tests pin
 * the schedule-driven replacement and the honest fallback.
 */

const CAPTURED = '2026-10-06T12:00:00.000Z'

/** Records which weeks the resolver actually asked for. */
function recordingPort(seen: number[], over: Partial<WindowFactsPort> = {}): WindowFactsPort {
  return {
    identity: async () => ({ teamId: 't1', teamName: 'Anvil Chorus', managerName: 'Rae', rosterSize: 4 }),
    allPlay: async s => {
      seen.push(s.week)
      return { wins: 6, losses: 2, ties: 0, luckWins: 0, weeksCounted: s.week, pointsFor: 900 }
    },
    forecast: async s => ({ season: s.season, week: s.week, playoffProbabilityPct: 88, generatedAt: CAPTURED }),
    dynasty: async s => ({
      season: s.season, projectedStrength3YearsPct: 82, projectedStrengthNextYearPct: 80,
      windowStartYear: null, windowEndYear: null, confidencePct: 70, generatedAt: CAPTURED,
    }),
    injuries: async () => ({ unavailableShare: 0, basis: 'test', coverage: 1, treatment: 'excluded' }),
    ...over,
  }
}

const schedule = (playoffTeams = 4, playoffStartPeriod = 15) => {
  const r = resolveScheduledPeriods({
    playoffStartPeriod, playoffTeams, weeksPerRound: 1, leagueSize: 12, maxScheduledPeriod: 25,
  })
  if (r.kind !== 'schedule') throw new Error(`expected schedule, got ${r.reason}`)
  return r.periods
}

const scope = (week: number) => ({ leagueId: 'l1', teamId: 't1', season: 2026, week })

describe('scheduledLookback', () => {
  const periods = schedule() // 1..16

  it('returns the period and its immediate scheduled predecessors, oldest first', () => {
    expect(scheduledLookback(periods, 9, 3)).toEqual({ kind: 'lookback', periods: [7, 8, 9] })
  })

  it('returns fewer than requested near the start rather than padding', () => {
    expect(scheduledLookback(periods, 2, 3)).toEqual({ kind: 'lookback', periods: [1, 2] })
    expect(scheduledLookback(periods, 1, 3)).toEqual({ kind: 'lookback', periods: [1] })
  })

  it('refuses a period the schedule does not contain', () => {
    // Arithmetic would happily produce 15, 16, 17 here. 17 is not a period of this season.
    expect(scheduledLookback(periods, 17, 3)).toEqual({ kind: 'refused', reason: 'period_not_in_schedule' })
  })

  it('refuses an empty schedule or an invalid count', () => {
    expect(scheduledLookback([], 3, 3)).toEqual({ kind: 'refused', reason: 'schedule_empty' })
    expect(scheduledLookback(periods, 3, 0)).toEqual({ kind: 'refused', reason: 'lookback_invalid' })
  })
})

describe('the resolver walks the schedule when one is supplied', () => {
  it('asks only for scheduled predecessors', async () => {
    const seen: number[] = []
    await resolveWindowDecision(scope(9), recordingPort(seen), { scheduledPeriods: schedule() })
    expect(seen.sort((a, b) => a - b)).toEqual([7, 8, 9])
  })

  it('does not report the schedule-unavailable gap when a schedule is given', async () => {
    const d = await resolveWindowDecision(scope(9), recordingPort([]), { scheduledPeriods: schedule() })
    expect(d.gaps).not.toContain(SCHEDULE_UNAVAILABLE_GAP)
  })

  it('asks for fewer weeks near the start of a season instead of week 0 or -1', async () => {
    const seen: number[] = []
    await resolveWindowDecision(scope(1), recordingPort(seen), { scheduledPeriods: schedule() })
    expect(seen).toEqual([1])
    expect(seen).not.toContain(0)
  })

  it('REFUSES a period outside the schedule rather than inventing a window', async () => {
    const seen: number[] = []
    // Week 17 with a schedule ending at 16 — the exact case arithmetic gets wrong.
    const d = await resolveWindowDecision(scope(17), recordingPort(seen), { scheduledPeriods: schedule() })
    expect(d.state).toBe('refused')
    expect(d.status).toBeNull()
    expect(d.gaps).toContain(PERIOD_NOT_SCHEDULED_GAP)
    expect(d.teamFit).toMatchObject({ winNowWeight: 1, longTermWeight: 1, basis: 'unresolved' })
    // It must not have read any evidence for a period that does not exist.
    expect(seen).toEqual([])
  })

  it('follows a longer schedule when the playoff field is larger', async () => {
    const seen: number[] = []
    // 6 playoff teams -> 3 rounds -> schedule runs to 17, so week 17 is legitimate here.
    await resolveWindowDecision(scope(17), recordingPort(seen), { scheduledPeriods: schedule(6) })
    expect(seen.sort((a, b) => a - b)).toEqual([15, 16, 17])
  })
})

describe('the arithmetic fallback stays available but names itself', () => {
  it('reports the gap when no schedule is supplied', async () => {
    const d = await resolveWindowDecision(scope(9), recordingPort([]))
    expect(d.gaps).toContain(SCHEDULE_UNAVAILABLE_GAP)
  })

  it('still produces a decision, preserving existing callers', async () => {
    const d = await resolveWindowDecision(scope(9), recordingPort([]))
    expect(d.state).not.toBe('refused')
    expect(d.status).not.toBeNull()
  })

  it('clamps at week 1 rather than asking for week 0', async () => {
    const seen: number[] = []
    await resolveWindowDecision(scope(2), recordingPort(seen))
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2])
  })

  it('an empty schedule array falls back rather than refusing', async () => {
    const d = await resolveWindowDecision(scope(9), recordingPort([]), { scheduledPeriods: [] })
    expect(d.gaps).toContain(SCHEDULE_UNAVAILABLE_GAP)
  })
})

describe('market value and refusal behaviour are unchanged', () => {
  it('a refusal yields neutral team fit with named gaps', async () => {
    const d = await resolveWindowDecision(scope(9), recordingPort([], { forecast: async () => null }),
      { scheduledPeriods: schedule() })
    expect(d.state).toBe('refused')
    expect(d.teamFit).toMatchObject({ winNowWeight: 1, longTermWeight: 1, basis: 'unresolved' })
    expect(d.gaps).toContain('season_forecast_missing')
  })

  it('never reports "competitive" as a fallback', async () => {
    const d = await resolveWindowDecision(scope(17), recordingPort([]), { scheduledPeriods: schedule() })
    expect(d.status).toBeNull()
    expect(JSON.stringify(d)).not.toContain('"competitive"')
  })
})
