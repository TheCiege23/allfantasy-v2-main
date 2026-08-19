/**
 * Decision OS Manager Intelligence Platform — Phase 3: Weekly Outlook aggregator.
 *
 * Pure, deterministic aggregation + contract tests. No DB, no mocks — plain
 * matchup/lineup fixtures in, `ManagerWeeklyOutlookV1` out. Covers the spec's
 * required cases (empty matchup, missing projections, favored/close/underdog,
 * incomplete lineup, no recommendation language) plus the classification tiers,
 * status mapping, caveats, and determinism.
 */
import { describe, it, expect } from 'vitest'
import { aggregateWeeklyOutlook } from '@/lib/decision-os/manager-intelligence/weekly-outlook/weeklyOutlookAggregator'
import {
  MANAGER_WEEKLY_OUTLOOK_VERSION,
  type WeeklyOutlookLineupInput,
  type WeeklyOutlookMatchupInput,
} from '@/lib/decision-os/manager-intelligence/weekly-outlook/types'

const FIXED = new Date('2026-10-01T00:00:00.000Z')

function lineup(over: Partial<WeeklyOutlookLineupInput> = {}): WeeklyOutlookLineupInput {
  return { hasRoster: true, starterCount: 9, injuredStarterCount: 0, questionableStarterCount: 0, byeWeekStarterCount: 0, ...over }
}
function matchup(over: Partial<WeeklyOutlookMatchupInput> = {}): WeeklyOutlookMatchupInput {
  return { hasMatchup: true, week: 5, status: 'scheduled', userProjected: 110, opponentProjected: 100, opponentName: 'The Rivals', ...over }
}

// Banned recommendation/advice language (word-boundary so "lineup"/"complete" are safe).
const BANNED = /\b(start|sit|add|drop|waiver|recommend|pick up)\b|trade for/i
function assertNoAdvice(text: string) {
  expect(BANNED.test(text)).toBe(false)
}

describe('aggregateWeeklyOutlook — empty / no-data', () => {
  it('returns null when there is no roster AND no matchup (nothing to describe)', () => {
    expect(
      aggregateWeeklyOutlook({ currentWeek: 5, matchup: null, lineup: lineup({ hasRoster: false }) }, FIXED),
    ).toBeNull()
  })

  it('empty matchup with a roster → matchupState unavailable, margin unknown, honest caveat', () => {
    const w = aggregateWeeklyOutlook({ currentWeek: 5, matchup: null, lineup: lineup() }, FIXED)!
    expect(w.matchupState).toBe('unavailable')
    expect(w.projectedMargin).toBe('unknown')
    expect(w.projectedPointsFor).toBeNull()
    expect(w.projectedPointsAgainst).toBeNull()
    expect(w.opponentName).toBeNull()
    expect(w.week).toBe(5) // falls back to currentWeek
    expect(w.caveats).toContain('No matchup data is available for this week yet.')
  })
})

describe('aggregateWeeklyOutlook — projected margin', () => {
  it('favored when projected by >= +5', () => {
    expect(aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup({ userProjected: 110, opponentProjected: 100 }), lineup: lineup() }, FIXED)!.projectedMargin).toBe('favored')
  })
  it('close when within +/- 5', () => {
    expect(aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup({ userProjected: 105, opponentProjected: 103 }), lineup: lineup() }, FIXED)!.projectedMargin).toBe('close')
  })
  it('underdog when behind by >= 5', () => {
    expect(aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup({ userProjected: 95, opponentProjected: 105 }), lineup: lineup() }, FIXED)!.projectedMargin).toBe('underdog')
  })
  it('respects the +/-5 boundary exactly (favored at +5, underdog at -5)', () => {
    expect(aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup({ userProjected: 105, opponentProjected: 100 }), lineup: lineup() }, FIXED)!.projectedMargin).toBe('favored')
    expect(aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup({ userProjected: 100, opponentProjected: 105 }), lineup: lineup() }, FIXED)!.projectedMargin).toBe('underdog')
    expect(aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup({ userProjected: 104.9, opponentProjected: 100 }), lineup: lineup() }, FIXED)!.projectedMargin).toBe('close')
  })
  it('unknown + caveat when projections are missing', () => {
    const w = aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup({ userProjected: null, opponentProjected: null }), lineup: lineup() }, FIXED)!
    expect(w.projectedMargin).toBe('unknown')
    expect(w.caveats).toContain("Projected points aren't available for this matchup yet.")
  })
  it('rounds projected points to one decimal', () => {
    const w = aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup({ userProjected: 110.456, opponentProjected: 99.94 }), lineup: lineup() }, FIXED)!
    expect(w.projectedPointsFor).toBe(110.5)
    expect(w.projectedPointsAgainst).toBe(99.9)
  })
})

describe('aggregateWeeklyOutlook — matchup state from status', () => {
  it('maps status strings case-insensitively', () => {
    expect(aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup({ status: 'COMPLETE' }), lineup: lineup() }, FIXED)!.matchupState).toBe('completed')
    expect(aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup({ status: 'final' }), lineup: lineup() }, FIXED)!.matchupState).toBe('completed')
    expect(aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup({ status: 'active' }), lineup: lineup() }, FIXED)!.matchupState).toBe('in_progress')
    expect(aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup({ status: 'scheduled' }), lineup: lineup() }, FIXED)!.matchupState).toBe('scheduled')
    expect(aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup({ status: 'whatever' }), lineup: lineup() }, FIXED)!.matchupState).toBe('scheduled')
  })
  it('adds a bye/median caveat when a matchup exists with no opponent', () => {
    const w = aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup({ opponentName: null }), lineup: lineup() }, FIXED)!
    expect(w.caveats).toContain('This week has no head-to-head opponent (bye or median week).')
  })
})

describe('aggregateWeeklyOutlook — lineup readiness + schedule pressure', () => {
  it('ready + normal when all starters healthy', () => {
    const w = aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup(), lineup: lineup() }, FIXED)!
    expect(w.lineupReadiness).toBe('ready')
    expect(w.schedulePressure).toBe('normal')
  })
  it('incomplete when no starters are set', () => {
    expect(aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup(), lineup: lineup({ starterCount: 0 }) }, FIXED)!.lineupReadiness).toBe('incomplete')
  })
  it('needs_attention + high pressure when multiple starters are unavailable', () => {
    const w = aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup(), lineup: lineup({ injuredStarterCount: 1, byeWeekStarterCount: 1 }) }, FIXED)!
    expect(w.lineupReadiness).toBe('needs_attention')
    expect(w.schedulePressure).toBe('high')
  })
  it('unknown readiness + pressure when there is no roster', () => {
    const w = aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup(), lineup: lineup({ hasRoster: false }) }, FIXED)!
    expect(w.lineupReadiness).toBe('unknown')
    expect(w.schedulePressure).toBe('unknown')
    expect(w.caveats).toContain("Roster data isn't available.")
  })
})

describe('aggregateWeeklyOutlook — contract, determinism, no advice', () => {
  it('emits the full V1 contract with provenance and an ISO derivedAt', () => {
    const w = aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup(), lineup: lineup() }, FIXED)!
    expect(w.version).toBe(MANAGER_WEEKLY_OUTLOOK_VERSION)
    expect(w.derivedAt).toBe(FIXED.toISOString())
    expect(Object.keys(w).sort()).toEqual(
      [
        'caveats', 'derivedAt', 'lineupReadiness', 'matchupState', 'opponentName',
        'projectedMargin', 'projectedPointsAgainst', 'projectedPointsFor', 'schedulePressure',
        'summary', 'version', 'week',
      ].sort(),
    )
  })
  it('is deterministic — identical input yields identical output', () => {
    const input = { currentWeek: 5, matchup: matchup({ userProjected: 95, opponentProjected: 105 }), lineup: lineup({ injuredStarterCount: 1 }) }
    expect(aggregateWeeklyOutlook(input, FIXED)).toEqual(aggregateWeeklyOutlook(input, FIXED))
  })
  it('summary + caveats carry NO recommendation / advice language (all scenarios)', () => {
    const scenarios = [
      { currentWeek: 5, matchup: null, lineup: lineup() },
      { currentWeek: 5, matchup: matchup({ userProjected: 120, opponentProjected: 100 }), lineup: lineup() },
      { currentWeek: 5, matchup: matchup({ userProjected: 90, opponentProjected: 110 }), lineup: lineup({ injuredStarterCount: 2 }) },
      { currentWeek: 5, matchup: matchup({ status: 'active', opponentName: null }), lineup: lineup({ starterCount: 0 }) },
      { currentWeek: 5, matchup: matchup({ status: 'complete' }), lineup: lineup({ questionableStarterCount: 1 }) },
    ]
    for (const s of scenarios) {
      const w = aggregateWeeklyOutlook(s, FIXED)!
      assertNoAdvice(w.summary)
      assertNoAdvice(w.caveats.join(' '))
    }
  })
  it('produces observational, opponent-aware summaries', () => {
    expect(aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup({ userProjected: 120, opponentProjected: 100 }), lineup: lineup() }, FIXED)!.summary)
      .toMatch(/Your Week 5 matchup against The Rivals projects as favored\./)
    expect(aggregateWeeklyOutlook({ currentWeek: 5, matchup: matchup({ userProjected: 90, opponentProjected: 110 }), lineup: lineup({ injuredStarterCount: 1 }) }, FIXED)!.summary)
      .toMatch(/projects as an underdog\. Your lineup needs attention\./)
  })
})
