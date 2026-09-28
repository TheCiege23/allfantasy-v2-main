import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Team defenses are priced (2026-09-28). Before this, FantasyCalc and the league board both priced
 * none, `pricePlayer` refused every DEF/DST, and ANY trade carrying a defense got no grade.
 * See lib/defense-values/leagueDefenseValue.ts for the measurement behind the flat value.
 */

vi.mock('@/lib/idp-projections/idpTradeValues', () => ({
  loadIdpTradeValuesByName: async () => ({
    byNameLower: new Map(),
    bySleeperId: new Map(),
    unpricedReasonByNameLower: new Map(),
    skipped: 'no_idp_scoring',
    coverage: { defenders: 0, projected: 0, priced: 0, named: 0 },
    ambiguousNames: [],
  }),
}))
vi.mock('@/lib/sleeper-client', () => ({ getLeagueInfo: vi.fn(), getLeagueRosters: vi.fn(), getPlayersBySport: vi.fn() }))

const getHistoricalPlayerValue = vi.fn()
const findPlayerByName = vi.fn()
const getPlayerAnalytics = vi.fn()
vi.mock('@/lib/historical-values', () => ({
  getHistoricalPlayerValue: (...a: unknown[]) => getHistoricalPlayerValue(...a),
  getHistoricalPickValueWeighted: vi.fn(() => ({ value: null })),
}))
vi.mock('@/lib/fantasycalc', () => ({ findPlayerByName: (...a: unknown[]) => findPlayerByName(...a) }))
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: vi.fn(async () => []) }))
vi.mock('@/lib/player-analytics', () => ({ getPlayerAnalytics: (...a: unknown[]) => getPlayerAnalytics(...a) }))

import {
  DEFENSE_CEILING_DYNASTY,
  DEFENSE_CEILING_REDRAFT,
  countDefenseSlots,
  defenseShareAtRank,
  resolveLeagueDefenseValue,
} from '@/lib/defense-values/leagueDefenseValue'
import { defenseNameAliases, loadLeagueTradeValues } from '@/lib/league-values/leagueTradeValues'

const { pricePlayer } = await import('@/lib/hybrid-valuation')

const RAVENS = { first_name: 'Baltimore', last_name: 'Ravens', position: 'DEF', team: 'BAL' }

describe('resolveLeagueDefenseValue — priced as a position, from the league', () => {
  it('counts DEF, DST and D/ST slots; a league starting none prices no defense at all', () => {
    expect(countDefenseSlots(['QB', 'RB', 'DEF', 'K'])).toBe(1)
    expect(countDefenseSlots(['DST', 'd/st'])).toBe(2)
    expect(resolveLeagueDefenseValue({ rosterPositions: ['QB', 'RB', 'K'], numTeams: 12, isDynasty: false }).value).toBeNull()
  })

  it('reads the measured share curve (held flat past DEF32)', () => {
    expect(defenseShareAtRank(1)).toBe(1)
    expect(defenseShareAtRank(12)).toBeCloseTo(0.703)
    expect(defenseShareAtRank(15)).toBeCloseTo((0.703 + 0.61) / 2)
    expect(defenseShareAtRank(40)).toBeCloseTo(0.323)
  })

  it('a 12-team one-DEF league: replacement DEF13, redraft above dynasty, both under the ceiling', () => {
    const redraft = resolveLeagueDefenseValue({ rosterPositions: ['DEF'], numTeams: 12, isDynasty: false })
    const dynasty = resolveLeagueDefenseValue({ rosterPositions: ['DEF'], numTeams: 12, isDynasty: true })
    expect(redraft.replacementRank).toBe(13)
    expect(redraft.value).toBe(314)
    expect(dynasty.value).toBe(241)
    expect(redraft.value!).toBeLessThan(DEFENSE_CEILING_REDRAFT)
    expect(dynasty.value!).toBeLessThan(DEFENSE_CEILING_DYNASTY)
    expect(redraft.basis).toMatch(/replacement is about DEF13/)
  })

  it('more demand for the same 32 defenses makes each one dearer', () => {
    const one = resolveLeagueDefenseValue({ rosterPositions: ['DEF'], numTeams: 10, isDynasty: false }).value!
    const two = resolveLeagueDefenseValue({ rosterPositions: ['DEF', 'DEF'], numTeams: 14, isDynasty: false }).value!
    expect(two).toBeGreaterThan(one)
  })
})

describe('the league board prices rostered team defenses', () => {
  const load = (rosterPositions: string[], players: Record<string, Record<string, string>>, roster: string[]) =>
    loadLeagueTradeValues({
      prisma: {} as never,
      platformLeagueId: 'L',
      isDynasty: false,
      prefetched: { rosterPositions, numTeams: 12, rosters: [{ players: roster }], players },
    })

  it('🛑 a rostered defense is priced by its Sleeper id and by the names a manager types', async () => {
    const values = await load(['QB', 'DEF', 'K'], { BAL: RAVENS, k1: { full_name: 'Justin Tucker', position: 'K' } }, ['BAL', 'k1'])
    expect(values.defense).toMatchObject({ value: 314, named: 1 })
    expect(values.bySleeperId?.get('BAL')).toMatchObject({ value: 314, position: 'DEF', basis: 'dst-flat', sleeperId: 'BAL', name: 'Baltimore Ravens' })
    for (const typed of ['baltimore ravens', 'ravens', 'bal', 'baltimore ravens d/st', 'bal dst', 'ravens defense']) {
      expect(values.byNameLower.get(typed)?.basis, typed).toBe('dst-flat')
    }
    // The kicker half still works beside it.
    expect(values.bySleeperId?.get('k1')?.basis).toBe('kicker-flat')
  })

  it('a league that starts no defense gets no defense entries', async () => {
    const values = await load(['QB', 'K'], { BAL: RAVENS }, ['BAL'])
    expect(values.defense.value).toBeNull()
    expect(values.bySleeperId?.has('BAL')).toBe(false)
    expect(values.byNameLower.has('ravens')).toBe(false)
  })

  it('an alias another rostered player already carries is not taken; the defense’s own full name is', async () => {
    const values = await load(
      ['DEF'],
      { BAL: { ...RAVENS, full_name: 'Baltimore Ravens' }, wr: { full_name: 'Ravens', position: 'WR' } },
      ['BAL', 'wr'],
    )
    expect(values.byNameLower.has('ravens')).toBe(false)
    expect(values.byNameLower.get('baltimore ravens')?.sleeperId).toBe('BAL')
  })

  it('aliases cover the full name, nickname and team code with the usual suffixes', () => {
    expect(defenseNameAliases('BAL', RAVENS)).toEqual(
      expect.arrayContaining(['baltimore ravens', 'ravens', 'bal', 'bal d/st', 'ravens dst', 'baltimore ravens defense', 'bal def']),
    )
  })
})

describe('pricePlayer', () => {
  const TODAY = new Date().toISOString().slice(0, 10)
  const entry = { value: 314, name: 'Baltimore Ravens', position: 'DEF', basis: 'dst-flat' as const, sleeperId: 'BAL' }

  beforeEach(() => {
    vi.clearAllMocks()
    findPlayerByName.mockReturnValue(null)
    getHistoricalPlayerValue.mockReturnValue({ value: null })
    getPlayerAnalytics.mockResolvedValue(null)
  })

  it('prices a defense from the league board — by id and by typed name', async () => {
    const ctx = {
      asOfDate: TODAY,
      isSuperFlex: false,
      fantasyCalcPlayers: [] as never[],
      leagueValueBySleeperId: new Map([['BAL', entry]]),
      leagueValueByNameLower: new Map([['baltimore ravens', entry]]),
    }
    const byId = await pricePlayer('Baltimore Ravens', ctx, { sleeperId: 'BAL', position: 'DEF' })
    expect(byId).toMatchObject({ value: 314, source: 'dst-flat', position: 'DEF' })
    expect(byId.unpriced).toBeFalsy()
    expect(await pricePlayer('Baltimore Ravens', ctx)).toMatchObject({ value: 314, source: 'dst-flat' })
  })

  it('without a league board a defense is still refused — never guessed', async () => {
    const ctx = { asOfDate: TODAY, isSuperFlex: false, fantasyCalcPlayers: [] as never[], leagueValueBySleeperId: new Map() }
    const refused = await pricePlayer('Baltimore Ravens', ctx, { sleeperId: 'BAL', position: 'DEF' })
    expect(refused.unpriced).toBe(true)
    expect(refused.unpricedReason?.label).toMatch(/team defenses/)
  })
})
