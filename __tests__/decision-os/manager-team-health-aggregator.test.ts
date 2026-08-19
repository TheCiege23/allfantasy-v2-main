/**
 * Decision OS Manager Intelligence Platform — Phase 2: Team Health aggregator.
 *
 * Pure, deterministic aggregation + contract tests. No DB, no mocks — plain
 * roster fixtures in, `ManagerTeamHealthV1` out. Covers the spec's required
 * cases (empty roster, no injury data, healthy team, heavily injured team) plus
 * the classification tiers, case-insensitivity, bye logic, and the guarantee
 * that the summary carries NO recommendation language.
 */
import { describe, it, expect } from 'vitest'
import { aggregateManagerTeamHealth } from '@/lib/decision-os/manager-intelligence/team-health/teamHealthAggregator'
import {
  MANAGER_TEAM_HEALTH_VERSION,
  type TeamHealthRosterPlayerInput,
} from '@/lib/decision-os/manager-intelligence/team-health/types'

const FIXED = new Date('2026-09-01T00:00:00.000Z')

function p(
  slotType: string,
  injuryStatus?: string | null,
  byeWeek?: number | null,
  droppedAt?: Date | string | null,
): TeamHealthRosterPlayerInput {
  return { slotType, injuryStatus: injuryStatus ?? null, byeWeek: byeWeek ?? null, droppedAt: droppedAt ?? null }
}

// A full, healthy starting lineup + 3 healthy bench (position codes = starters).
function healthyRoster(): TeamHealthRosterPlayerInput[] {
  return [
    p('QB'), p('RB'), p('RB'), p('WR'), p('WR'), p('TE'), p('FLEX'), p('K'), p('DEF'),
    p('BENCH'), p('BENCH'), p('BENCH'),
  ]
}

describe('aggregateManagerTeamHealth — empty / no-roster', () => {
  it('returns null when there are no players', () => {
    expect(aggregateManagerTeamHealth({ players: [], currentWeek: 3 }, FIXED)).toBeNull()
  })

  it('returns null when every player is dropped (no active roster)', () => {
    const players = [p('QB', null, null, new Date()), p('BENCH', null, null, '2026-09-01')]
    expect(aggregateManagerTeamHealth({ players, currentWeek: 3 }, FIXED)).toBeNull()
  })
})

describe('aggregateManagerTeamHealth — healthy team / no injury data', () => {
  it('reports all starters available and an observational all-clear summary', () => {
    const h = aggregateManagerTeamHealth({ players: healthyRoster(), currentWeek: 3 }, FIXED)!
    expect(h).not.toBeNull()
    expect(h.starterCount).toBe(9)
    expect(h.availableStarterCount).toBe(9)
    expect(h.injuredStarterCount).toBe(0)
    expect(h.questionableStarterCount).toBe(0)
    expect(h.byeWeekStarterCount).toBe(0)
    expect(h.benchAvailability).toBe('healthy')
    expect(h.rosterCompleteness).toBe('excellent')
    expect(h.summary).toMatch(/all projected starters are healthy/i)
    expect(h.summary).toMatch(/bench depth appears healthy/i)
  })

  it('treats null / "healthy" / "Active" injuryStatus and unknown strings as healthy', () => {
    const players = [p('QB', null), p('RB', 'healthy'), p('WR', 'Active'), p('TE', 'Gameday Decision??'), p('BENCH')]
    const h = aggregateManagerTeamHealth({ players, currentWeek: 3 }, FIXED)!
    expect(h.injuredStarterCount).toBe(0)
    expect(h.questionableStarterCount).toBe(0)
  })
})

describe('aggregateManagerTeamHealth — injuries / questionable / bye', () => {
  it('counts out/IR starters as injured and drives completeness to needs_attention when uncovered', () => {
    // 9 starters, 3 out, only 1 healthy bench → holes (3) > cover (1).
    const players = [
      p('QB', 'Out'), p('RB', 'IR'), p('WR', 'out'),
      p('RB'), p('WR'), p('TE'), p('FLEX'), p('K'), p('DEF'),
      p('BENCH'),
    ]
    const h = aggregateManagerTeamHealth({ players, currentWeek: 5 }, FIXED)!
    expect(h.injuredStarterCount).toBe(3)
    expect(h.availableStarterCount).toBe(6)
    expect(h.rosterCompleteness).toBe('needs_attention')
    expect(h.benchAvailability).toBe('thin')
    expect(h.summary).toMatch(/3 projected starters are currently unavailable/i)
  })

  it('counts questionable/doubtful/GTD starters separately from out', () => {
    const players = [p('QB', 'Questionable'), p('RB', 'Doubtful'), p('WR', 'GTD'), p('TE', 'Out'), p('BENCH'), p('BENCH')]
    const h = aggregateManagerTeamHealth({ players, currentWeek: 5 }, FIXED)!
    expect(h.questionableStarterCount).toBe(3)
    expect(h.injuredStarterCount).toBe(1)
    // Questionable players are still "available" (not definitively out).
    expect(h.availableStarterCount).toBe(h.starterCount - 1)
  })

  it('counts a starter on bye only when byeWeek === currentWeek and currentWeek > 0', () => {
    const players = [p('QB', null, 7), p('RB', null, 7), p('WR', null, 9), p('BENCH')]
    expect(aggregateManagerTeamHealth({ players, currentWeek: 7 }, FIXED)!.byeWeekStarterCount).toBe(2)
    expect(aggregateManagerTeamHealth({ players, currentWeek: 9 }, FIXED)!.byeWeekStarterCount).toBe(1)
    expect(aggregateManagerTeamHealth({ players, currentWeek: 0 }, FIXED)!.byeWeekStarterCount).toBe(0)
    expect(aggregateManagerTeamHealth({ players, currentWeek: null }, FIXED)!.byeWeekStarterCount).toBe(0)
  })

  it('does not double-count a starter who is both out and on bye in availability', () => {
    const players = [p('QB', 'Out', 4), p('RB'), p('WR'), p('BENCH'), p('BENCH'), p('BENCH')]
    const h = aggregateManagerTeamHealth({ players, currentWeek: 4 }, FIXED)!
    expect(h.injuredStarterCount).toBe(1)
    expect(h.byeWeekStarterCount).toBe(1)
    expect(h.availableStarterCount).toBe(2) // 3 starters - 1 unavailable (deduped)
  })
})

describe('aggregateManagerTeamHealth — bench availability + completeness tiers', () => {
  it('classifies bench depth: >=3 healthy, 1-2 thin, 0 critical (IR/taxi excluded from depth)', () => {
    const base = [p('QB'), p('RB'), p('WR')]
    const three = aggregateManagerTeamHealth({ players: [...base, p('BENCH'), p('bench'), p('BN')], currentWeek: 3 }, FIXED)!
    expect(three.benchAvailability).toBe('healthy')
    const two = aggregateManagerTeamHealth({ players: [...base, p('BENCH'), p('BENCH')], currentWeek: 3 }, FIXED)!
    expect(two.benchAvailability).toBe('thin')
    // IR + taxi are NOT bench-eligible depth → critical (0 usable bench).
    const stashed = aggregateManagerTeamHealth({ players: [...base, p('IR'), p('TAXI'), p('devy')], currentWeek: 3 }, FIXED)!
    expect(stashed.benchAvailability).toBe('critical')
  })

  it('classifies completeness good when bench can cover the holes', () => {
    const players = [p('QB', 'Out'), p('RB'), p('WR'), p('BENCH'), p('BENCH')]
    const h = aggregateManagerTeamHealth({ players, currentWeek: 3 }, FIXED)!
    expect(h.rosterCompleteness).toBe('good') // 1 hole <= 2 cover
  })
})

describe('aggregateManagerTeamHealth — case-insensitivity & contract shape', () => {
  it('is case-insensitive across slotType and injuryStatus conventions', () => {
    const players = [p('qb', 'oUt'), p('Rb', 'iR'), p('wr', 'QUESTIONABLE'), p('bEnCh')]
    const h = aggregateManagerTeamHealth({ players, currentWeek: 3 }, FIXED)!
    expect(h.injuredStarterCount).toBe(2)
    expect(h.questionableStarterCount).toBe(1)
  })

  it('emits the full V1 contract with provenance and an ISO derivedAt', () => {
    const h = aggregateManagerTeamHealth({ players: healthyRoster(), currentWeek: 3 }, FIXED)!
    expect(h.version).toBe(MANAGER_TEAM_HEALTH_VERSION)
    expect(h.derivedAt).toBe(FIXED.toISOString())
    expect(Object.keys(h).sort()).toEqual(
      [
        'availableStarterCount', 'benchAvailability', 'byeWeekStarterCount', 'derivedAt',
        'injuredStarterCount', 'questionableStarterCount', 'rosterCompleteness',
        'starterCount', 'summary', 'version',
      ].sort(),
    )
  })

  it('is deterministic — identical input yields identical output', () => {
    const players = [p('QB', 'Out'), p('RB', 'Questionable', 3), p('WR'), p('BENCH')]
    const a = aggregateManagerTeamHealth({ players, currentWeek: 3 }, FIXED)
    const b = aggregateManagerTeamHealth({ players, currentWeek: 3 }, FIXED)
    expect(a).toEqual(b)
  })

  it('summary carries NO recommendation / advice language', () => {
    const players = [p('QB', 'Out'), p('RB', 'Questionable', 4), p('WR', null, 4), p('BENCH')]
    const summary = aggregateManagerTeamHealth({ players, currentWeek: 4 }, FIXED)!.summary.toLowerCase()
    for (const banned of ['start ', 'sit ', 'pick up', 'add ', 'drop ', 'trade for', 'you should', 'we recommend', 'i recommend', 'suggest']) {
      expect(summary).not.toContain(banned)
    }
  })
})
