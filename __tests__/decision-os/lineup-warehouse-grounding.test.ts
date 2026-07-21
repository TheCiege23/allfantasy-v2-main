import { describe, expect, it, vi } from 'vitest'

// F2.9+F2.10 → manager.lineup.set SHADOW enrichment (ADR F2.10). The Decision Object must
// cite stored warehouse facts through its EXISTING fields, degrade honestly, keep
// confidence and data_completeness independently computed, satisfy assertFourAnswers, and
// leave deterministic rules + live behavior untouched.

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { assertFourAnswers } from '@/lib/decision-os/core/decision'
import { buildLineupDCO } from '@/lib/decision-os/lineup/dco'
import { decideLineupSet } from '@/lib/decision-os/lineup/decision'
import { projectLineupWarehouseFacts } from '@/lib/decision-os/lineup/warehouseFacts'
import type { RawMatchupFactRow, RawPlayerGameFactRow } from '@/lib/decision-os/world/facts'
import type { LineupWorld } from '@/lib/decision-os/lineup/world'

const perfRow = (playerId: string, week: number, points: number, season = 2025): RawPlayerGameFactRow => ({
  playerId, sport: 'NFL', season, weekOrRound: week, fantasyPoints: points,
  normalizedStats: {}, createdAt: new Date('2026-06-30T00:00:00Z'),
})
const matchRow = (over: Partial<RawMatchupFactRow>): RawMatchupFactRow => ({
  leagueId: 'L1', sport: 'NFL', season: 2025, weekOrPeriod: 1,
  teamACanonicalId: 'team-me', teamBCanonicalId: 'team-opp',
  scoreA: 100, scoreB: 90, winnerCanonicalId: 'team-me', isComplete: true,
  createdAt: new Date('2026-06-30T00:00:00Z'), ...over,
})

const world: LineupWorld = {
  week: 3,
  facts: { rosterConfig: null },
  lock_state: { locked: false, uncertainty: null },
} as never

const players = [
  { playerId: '4984', playerName: 'QB One', position: 'QB', sport: 'NFL' },
  { playerId: '3198', playerName: 'RB One', position: 'RB', sport: 'NFL' },
] as never[]

const decisionDeps = {
  recommend: async () => ({ leagues: [], actions: [] }) as never,
  ruleDeps: { validateRedraft: () => ({ issues: [] }) } as never,
  newId: () => 'test-decision-id',
}

async function decideWith(warehouse: ReturnType<typeof projectLineupWarehouseFacts> | undefined) {
  const dco = buildLineupDCO({
    world, userId: 'u1', leagueId: 'L1', sport: 'NFL', rosterId: 'r1',
    players: players as never, projectionConfidence: 80, warehouse,
  })
  return { dco, decision: await decideLineupSet(dco, decisionDeps as never) }
}

describe('Example 1 — strong warehouse support', () => {
  it('cites stored performance and matchup facts; confidence and completeness both reported and independent', async () => {
    const warehouse = projectLineupWarehouseFacts({
      performanceRows: [perfRow('4984', 1, 30), perfRow('4984', 2, 40), perfRow('3198', 1, 20), perfRow('3198', 2, 10)],
      matchupRows: [matchRow({ weekOrPeriod: 1 }), matchRow({ weekOrPeriod: 2, scoreA: 80, scoreB: 95, winnerCanonicalId: 'team-opp' })],
      playerIds: ['4984', '3198'],
      teamId: 'team-me',
      leagueSeason: 2025,
    })
    expect(warehouse.performance).toMatchObject({ playersWithHistory: 2, totalPlayers: 2, seasonMismatch: false })
    expect(warehouse.matchup?.currentSeason).toMatchObject({ wins: 1, losses: 1, sampleSize: 2 })

    const { dco, decision } = await decideWith(warehouse)
    expect(() => assertFourAnswers(decision)).not.toThrow()
    // Facts are CITED — real stored aggregates in the explanation surface.
    expect(decision.four_answers.why_it_matters).toMatch(/Grounded in stored results/)
    expect(decision.four_answers.why_it_matters).toMatch(/2 of 2 roster players/)
    expect(decision.four_answers.why_it_matters).toMatch(/stored current-season record is 1-1 over 2 completed matchups/)
    expect(typeof decision.confidence).toBe('number')
    expect(typeof decision.data_completeness).toBe('number')
    // Independence: completeness derives from input coverage (100 here); confidence from the
    // decision state — computed by different functions on different inputs.
    expect(dco.data_completeness).toBe(100)
    expect(decision.confidence).not.toBeNaN()
  })
})

describe('Example 2 — partial support', () => {
  it('performance cited, matchup honestly unavailable — no zero-record fallback anywhere', async () => {
    const warehouse = projectLineupWarehouseFacts({
      performanceRows: [perfRow('4984', 1, 30), perfRow('4984', 2, 40)],
      matchupRows: [], // sparse coverage — the NORMAL path
      playerIds: ['4984', '3198'],
      teamId: 'team-me',
      leagueSeason: 2025,
    })
    expect(warehouse.matchup).toBeNull()
    expect(warehouse.uncertainty).toContain('warehouse_matchup_unavailable: no completed matchup history stored for this team')

    const { decision } = await decideWith(warehouse)
    expect(() => assertFourAnswers(decision)).not.toThrow()
    expect(decision.four_answers.why_it_matters).toMatch(/1 of 2 roster players/)
    // NO fabricated record — the sentence simply is not written.
    expect(decision.four_answers.why_it_matters).not.toMatch(/current-season record/)
    expect(decision.four_answers.why_it_matters).not.toMatch(/0-0/)
    expect(decision.uncertainty_sources.some((u) => u.startsWith('warehouse_matchup_unavailable'))).toBe(true)
  })
})

describe('Example 3 — insufficient support', () => {
  it('neither source reliable: uncertainty lists every gap, nothing is invented, contract holds', async () => {
    const warehouse = projectLineupWarehouseFacts({
      performanceRows: [perfRow('4984', 17, 22, 2024)], // prior season only
      matchupRows: [],
      playerIds: ['4984', '3198'],
      teamId: null, // team identity unresolved
      leagueSeason: 2026,
    })
    expect(warehouse.performance?.seasonMismatch).toBe(true)
    expect(warehouse.matchup).toBeNull()
    expect(warehouse.uncertainty.some((u) => u.startsWith('warehouse_season_mismatch'))).toBe(true)
    expect(warehouse.uncertainty.some((u) => u.startsWith('warehouse_matchup_unavailable'))).toBe(true)

    const { decision } = await decideWith(warehouse)
    expect(() => assertFourAnswers(decision)).not.toThrow()
    // Season-mismatched grounding is LABELLED, never presented as current form.
    expect(decision.four_answers.why_it_matters).toMatch(/\(2024 season data\)/)
    // Missing inputs are listed for the caller.
    expect(decision.uncertainty_sources.filter((u) => u.startsWith('warehouse_')).length).toBeGreaterThanOrEqual(2)
    // No matchup numbers appear anywhere.
    expect(decision.four_answers.why_it_matters).not.toMatch(/record/)
  })
})

describe('compatibility and shadow isolation', () => {
  it('a DCO without warehouse facts behaves exactly as before (older callers unaffected)', async () => {
    const { dco, decision } = await decideWith(undefined)
    expect(dco.warehouse).toBeUndefined()
    expect(() => assertFourAnswers(decision)).not.toThrow()
    expect(decision.four_answers.why_it_matters).not.toMatch(/Grounded in stored results/)
    expect(decision.uncertainty_sources.every((u) => !u.startsWith('warehouse_'))).toBe(true)
  })

  it('warehouse facts never touch rule verdicts or recommended actions (rules stay deterministic)', async () => {
    const grounded = await decideWith(projectLineupWarehouseFacts({
      performanceRows: [perfRow('4984', 1, 30)], matchupRows: [matchRow({})],
      playerIds: ['4984'], teamId: 'team-me', leagueSeason: 2025,
    }))
    const bare = await decideWith(undefined)
    expect(grounded.decision.rule_verdicts).toEqual(bare.decision.rule_verdicts)
    expect(grounded.decision.recommended_actions).toEqual(bare.decision.recommended_actions)
  })
})
