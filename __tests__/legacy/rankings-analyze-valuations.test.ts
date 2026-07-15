import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Regression coverage for Team Direction / rankings-analyze player valuations
 * (AF_DATA_PROVENANCE_AUDIT.md demo risk #1).
 *
 * Original bug: getFantasyCalcValues() was a stub that always returned an empty map, so
 * EVERY player fell back to a flat position+age price (4000/3500...) and the "tier" label
 * looked real but wasn't. These tests certify:
 *   1. the FantasyCalc map is real and non-empty (the stub is gone);
 *   2. the fallback is per-MISSING-player only, so the large majority price from FC;
 *   3. a provider outage is LOUD (empty map + console.error), never silent flat prices;
 *   4. FC values drive roster value ordering (the input to overallScore -> tier).
 */

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: vi.fn(() => (handler: unknown) => handler) }))
// The route builds an OpenAI client at module load (line 22); jsdom trips the SDK's browser
// guard. Stub it — these tests exercise only the (LLM-free) valuation functions.
vi.mock('@/lib/ai/openai-route-client', () => ({ getOpenAIRouteClient: vi.fn(() => ({})) }))
vi.mock('@/lib/fantasycalc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/fantasycalc')>()
  return { ...actual, fetchFantasyCalcValues: vi.fn() }
})

import {
  getFantasyCalcValues,
  calculatePositionalValuesWithPlayers,
} from '@/server/api-route-modules/legacy/rankings/analyze/route'
import { fetchFantasyCalcValues } from '@/lib/fantasycalc'

function fc(name: string, value: number) {
  return { player: { name }, value }
}

describe('rankings-analyze valuations (provenance #1)', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('getFantasyCalcValues', () => {
    it('builds a real non-empty name->value map from FantasyCalc (not the old empty stub)', async () => {
      vi.mocked(fetchFantasyCalcValues).mockResolvedValue([
        fc('Josh Allen', 9000),
        fc('Bijan Robinson', 8000),
        fc('CeeDee Lamb', 8500),
      ] as never)

      const map = await getFantasyCalcValues({
        total_rosters: 12,
        roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX'],
      })

      expect(map.size).toBe(3)
      expect(map.get('josh allen')).toBe(9000)
      expect(map.get('ceedee lamb')).toBe(8500)
    })

    it('passes superflex settings through (numQbs=2 when SF, numTeams from league)', async () => {
      vi.mocked(fetchFantasyCalcValues).mockResolvedValue([] as never)
      await getFantasyCalcValues({ total_rosters: 10, roster_positions: ['QB', 'SUPER_FLEX'] })
      expect(fetchFantasyCalcValues).toHaveBeenCalledWith(
        expect.objectContaining({ numQbs: 2, numTeams: 10 })
      )
    })

    it('LOUD FAILURE: a FantasyCalc outage yields an empty map + console.error (not silent flat prices)', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(fetchFantasyCalcValues).mockRejectedValue(new Error('FantasyCalc API error: 503'))

      const map = await getFantasyCalcValues({ total_rosters: 12, roster_positions: [] })

      expect(map.size).toBe(0)
      expect(errSpy).toHaveBeenCalled()
      errSpy.mockRestore()
    })
  })

  describe('calculatePositionalValuesWithPlayers', () => {
    const playersData: Record<string, unknown> = {
      p_qb: { first_name: 'Josh', last_name: 'Allen', position: 'QB', age: 28, team: 'BUF' },
      p_rb: { first_name: 'Bijan', last_name: 'Robinson', position: 'RB', age: 22, team: 'ATL' },
      p_wr: { first_name: 'CeeDee', last_name: 'Lamb', position: 'WR', age: 25, team: 'DAL' },
      p_te: { first_name: 'Sam', last_name: 'LaPorta', position: 'TE', age: 23, team: 'DET' },
      p_miss: { first_name: 'Deep', last_name: 'Bench', position: 'RB', age: 30, team: 'FA' },
    }
    const roster = ['p_qb', 'p_rb', 'p_wr', 'p_te', 'p_miss']
    const fcMap = () =>
      new Map<string, number>([
        ['josh allen', 9000],
        ['bijan robinson', 8000],
        ['ceedee lamb', 8500],
        ['sam laporta', 4200],
      ])

    it('prices rostered players from FantasyCalc, not the flat position base', () => {
      const result = calculatePositionalValuesWithPlayers(roster, fcMap(), playersData)
      const priced = [
        ...result.players.qb,
        ...result.players.rb,
        ...result.players.wr,
        ...result.players.te,
      ]
      const byName = Object.fromEntries(priced.map((p) => [p.name, p.value]))

      // Exact FC values survive — NOT the flat 4000/3500 base the original bug produced.
      expect(byName['Josh Allen']).toBe(9000)
      expect(byName['Bijan Robinson']).toBe(8000)
      expect(byName['CeeDee Lamb']).toBe(8500)
      expect(byName['Sam LaPorta']).toBe(4200)
      // The single unmatched player falls back per-player: RB base 3500 * age-30 adj 0.65.
      expect(byName['Deep Bench']).toBe(Math.round(3500 * 0.65))
    })

    it('measures the fallback rate: the large majority price from FantasyCalc', () => {
      const map = fcMap()
      const result = calculatePositionalValuesWithPlayers(roster, map, playersData)
      const allPlayers = [
        ...result.players.qb,
        ...result.players.rb,
        ...result.players.wr,
        ...result.players.te,
      ]
      const fromFc = allPlayers.filter((p) => map.get(p.name.toLowerCase()) === p.value).length
      const fallbackRate = 1 - fromFc / allPlayers.length

      expect(fromFc).toBe(4)
      expect(fallbackRate).toBeLessThanOrEqual(0.25) // at most 1 of 5 fell back
    })

    it('tier input is real: an all-FC roster out-values an all-fallback roster (feeds overallScore -> tier)', () => {
      const starters = ['p_qb', 'p_rb', 'p_wr', 'p_te']
      const realTeam = calculatePositionalValuesWithPlayers(starters, fcMap(), playersData)
      const flatTeam = calculatePositionalValuesWithPlayers(starters, new Map(), playersData)
      expect(realTeam.total).toBeGreaterThan(flatTeam.total)
    })
  })
})
