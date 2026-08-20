import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SCORING_UPGRADE_SHADOW_MODE,
  parseScoringUpgradeShadowMode,
  resolveScoringUpgradeShadowPlan,
} from '@/lib/scoring/scoring-upgrade-shadow-flag'
import {
  computeScoringUpgradeShadowSeverity,
  runScoringUpgradeShadow,
  SCORING_UPGRADE_SHADOW_EPS_MATCH,
  SCORING_UPGRADE_SHADOW_EPS_WARN,
  type ScoringUpgradeCandidateFn,
  type WeeklyScoreSample,
} from '@/lib/scoring/scoring-upgrade-shadow'

function sample(overrides: Partial<WeeklyScoreSample> = {}): WeeklyScoreSample {
  return {
    leagueId: 'L1',
    playerId: 'P1',
    season: 2026,
    week: 3,
    sport: 'NFL',
    fantasyPts: 12.34,
    ...overrides,
  }
}

describe('scoring-upgrade-shadow-flag', () => {
  it('defaults to off', () => {
    expect(DEFAULT_SCORING_UPGRADE_SHADOW_MODE).toBe('off')
  })

  it('parses recognized modes case-insensitively', () => {
    expect(parseScoringUpgradeShadowMode('off')).toBe('off')
    expect(parseScoringUpgradeShadowMode('Internal')).toBe('internal')
    expect(parseScoringUpgradeShadowMode(' CANARY ')).toBe('canary')
    expect(parseScoringUpgradeShadowMode('on')).toBe('on')
  })

  it('treats unknown / empty / nullish values as off', () => {
    expect(parseScoringUpgradeShadowMode(undefined)).toBe('off')
    expect(parseScoringUpgradeShadowMode(null)).toBe('off')
    expect(parseScoringUpgradeShadowMode('')).toBe('off')
    expect(parseScoringUpgradeShadowMode('enabled')).toBe('off')
  })

  it('plan: mode=off is never enabled', () => {
    expect(
      resolveScoringUpgradeShadowPlan({ mode: 'off', isInternalRequest: true, isCanaryLeague: true }),
    ).toEqual({ enabled: false, reason: 'mode_off' })
  })

  it('plan: mode=internal requires internal request', () => {
    expect(
      resolveScoringUpgradeShadowPlan({ mode: 'internal', isInternalRequest: false, isCanaryLeague: true }),
    ).toEqual({ enabled: false, reason: 'mode_internal_non_internal_request' })
    expect(
      resolveScoringUpgradeShadowPlan({ mode: 'internal', isInternalRequest: true, isCanaryLeague: false }),
    ).toEqual({ enabled: true, reason: 'mode_internal_internal_request' })
  })

  it('plan: mode=canary requires canary league', () => {
    expect(
      resolveScoringUpgradeShadowPlan({ mode: 'canary', isInternalRequest: false, isCanaryLeague: false }),
    ).toEqual({ enabled: false, reason: 'mode_canary_non_canary_league' })
    expect(
      resolveScoringUpgradeShadowPlan({ mode: 'canary', isInternalRequest: false, isCanaryLeague: true }),
    ).toEqual({ enabled: true, reason: 'mode_canary_league' })
  })

  it('plan: mode=on is always enabled', () => {
    expect(
      resolveScoringUpgradeShadowPlan({ mode: 'on', isInternalRequest: false, isCanaryLeague: false }),
    ).toEqual({ enabled: true, reason: 'mode_on' })
  })
})

describe('runScoringUpgradeShadow — disabled paths', () => {
  it('does not invoke the candidate when mode=off (default flag state)', () => {
    const candidate = vi.fn<ScoringUpgradeCandidateFn>(() => 99)
    const res = runScoringUpgradeShadow({
      mode: 'off',
      isInternalRequest: true,
      isCanaryLeague: true,
      samples: [sample(), sample({ playerId: 'P2' })],
      candidate,
    })

    expect(candidate).not.toHaveBeenCalled()
    expect(res.enabled).toBe(false)
    expect(res.rows).toHaveLength(0)
    expect(res.sampleCount).toBe(2)
    expect(res.evaluatedCount).toBe(0)
    expect(res.mismatchedCount).toBe(0)
    expect(res.severity).toBe('none')
    expect(res.notes).toContain('shadow_disabled')
    expect(res.plan).toEqual({ enabled: false, reason: 'mode_off' })
  })

  it('does not invoke the candidate when canary mode does not match', () => {
    const candidate = vi.fn<ScoringUpgradeCandidateFn>(() => 1)
    const res = runScoringUpgradeShadow({
      mode: 'canary',
      isInternalRequest: false,
      isCanaryLeague: false,
      samples: [sample()],
      candidate,
    })
    expect(candidate).not.toHaveBeenCalled()
    expect(res.enabled).toBe(false)
    expect(res.plan.reason).toBe('mode_canary_non_canary_league')
  })

  it('emits a shadow_skipped telemetry event when disabled', () => {
    const telemetry = vi.fn()
    runScoringUpgradeShadow({
      mode: 'off',
      isInternalRequest: false,
      isCanaryLeague: false,
      samples: [sample()],
      candidate: () => 0,
      telemetry,
    })
    expect(telemetry).toHaveBeenCalledTimes(1)
    expect(telemetry.mock.calls[0][0]).toBe('shadow_skipped')
    expect(telemetry.mock.calls[0][1]).toMatchObject({
      jobName: 'scoring_upgrade_shadow',
      reason: 'mode_off',
      sampleCount: 1,
    })
  })
})

describe('runScoringUpgradeShadow — diff math', () => {
  function runOn(
    samples: WeeklyScoreSample[],
    candidate: ScoringUpgradeCandidateFn,
    telemetry?: ReturnType<typeof vi.fn>,
  ) {
    return runScoringUpgradeShadow({
      mode: 'on',
      isInternalRequest: false,
      isCanaryLeague: false,
      samples,
      candidate,
      telemetry,
      now: (() => {
        let t = 1_000
        return () => (t += 5)
      })(),
    })
  }

  it('identical baseline and candidate yields severity none and no mismatches', () => {
    const res = runOn([sample({ fantasyPts: 10 })], () => 10)
    expect(res.severity).toBe('none')
    expect(res.mismatchedCount).toBe(0)
    expect(res.evaluatedCount).toBe(1)
    expect(res.rows[0].delta).toBe(0)
    expect(res.rows[0].mismatched).toBe(false)
  })

  it('delta within EPS_MATCH is treated as equivalent', () => {
    const baseline = 10
    const tinyDelta = SCORING_UPGRADE_SHADOW_EPS_MATCH // 0.02
    const res = runOn([sample({ fantasyPts: baseline })], () => baseline + tinyDelta)
    expect(res.severity).toBe('none')
    expect(res.mismatchedCount).toBe(0)
    expect(res.rows[0].mismatched).toBe(false)
  })

  it('delta above EPS_MATCH and at/below EPS_WARN yields warning', () => {
    const baseline = 10
    const candidateValue = baseline + SCORING_UPGRADE_SHADOW_EPS_WARN // 0.5
    const res = runOn([sample({ fantasyPts: baseline })], () => candidateValue)
    expect(res.mismatchedCount).toBe(1)
    expect(res.severity).toBe('warning')
    expect(res.rows[0].delta).toBeCloseTo(0.5, 2)
  })

  it('delta above EPS_WARN yields critical', () => {
    const res = runOn([sample({ fantasyPts: 10 })], () => 12)
    expect(res.severity).toBe('critical')
    expect(res.mismatchedCount).toBe(1)
    expect(res.rows[0].delta).toBe(2)
  })

  it('candidate returning null marks the row as missingCandidate without throwing', () => {
    const res = runOn([sample({ fantasyPts: 10 })], () => null)
    expect(res.missingCandidateCount).toBe(1)
    expect(res.mismatchedCount).toBe(0)
    expect(res.severity).toBe('info')
    expect(res.rows[0]).toMatchObject({
      candidate: null,
      delta: null,
      missingCandidate: true,
      candidateError: null,
    })
  })

  it('candidate that throws is captured per-row and never bubbles', () => {
    const res = runOn([sample({ fantasyPts: 10 })], () => {
      throw new Error('boom')
    })
    expect(res.candidateErrorCount).toBe(1)
    expect(res.mismatchedCount).toBe(0)
    expect(res.severity).toBe('info')
    expect(res.rows[0].candidateError).toBe('boom')
    expect(res.rows[0].delta).toBeNull()
  })

  it('rounds baseline and candidate to cents before computing delta', () => {
    const res = runOn([sample({ fantasyPts: 10.126 })], () => 10.124)
    // 10.13 vs 10.12 → delta 0.01, within EPS_MATCH
    expect(res.rows[0].baseline).toBe(10.13)
    expect(res.rows[0].candidate).toBe(10.12)
    expect(res.rows[0].delta).toBeCloseTo(-0.01, 2)
    expect(res.severity).toBe('none')
  })

  it('emits shadow_started and shadow_completed telemetry with counts', () => {
    const telemetry = vi.fn()
    const res = runOn(
      [sample({ playerId: 'P1', fantasyPts: 10 }), sample({ playerId: 'P2', fantasyPts: 8 })],
      (s) => (s.playerId === 'P1' ? 11 : 8),
      telemetry,
    )
    const events = telemetry.mock.calls.map((c) => c[0])
    expect(events).toContain('shadow_started')
    expect(events).toContain('shadow_completed')
    const completed = telemetry.mock.calls.find((c) => c[0] === 'shadow_completed')!
    expect(completed[1]).toMatchObject({
      jobName: 'scoring_upgrade_shadow',
      sampleCount: 2,
      mismatchedCount: 1,
      missingCandidateCount: 0,
      candidateErrorCount: 0,
      severity: res.severity,
    })
  })
})

describe('computeScoringUpgradeShadowSeverity', () => {
  it('returns none for empty input', () => {
    expect(computeScoringUpgradeShadowSeverity([])).toBe('none')
  })

  it('escalates critical over warning over info', () => {
    const sev = computeScoringUpgradeShadowSeverity([
      {
        leagueId: 'L1', playerId: 'P1', season: 2026, week: 1, sport: 'NFL',
        baseline: 10, candidate: 10.1, delta: 0.1,
        mismatched: true, missingCandidate: false, candidateError: null,
      },
      {
        leagueId: 'L1', playerId: 'P2', season: 2026, week: 1, sport: 'NFL',
        baseline: 10, candidate: 12, delta: 2,
        mismatched: true, missingCandidate: false, candidateError: null,
      },
      {
        leagueId: 'L1', playerId: 'P3', season: 2026, week: 1, sport: 'NFL',
        baseline: 10, candidate: null, delta: null,
        mismatched: false, missingCandidate: true, candidateError: null,
      },
    ])
    expect(sev).toBe('critical')
  })
})
