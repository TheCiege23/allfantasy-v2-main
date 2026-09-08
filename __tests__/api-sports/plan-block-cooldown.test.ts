/** @vitest-environment node */
/**
 * API-Sports refuses the season-wide games query for the current season on this plan.
 * `/api/cron/import-scores` runs on the fast tier, so before the cooldown that produced
 * an error-level log line roughly every two minutes, forever — noise that competes with
 * real errors in the same stream.
 *
 * ⚠ THE SCOPING IS THE POINT. Only the season-wide query is refused; date- and week-scoped
 * calls are entitled and still write rows (measured 2026-09-08: 321 NFL and 1,596 NCAAF
 * `SportsGame` rows for season 2026 with `source='api_sports'`, newest created that day).
 * A global pause would take a live writer down, so the block must stay per (sport, season).
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  isApiSportsPlanBlocked,
  isApiSportsPlanError,
  markApiSportsPlanBlocked,
  resetApiSportsPlanBlocks,
} from '@/lib/api-sports'

beforeEach(() => {
  resetApiSportsPlanBlocks()
})

describe('API-Sports plan-block cooldown', () => {
  it('is not blocked until a refusal is recorded', () => {
    expect(isApiSportsPlanBlocked('NFL', '2026')).toBe(false)
    markApiSportsPlanBlocked('NFL', '2026')
    expect(isApiSportsPlanBlocked('NFL', '2026')).toBe(true)
  })

  it('blocks ONE sport/season pair and never the others', () => {
    // 🛑 The failure this guards: pausing api_sports globally. Date- and week-scoped
    // calls for other pairs are entitled and are actively writing rows in production.
    markApiSportsPlanBlocked('NFL', '2026')

    expect(isApiSportsPlanBlocked('NFL', '2026')).toBe(true)
    expect(isApiSportsPlanBlocked('NCAAF', '2026')).toBe(false)
    expect(isApiSportsPlanBlocked('NFL', '2025')).toBe(false)
  })

  it('clears on reset, so an upgraded plan is not refused forever', () => {
    markApiSportsPlanBlocked('NFL', '2026')
    resetApiSportsPlanBlocks()
    expect(isApiSportsPlanBlocked('NFL', '2026')).toBe(false)
  })

  it('detects a plan refusal by SHAPE, not by the vendor sentence', () => {
    // The tag is set where the vendor's `errors.plan` KEY is seen. The prose beside it
    // ("try from 2022 to 2024") is copy that can be reworded without notice, so a guard
    // keyed on the words would silently stop firing — the exact defect in the
    // neighbouring IP-block check, which matches on "IP is not allowed".
    const tagged = Object.assign(new Error('API-Sports error: {"plan":"..."}'), {
      apiSportsPlanBlocked: true,
    })
    expect(isApiSportsPlanError(tagged)).toBe(true)
  })

  it('does not treat a real outage as a plan refusal', () => {
    // A network failure must keep reaching the error branch. If this returned true the
    // cooldown would suppress genuine outages for six hours.
    expect(isApiSportsPlanError(new Error('API-Sports request failed: 503'))).toBe(false)
    // And the untagged plan-worded message must NOT match either: matching the sentence
    // is what this implementation deliberately refuses to do.
    expect(isApiSportsPlanError(new Error('Free plans do not have access to this season'))).toBe(false)
    expect(isApiSportsPlanError(null)).toBe(false)
    expect(isApiSportsPlanError(undefined)).toBe(false)
  })
})
