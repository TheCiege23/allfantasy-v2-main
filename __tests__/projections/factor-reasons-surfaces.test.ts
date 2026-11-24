import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Why AF moved this" travels with the number to every screen, and the paywall can always take both back
 * (owner, 2026-11-23). The roster/free-agent pricing pass used to apply AF's factors for every viewer and carry no
 * record of the number before them, so the response gate had nothing to revert: a free user saw AF's adjusted number.
 */

const metrics = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('@/lib/af-projections/leaguePlayerMetrics', () => ({ loadLeaguePlayerMetrics: metrics.load }))

import { leagueRosterForecasts } from '@/lib/af-projections/leagueRosterForecasts'
import { nflWeeklyWithFactors } from '@/lib/af-projections/nflWeeklyFactors'
import { withholdAfIntelligence } from '@/lib/core-app/afIntelligenceWithhold'
import { displayPlayerFromUnifiedRow } from '@/lib/player-data/adapters/redraftDisplayPlayers'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'

const REASON = 'listed Questionable or day-to-day before the game -15% (measured on 812 games)'
const league = { id: 'L1', sport: 'NBA', season: 2026, settings: {} }

describe('leagueRosterForecasts', () => {
  beforeEach(() => {
    metrics.load.mockReset()
    metrics.load.mockResolvedValue({
      unit: 'fantasy points',
      rows: [
        { rosterPlayerId: 'p1', playerId: 'p1', position: 'G', positionRank: 4, positionCount: 60, weekly: 85, daily: null,
          afFactors: { multiplier: 0.85, reasons: [REASON], unadjusted: { weekly: 100, daily: null } } },
        { rosterPlayerId: 'p2', playerId: 'p2', position: 'F', positionRank: 9, positionCount: 60, weekly: 70, daily: null },
      ],
    })
  })

  it('carries the reasons with the number before them, so the gate reverts both for a viewer without the plan', async () => {
    const out = await leagueRosterForecasts(
      [{ id: 'p1', projectedPoints: null }, { id: 'p2', projectedPoints: null }], league, ['p1', 'p2'], { afIntelligence: true })
    expect(out[0]).toMatchObject({ projectedPoints: 85, afFactors: { reasons: [REASON], unadjusted: { projectedPoints: 100 } } })
    expect(out[1]).not.toHaveProperty('afFactors')
    // What a free user is sent: the number before AF's factors, and no reasons.
    const locked = withholdAfIntelligence(out)
    expect(locked[0]).toMatchObject({ projectedPoints: 100 })
    expect(locked[0]).not.toHaveProperty('afFactors')
    expect(locked[1]).toMatchObject({ projectedPoints: 70 })
  })

  it('asks for the metrics without factors for a viewer without the plan', async () => {
    await leagueRosterForecasts([{ id: 'p1', projectedPoints: null }], league, ['p1'], { afIntelligence: false })
    expect(metrics.load.mock.calls[0]![0]).toMatchObject({ afIntelligence: false })
  })

  it('a player ruled out is a zero with no reasons', async () => {
    const out = await leagueRosterForecasts([{ id: 'p1', projectedPoints: null, injuryStatus: 'Out' }], league, ['p1'], { afIntelligence: true })
    expect(out[0]).toMatchObject({ projectedPoints: 0 })
    expect(out[0]).not.toHaveProperty('afFactors')
  })
})

describe('nflWeeklyWithFactors', () => {
  const f = { multiplier: 0.85, reasons: [REASON] }
  it('with the plan: the adjusted number, with the number before the factors kept for the gate', () => {
    expect(nflWeeklyWithFactors(17, f, true)).toEqual({ weekly: 17, afFactors: { multiplier: 0.85, reasons: [REASON], unadjusted: { weekly: 20 } } })
  })
  it('without the plan: the number before the factors and no reasons', () => {
    expect(nflWeeklyWithFactors(17, f, false)).toEqual({ weekly: 20 })
  })
  it('no factors, a neutral one, or no number: untouched', () => {
    expect(nflWeeklyWithFactors(17, null, true)).toEqual({ weekly: 17 })
    expect(nflWeeklyWithFactors(17, { multiplier: 1, reasons: [] }, true)).toEqual({ weekly: 17 })
    expect(nflWeeklyWithFactors(null, f, true)).toEqual({ weekly: null })
  })
})

describe('displayPlayerFromUnifiedRow', () => {
  const base = { id: 'p1', name: 'A Player', position: 'G', team: 'BOS', projectedPoints: 85,
    afFactors: { multiplier: 0.85, reasons: [REASON] } } as unknown as UnifiedPlayerWireDto
  it('keeps the reasons when the number shown is the row\'s own AF-priced one', () => {
    expect(displayPlayerFromUnifiedRow(base).afFactors?.reasons).toEqual([REASON])
  })
  it('drops them when the row has no number of its own to explain', () => {
    const none = { ...base, projectedPoints: null } as unknown as UnifiedPlayerWireDto
    const shown = displayPlayerFromUnifiedRow(none)
    expect(shown.projectedPoints).toBeNull()
    expect(shown.afFactors).toBeUndefined()
  })
})
