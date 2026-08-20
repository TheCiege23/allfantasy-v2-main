import { describe, expect, it } from 'vitest'
import {
  parseLeagueScopedWeeklyScoreReadMode,
  resolveLeagueScopedReadPlan,
} from '@/lib/scoring/league-scoped-weekly-score-read-flag'

describe('league-scoped-weekly-score-read-flag parser', () => {
  it('parses supported modes and defaults to off', () => {
    expect(parseLeagueScopedWeeklyScoreReadMode('off')).toBe('off')
    expect(parseLeagueScopedWeeklyScoreReadMode('internal')).toBe('internal')
    expect(parseLeagueScopedWeeklyScoreReadMode('canary')).toBe('canary')
    expect(parseLeagueScopedWeeklyScoreReadMode('on')).toBe('on')
    expect(parseLeagueScopedWeeklyScoreReadMode('unexpected')).toBe('off')
    expect(parseLeagueScopedWeeklyScoreReadMode(undefined)).toBe('off')
  })
})

describe('league-scoped-weekly-score-read-flag planning helper', () => {
  it('keeps reads global when mode is off', () => {
    const plan = resolveLeagueScopedReadPlan({
      mode: 'off',
      isInternalRequest: true,
      isCanaryLeague: true,
    })
    expect(plan.readFromLeagueScoped).toBe(false)
    expect(plan.allowGlobalFallback).toBe(true)
    expect(plan.allowComputeFallback).toBe(false)
  })

  it('allows internal-only scoped reads in internal mode', () => {
    const internalPlan = resolveLeagueScopedReadPlan({
      mode: 'internal',
      isInternalRequest: true,
      isCanaryLeague: false,
    })
    expect(internalPlan.readFromLeagueScoped).toBe(true)

    const externalPlan = resolveLeagueScopedReadPlan({
      mode: 'internal',
      isInternalRequest: false,
      isCanaryLeague: false,
    })
    expect(externalPlan.readFromLeagueScoped).toBe(false)
  })

  it('allows scoped reads only for canary leagues in canary mode', () => {
    const canaryPlan = resolveLeagueScopedReadPlan({
      mode: 'canary',
      isInternalRequest: false,
      isCanaryLeague: true,
    })
    expect(canaryPlan.readFromLeagueScoped).toBe(true)

    const nonCanaryPlan = resolveLeagueScopedReadPlan({
      mode: 'canary',
      isInternalRequest: true,
      isCanaryLeague: false,
    })
    expect(nonCanaryPlan.readFromLeagueScoped).toBe(false)
  })
})
