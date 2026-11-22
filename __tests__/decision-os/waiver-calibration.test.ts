// @vitest-environment node
/**
 * The waiver engine learns from its own #1 claims (lib/decision-os/waiver/calibration.ts, 2026-11-20).
 *
 * Pinned:
 *   - a band says nothing below 20 graded claims; above it the correction is shrunk, half the gap, ±10;
 *   - the correction moves the CONFIDENCE only — never the ranking, the scores or the bid;
 *   - only a redraft, full-PPR NFL league is in scope; an unknown reception format is not assumed PPR;
 *   - a claim is graded only once its three-week window is over, and only when there is a stat row;
 *   - the weekly run rotates, honours the kill switch and the ledger switch, and stops on its budget.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  calibrateWaiverScore,
  calibrationNote,
  foldWaiverEngineBands,
  isWaiverCalibrationScope,
  waiverCalibrationFrom,
  WAIVER_CALIBRATION_MAX_DELTA,
  type GradedWaiverClaim,
} from '@/lib/decision-os/waiver/calibration'
import { gradeEngineClaims, type EngineClaimRow } from '@/lib/chimmy-outcomes/ledgerGrading'
import { weekCalendar } from '@/lib/chimmy-outcomes/ledgerRecord'
import { decideWaiverClaim } from '@/lib/decision-os/waiver/decision'
import { claimsToPanelRecommendations } from '@/lib/decision-os/waiver/panelRecommendations'
import { buildWaiverDCO } from '@/lib/decision-os/waiver/dco'
import { dueCandidates, runWeeklyWaiverEngineCalls, ATTEMPT_TTL_MS, type WeeklyEngineDeps } from '@/lib/decision-os/waiver/weeklyEngineCalls'
import { fakeAnalysis, fakeDecisionDeps, fakeEngineInput, fakeSuggestion, fakeWorld } from './waiverFakes'

/** n High-band claims scored 85, of which `startable` became startable. */
const high = (n: number, startable: number): GradedWaiverClaim[] =>
  Array.from({ length: n }, (_, i) => ({ score: 85, startable: i < startable, ageDays: 0 }))

describe('the calibration', () => {
  it('is silent below the minimum sample', () => {
    expect(waiverCalibrationFrom(foldWaiverEngineBands(high(19, 0)))).toBeNull()
    expect(calibrateWaiverScore(85, waiverCalibrationFrom(foldWaiverEngineBands(high(19, 0))))).toBeNull()
  })

  it('pulls a High claim down when High claims rarely became startable, by half the shrunk gap, capped', () => {
    const cal = waiverCalibrationFrom(foldWaiverEngineBands(high(40, 10)))!
    // 10 of 40 startable, shrunk toward 0.85 with 20 pseudo-claims: (10 + 17) / 60 = 0.45 → half of -40 = -20 → capped.
    expect(cal.high?.observedRate).toBeCloseTo(0.45, 2)
    const c = calibrateWaiverScore(85, cal)!
    expect(c.delta).toBe(-WAIVER_CALIBRATION_MAX_DELTA)
    expect(c.score).toBe(75)
    expect(calibrationNote(c)).toMatch(/Adjusted -10 from how 40 past High-confidence top claims in full-PPR redraft leagues turned out\./)
  })

  it('moves a claim by its OWN band only, and says nothing when the move rounds to zero', () => {
    const cal = waiverCalibrationFrom(foldWaiverEngineBands(high(40, 34)))!
    expect(calibrateWaiverScore(60, cal)).toBeNull() // Medium has no record
    const c = calibrateWaiverScore(85, cal)!
    expect(Math.abs(c.delta)).toBeLessThanOrEqual(1)
    if (c.delta === 0) expect(calibrationNote(c)).toBe('')
  })

  it('drops a score outside 0–100 rather than banding it', () => {
    expect(foldWaiverEngineBands([{ score: 140, startable: true, ageDays: 0 }, { score: Number.NaN, startable: true, ageDays: 0 }])).toEqual({})
  })
})

describe('the scope', () => {
  const ppr = { scoring_settings: { rec: 1, pass_td: 4 } }
  it('is a redraft, full-PPR NFL league and nothing else', () => {
    expect(isWaiverCalibrationScope({ sport: 'NFL', leagueType: 'redraft', settings: ppr })).toBe(true)
    expect(isWaiverCalibrationScope({ sport: 'NFL', leagueType: null, scoring: 'ppr' })).toBe(true)
    expect(isWaiverCalibrationScope({ sport: 'NFL', leagueType: 'redraft', settings: { scoring_settings: { rec: 0.5 } } })).toBe(false)
    expect(isWaiverCalibrationScope({ sport: 'NFL', leagueType: 'redraft', isDynasty: true, settings: ppr })).toBe(false)
    expect(isWaiverCalibrationScope({ sport: 'NFL', leagueType: 'best_ball', settings: ppr })).toBe(false)
    expect(isWaiverCalibrationScope({ sport: 'NBA', leagueType: 'redraft', settings: ppr })).toBe(false)
    // Nothing says how receptions score: not assumed PPR.
    expect(isWaiverCalibrationScope({ sport: 'NFL', leagueType: 'redraft' })).toBe(false)
  })
})

describe('grading the engine’s claims', () => {
  const DAY = 86_400_000
  const start = Date.parse('2026-09-10T00:00:00Z')
  const cal = weekCalendar(
    Array.from({ length: 18 }, (_, i) => ({
      week: i + 1,
      firstKickoff: new Date(start + i * 7 * DAY),
      lastKickoff: new Date(start + i * 7 * DAY + 4 * DAY),
    })),
  )
  const row = (over: Partial<EngineClaimRow>): EngineClaimRow => ({
    userId: 'u1', week: 2, recPts: 36, recWeeks: 3, altPts: null, hasDrop: false, score: 85, givenAt: new Date(start + 7 * DAY), ...over,
  })

  it('grades a claim once its three-week window is over; startable is 10+ PPR a week', () => {
    const now = new Date(start + 8 * 7 * DAY)
    const bands = gradeEngineClaims([row({}), row({ recPts: 20 }), row({ score: 60 })], cal, now)
    expect(bands.high).toMatchObject({ n: 2, startable: 1 })
    expect(bands.medium).toMatchObject({ n: 1, startable: 1 })
  })

  it('leaves a claim whose window is still being played, or has no stat row, ungraded', () => {
    const now = new Date(start + 2 * 7 * DAY)
    expect(gradeEngineClaims([row({})], cal, now)).toEqual({})
    expect(gradeEngineClaims([row({ recWeeks: 0, recPts: null })], cal, new Date(start + 10 * 7 * DAY))).toEqual({})
  })
})

describe('the card and the panel', () => {
  const dco = () =>
    buildWaiverDCO({ world: fakeWorld(), userId: 'u1', leagueId: 'L1', sport: 'NFL', rosterId: 'roster-1', engineInput: fakeEngineInput() })
  const cal = waiverCalibrationFrom(foldWaiverEngineBands(high(40, 10)))

  it('the confidence moves, the claims do not', async () => {
    const two = [fakeSuggestion(), fakeSuggestion({ playerId: 'wp2', playerName: 'Second', compositeScore: 70, priorityRank: 2 })]
    const plain = await decideWaiverClaim(dco(), fakeDecisionDeps({ recommend: async () => fakeAnalysis(two) }))
    const learned = await decideWaiverClaim(dco(), fakeDecisionDeps({ recommend: async () => fakeAnalysis(two), calibration: cal }))
    expect(plain.confidence).toBe(82)
    expect(learned.confidence).toBe(72)
    expect(learned.four_answers.how_confident).toMatch(/^Medium confidence.*\. Adjusted -10 from how 40 past High-confidence/)
    expect(learned.recommended_actions).toEqual(plain.recommended_actions)
    expect(learned.four_answers.what_to_do).toBe(plain.four_answers.what_to_do)
  })

  it('no record changes nothing', async () => {
    const plain = await decideWaiverClaim(dco(), fakeDecisionDeps())
    const none = await decideWaiverClaim(dco(), fakeDecisionDeps({ calibration: null }))
    expect(none.confidence).toBe(plain.confidence)
    expect(none.four_answers.how_confident).toBe(plain.four_answers.how_confident)
  })

  it('the panel bands each row by its corrected score and keeps the engine’s order', () => {
    const claims = [
      { ...claimOf('a', 85, 1) },
      { ...claimOf('b', 60, 2) },
    ]
    const plain = claimsToPanelRecommendations(claims, { leagueId: 'L1', includeFaab: false, limit: 5 })
    const learned = claimsToPanelRecommendations(claims, { leagueId: 'L1', includeFaab: false, limit: 5, calibration: cal })
    expect(plain.map((r) => r.confidence)).toEqual(['high', 'medium'])
    expect(learned.map((r) => r.confidence)).toEqual(['medium', 'medium'])
    expect(learned.map((r) => r.addPlayerId)).toEqual(['a', 'b'])
  })
})

function claimOf(id: string, score: number, rank: number) {
  return {
    addPlayerId: id, addPlayerName: id, position: 'WR', team: null, dropPlayerId: null, dropPlayerName: null,
    faabBid: null, priorityRank: rank, compositeScore: score, recommendation: 'Add' as const, reason: 'r',
  }
}

describe('the weekly run', () => {
  const NOW = Date.parse('2026-10-06T12:00:00Z')
  const pprLeague = { sport: 'NFL', leagueType: 'redraft', settings: { scoring_settings: { rec: 1 } } }

  function deps(over: Partial<WeeklyEngineDeps> = {}) {
    let attempts: Record<string, number> = {}
    const recorded: Array<{ userId: string; leagueId: string }> = []
    const d: WeeklyEngineDeps = {
      now: () => NOW,
      feedEnabled: async () => true,
      env: {},
      loadCandidates: async () => [{ id: 'L1', userId: 'u1' }, { id: 'L2', userId: 'u2' }, { id: 'L3', userId: 'u3' }],
      loadScopeLeague: async (id) => (id === 'L3' ? { ...pprLeague, settings: { scoring_settings: { rec: 0.5 } } } : pprLeague),
      readAttempts: async () => attempts,
      writeAttempts: async (a) => {
        attempts = a
      },
      runEngine: async () => [claimOf('p', 85, 1)],
      record: async (a) => {
        recorded.push({ userId: a.userId, leagueId: a.leagueId })
        return 'recorded'
      },
      ...over,
    }
    return { d, recorded, attempts: () => attempts }
  }

  it('records each in-scope league once, skips the rest, and does not re-run inside six days', async () => {
    const { d, recorded, attempts } = deps()
    const first = await runWeeklyWaiverEngineCalls({ budgetMs: 60_000 }, d)
    expect(first).toMatchObject({ ran: true, started: 3, recorded: 2, outcomes: { recorded: 2, out_of_scope: 1 } })
    expect(recorded.map((r) => r.leagueId)).toEqual(['L1', 'L2'])
    expect(Object.keys(attempts())).toHaveLength(3)

    const second = await runWeeklyWaiverEngineCalls({ budgetMs: 60_000 }, d)
    expect(second).toMatchObject({ ran: true, due: 0, started: 0 })
    expect(recorded).toHaveLength(2)
  })

  it('an attempt older than six days is due again', () => {
    const { due, kept } = dueCandidates([{ id: 'L1', userId: 'u1' }], { 'u1|L1': NOW - ATTEMPT_TTL_MS - 1 }, NOW)
    expect(due).toHaveLength(1)
    expect(kept).toEqual({})
  })

  it('stops on its limit and on its budget', async () => {
    const { d } = deps()
    expect(await runWeeklyWaiverEngineCalls({ budgetMs: 60_000, limit: 1 }, d)).toMatchObject({ started: 1 })
    let t = NOW
    const slow = deps({ now: () => (t += 30_000) })
    expect(await runWeeklyWaiverEngineCalls({ budgetMs: 50_000 }, slow.d)).toMatchObject({ budgetStopped: true, started: 1 })
  })

  it('a league whose engine run fails is counted, and the run carries on', async () => {
    const { d, recorded } = deps({ runEngine: async (_u, id) => { if (id === 'L1') throw new Error('boom'); return [claimOf('p', 85, 1)] } })
    expect(await runWeeklyWaiverEngineCalls({ budgetMs: 60_000 }, d)).toMatchObject({ outcomes: { error: 1, recorded: 1 } })
    expect(recorded.map((r) => r.leagueId)).toEqual(['L2'])
  })

  it('honours the waiverDecision kill switch and the ledger’s waiver switch before running anything', async () => {
    const runEngine = vi.fn(async () => [claimOf('p', 85, 1)])
    expect(await runWeeklyWaiverEngineCalls({ budgetMs: 60_000 }, deps({ feedEnabled: async () => false, runEngine }).d)).toEqual({ ran: false, reason: 'feed_disabled' })
    expect(await runWeeklyWaiverEngineCalls({ budgetMs: 60_000 }, deps({ env: { ADVICE_LEDGER_WAIVERS: 'off' }, runEngine }).d)).toEqual({ ran: false, reason: 'ledger_off' })
    expect(runEngine).not.toHaveBeenCalled()
  })
})
