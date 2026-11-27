import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  league: vi.fn(),
  keeps: vi.fn(),
  picks: vi.fn(),
  draft: vi.fn(),
  evaluate: vi.fn(),
  ranks: vi.fn(),
  facts: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: m.league },
    keeperRecord: { findMany: m.keeps },
    draftPick: { findMany: m.picks },
    draftSession: { findFirst: m.draft },
    draftFact: { findMany: m.facts },
  },
}))
vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: class {
    evaluateUserFeatureAccess = m.evaluate
  },
}))
vi.mock('@/lib/keeper/keeperMarketValues', () => ({ loadKeeperMarketRanks: m.ranks }))

import { describeKeeperCardCost, keeperRuleLabel } from '@/lib/keeper/keeperCardCostLine'
import { loadPlayerKeeperCardCost } from '@/lib/keeper/keeperCardCost'
import type { KeeperRules } from '@/lib/keeper/keeperRules'

const rules = (over: Partial<KeeperRules> = {}): KeeperRules => ({
  costSystem: 'round_based', roundsEarlier: 1, inflationPerYear: 1, waiverCostRound: null, minCostRound: null, sameRoundRule: 'player_chooses', ...over,
})

describe('player card keeper line — words', () => {
  it('names the rule: same round / 1 round earlier / 1 round later', () => {
    expect(keeperRuleLabel(rules({ roundsEarlier: 0 }))).toBe('same round')
    expect(keeperRuleLabel(rules({ roundsEarlier: 1 }))).toBe('1 round earlier')
    expect(keeperRuleLabel(rules({ roundsEarlier: -1 }))).toBe('1 round later')
  })

  it('cost, history and the value of keeping him (the Keepers tab’s keeperValue)', () => {
    const line = describeKeeperCardCost({
      rules: rules(), cost: { ok: true, costRound: 5 }, basis: 'drafted', lastRound: 6, valuation: { marketRank: 14, teams: 12 },
    })
    expect(line.headline).toBe('Keeper cost: Round 5')
    expect(line.detail).toBe('Drafted Round 6 last season · league rule: 1 round earlier')
    // Round 5 in a 12-team league uses about the 54th pick: 54 − 14 = 40 picks of value.
    expect(line.value).toMatchObject({ marketRank: 14, pickSlot: 54, surplus: 40 })
    expect(line.value?.sentence).toBe('Market rank #14; a Round 5 keeper uses about the #54 pick — 40 picks of value.')
  })

  it('a player worth less than his pick says so; an unpriced one gets the cost alone', () => {
    const bad = describeKeeperCardCost({ rules: rules(), cost: { ok: true, costRound: 2 }, basis: 'drafted', lastRound: 3, valuation: { marketRank: 90, teams: 12 } })
    expect(bad.value?.surplus).toBe(-72)
    expect(bad.value?.sentence).toMatch(/he costs 72 picks more than he is worth/)
    const unpriced = describeKeeperCardCost({ rules: rules(), cost: { ok: true, costRound: 2 }, basis: 'drafted', lastRound: 3, valuation: { marketRank: null, teams: 12 } })
    expect(unpriced.value).toBeNull()
  })

  it('pickups and the round floor', () => {
    expect(describeKeeperCardCost({ rules: rules(), cost: { ok: true, costRound: 15 }, basis: 'waiver', lastRound: null }).detail)
      .toBe('Not drafted last season · league rule: pickups cost the last round')
    const floor = describeKeeperCardCost({ rules: rules({ minCostRound: 2 }), cost: { ok: false, costRound: 1 }, basis: 'drafted', lastRound: 2 })
    expect(floor).toMatchObject({ canKeep: false, costRound: null })
    expect(floor.headline).toMatch(/Can’t be kept/)
  })
})

describe('player card keeper line — when it shows', () => {
  const keeperLeague = {
    userId: 'commish', sport: 'NFL', settings: {}, leagueType: 'keeper', leagueSize: 12, scoringPresetId: null,
    keeperCostSystem: 'round_based', keeperRoundPenalty: 1, keeperInflationRate: 1, keeperConflictRule: 'player_chooses',
  }
  const subject = { leagueId: 'L', sleeperId: '4034', externalId: null, name: 'Christian McCaffrey', position: 'RB' }
  beforeEach(() => {
    vi.clearAllMocks()
    m.league.mockResolvedValue(keeperLeague)
    m.keeps.mockResolvedValue([])
    m.picks.mockResolvedValue([{ playerId: '4034', playerName: 'Christian McCaffrey', position: 'RB', round: 6 }])
    m.draft.mockResolvedValue({ rounds: 15 })
    m.ranks.mockResolvedValue(() => 14)
  })

  it('not in a non-keeper league', async () => {
    m.league.mockResolvedValue({ ...keeperLeague, leagueType: 'redraft' })
    expect(await loadPlayerKeeperCardCost(subject)).toBeNull()
    expect(m.evaluate).not.toHaveBeenCalled()
  })

  it('locked when the commissioner is on free / AF Pro', async () => {
    m.evaluate.mockResolvedValue({ allowed: false })
    expect(await loadPlayerKeeperCardCost(subject)).toBeNull()
    expect(m.evaluate).toHaveBeenCalledWith('commish', 'commissioner_automation')
  })

  it('shown when the commissioner holds AF Commissioner / AF Supreme: drafted R6, 1 round earlier → R5 with its value', async () => {
    m.evaluate.mockResolvedValue({ allowed: true })
    const line = await loadPlayerKeeperCardCost(subject)
    expect(line).toMatchObject({ costRound: 5, headline: 'Keeper cost: Round 5', detail: 'Drafted Round 6 last season · league rule: 1 round earlier' })
    expect(line?.value).toMatchObject({ surplus: 40 })
  })

  it('a kept player’s cost walks from last season’s KEEPER round', async () => {
    m.evaluate.mockResolvedValue({ allowed: true })
    m.keeps.mockResolvedValue([{ playerId: '4034', playerName: 'Christian McCaffrey', position: 'RB', costRound: 5 }])
    const line = await loadPlayerKeeperCardCost(subject)
    expect(line).toMatchObject({ costRound: 4, detail: 'Kept at Round 5 last season · league rule: 1 round earlier' })
  })
})

describe('player card keeper line — imported keeper leagues (draft history the import stored)', () => {
  const imported = (over: Record<string, unknown> = {}) => ({
    userId: 'commish', sport: 'NFL', settings: {}, leagueType: 'keeper', leagueSize: 12, scoringPresetId: null,
    keeperCostSystem: 'round_based', keeperRoundPenalty: 1, keeperInflationRate: 1, keeperConflictRule: 'player_chooses',
    platform: 'sleeper', season: 2027, keeperWaiverAllowed: true, keeperMaxYears: null, ...over,
  })
  const fact = (playerId: string, season: number, round: number, isKeeper = false) => ({ playerId, season, round, metadata: { isKeeper } })
  const filler = Array.from({ length: 15 }, (_, i) => fact(`f${i}`, 2026, i + 1))
  const subject = { leagueId: 'L', sleeperId: '4034', externalId: null, name: 'Christian McCaffrey', position: 'RB' }
  beforeEach(() => {
    vi.clearAllMocks()
    m.evaluate.mockResolvedValue({ allowed: true })
    m.ranks.mockResolvedValue(() => 14)
    m.league.mockResolvedValue(imported())
    m.facts.mockResolvedValue([...filler, fact('4034', 2026, 6)])
  })

  it('Sleeper: drafted R6 in the imported 2026 draft, league rule 1 round earlier → Round 5, with its value', async () => {
    const line = await loadPlayerKeeperCardCost(subject)
    expect(line).toMatchObject({ costRound: 5, headline: 'Keeper cost: Round 5' })
    expect(line?.detail).toBe("Drafted Round 6 last season · league rule: 1 round earlier · from the league's imported 2026 draft")
    expect(line?.value).toMatchObject({ surplus: 40 })
    expect(m.picks).not.toHaveBeenCalled() // native draft tables are not read for an imported league
  })

  it('a player kept in the imported draft walks from his keeper round', async () => {
    m.facts.mockResolvedValue([...filler, fact('4034', 2025, 7), fact('4034', 2026, 6, true)])
    expect(await loadPlayerKeeperCardCost(subject)).toMatchObject({ costRound: 5, detail: expect.stringMatching(/^Kept at Round 6 last season/) })
  })

  it('a Sleeper player absent from last season’s draft is a pickup: the last round', async () => {
    m.facts.mockResolvedValue(filler)
    expect(await loadPlayerKeeperCardCost(subject)).toMatchObject({ costRound: 15, detail: expect.stringMatching(/^Not drafted last season/) })
  })

  it('no line rather than a guess: no draft on file, or only an older draft', async () => {
    m.facts.mockResolvedValue([])
    expect(await loadPlayerKeeperCardCost(subject)).toBeNull()
    m.facts.mockResolvedValue([fact('4034', 2024, 6), ...filler.map((f) => ({ ...f, season: 2024 }))])
    expect(await loadPlayerKeeperCardCost(subject)).toBeNull()
  })

  it('outside Sleeper, a player the imported history does not name gets no line (ids may be the provider’s)', async () => {
    m.league.mockResolvedValue(imported({ platform: 'espn' }))
    m.facts.mockResolvedValue(filler)
    expect(await loadPlayerKeeperCardCost(subject)).toBeNull()
    m.facts.mockResolvedValue([...filler, fact('4034', 2026, 9)])
    expect(await loadPlayerKeeperCardCost(subject)).toMatchObject({ costRound: 8 })
  })

  it('the same gate: the commissioner’s plan', async () => {
    m.evaluate.mockResolvedValue({ allowed: false })
    expect(await loadPlayerKeeperCardCost(subject)).toBeNull()
    expect(m.facts).not.toHaveBeenCalled()
  })

  it('pickups not allowed as keepers: the card says he can’t be kept', async () => {
    m.league.mockResolvedValue(imported({ keeperWaiverAllowed: false }))
    m.facts.mockResolvedValue(filler)
    expect(await loadPlayerKeeperCardCost(subject)).toMatchObject({ canKeep: false, headline: 'Can’t be kept' })
  })
})
